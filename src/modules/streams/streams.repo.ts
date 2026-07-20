import { query } from '../../lib/db';

// Phase 13: revenue streams - a merchant's own subdivisions of their activity
// (a shop branch, a market stall, the Instagram page, a sales rep, a pop-up, a
// second brand). Everything here is keyed on merchant_id (owner-scoped) so a
// merchant can only ever touch their own.

export type StreamStatus = 'active' | 'archived';

export interface PublicStream {
  id: string;
  merchant_id: string;
  name: string;
  // Money routing (Phase 13): a routed stream carries its own settlement
  // destination + Monnify sub-account; all four stay null for tracking-only.
  settlement_bank_code: string | null;
  settlement_bank_name: string | null;
  settlement_account_number: string | null;
  settlement_account_name: string | null;
  sub_account_code: string | null;
  status: StreamStatus;
  created_at: string;
  updated_at: string;
  // Per-stream rollups; populated by the list query, undefined elsewhere.
  invoice_count?: number;
  link_count?: number;
  total_collected?: number;
  last_paid_at?: string | null;
}

const STREAM_COLUMNS =
  'id, merchant_id, name, settlement_bank_code, settlement_bank_name, settlement_account_number, settlement_account_name, sub_account_code, status, created_at, updated_at';

export interface NewStream {
  merchantId: string;
  name: string;
  settlementBankCode: string | null;
  settlementBankName: string | null;
  settlementAccountNumber: string | null;
  settlementAccountName: string | null;
  subAccountCode: string | null;
}

// The unique (merchant_id, lower(name)) index throws 23505 on a duplicate; the
// service maps that to a friendly 409.
export async function insertStream(input: NewStream): Promise<PublicStream> {
  const rows = await query<PublicStream>(
    `insert into streams
       (merchant_id, name, settlement_bank_code, settlement_bank_name,
        settlement_account_number, settlement_account_name, sub_account_code)
     values ($1, $2, $3, $4, $5, $6, $7)
     returning ${STREAM_COLUMNS}`,
    [
      input.merchantId,
      input.name,
      input.settlementBankCode,
      input.settlementBankName,
      input.settlementAccountNumber,
      input.settlementAccountName,
      input.subAccountCode,
    ],
  );
  return rows[0]!;
}

export async function listStreamsForMerchant(
  merchantId: string,
): Promise<PublicStream[]> {
  // Rollups power the manager UI: how much each stream has collected across
  // BOTH products (paid invoices + link collections), and how many of each
  // reference it. Correlated subselects keep the shape simple, like the
  // payment-links list.
  return query<PublicStream>(
    `select ${STREAM_COLUMNS.split(', ')
      .map((c) => `s.${c}`)
      .join(', ')},
            (select count(*)::int from invoices i where i.stream_id = s.id) as invoice_count,
            (select count(*)::int from payment_links pl where pl.stream_id = s.id) as link_count,
            ((select coalesce(sum(p.amount), 0)
                from payments p
                join invoices i on i.id = p.invoice_id
               where i.stream_id = s.id and p.paid_at is not null)
             + (select coalesce(sum(lp.amount), 0)
                  from link_payments lp
                  join payment_links pl on pl.id = lp.payment_link_id
                 where pl.stream_id = s.id))::float8 as total_collected,
            greatest(
              (select max(p.paid_at)
                 from payments p
                 join invoices i on i.id = p.invoice_id
                where i.stream_id = s.id),
              (select max(lp.paid_at)
                 from link_payments lp
                 join payment_links pl on pl.id = lp.payment_link_id
                where pl.stream_id = s.id)) as last_paid_at
       from streams s
      where s.merchant_id = $1
      order by s.status, lower(s.name)`,
    [merchantId],
  );
}

export async function findStream(
  merchantId: string,
  streamId: string,
): Promise<PublicStream | null> {
  const rows = await query<PublicStream>(
    `select ${STREAM_COLUMNS} from streams
      where id = $1 and merchant_id = $2 limit 1`,
    [streamId, merchantId],
  );
  return rows[0] ?? null;
}

export interface StreamPatch {
  name?: string;
  // Attaching (or replacing) a settlement destination sets all five together;
  // clearing sets all five to null. The service decides which; the repo just
  // writes what it is given.
  settlement?: {
    bankCode: string | null;
    bankName: string | null;
    accountNumber: string | null;
    accountName: string | null;
    subAccountCode: string | null;
  };
}

// Owner-scoped update. Returns the updated row, or null if no such stream
// belongs to this merchant. Maps to 23505 on a name collision (service -> 409).
export async function updateStream(
  merchantId: string,
  streamId: string,
  patch: StreamPatch,
): Promise<PublicStream | null> {
  const sets: string[] = [];
  const params: unknown[] = [streamId, merchantId];
  if (patch.name !== undefined) {
    params.push(patch.name);
    sets.push(`name = $${params.length}`);
  }
  if (patch.settlement !== undefined) {
    const s = patch.settlement;
    for (const [column, value] of [
      ['settlement_bank_code', s.bankCode],
      ['settlement_bank_name', s.bankName],
      ['settlement_account_number', s.accountNumber],
      ['settlement_account_name', s.accountName],
      ['sub_account_code', s.subAccountCode],
    ] as const) {
      params.push(value);
      sets.push(`${column} = $${params.length}`);
    }
  }
  if (sets.length === 0) {
    return findStream(merchantId, streamId);
  }
  const rows = await query<PublicStream>(
    `update streams set ${sets.join(', ')}
      where id = $1 and merchant_id = $2
      returning ${STREAM_COLUMNS}`,
    params,
  );
  return rows[0] ?? null;
}

// Owner-scoped status change (active <-> archived, both directions legal).
export async function updateStreamStatus(
  merchantId: string,
  streamId: string,
  status: StreamStatus,
): Promise<PublicStream | null> {
  const rows = await query<PublicStream>(
    `update streams set status = $3
      where id = $1 and merchant_id = $2
      returning ${STREAM_COLUMNS}`,
    [streamId, merchantId, status],
  );
  return rows[0] ?? null;
}

// How many invoices/links reference a stream - gates deletion (the service only
// deletes an unreferenced stream; anything with history is archived instead).
export async function streamUsage(
  streamId: string,
): Promise<{ invoice_count: number; link_count: number }> {
  const rows = await query<{ invoice_count: number; link_count: number }>(
    `select
       (select count(*)::int from invoices where stream_id = $1) as invoice_count,
       (select count(*)::int from payment_links where stream_id = $1) as link_count`,
    [streamId],
  );
  return rows[0]!;
}

export async function deleteStream(
  merchantId: string,
  streamId: string,
): Promise<boolean> {
  const rows = await query<{ id: string }>(
    `delete from streams where id = $1 and merchant_id = $2 returning id`,
    [streamId, merchantId],
  );
  return rows.length > 0;
}
