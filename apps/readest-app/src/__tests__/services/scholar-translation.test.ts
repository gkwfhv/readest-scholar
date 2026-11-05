import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AppService } from '@/types/system';
import type { Book } from '@/types/book';

const mocks = vi.hoisted(() => ({
  fetchWithAuth: vi.fn(),
  updateBook: vi.fn(async (_envConfig: unknown, book: unknown) => book),
  uploadBook: vi.fn(async () => {}),
  writeFile: vi.fn(async () => {}),
  deleteFile: vi.fn(async () => {}),
  exists: vi.fn(async () => false),
  accountId: 'acct' as string | null,
  importBook: vi.fn(),
}));

vi.mock('@/utils/fetch', () => ({ fetchWithAuth: mocks.fetchWithAuth }));
vi.mock('@/utils/transfer', () => ({ toProgressPercent: () => 0 }));
vi.mock('@/services/scholarFileBaseline', () => ({
  getScholarAccountId: async () => mocks.accountId,
}));
vi.mock('@/services/environment', () => ({ getAPIBaseUrl: () => 'https://api.test' }));
vi.mock('@/services/constants', () => ({ CLOUD_BOOKS_SUBDIR: 'Books' }));
vi.mock('@/utils/book', () => ({
  getDir: () => 'hash1',
  getRemoteBookFilename: () => 'paper.pdf',
}));
vi.mock('@/store/libraryStore', () => ({
  useLibraryStore: {
    getState: () => ({
      updateBook: mocks.updateBook,
      getBookByHash: () => undefined,
      library: [],
    }),
  },
}));
vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: { getState: () => ({ settings: { aiSettings: {} } }) },
}));
vi.mock('@/services/ai/translationModel', () => ({
  getPdfTranslationModel: () => ({ provider: 'ai-gateway', model: 'm', apiKey: 'k' }),
}));

const {
  applyJobToBook,
  availableTranslationKinds,
  createJob,
  downloadOutputs,
  ensureUploaded,
  pruneTranslationFiles,
  describeJobFailure,
  finalizeJob,
  derivedTranslationHash,
  TranslationError,
} = await import('@/services/scholarTranslation');

const envConfig = {} as never;
const appService = {
  uploadBook: mocks.uploadBook,
  importBook: mocks.importBook,
  writeFile: mocks.writeFile,
  deleteFile: mocks.deleteFile,
  exists: mocks.exists,
} as unknown as AppService;

const book = (overrides: Partial<Book> = {}): Book => ({
  hash: 'hash1',
  format: 'PDF',
  title: 'Paper',
  author: 'A',
  createdAt: 1,
  updatedAt: 1,
  ...overrides,
});

const jsonResponse = (value: unknown) => ({ json: async () => value });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.accountId = 'acct';
  mocks.exists.mockResolvedValue(false);
});

describe('createJob', () => {
  it('sends the documented fields and never a prompt/style override', async () => {
    mocks.fetchWithAuth.mockResolvedValueOnce(
      jsonResponse({ id: 'job-1', state: 'queued', progress: 0, mode: 'both' }),
    );

    await createJob({
      fileId: 'file-1',
      versionId: 'version-1',
      options: {
        mode: 'both',
        whiteBackgroundCompatibility: true,
        whiteBackgroundPages: '2,4-6',
        glossarySha256: 'a'.repeat(64),
      },
      translationModel: { provider: 'ai-gateway', model: 'm', apiKey: 'k' },
    });

    const [url, init] = mocks.fetchWithAuth.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.test/scholar/translation-jobs');
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({
      fileId: 'file-1',
      versionId: 'version-1',
      mode: 'both',
      whiteBackgroundCompatibility: true,
      whiteBackgroundPages: '2,4-6',
      glossarySha256: 'a'.repeat(64),
    });
    expect(body.prompt).toBeUndefined();
    expect(body.systemPrompt).toBeUndefined();
    expect(typeof body.idempotencyKey).toBe('string');
  });
});

