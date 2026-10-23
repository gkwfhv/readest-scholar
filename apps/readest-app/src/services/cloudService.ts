import {
  AppService,
  FileSystem,
  BaseDir,
  DeleteAction,
  ScholarFileUploadContext,
} from '@/types/system';
import { Book } from '@/types/book';
import {
  getDir,
  getLocalBookFilename,
  getRemoteBookFilename,
  getCoverFilename,
} from '@/utils/book';
import {
  downloadFile,
  uploadFile,
  uploadReplicaFile,
  deleteFile as deleteCloudFile,
  createProgressHandler,
  batchGetDownloadUrls,
} from '@/libs/storage';
import { ClosableFile } from '@/utils/file';
import { ProgressHandler } from '@/utils/transfer';
import { CLOUD_BOOKS_SUBDIR, CLOUD_REPLICAS_SUBDIR } from './constants';
import { isBookFileContentSource, resolveBookContentSource } from './bookContent';
import { getAbsOfflineDir } from '@/utils/audiobook';
import { isScholarReleaseBundle, isScholarTestBundle, getAPIBaseUrl } from '@/services/environment';
import { fetchWithAuth } from '@/utils/fetch';
import { uploadScholarFileVersion } from '@/libs/scholarFileVersion';
import { sha256File } from '@/services/dictionaries/plugins/integrity';
import {
  getScholarAccountId,
  getScholarFileBaseline,
  saveScholarFileBaseline,
} from './scholarFileBaseline';

export async function deleteBook(
  fs: FileSystem,
  book: Book,
  deleteAction: DeleteAction,
): Promise<void> {
  if (deleteAction === 'local' || deleteAction === 'both' || deleteAction === 'purge') {
    const source = await resolveBookContentSource(fs, book);
    // Only remove files Readest itself created. A 'managed' source lives under
    // our Books/<hash>/ dir (a copy we made on import), so it is ours to delete.
    // An 'external' source is the user's own file at a user-controlled location
    // (book.filePath, base 'None') — e.g. a "Read books in place" import or a
    // transiently-opened file. Deleting a book from Readest must NEVER remove
    // that source file; doing so silently destroyed users' originals.
    if (source.kind === 'managed' && deleteAction !== 'purge') {
      // Purge wipes the whole directory below, so skip the per-file removal.
      if (await fs.exists(source.path, source.base)) {
        await fs.removeFile(source.path, source.base);
      }
    }

    // Purge erases the entire app-generated Books/<hash>/ directory — the
    // managed book file, cover.png, and (the reason for issue #4615)
    // config.json (reading progress, notes, bookmarks) + nav.json that the
    // other delete actions leave behind. In-place books keep their external
    // source file untouched; this only clears Readest's own sidecar dir.
    if (deleteAction === 'purge') {
      const dir = getDir(book);
      if (await fs.exists(dir, 'Books')) {
        await fs.removeDir(dir, 'Books', true);
      }
      // The per-book TTS audio cache lives under Cache (kept out of Books/
      // so backups and sync never pick it up); purge erases every trace of
      // the book, so drop it too. Non-purge deletes leave it: like
      // config.json, a re-downloaded book resumes with a warm audio cache.
      const ttsCacheDir = `tts-cache/${book.hash}`;
      if (await fs.exists(ttsCacheDir, 'Cache')) {
        await fs.removeDir(ttsCacheDir, 'Cache', true);
      }
    }

    // An offline Audiobookshelf download keeps its tracks beside the book
    // (#6256); purge already wiped the whole directory above.
    if (book.format === 'ABS' && deleteAction !== 'purge') {
      const offlineDir = getAbsOfflineDir(book.hash);
      if (await fs.exists(offlineDir, 'Books')) {
        await fs.removeDir(offlineDir, 'Books', true);
      }
    }
    book.absDownloadedAt = null;

    if (deleteAction === 'both' && (await fs.exists(getCoverFilename(book), 'Books'))) {
      await fs.removeFile(getCoverFilename(book), 'Books');
    }
    if (deleteAction === 'local' || deleteAction === 'purge') {
      // Mirror 'local': mark not-downloaded but leave the tombstone (deletedAt)
      // to the caller. The page's handleBookDelete sets deletedAt and queues the
      // cloud deletion for purge, exactly as it does for the 'both' action.
      book.downloadedAt = null;
    } else {
      book.deletedAt = Date.now();
      book.downloadedAt = null;
      book.coverDownloadedAt = null;
    }
  }
  if ((deleteAction === 'cloud' || deleteAction === 'both') && book.uploadedAt) {
    if (isScholarReleaseBundle() || isScholarTestBundle()) {
      // The Scholar transfer queue performs a version-aware soft delete. A
      // legacy object delete here could destroy bytes before the CAS runs.
      if (deleteAction === 'cloud') {
        throw new Error('Use Scholar version-aware file deletion');
      }
      return;
    }
    const fps = [getRemoteBookFilename(book), getCoverFilename(book)];
    for (const fp of fps) {
      const cfp = `${CLOUD_BOOKS_SUBDIR}/${fp}`;
      try {
        deleteCloudFile(cfp);
      } catch (error) {
        console.log('Failed to delete uploaded file:', error);
      }
    }
    book.uploadedAt = null;
  }
}

