import { timingSafeEqual } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';

function readToken(): Buffer {
  const path = process.env['SCHOLAR_TRANSLATION_WORKER_TOKEN_FILE'];
  if (!path) throw new Error('Translation worker token file is not configured');
  const mode = statSync(path).mode;
  if (mode & 0o077) throw new Error('Translation worker token file permissions are too broad');
  const value = readFileSync(path, 'utf8').trim();
  if (!/^[A-Za-z0-9_-]{43}$/.test(value)) throw new Error('Invalid translation worker token');
  return Buffer.from(value, 'utf8');
}

/** Returns false for malformed requests without exposing the expected secret. */
export function isValidTranslationWorkerToken(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  let expected: Buffer;
  try {
    expected = readToken();
  } catch {
    return false;
  }
  const actual = Buffer.from(value, 'utf8');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