describe('createJob document type', () => {
  const baseOptions = {
    mode: 'dual' as const,
    whiteBackgroundCompatibility: false,
  };

  it('sends auto by default', async () => {
    mocks.fetchWithAuth.mockResolvedValueOnce(
      jsonResponse({ id: 'job-1', state: 'queued', progress: 0, mode: 'dual' }),
    );
    await createJob({
      fileId: 'file-1',
      versionId: 'version-1',
      options: baseOptions,
      translationModel: { provider: 'ai-gateway', model: 'm', apiKey: 'k' },
    });
    const body = JSON.parse(mocks.fetchWithAuth.mock.calls[0]![1].body as string);
    expect(body.documentType).toBe('auto');
  });

  it('forces mono and drops page options in book mode', async () => {
    mocks.fetchWithAuth.mockResolvedValueOnce(
      jsonResponse({ id: 'job-1', state: 'queued', progress: 0, mode: 'mono' }),
    );
    await createJob({
      fileId: 'file-1',
      versionId: 'version-1',
      options: {
        mode: 'both',
        documentType: 'book',
        whiteBackgroundCompatibility: true,
        whiteBackgroundPages: '2-4',
      },
      translationModel: { provider: 'ai-gateway', model: 'm', apiKey: 'k' },
    });
    const body = JSON.parse(mocks.fetchWithAuth.mock.calls[0]![1].body as string);
    expect(body.mode).toBe('mono');
    expect(body.documentType).toBe('book');
    expect(body.whiteBackgroundCompatibility).toBe(false);
    expect(body.whiteBackgroundPages).toBeUndefined();
  });
});

describe('finalizeJob for book mode', () => {
  it('imports the EPUB under a stable derived hash and links the source book', async () => {
    const bytes = new TextEncoder().encode('epub-bytes');
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    const sha256 = Array.from(new Uint8Array(digest))
      .map((value) => value.toString(16).padStart(2, '0'))
      .join('');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(bytes, { status: 200 })),
    );
    const source = book({ hash: 'sourcehash', title: 'A Book' });
    const derivedHash = derivedTranslationHash(source);
    mocks.importBook.mockResolvedValue({
      hash: derivedHash,
      title: 'A Book（中文）',
      primaryLanguage: 'zh-CN',
    });

    const result = await finalizeJob(envConfig, appService, source, {
      id: 'job-epub',
      state: 'succeeded',
      progress: 100,
      mode: 'mono',
      outputs: [
        {
          kind: 'epub',
          downloadUrl: 'https://files/book.epub',
          sha256,
          fileSize: bytes.byteLength,
        },
      ],
    });

    expect(result.ok).toBe(true);
    expect(mocks.importBook).toHaveBeenCalledTimes(1);
    const [file, , options] = mocks.importBook.mock.calls[0]! as [
      File,
      unknown,
      Record<string, unknown>,
    ];
    expect(file.name).toBe(`${derivedHash}.epub`);
    expect(options).toMatchObject({ nativeHash: derivedHash, overwrite: true });
    expect(mocks.updateBook).toHaveBeenLastCalledWith(
      envConfig,
      expect.objectContaining({ translatedBookHash: derivedHash }),
    );
    vi.unstubAllGlobals();
  });
});

describe('ensureUploaded', () => {
  it('reuses an active Scholar version without uploading', async () => {
    mocks.fetchWithAuth.mockResolvedValueOnce(
      jsonResponse({ fileId: 'file-1', activeVersionId: 'version-1' }),
    );

    const result = await ensureUploaded(appService, book());

    expect(result).toEqual({ fileId: 'file-1', versionId: 'version-1', accountId: 'acct' });
    expect(mocks.uploadBook).not.toHaveBeenCalled();
  });

  it('uploads a PDF that has no active version, then re-reads it', async () => {
    mocks.fetchWithAuth
      .mockResolvedValueOnce(jsonResponse({ fileId: 'file-1', activeVersionId: null }))
      .mockResolvedValueOnce(jsonResponse({ fileId: 'file-1', activeVersionId: 'version-2' }));

    const result = await ensureUploaded(appService, book());

    expect(mocks.uploadBook).toHaveBeenCalledTimes(1);
    expect(result.versionId).toBe('version-2');
  });

  it('fails when the upload still leaves no active version', async () => {
    mocks.fetchWithAuth
      .mockResolvedValueOnce(jsonResponse({ fileId: 'file-1', activeVersionId: null }))
      .mockResolvedValueOnce(jsonResponse({ fileId: 'file-1', activeVersionId: null }));

    await expect(ensureUploaded(appService, book())).rejects.toBeInstanceOf(TranslationError);
  });

  it('fails before any request when signed out', async () => {
    mocks.accountId = null;
    await expect(ensureUploaded(appService, book())).rejects.toMatchObject({
      reason: 'not-signed-in',
    });
    expect(mocks.fetchWithAuth).not.toHaveBeenCalled();
  });
});