export async function uploadFileToCloud(
  fs: FileSystem,
  resolveFilePath: (path: string, base: BaseDir) => Promise<string>,
  lfp: string,
  cfp: string,
  base: BaseDir,
  handleProgress: ProgressHandler,
  hash: string,
  temp: boolean = false,
  media?: string,
): Promise<string | undefined> {
  console.log('Uploading file:', lfp, 'to', cfp);
  const file = await fs.openFile(lfp, base, cfp);
  try {
    const localFullpath = await resolveFilePath(lfp, base);
    return await uploadFile(file, localFullpath, handleProgress, hash, temp, media);
  } finally {
    const opened = file as ClosableFile;
    if (opened.close) await opened.close();
  }
}

// Upload a single replica binary to the cloud under
// CLOUD_REPLICAS_SUBDIR/<kind>/<replicaId>/<filename>. Filename is the
// caller-supplied logical name (server-validated; see replicaSchemas.ts).
export async function uploadReplicaFileToCloud(
  fs: FileSystem,
  resolveFilePath: (path: string, base: BaseDir) => Promise<string>,
  opts: {
    kind: string;
    replicaId: string;
    filename: string;
    lfp: string;
    base: BaseDir;
    onProgress: ProgressHandler;
  },
): Promise<void> {
  const cfp = `${CLOUD_REPLICAS_SUBDIR}/${opts.kind}/${opts.replicaId}/${opts.filename}`;
  console.log('Uploading replica file:', opts.lfp, 'to', cfp);
  const file = await fs.openFile(opts.lfp, opts.base, opts.filename);
  const localFullpath = await resolveFilePath(opts.lfp, opts.base);
  await uploadReplicaFile(file, localFullpath, cfp, opts.kind, opts.replicaId, opts.onProgress);
  const f = file as ClosableFile;
  if (f && f.close) {
    await f.close();
  }
}

// Cloud key for a replica binary. Centralized so adapters and the
// download path share the same path-construction rule.
export const replicaCloudKey = (kind: string, replicaId: string, filename: string): string =>
  `${CLOUD_REPLICAS_SUBDIR}/${kind}/${replicaId}/${filename}`;

export async function downloadReplicaFileFromCloud(
  appService: AppService,
  opts: {
    kind: string;
    replicaId: string;
    filename: string;
    dst: string;
    onProgress?: ProgressHandler;
  },
): Promise<void> {
  const cfp = replicaCloudKey(opts.kind, opts.replicaId, opts.filename);
  await downloadFile({
    appService,
    cfp,
    dst: opts.dst,
    onProgress: opts.onProgress,
  });
}

export async function deleteReplicaBundleFromCloud(
  kind: string,
  replicaId: string,
  filenames: string[],
): Promise<void> {
  for (const filename of filenames) {
    const cfp = replicaCloudKey(kind, replicaId, filename);
    try {
      await deleteCloudFile(cfp);
    } catch (error) {
      console.log(`Failed to delete replica file ${cfp}:`, error);
    }
  }
}

