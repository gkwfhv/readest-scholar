import type {
  Book,
  BookTranslation,
  TranslationFileRef,
  TranslationMode,
  TranslationOutputKind,
} from '@/types/book';
import type { AppService } from '@/types/system';
import type { EnvConfigType } from '@/services/environment';
import { getAPIBaseUrl } from '@/services/environment';
import { CLOUD_BOOKS_SUBDIR } from '@/services/constants';
import { getScholarAccountId } from '@/services/scholarFileBaseline';
import {
  getPdfTranslationModel,
  type PdfTranslationModelRequest,
} from '@/services/ai/translationModel';
import { getDir, getRemoteBookFilename } from '@/utils/book';
import { fetchWithAuth } from '@/utils/fetch';
import { toProgressPercent, type ProgressHandler } from '@/utils/transfer';
import { useSettingsStore } from '@/store/settingsStore';
import { useLibraryStore } from '@/store/libraryStore';

const MAX_OUTPUT_BYTES = 200 * 1024 * 1024;
const DOWNLOAD_TIMEOUT_MS = 5 * 60 * 1000;
const IN_FLIGHT_STATES: ReadonlySet<BookTranslation['state']> = new Set(['queued', 'running']);

export interface ScholarFileStatus {
  fileId: string;
  activeVersionId: string | null;
}

export interface TranslationOutput {
  kind: TranslationOutputKind;
  downloadUrl: string;
  sha256: string;
  fileSize: number;
}

export interface TranslationJob {
  id: string;
  state: BookTranslation['state'];
  progress: number;
  mode: TranslationMode;
  errorCode?: string | null;
  outputs?: TranslationOutput[];
}

export interface TranslationOptions {
  mode: TranslationMode;
  /** Uploaded once per submission; the resulting hash is reused for a batch. */
  glossaryCsv?: File | null;
  glossarySha256?: string | null;
  whiteBackgroundCompatibility: boolean;
  whiteBackgroundPages?: string;
  /** HTTPS OpenAI-compatible endpoint the translation worker can reach. */
  baseUrl?: string;
}

export type TranslationFailureReason =
  | 'not-signed-in'
  | 'not-pdf'
  | 'already-running'
  | 'upload-failed'
  | 'no-model'
  | 'queue-full'
  | 'too-large'
  | 'source-missing'
  | 'server-error';

export type StartTranslationResult =
  | { ok: true; book: Book; job: TranslationJob }
  | { ok: false; book: Book; reason: TranslationFailureReason; message?: string };

export class TranslationError extends Error {
  constructor(public readonly reason: TranslationFailureReason) {
    super(reason);
    this.name = 'TranslationError';
  }
}

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

export const translationFilename = (jobId: string, kind: TranslationOutputKind) =>
  `translation-${jobId}-${kind}.pdf`;

/** Books-relative path of a downloaded output; deterministic and never the
 *  book's own managed filename. */
export const translationPath = (book: Book, jobId: string, kind: TranslationOutputKind) =>
  `${getDir(book)}/${translationFilename(jobId, kind)}`;

// ---------------------------------------------------------------------------
// Settings / model
// ---------------------------------------------------------------------------

export const resolveTranslationModel = (
  baseUrlOverride?: string,
): PdfTranslationModelRequest | null =>
  getPdfTranslationModel(useSettingsStore.getState().settings?.aiSettings, baseUrlOverride);

// ---------------------------------------------------------------------------
// Wire calls
// ---------------------------------------------------------------------------

const fileKeyFor = (accountId: string, book: Book) =>
  `${accountId}/${CLOUD_BOOKS_SUBDIR}/${getRemoteBookFilename(book)}`;

// fetchWithAuth has no timeout. A polling request that never settles used to
// wedge the poller's in-flight latch, so the cover badge stopped updating while
// the job kept running. Bound every JSON round-trip; uploads/downloads keep
// their own long-lived paths.
const REQUEST_TIMEOUT_MS = 20000;

