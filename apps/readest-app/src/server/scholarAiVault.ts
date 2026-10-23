import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';

export type ScholarAiCredentialKind = 'aiGatewayApiKey' | 'openrouterApiKey';
export interface SealedAiCredential {
  nonce: string;
  ciphertext: string;
  authTag: string;
}

function associatedData(userId: string, kind: ScholarAiCredentialKind): Buffer {
  return Buffer.from(JSON.stringify(['scholar-ai-credential:v1', userId, kind]));
}

function checkKey(key: Buffer): void {
  if (key.length !== 32) throw new Error('AI credential vault key must be 32 bytes');
}

/** 32 random bytes, encoded as base64 in a restricted server-side file. */
export function readAiVaultKey(): Buffer {
  const path = process.env['SCHOLAR_AI_VAULT_KEY_FILE'];
  if (!path) throw new Error('AI credential vault key file is not configured');
  const mode = statSync(path).mode;
  if (mode & 0o077) throw new Error('AI credential vault key file permissions are too broad');
  const encoded = readFileSync(path, 'utf8').trim();
  if (!/^[A-Za-z0-9+/]{43}=$/.test(encoded)) throw new Error('Invalid AI credential vault key');
  const key = Buffer.from(encoded, 'base64');
  checkKey(key);
  return key;
}

export function sealAiCredential(
  key: Buffer,
  userId: string,
  kind: ScholarAiCredentialKind,
  value: string,
): SealedAiCredential {
  checkKey(key);
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  cipher.setAAD(associatedData(userId, kind));
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return {
    nonce: nonce.toString('base64'),
    ciphertext: ciphertext.toString('base64'),
    authTag: cipher.getAuthTag().toString('base64'),
  };
}

export function openAiCredential(
  key: Buffer,
  userId: string,
  kind: ScholarAiCredentialKind,
  sealed: SealedAiCredential,
): string {
  checkKey(key);
  const nonce = Buffer.from(sealed.nonce, 'base64');
  const authTag = Buffer.from(sealed.authTag, 'base64');
  if (nonce.length !== 12 || authTag.length !== 16) {
    throw new Error('Invalid AI credential envelope');
  }
  const decipher = createDecipheriv('aes-256-gcm', key, nonce);
  decipher.setAAD(associatedData(userId, kind));
  decipher.setAuthTag(authTag);
  return Buffer.concat([
    decipher.update(Buffer.from(sealed.ciphertext, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}