export async function uploadBook(
  fs: FileSystem,
  resolveFilePath: (path: string, base: BaseDir) => Promise<string>,
  book: Book,
  onProgress?: ProgressHandler,
  scholar?: ScholarFileUploadContext,
): Promise<void> {
  const completedFiles = { count: 0 };
  const coverExist = await fs.exists(getCoverFilename(book), 'Books');

  let bookSource = scholar?.snapshotPath
    ? { kind: 'snapshot' as const, path: scholar.snapshotPath, base: 'Cache' as const }
    : await resolveBookContentSource(fs, book);
  if (bookSource.kind === 'url') {
    const fileobj = await fs.openFile(bookSource.path, bookSource.base);
    await fs.writeFile(getLocalBookFilename(book), 'Books', await fileobj.arrayBuffer());
    const f = fileobj as ClosableFile;
    if (f && f.close) {
      await f.close();
    }
    bookSource = { kind: 'managed', path: getLocalBookFilename(book), base: 'Books' };
  }

  if (!isBookFileContentSource(bookSource)) {
    throw new Error('Book file not uploaded');
  }

  const toUploadFpCount = coverExist ? 2 : 1;
  const handleProgress = createProgressHandler(toUploadFpCount, completedFiles, onProgress);

  if (coverExist) {
    const lfp = getCoverFilename(book);
    const cfp = `${CLOUD_BOOKS_SUBDIR}/${getCoverFilename(book)}`;
    try {
      await uploadFileToCloud(fs, resolveFilePath, lfp, cfp, 'Books', handleProgress, book.hash);
    } catch (error) {
      // Older Scholar libraries may already have a cover at this fixed key.
      // A regenerated local thumbnail can differ in size; keep the existing
      // remote cover so it cannot block the immutable book-file upload.
      if (
        !(isScholarReleaseBundle() || isScholarTestBundle()) ||
        !(error instanceof Error) ||
        error.message !== 'File size differs from existing object'
      )
        throw error;
      console.warn('Scholar cover differs from the stored copy; keeping the remote cover');
    }
    completedFiles.count++;
  }

  const cfp = `${CLOUD_BOOKS_SUBDIR}/${getRemoteBookFilename(book)}`;
  if (isScholarReleaseBundle() || isScholarTestBundle()) {
    const accountId = await getScholarAccountId();
    if (!accountId) throw new Error('Not authenticated');
    if (scholar && scholar.accountId !== accountId)
      throw new Error('Scholar upload account changed');
    const expectedVersionId = scholar
      ? scholar.expectedVersionId
      : (getScholarFileBaseline(accountId, cfp)?.versionId ?? null);
    const opId = scholar?.opId ?? crypto.randomUUID();
    const file = await fs.openFile(bookSource.path, bookSource.base, cfp);
    try {
      const fullPath = await resolveFilePath(bookSource.path, bookSource.base);
      const response = await fetchWithAuth(`${getAPIBaseUrl()}/scholar/files/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileName: cfp, bookHash: book.hash }),
      });
      const { fileId } = (await response.json()) as { fileId: string };
      if (!fileId) throw new Error('Invalid Scholar file registration');
      const result = await uploadScholarFileVersion(
        file,
        fileId,
        opId,
        expectedVersionId,
        handleProgress,
        fullPath,
      );
      if (!result.applied) throw new Error('Scholar file conflict; local version retained');
      saveScholarFileBaseline(accountId, cfp, { fileId, versionId: result.versionId });
    } finally {
      const opened = file as ClosableFile;
      if (opened.close) await opened.close();
    }
  } else {
    await uploadFileToCloud(
      fs,
      resolveFilePath,
      bookSource.path,
      cfp,
      bookSource.base,
      handleProgress,
      book.hash,
    );
  }
  completedFiles.count++;

  book.deletedAt = null;
  book.fileSyncDeletionRequestedAt = null;
  book.updatedAt = Date.now();
  book.uploadedAt = Date.now();
  book.downloadedAt = Date.now();
  book.coverDownloadedAt = Date.now();
}

// Re-upload only the cover (books/<hash>/cover.png), overwriting the cloud
// copy. Used after a cover edit (issue #4544) so peers can re-download it.
// Deliberately does NOT touch book.uploadedAt — that marker means "the book
// file is in cloud as of T"; a cover-only change must not trigger a file
// re-download on peers.
export async function uploadBookCover(
  fs: FileSystem,
  resolveFilePath: (path: string, base: BaseDir) => Promise<string>,
  book: Book,
  onProgress?: ProgressHandler,
): Promise<void> {
  if (!(await fs.exists(getCoverFilename(book), 'Books'))) return;
  const completedFiles = { count: 0 };
  const handleProgress = createProgressHandler(1, completedFiles, onProgress);
  const lfp = getCoverFilename(book);
  const cfp = `${CLOUD_BOOKS_SUBDIR}/${getCoverFilename(book)}`;
  await uploadFileToCloud(fs, resolveFilePath, lfp, cfp, 'Books', handleProgress, book.hash);
}

export async function downloadCloudFile(
  appService: AppService,
  localBooksDir: string,
  lfp: string,
  cfp: string,
  onProgress: ProgressHandler,
): Promise<void> {
  console.log('Downloading file:', cfp, 'to', lfp);
  const dstPath = `${localBooksDir}/${lfp}`;
  await downloadFile({ appService, cfp, dst: dstPath, onProgress });
}

/**
 * A pinned version URL and a temporary destination keep a failed or racing
 * download from changing the library copy. The baseline advances only after
 * the downloaded bytes match the immutable version's size and SHA-256.
 */
async function downloadVerifiedScholarBookFile(
  appService: AppService,
  fs: FileSystem,
  dst: string,
  cfp: string,
  onProgress: ProgressHandler,
): Promise<void> {
  const accountId = await getScholarAccountId();
  if (!accountId) throw new Error('Not authenticated');
  const endpoint = `${getAPIBaseUrl()}/scholar/files`;
  const fileKey = `${accountId}/${cfp}`;
  const statusResponse = await fetchWithAuth(
    `${endpoint}/status?fileKey=${encodeURIComponent(fileKey)}`,
    { method: 'GET' },
  );
  const status = (await statusResponse.json()) as {
    fileId?: string;
    activeVersionId?: string | null;
  };
  if (!status.fileId || !status.activeVersionId) {
    throw new Error('Scholar book has no active file version');
  }
  const versionResponse = await fetchWithAuth(
    `${endpoint}/download?fileId=${encodeURIComponent(status.fileId)}&versionId=${encodeURIComponent(status.activeVersionId)}`,
    { method: 'GET' },
  );
  const version = (await versionResponse.json()) as {
    versionId?: string;
    downloadUrl?: string;
    sha256?: string;
    fileSize?: number;
  };
  if (
    version.versionId !== status.activeVersionId ||
    !version.downloadUrl ||
    !/^[0-9a-f]{64}$/i.test(version.sha256 ?? '') ||
    !Number.isSafeInteger(version.fileSize) ||
    (version.fileSize ?? -1) < 0
  )
    throw new Error('Invalid Scholar file version response');

  const temporaryPath = `${dst}.scholar-${crypto.randomUUID()}.part`;
  try {
    await downloadFile({
      appService,
      dst: temporaryPath,
      cfp,
      url: version.downloadUrl,
      onProgress,
    });
    const staged = await fs.openFile(temporaryPath, 'None');
    try {
      if (
        staged.size !== version.fileSize ||
        (await sha256File(staged)) !== version.sha256?.toLowerCase()
      ) {
        throw new Error('Scholar file hash mismatch');
      }
    } finally {
      const opened = staged as ClosableFile;
      if (opened.close) await opened.close();
    }
    if ((await getScholarAccountId()) !== accountId) {
      throw new Error('Scholar upload account changed');
    }
    await fs.copyFile(temporaryPath, 'None', dst, 'None');
    saveScholarFileBaseline(accountId, cfp, {
      fileId: status.fileId,
      versionId: status.activeVersionId,
    });
  } finally {
    if (await fs.exists(temporaryPath, 'None')) await fs.removeFile(temporaryPath, 'None');
  }
}

export async function downloadBookCovers(
  appService: AppService,
  fs: FileSystem,
  localBooksDir: string,
  books: Book[],
): Promise<void> {
  const booksLfps = new Map(
    books.map((book) => {
      const lfp = getCoverFilename(book);
      return [lfp, book];
    }),
  );
  const filePaths = books.map((book) => ({
    lfp: getCoverFilename(book),
    cfp: `${CLOUD_BOOKS_SUBDIR}/${getCoverFilename(book)}`,
  }));
  const downloadUrls = await batchGetDownloadUrls(filePaths);
  await Promise.all(
    books.map(async (book) => {
      if (!(await fs.exists(getDir(book), 'Books'))) {
        await fs.createDir(getDir(book), 'Books');
      }
    }),
  );
  await Promise.all(
    downloadUrls.map(async (file) => {
      try {
        const dst = `${localBooksDir}/${file.lfp}`;
        if (!file.downloadUrl) return;
        await downloadFile({ appService, dst, cfp: file.cfp, url: file.downloadUrl });
        const book = booksLfps.get(file.lfp);
        if (book && !book.coverDownloadedAt) {
          book.coverDownloadedAt = Date.now();
        }
      } catch (error) {
        console.log(`Failed to download cover file for book: '${file.lfp}'`, error);
      }
    }),
  );
}

export async function downloadBook(
  appService: AppService,
  fs: FileSystem,
  localBooksDir: string,
  book: Book,
  onlyCover: boolean = false,
  redownload: boolean = false,
  onProgress?: ProgressHandler,
): Promise<void> {
  let bookDownloaded = false;
  let bookCoverDownloaded = false;
  const completedFiles = { count: 0 };
  let toDownloadFpCount = 0;
  const needDownCover = !(await fs.exists(getCoverFilename(book), 'Books')) || redownload;
  const needDownBook =
    (!onlyCover && !(await fs.exists(getLocalBookFilename(book), 'Books'))) || redownload;
  if (needDownCover) {
    toDownloadFpCount++;
  }
  if (needDownBook) {
    toDownloadFpCount++;
  }

  const handleProgress = createProgressHandler(toDownloadFpCount, completedFiles, onProgress);

  if (!(await fs.exists(getDir(book), 'Books'))) {
    await fs.createDir(getDir(book), 'Books');
  }

  try {
    if (needDownCover) {
      const lfp = getCoverFilename(book);
      const cfp = `${CLOUD_BOOKS_SUBDIR}/${lfp}`;
      await downloadCloudFile(appService, localBooksDir, lfp, cfp, handleProgress);
      bookCoverDownloaded = true;
    }
  } catch (error) {
    // don't throw error here since some books may not have cover images at all
    console.log(`Failed to download cover file for book: '${book.title}'`, error);
  } finally {
    if (needDownCover) {
      completedFiles.count++;
    }
  }

  if (needDownBook) {
    const lfp = getLocalBookFilename(book);
    const cfp = `${CLOUD_BOOKS_SUBDIR}/${getRemoteBookFilename(book)}`;
    const localFullpath = `${localBooksDir}/${lfp}`;
    if (isScholarReleaseBundle() || isScholarTestBundle()) {
      await downloadVerifiedScholarBookFile(appService, fs, localFullpath, cfp, handleProgress);
    } else {
      await downloadCloudFile(appService, localBooksDir, lfp, cfp, handleProgress);
    }
    bookDownloaded = await fs.exists(localFullpath, 'None');
    completedFiles.count++;
  }
  // some books may not have cover image, so we need to check if the book is downloaded
  if (bookDownloaded || (!onlyCover && !needDownBook)) {
    book.downloadedAt = Date.now();
  }
  if ((bookCoverDownloaded || !needDownCover) && !book.coverDownloadedAt) {
    book.coverDownloadedAt = Date.now();
  }
}
