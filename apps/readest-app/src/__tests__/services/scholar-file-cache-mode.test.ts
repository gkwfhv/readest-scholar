import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { Book } from '@/types/book';
import type { TransferItem } from '@/store/transferStore';
import {
  getScholarFileCacheMode,
  isScholarMirrorNetworkAllowed,
  setScholarFileCacheMode,
  SCHOLAR_FILE_CACHE_MODE_EVENT,
} from '@/services/scholarFileCacheMode';
import { shouldMirrorScholarBook } from '@/hooks/useScholarFullMirror';

const accountA = '00000000-0000-4000-8000-000000000001';
const accountB = '00000000-0000-4000-8000-000000000002';
const book = (changes: Partial<Book> = {}) =>
  ({
    hash: 'paper',
    title: 'Paper',
    format: 'PDF',
    uploadedAt: 1,
    ...changes,
  }) as Book;
const transfer = (changes: Partial<TransferItem> = {}) =>
  ({
    id: 'task',
    kind: 'book',
    type: 'download',
    bookHash: 'paper',
    status: 'failed',
    ...changes,
  }) as TransferItem;

beforeEach(() => localStorage.clear());

describe('Scholar device file cache mode', () => {
  test('defaults to on demand and scopes full mirror to one account', () => {
    expect(getScholarFileCacheMode(accountA)).toBe('on_demand');
    const event = vi.fn();
    window.addEventListener(SCHOLAR_FILE_CACHE_MODE_EVENT, event);
    setScholarFileCacheMode(accountA, 'full_mirror');
    expect(getScholarFileCacheMode(accountA)).toBe('full_mirror');
    expect(getScholarFileCacheMode(accountB)).toBe('on_demand');
    expect(event).toHaveBeenCalledOnce();
    window.removeEventListener(SCHOLAR_FILE_CACHE_MODE_EVENT, event);
  });

  test('never queues absent, deleted, fileless, or already failed downloads', () => {
    expect(shouldMirrorScholarBook(book(), [])).toBe(true);
    expect(shouldMirrorScholarBook(book({ uploadedAt: null }), [])).toBe(false);
    expect(shouldMirrorScholarBook(book({ deletedAt: 2 }), [])).toBe(false);
    expect(shouldMirrorScholarBook(book({ url: 'feed://example' }), [])).toBe(false);
    expect(shouldMirrorScholarBook(book(), [transfer()])).toBe(false);
    expect(shouldMirrorScholarBook(book(), [transfer({ status: 'pending' })])).toBe(false);
    expect(shouldMirrorScholarBook(book(), [transfer({ status: 'completed' })])).toBe(true);
    expect(
      shouldMirrorScholarBook(book(), [transfer({ scholarAccountId: accountB })], accountA),
    ).toBe(true);
    expect(
      shouldMirrorScholarBook(book(), [transfer({ scholarAccountId: accountA })], accountA),
    ).toBe(false);
  });
});

test('mobile full mirror waits for a positively identified Wi-Fi link', () => {
  const agent = vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('iPhone');
  expect(isScholarMirrorNetworkAllowed()).toBe(false);
  const connection = { type: 'cellular', saveData: false };
  Object.defineProperty(navigator, 'connection', { configurable: true, value: connection });
  expect(isScholarMirrorNetworkAllowed()).toBe(false);
  connection.type = 'wifi';
  expect(isScholarMirrorNetworkAllowed()).toBe(true);
  connection.saveData = true;
  expect(isScholarMirrorNetworkAllowed()).toBe(false);
  Reflect.deleteProperty(navigator, 'connection');
  agent.mockRestore();
  expect(isScholarMirrorNetworkAllowed(true)).toBe(false);
});
