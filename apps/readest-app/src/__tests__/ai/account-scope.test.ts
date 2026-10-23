import { describe, expect, test } from 'vitest';
import { aiAccountScope, aiUserScope } from '@/services/ai/accountScope';

describe('AI account storage scopes', () => {
  test('the same book is separate for two accounts and guest', () => {
    const a = aiAccountScope('paper', 'user-a');
    const b = aiAccountScope('paper', 'user-b');
    const guest = aiAccountScope('paper', null);
    expect(new Set([a, b, guest]).size).toBe(3);
    expect(a).not.toBe('paper');
    expect(aiAccountScope('paper', 'user-a')).toBe(a);
  });

  test('delimiters in account and book ids cannot collide', () => {
    expect(aiAccountScope('b:c', 'a')).not.toBe(aiAccountScope('c', 'a:b'));
    expect(aiUserScope(null)).not.toBe(aiUserScope('guest'));
  });
});
