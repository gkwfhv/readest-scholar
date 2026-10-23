import { randomBytes } from 'node:crypto';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { openAiCredential, readAiVaultKey, sealAiCredential } from '@/server/scholarAiVault';

const alice = '00000000-0000-4000-8000-000000000001';
const bob = '00000000-0000-4000-8000-000000000002';

describe('Scholar AI credential envelope', () => {
  it('encrypts at rest and decrypts only for the owner and field', () => {
    const key = randomBytes(32);
    const sealed = sealAiCredential(key, alice, 'openrouterApiKey', 'synthetic-secret');
    expect(JSON.stringify(sealed)).not.toContain('synthetic-secret');
    expect(openAiCredential(key, alice, 'openrouterApiKey', sealed)).toBe('synthetic-secret');
    expect(() => openAiCredential(key, bob, 'openrouterApiKey', sealed)).toThrow();
    expect(() => openAiCredential(key, alice, 'aiGatewayApiKey', sealed)).toThrow();
  });

  it('loads a restricted server key file and rejects broad permissions', () => {
    const dir = mkdtempSync(join(tmpdir(), 'scholar-ai-vault-'));
    const file = join(dir, 'vault.key');
    const prior = process.env['SCHOLAR_AI_VAULT_KEY_FILE'];
    try {
      const key = randomBytes(32);
      writeFileSync(file, key.toString('base64') + '\n', { mode: 0o600 });
      process.env['SCHOLAR_AI_VAULT_KEY_FILE'] = file;
      expect(readAiVaultKey()).toEqual(key);
      chmodSync(file, 0o644);
      expect(() => readAiVaultKey()).toThrow(/permissions/);
    } finally {
      if (prior === undefined) delete process.env['SCHOLAR_AI_VAULT_KEY_FILE'];
      else process.env['SCHOLAR_AI_VAULT_KEY_FILE'] = prior;
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('rejects tampering and an unrelated key', () => {
    const key = randomBytes(32);
    const sealed = sealAiCredential(key, alice, 'aiGatewayApiKey', 'only-test-data');
    expect(() => openAiCredential(randomBytes(32), alice, 'aiGatewayApiKey', sealed)).toThrow();
    const tampered = { ...sealed, ciphertext: Buffer.from('changed').toString('base64') };
    expect(() => openAiCredential(key, alice, 'aiGatewayApiKey', tampered)).toThrow();
  });
});
