import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

import { env } from '../config/env';
import { HttpError } from '../middleware/error';

// AES-256-GCM for connected-account Monnify credentials at rest (PRD §7.6, §12).
// Ciphertext format: v1:<iv-hex>:<auth-tag-hex>:<ciphertext-hex>.
// The *_ref columns in connected_accounts hold ONLY this format — never plaintext.

function encryptionKey(): Buffer {
  const hex = env.CREDENTIALS_ENCRYPTION_KEY;
  if (!hex || !/^[0-9a-f]{64}$/i.test(hex)) {
    throw new HttpError(
      500,
      'CREDENTIALS_ENCRYPTION_KEY is not configured (need 32 bytes as 64 hex chars).',
    );
  }
  return Buffer.from(hex, 'hex');
}

export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString('hex')}:${tag.toString('hex')}:${ct.toString('hex')}`;
}

export function decryptSecret(stored: string): string {
  const [version, ivHex, tagHex, ctHex] = stored.split(':');
  if (version !== 'v1' || !ivHex || !tagHex || !ctHex) {
    throw new HttpError(500, 'Stored credential has an unknown format.');
  }
  const decipher = createDecipheriv(
    'aes-256-gcm',
    encryptionKey(),
    Buffer.from(ivHex, 'hex'),
  );
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  return Buffer.concat([
    decipher.update(Buffer.from(ctHex, 'hex')),
    decipher.final(),
  ]).toString('utf8');
}
