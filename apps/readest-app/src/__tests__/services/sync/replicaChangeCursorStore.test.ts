import { beforeEach, describe, expect, test } from 'vitest';
import { LocalStorageChangeCursorStore } from '@/services/sync/replicaChangeCursorStore';

beforeEach(() => localStorage.clear());

describe('LocalStorageChangeCursorStore', () => {
  test('keeps accounts separate and recovers the latest cursor after restart', () => {
    const first = new LocalStorageChangeCursorStore(localStorage, 'window-a');
    first.set('account-a', 'dictionary', '9007199254740993');
    first.set('account-b', 'dictionary', '2');
    expect(
      new LocalStorageChangeCursorStore(localStorage, 'window-c').get('account-a', 'dictionary'),
    ).toBe('9007199254740993');
    expect(
      new LocalStorageChangeCursorStore(localStorage, 'window-c').get('account-b', 'dictionary'),
    ).toBe('2');
    expect(first.get('account-a', 'font')).toBe('0');
  });

  test('a stale acknowledgment from another window cannot roll back the maximum', () => {
    const first = new LocalStorageChangeCursorStore(localStorage, 'window-a');
    const second = new LocalStorageChangeCursorStore(localStorage, 'window-b');
    first.set('account-a', 'dictionary', '9007199254740993');
    second.set('account-a', 'dictionary', '9007199254740995');
    first.set('account-a', 'dictionary', '9007199254740994');
    first.set('account-a', 'dictionary', '9007199254740992');
    expect(first.get('account-a', 'dictionary')).toBe('9007199254740995');
    expect(second.get('account-a', 'dictionary')).toBe('9007199254740995');
    expect(
      new LocalStorageChangeCursorStore(localStorage, 'window-c').get('account-a', 'dictionary'),
    ).toBe('9007199254740995');
  });

  test('never acknowledges when the synchronous storage write fails', () => {
    const failingStorage = {
      get length() {
        return localStorage.length;
      },
      key: (index: number) => localStorage.key(index),
      getItem: (key: string) => localStorage.getItem(key),
      setItem: () => {
        throw new Error('quota exceeded');
      },
    } as unknown as Storage;
    const store = new LocalStorageChangeCursorStore(failingStorage, 'window-a');
    expect(() => store.set('account-a', 'dictionary', '3')).toThrow('quota exceeded');
    expect(store.get('account-a', 'dictionary')).toBe('0');
  });
});
