/**
 * Local AI storage is shared by all logins in a browser profile or desktop app.
 * Keep every derived index, chat and agent-memory key within an account scope.
 * Older bare-hash data remains orphaned so we never silently assign it to a
 * different person after an account switch.
 */
export function aiAccountScope(bookHash: string, userId: string | null | undefined): string {
  const account = userId ? 'user:' + encodeURIComponent(userId) : 'guest';
  return 'scholar-ai:v1:' + account + ':' + encodeURIComponent(bookHash);
}

export function aiUserScope(userId: string | null | undefined): string {
  return userId ? 'user:' + encodeURIComponent(userId) : 'guest';
}
