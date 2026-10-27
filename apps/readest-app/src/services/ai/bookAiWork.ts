/** A pending local deletion blocks new AI writes for that account and book. */
const PENDING_PREFIX = 'scholar-ai-pending-book-delete:v1:';
const GENERATION_PREFIX = 'scholar-ai-book-generation:v1:';

interface ActiveBookAiWork {
  controller: AbortController;
  promise: Promise<unknown>;
}

const active = new Map<string, Set<ActiveBookAiWork>>();

export function pendingBookAiDeletionKey(scope: string): string {
  return PENDING_PREFIX + encodeURIComponent(scope);
}

export function bookAiGeneration(scope: string): string {
  return typeof localStorage === 'undefined'
    ? ''
    : (localStorage.getItem(GENERATION_PREFIX + encodeURIComponent(scope)) ?? '');
}

export function advanceBookAiGeneration(scope: string): void {
  localStorage.setItem(
    GENERATION_PREFIX + encodeURIComponent(scope),
    `${Date.now()}:${Math.random()}`,
  );
}

export function isBookAiDataDeletionPending(scope: string): boolean {
  return (
    typeof localStorage !== 'undefined' &&
    localStorage.getItem(pendingBookAiDeletionKey(scope)) !== null
  );
}

export function assertBookAiScopeActive(scope: string, expectedGeneration?: string): void {
  if (isBookAiDataDeletionPending(scope)) {
    throw new Error('Book AI data is being deleted');
  }
  if (expectedGeneration !== undefined && bookAiGeneration(scope) !== expectedGeneration) {
    throw new Error('Book AI data changed during indexing');
  }
}

/** Register before any asynchronous extraction or embedding begins. */
export function runBookAiWork<T>(
  scope: string,
  work: (signal: AbortSignal, assertCurrent: () => void) => Promise<T>,
): Promise<T> {
  const generation = bookAiGeneration(scope);
  const assertCurrent = () => assertBookAiScopeActive(scope, generation);
  assertCurrent();
  const controller = new AbortController();
  const promise = Promise.resolve().then(() => {
    assertCurrent();
    return work(controller.signal, assertCurrent);
  });
  const entry: ActiveBookAiWork = { controller, promise };
  const entries = active.get(scope) ?? new Set<ActiveBookAiWork>();
  entries.add(entry);
  active.set(scope, entries);
  // Handle both outcomes so the cleanup hook cannot create an unhandled rejection.
  void promise.then(
    () => {
      entries.delete(entry);
      if (entries.size === 0) active.delete(scope);
    },
    () => {
      entries.delete(entry);
      if (entries.size === 0) active.delete(scope);
    },
  );
  return promise;
}

export function cancelBookAiWork(scope: string): void {
  for (const entry of active.get(scope) ?? []) entry.controller.abort();
}

/** Deletion waits for writes already underway before removing their rows. */
export async function waitForBookAiWork(scope: string): Promise<void> {
  await Promise.allSettled(Array.from(active.get(scope) ?? [], (entry) => entry.promise));
}
