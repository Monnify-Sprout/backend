import { getMonnifyProvider } from '../../lib/monnify';
import { HttpError } from '../../middleware/error';
import { findMerchantById, isUniqueViolation } from '../auth/auth.repo';

import {
  countStreams,
  deleteStream as deleteStreamRow,
  findDefaultStream,
  findStream,
  insertDefaultStreamIfMissing,
  insertStream,
  listStreamsForMerchant,
  streamUsage,
  updateStream as updateStreamRow,
  updateStreamStatus,
  type PublicStream,
  type StreamStatus,
} from './streams.repo';
import type { CreateStreamInput, UpdateStreamInput } from './streams.schema';

const DUPLICATE_MESSAGE = 'You already have a stream with that name.';

// A merchant runs a small, deliberate set of streams (a separate operations /
// settlement account each). Extra streams are for when they genuinely split the
// business, so the total (default + created, active + archived) is capped.
export const MAX_STREAMS = 3;

// The default ("<business> - Main") stream every merchant has. Idempotent, so it
// is safe to call at registration and as a defensive fallback when resolving the
// request scope. Tracking-only - no Monnify sub-account, no verification needed.
export async function ensureDefaultStream(
  merchantId: string,
): Promise<PublicStream> {
  const merchant = await findMerchantById(merchantId);
  if (!merchant) {
    throw new HttpError(404, 'Merchant not found.');
  }
  return insertDefaultStreamIfMissing(merchantId, `${merchant.business_name} - Main`);
}

// Resolve which stream a request is scoped to (Phase 14). A valid, ACTIVE stream
// id from the client's `X-Stream-Id` header wins; anything missing, unknown, or
// archived falls back to the merchant's default, so a stale header never errors
// the whole app. Never throws for a bad header - it degrades to the default.
export async function resolveStreamScope(
  merchantId: string,
  headerStreamId: string | undefined,
): Promise<PublicStream> {
  if (headerStreamId) {
    const stream = await findStream(merchantId, headerStreamId);
    if (stream && stream.status === 'active') {
      return stream;
    }
  }
  const fallback = await findDefaultStream(merchantId);
  return fallback ?? ensureDefaultStream(merchantId);
}

export function listStreams(merchantId: string): Promise<PublicStream[]> {
  return listStreamsForMerchant(merchantId);
}

// Money routing (Phase 13): a stream with its own settlement account gets its
// own Monnify sub-account under Sprout's contract, so revenue assigned to it
// settles there instead of the merchant's default account. The sub-account is
// created BEFORE any DB write (like verification): if the provider throws, no
// half-routed stream is left behind.
async function routeSubAccount(
  merchantId: string,
  streamName: string,
  bankCode: string,
  accountNumber: string,
): Promise<string> {
  const merchant = await findMerchantById(merchantId);
  if (!merchant) {
    throw new HttpError(404, 'Merchant not found.');
  }
  // Only a verified merchant can hold sub-accounts under Sprout's contract -
  // the same gate as collecting itself (PRD §7.1).
  if (merchant.status !== 'active' || !merchant.sub_account_code) {
    throw new HttpError(
      403,
      'Complete BVN/NIN verification before routing a stream to its own account.',
    );
  }
  const provider = getMonnifyProvider();
  const sub = await provider.createSubAccount({
    businessName: `${merchant.business_name} - ${streamName}`,
    email: merchant.email,
    bankCode,
    accountNumber,
  });
  return sub.subAccountCode;
}

export async function createStream(
  merchantId: string,
  input: CreateStreamInput,
): Promise<PublicStream> {
  // Cap the number of streams a merchant can run (Phase 14). The default counts,
  // so the first two extra streams are the merchant's own additions.
  const existing = await countStreams(merchantId);
  if (existing >= MAX_STREAMS) {
    throw new HttpError(
      409,
      `You can have up to ${MAX_STREAMS} streams. Delete one to add another.`,
    );
  }

  // Tracking-only streams are just labels - any merchant may create them.
  // Routing (a settlement account) additionally needs a sub-account.
  const routed = Boolean(input.settlement_account_number);
  const subAccountCode = routed
    ? await routeSubAccount(
        merchantId,
        input.name,
        input.settlement_bank_code!,
        input.settlement_account_number!,
      )
    : null;

  try {
    return await insertStream({
      merchantId,
      name: input.name,
      settlementBankCode: input.settlement_bank_code ?? null,
      settlementBankName: input.settlement_bank_name ?? null,
      settlementAccountNumber: input.settlement_account_number ?? null,
      settlementAccountName: input.settlement_account_name ?? null,
      subAccountCode,
    });
  } catch (err) {
    // The case-insensitive unique index rejects a duplicate name.
    if (isUniqueViolation(err)) {
      throw new HttpError(409, DUPLICATE_MESSAGE);
    }
    throw err;
  }
}