describe('applyJobToBook', () => {
  it('never regresses the same job from succeeded back to running', async () => {
    const existing = book({
      translation: {
        jobId: 'job-1',
        state: 'succeeded',
        progress: 100,
        mode: 'dual',
        outputs: ['dual'],
        updatedAt: 1,
      },
      translationUpdatedAt: 1,
    });

    const next = await applyJobToBook(envConfig, existing, {
      id: 'job-1',
      state: 'running',
      progress: 40,
      mode: 'dual',
    });

    expect(next.translation?.state).toBe('succeeded');
    expect(mocks.updateBook).toHaveBeenCalledTimes(1);
  });

  it('lets a new job replace an old terminal one', async () => {
    const existing = book({
      translation: {
        jobId: 'job-old',
        state: 'failed',
        progress: 0,
        mode: 'dual',
        outputs: [],
        updatedAt: 1,
      },
      translationUpdatedAt: 1,
    });

    const next = await applyJobToBook(envConfig, existing, {
      id: 'job-new',
      state: 'queued',
      progress: 0,
      mode: 'mono',
    });

    expect(next.translation?.jobId).toBe('job-new');
    expect(next.translation?.state).toBe('queued');
  });
});

describe('availableTranslationKinds', () => {
  it('lists the kinds a succeeded job produced, Chinese first', () => {
    const target = book({
      translation: {
        jobId: 'job-1',
        state: 'succeeded',
        progress: 100,
        mode: 'both',
        outputs: ['dual', 'mono'],
        updatedAt: 1,
      },
    });
    expect(availableTranslationKinds(target)).toEqual(['mono', 'dual']);
  });

  it('is empty until the job succeeds', () => {
    const target = book({
      translation: {
        jobId: 'job-1',
        state: 'running',
        progress: 50,
        mode: 'dual',
        outputs: [],
        updatedAt: 1,
      },
    });
    expect(availableTranslationKinds(target)).toEqual([]);
  });
});

describe('pruneTranslationFiles', () => {
  it('deletes only outputs the new translation replaced', async () => {
    const keep = {
      jobId: 'job-new',
      kind: 'dual' as const,
      path: 'hash1/translation-job-new-dual.pdf',
      sha256: 'b',
      fileSize: 3,
      downloadedAt: 1,
    };
    const stale = {
      jobId: 'job-old',
      kind: 'dual' as const,
      path: 'hash1/translation-job-old-dual.pdf',
      sha256: 'a',
      fileSize: 3,
      downloadedAt: 1,
    };

    await pruneTranslationFiles(appService, book({ translationFiles: [stale, keep] }), [keep]);

    expect(mocks.deleteFile).toHaveBeenCalledTimes(1);
    expect(mocks.deleteFile).toHaveBeenCalledWith(stale.path, 'Books');
    expect(mocks.writeFile).not.toHaveBeenCalled();
  });
});

describe('downloadOutputs', () => {
  const bytes = new TextEncoder().encode('abc').buffer;
  const sha256Of = async (buffer: ArrayBuffer) => {
    const digest = await crypto.subtle.digest('SHA-256', buffer);
    return Array.from(new Uint8Array(digest))
      .map((value) => value.toString(16).padStart(2, '0'))
      .join('');
  };

  it('downloads, verifies, and writes an output', async () => {
    const sha256 = await sha256Of(bytes);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, arrayBuffer: async () => bytes })),
    );

    const files = await downloadOutputs(appService, book(), {
      id: 'job-1',
      state: 'succeeded',
      progress: 100,
      mode: 'dual',
      outputs: [
        { kind: 'dual', downloadUrl: 'https://files/x.pdf', sha256, fileSize: bytes.byteLength },
      ],
    });

    expect(files).toHaveLength(1);
    expect(files[0]?.path).toBe('hash1/translation-job-1-dual.pdf');
    expect(mocks.writeFile).toHaveBeenCalledWith(files[0]?.path, 'Books', bytes);
    vi.unstubAllGlobals();
  });

  it('reuses an existing verified file without re-downloading', async () => {
    const sha256 = await sha256Of(bytes);
    const existing = {
      jobId: 'job-1',
      kind: 'dual' as const,
      path: 'hash1/translation-job-1-dual.pdf',
      sha256,
      fileSize: bytes.byteLength,
      downloadedAt: 1,
    };
    mocks.exists.mockResolvedValue(true);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const files = await downloadOutputs(appService, book({ translationFiles: [existing] }), {
      id: 'job-1',
      state: 'succeeded',
      progress: 100,
      mode: 'dual',
      outputs: [
        { kind: 'dual', downloadUrl: 'https://files/x.pdf', sha256, fileSize: bytes.byteLength },
      ],
    });

    expect(files).toEqual([existing]);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mocks.writeFile).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});

describe('describeJobFailure', () => {
  const _ = (key: string) => key;

  it('explains the page cap instead of a generic failure', () => {
    expect(describeJobFailure('pdf_page_limit', _)).toBe(
      'This PDF has too many pages to translate.',
    );
  });

  it('falls back to the generic message for unknown codes', () => {
    expect(describeJobFailure('something_new', _)).toBe('Translation failed');
  });
});
