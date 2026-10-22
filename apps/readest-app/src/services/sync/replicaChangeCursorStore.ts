const PREFIX = 'readest.scholar.replica.change-cursor.v1:';
const MAX_BIGINT = 9223372036854775807n;

const isCursor = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^(0|[1-9][0-9]*)$/.test(value) &&
  value.length <= 19 &&
  BigInt(value) <= MAX_BIGINT;

const prefixFor = (userId: string, kind: string) => PREFIX + JSON.stringify([userId, kind]) + ':';

/**
 * Each window owns a separate key. A stale acknowledgment can only change
 * its own key, so simultaneous windows cannot overwrite a newer cursor.
 * Reads take the maximum across those keys for the same account and kind.
 */
export class LocalStorageChangeCursorStore {
  constructor(
    private readonly storage: Storage = localStorage,
    private readonly writerId: string = crypto.randomUUID(),
  ) {}

  get(userId: string, kind: string): string {
    const prefix = prefixFor(userId, kind);
    let highest = '0';
    for (let i = 0; i < this.storage.length; i++) {
      const key = this.storage.key(i);
      if (!key?.startsWith(prefix)) continue;
      const value = this.storage.getItem(key);
      if (isCursor(value) && BigInt(value) > BigInt(highest)) highest = value;
    }
    return highest;
  }

  set(userId: string, kind: string, value: string): void {
    if (!userId || !kind || !isCursor(value)) throw new Error('Invalid replica change cursor');
    if (BigInt(value) <= BigInt(this.get(userId, kind))) return;
    this.storage.setItem(prefixFor(userId, kind) + this.writerId, value);
  }
}