export async function updateStream(
  merchantId: string,
  streamId: string,
  input: UpdateStreamInput,
): Promise<PublicStream> {
  const current = await findStream(merchantId, streamId);
  if (!current) {
    throw new HttpError(404, 'Stream not found.');
  }

  let settlement;
  if (input.clear_settlement) {
    // Detach: back to tracking-only. The old sub-account simply goes unused.
    settlement = {
      bankCode: null,
      bankName: null,
      accountNumber: null,
      accountName: null,
      subAccountCode: null,
    };
  } else if (input.settlement_account_number) {
    // Attach or replace: a new destination means a new sub-account.
    const subAccountCode = await routeSubAccount(
      merchantId,
      input.name ?? current.name,
      input.settlement_bank_code!,
      input.settlement_account_number,
    );
    settlement = {
      bankCode: input.settlement_bank_code!,
      bankName: input.settlement_bank_name ?? null,
      accountNumber: input.settlement_account_number,
      accountName: input.settlement_account_name ?? null,
      subAccountCode,
    };
  }

  try {
    const updated = await updateStreamRow(merchantId, streamId, {
      name: input.name,
      settlement,
    });
    if (!updated) {
      throw new HttpError(404, 'Stream not found.');
    }
    return updated;
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new HttpError(409, DUPLICATE_MESSAGE);
    }
    throw err;
  }
}

export async function setStreamStatus(
  merchantId: string,
  streamId: string,
  status: StreamStatus,
): Promise<PublicStream> {
  const current = await findStream(merchantId, streamId);
  if (!current) {
    throw new HttpError(404, 'Stream not found.');
  }
  // The default stream is always active - it is where unassigned activity lands
  // and the fallback scope for every request, so it can never be archived.
  if (status === 'archived' && current.is_default) {
    throw new HttpError(409, 'Your main stream cannot be archived.');
  }
  const updated = await updateStreamStatus(merchantId, streamId, status);
  if (!updated) {
    throw new HttpError(404, 'Stream not found.');
  }
  return updated;
}

// Deletion is only for a stream nothing references (created by mistake). One
// with invoices or links keeps its history - archive it instead.
export async function deleteStream(
  merchantId: string,
  streamId: string,
): Promise<void> {
  const stream = await findStream(merchantId, streamId);
  if (!stream) {
    throw new HttpError(404, 'Stream not found.');
  }
  if (stream.is_default) {
    throw new HttpError(409, 'Your main stream cannot be deleted.');
  }
  const usage = await streamUsage(streamId);
  if (usage.invoice_count > 0 || usage.link_count > 0) {
    throw new HttpError(
      409,
      'This stream has invoices or payment links. Archive it instead of deleting.',
    );
  }
  const deleted = await deleteStreamRow(merchantId, streamId);
  if (!deleted) {
    throw new HttpError(404, 'Stream not found.');
  }
}

// Used by invoice/link creation: confirm a stream_id (if supplied) belongs to
// the merchant and is still active. Returns the resolved stream so callers can
// route its sub-account, or null when none was requested.
export async function assertOwnedStream(
  merchantId: string,
  streamId: string | undefined,
): Promise<PublicStream | null> {
  if (!streamId) {
    return null;
  }
  const stream = await findStream(merchantId, streamId);
  if (!stream) {
    throw new HttpError(422, 'Unknown stream.');
  }
  if (stream.status !== 'active') {
    throw new HttpError(422, 'This stream is archived. Restore it first.');
  }
  return stream;
}