async function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  timeoutMs = REQUEST_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchWithAuth(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchJson<T>(
  url: string,
  init: RequestInit = {},
  timeoutMs = REQUEST_TIMEOUT_MS,
): Promise<T> {
  const response = await fetchWithTimeout(url, init, timeoutMs);
  return (await response.json()) as T;
}

export async function getScholarFileStatus(book: Book): Promise<ScholarFileStatus> {
  const accountId = await getScholarAccountId();
  if (!accountId) throw new TranslationError('not-signed-in');
  return await fetchJson<ScholarFileStatus>(
    `${getAPIBaseUrl()}/scholar/files/status?fileKey=${encodeURIComponent(fileKeyFor(accountId, book))}`,
    { method: 'GET' },
  );
}

export async function listJobs(fileId: string): Promise<TranslationJob[]> {
  const data = await fetchJson<{ jobs?: TranslationJob[] }>(
    `${getAPIBaseUrl()}/scholar/translation-jobs?fileId=${encodeURIComponent(fileId)}`,
    { method: 'GET' },
  );
  return data.jobs ?? [];
}

export async function getJob(jobId: string): Promise<TranslationJob> {
  return await fetchJson<TranslationJob>(
    `${getAPIBaseUrl()}/scholar/translation-jobs/${encodeURIComponent(jobId)}`,
    { method: 'GET' },
  );
}

export async function createJob(args: {
  fileId: string;
  versionId: string;
  options: TranslationOptions;
  translationModel: PdfTranslationModelRequest;
}): Promise<TranslationJob> {
  const { fileId, versionId, options, translationModel } = args;
  const body = {
    fileId,
    versionId,
    idempotencyKey: crypto.randomUUID(),
    mode: options.mode,
    translationModel,
    whiteBackgroundCompatibility: options.whiteBackgroundCompatibility,
    ...(options.whiteBackgroundCompatibility && options.whiteBackgroundPages?.trim()
      ? { whiteBackgroundPages: options.whiteBackgroundPages.trim() }
      : {}),
    ...(options.glossarySha256 ? { glossarySha256: options.glossarySha256 } : {}),
  };
  return await fetchJson<TranslationJob>(`${getAPIBaseUrl()}/scholar/translation-jobs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export async function cancelJob(jobId: string): Promise<void> {
  await fetchWithTimeout(
    `${getAPIBaseUrl()}/scholar/translation-jobs/${encodeURIComponent(jobId)}/cancel`,
    { method: 'POST' },
  );
}

export async function retryJob(
  jobId: string,
  translationModel: PdfTranslationModelRequest,
): Promise<TranslationJob> {
  return await fetchJson<TranslationJob>(
    `${getAPIBaseUrl()}/scholar/translation-jobs/${encodeURIComponent(jobId)}/retry`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idempotencyKey: crypto.randomUUID(), translationModel }),
    },
  );
}

export async function uploadGlossary(csv: File): Promise<string> {
  if (csv.size > 65536) throw new Error('Glossary must be 64 KiB or smaller');
  const text = await csv.text();
  const result = await fetchJson<{ sha256: string }>(
    `${getAPIBaseUrl()}/scholar/translation-glossaries`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ csv: text }),
    },
  );
  return result.sha256;
}

// ---------------------------------------------------------------------------
// Upload
// ---------------------------------------------------------------------------

export interface EnsureUploadedResult {
  fileId: string;
  versionId: string;
  accountId: string;
}

/**
 * Guarantee the PDF is in Scholar and return its active version. A book that
 * was never registered makes the status call fail; that is treated as "not
 * uploaded" and followed by an upload, not as a fatal error.
 */
export async function ensureUploaded(
  appService: AppService,
  book: Book,
  onProgress?: (percent: number) => void,
): Promise<EnsureUploadedResult> {
  const accountId = await getScholarAccountId();
  if (!accountId) throw new TranslationError('not-signed-in');
  let status: ScholarFileStatus | null = null;
  try {
    status = await getScholarFileStatus(book);
  } catch {
    status = null;
  }
  if (!status?.activeVersionId) {
    const handler: ProgressHandler | undefined = onProgress
      ? (progress) => onProgress(toProgressPercent(progress))
      : undefined;
    await appService.uploadBook(book, handler);
    status = await getScholarFileStatus(book);
  }
  if (!status?.activeVersionId) throw new TranslationError('upload-failed');
  return { fileId: status.fileId, versionId: status.activeVersionId, accountId };
}

// ---------------------------------------------------------------------------
// Local outputs
// ---------------------------------------------------------------------------

const sha256Hex = async (bytes: ArrayBuffer): Promise<string> => {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('');
};

const outputKinds = (job: TranslationJob): TranslationOutputKind[] =>
  (job.outputs ?? [])
    .map((output) => output.kind)
    .filter((kind): kind is TranslationOutputKind => kind === 'mono' || kind === 'dual');

/**
 * Download every output of a succeeded job into Books/<hash>/. An existing file
 * whose sha256 matches is reused, so a repeated poll costs no bandwidth.
 */
export async function downloadOutputs(
  appService: AppService,
  book: Book,
  job: TranslationJob,
): Promise<TranslationFileRef[]> {
  const files: TranslationFileRef[] = [];
  for (const output of job.outputs ?? []) {
    if (output.kind !== 'mono' && output.kind !== 'dual') continue;
    const path = translationPath(book, job.id, output.kind);
    const existing = (book.translationFiles ?? []).find(
      (ref) => ref.jobId === job.id && ref.kind === output.kind,
    );
    if (
      existing &&
      existing.sha256 === output.sha256 &&
      (await appService.exists(path, 'Books').catch(() => false))
    ) {
      files.push(existing);
      continue;
    }
    if (output.fileSize > MAX_OUTPUT_BYTES) throw new TranslationError('too-large');
    // The signed URL can stall; without a bound, finalizeJob (and the badge
    // mutex) would stay in flight forever. Downloads are large, so allow more.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetch(output.downloadUrl, { signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
    if (!response.ok) throw new TranslationError('server-error');
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength !== output.fileSize) throw new TranslationError('server-error');
    if ((await sha256Hex(bytes)) !== output.sha256) throw new TranslationError('server-error');
    await appService.writeFile(path, 'Books', bytes);
    files.push({
      jobId: job.id,
      kind: output.kind,
      path,
      sha256: output.sha256,
      fileSize: output.fileSize,
      downloadedAt: Date.now(),
    });
  }
  return files;
}

/** Delete local outputs that the new translation replaced. Only refs recorded
 *  on the book are touched; the book's own managed file is never referenced. */
export async function pruneTranslationFiles(
  appService: AppService,
  book: Book,
  keep: TranslationFileRef[],
): Promise<void> {
  const kept = new Set(keep.map((ref) => `${ref.jobId}:${ref.kind}`));
  for (const ref of book.translationFiles ?? []) {
    if (!kept.has(`${ref.jobId}:${ref.kind}`)) {
      await appService.deleteFile(ref.path, 'Books').catch(() => {});
    }
  }
}

// ---------------------------------------------------------------------------
// Book metadata
// ---------------------------------------------------------------------------

const stateRank: Record<BookTranslation['state'], number> = {
  queued: 0,
  running: 1,
  failed: 2,
  canceled: 2,
  succeeded: 3,
};

/**
 * Merge a job observation into the book row and persist it. A stale poller
 * cannot regress the same job from a terminal state back to queued/running;
 * a new jobId (re-translate) always wins.
 */
export async function applyJobToBook(
  envConfig: EnvConfigType,
  book: Book,
  job: TranslationJob,
  localFiles?: TranslationFileRef[],
): Promise<Book> {
  const previous = book.translation;
  let state = job.state;
  if (previous && previous.jobId === job.id && stateRank[previous.state] > stateRank[state]) {
    state = previous.state;
  }
  const now = Date.now();
  const next: Book = {
    ...book,
    translation: {
      jobId: job.id,
      state,
      progress: Math.max(0, Math.min(100, Math.round(job.progress ?? 0))),
      mode: job.mode ?? previous?.mode ?? 'dual',
      outputs: state === 'succeeded' ? outputKinds(job) : (previous?.outputs ?? []),
      errorCode: job.errorCode ?? null,
      updatedAt: now,
    },
    translationUpdatedAt: now,
    updatedAt: now,
    ...(localFiles ? { translationFiles: localFiles } : {}),
  };
  await useLibraryStore.getState().updateBook(envConfig, next);
  return next;
}

/** Terminal observation: download and verify the outputs, prune the previous
 *  copy, then persist. The green badge is only written after the bytes exist. */
export async function finalizeJob(
  envConfig: EnvConfigType,
  appService: AppService,
  book: Book,
  job: TranslationJob,
): Promise<{ ok: boolean; book: Book; reason?: TranslationFailureReason }> {
  if (job.state !== 'succeeded') {
    const next = await applyJobToBook(envConfig, book, job);
    return { ok: false, book: next, reason: 'server-error' };
  }
  try {
    const files = await downloadOutputs(appService, book, job);
    await pruneTranslationFiles(appService, book, files);
    const next = await applyJobToBook(envConfig, book, job, files);
    return { ok: true, book: next };
  } catch (cause) {
    const reason = cause instanceof TranslationError ? cause.reason : 'server-error';
    const next = await applyJobToBook(envConfig, book, job);
    return { ok: false, book: next, reason };
  }
}

// ---------------------------------------------------------------------------
// Start / re-download
// ---------------------------------------------------------------------------

const inFlightStarts = new Map<string, Promise<StartTranslationResult>>();

const mapStartError = (cause: unknown): TranslationFailureReason => {
  if (cause instanceof TranslationError) return cause.reason;
  const message = cause instanceof Error ? cause.message : '';
  if (/authenticat|sign in|401/i.test(message)) return 'not-signed-in';
  if (/model is unavailable|not configured/i.test(message)) return 'no-model';
  if (/queue/i.test(message)) return 'queue-full';
  if (/exceed|too large|413|size/i.test(message)) return 'too-large';
  if (/source|not found|404/i.test(message)) return 'source-missing';
  return 'server-error';
};

/**
 * Full single-book pipeline for the context menu and the batch loop. Never
 * throws for expected failures: the caller reports `reason` in the batch
 * summary and keeps the other books going.
 */
export async function startTranslation(
  envConfig: EnvConfigType,
  appService: AppService,
  book: Book,
  options: TranslationOptions,
  onProgress?: (percent: number) => void,
): Promise<StartTranslationResult> {
  const pending = inFlightStarts.get(book.hash);
  if (pending) return pending;
  const run = (async (): Promise<StartTranslationResult> => {
    try {
      if (book.format !== 'PDF') return { ok: false, book, reason: 'not-pdf' };
      const translationModel = resolveTranslationModel(options.baseUrl);
      if (!translationModel) return { ok: false, book, reason: 'no-model' };
      const uploaded = await ensureUploaded(appService, book, onProgress);
      const history = await listJobs(uploaded.fileId);
      const active = history.find((job) => IN_FLIGHT_STATES.has(job.state));
      if (active) {
        const next = await applyJobToBook(envConfig, book, active);
        return { ok: true, book: next, job: active };
      }
      if (options.glossaryCsv && !options.glossarySha256) {
        options = { ...options, glossarySha256: await uploadGlossary(options.glossaryCsv) };
      }
      const job = await createJob({
        fileId: uploaded.fileId,
        versionId: uploaded.versionId,
        options,
        translationModel,
      });
      const next = await applyJobToBook(envConfig, book, job);
      return { ok: true, book: next, job };
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : undefined;
      console.warn('[translation] start failed', message ?? cause);
      return { ok: false, book, reason: mapStartError(cause), message };
    }
  })();
  inFlightStarts.set(book.hash, run);
  try {
    return await run;
  } finally {
    inFlightStarts.delete(book.hash);
  }
}

/** Cross-device case: the synced state says succeeded but this device holds no
 *  bytes. Re-fetch the job's signed URLs and download them. */
export async function ensureTranslatedFiles(
  envConfig: EnvConfigType,
  appService: AppService,
  book: Book,
): Promise<TranslationFileRef[]> {
  const translation = book.translation;
  if (!translation || translation.state !== 'succeeded') {
    throw new TranslationError('source-missing');
  }
  const local = (book.translationFiles ?? []).filter((ref) => ref.jobId === translation.jobId);
  const allPresent =
    local.length > 0 &&
    (
      await Promise.all(local.map((ref) => appService.exists(ref.path, 'Books').catch(() => false)))
    ).every(Boolean);
  if (allPresent) return local;
  const job = await getJob(translation.jobId);
  if (job.state !== 'succeeded') throw new TranslationError('source-missing');
  const files = await downloadOutputs(appService, book, job);
  await pruneTranslationFiles(appService, book, files);
  await applyJobToBook(envConfig, book, job, files);
  return files;
}

// ---------------------------------------------------------------------------
// Predicates
// ---------------------------------------------------------------------------

export const isTranslationInFlight = (book: Book): boolean =>
  !!book.translation && IN_FLIGHT_STATES.has(book.translation.state);

/** Output kinds the open dialog may offer, in display order (Chinese, then
 *  bilingual). Empty until the job succeeded. */
export function availableTranslationKinds(book: Book): TranslationOutputKind[] {
  const translation = book.translation;
  if (!translation || translation.state !== 'succeeded') return [];
  const local = new Set(
    (book.translationFiles ?? [])
      .filter((ref) => ref.jobId === translation.jobId)
      .map((ref) => ref.kind),
  );
  const remote = new Set(translation.outputs);
  return (['mono', 'dual'] as const).filter((kind) => local.has(kind) || remote.has(kind));
}

export function describeTranslationError(
  reason: TranslationFailureReason | undefined,
  _: (key: string) => string,
): string {
  switch (reason) {
    case 'not-signed-in':
      return _('Sign in to translate this PDF');
    case 'not-pdf':
      return _('This book is not a PDF');
    case 'already-running':
      return _('Translation is already running');
    case 'upload-failed':
      return _('Uploading PDF failed');
    case 'no-model':
      return _(
        'Configure AI Assistant with AI Gateway or an OpenAI-compatible provider before translating.',
      );
    case 'queue-full':
      return _('The translation queue is full. Try again later.');
    case 'too-large':
      return _('This PDF is too large to translate.');
    case 'source-missing':
      return _('The PDF is not available on this device.');
    default:
      return _('Translation failed');
  }
}
