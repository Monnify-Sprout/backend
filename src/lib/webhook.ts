import { createHmac, timingSafeEqual } from 'node:crypto';

// Monnify signs collection webhooks with an HMAC-SHA512 of the RAW request body,
// keyed by the client secret, in the `monnify-signature` header. We validate over
// the raw bytes (captured in index.ts) — never the re-serialised JSON.
export function computeMonnifySignature(
  rawBody: Buffer | string,
  secret: string,
): string {
  return createHmac('sha512', secret).update(rawBody).digest('hex');
}

export function verifyMonnifySignature(
  rawBody: Buffer | string | undefined,
  signature: string | undefined,
  secret: string | undefined,
): boolean {
  if (!rawBody || !signature || !secret) {
    return false;
  }
  const expected = Buffer.from(computeMonnifySignature(rawBody, secret));
  const provided = Buffer.from(signature);
  // timingSafeEqual throws on length mismatch — guard first.
  return (
    expected.length === provided.length && timingSafeEqual(expected, provided)
  );
}
