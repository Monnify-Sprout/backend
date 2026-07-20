import { query } from '../../lib/db';

// Phase 12: static (reusable) payment links + their collections. Everything here
// is keyed on merchant_id (owner-scoped) so a merchant can only ever touch its own.

export type PaymentLinkStatus = 'active' | 'paused' | 'ended';

export interface PublicPaymentLink {
  id: string;
  merchant_id: string;
  title: string;
  item: string | null;
  slug: string;
  amount: string | null; // pg numeric as string; null = buyer-entered amount
  currency: string;
  status: PaymentLinkStatus;
  category_id: string | null;
  stream_id: string | null;
  reserved_account_reference: string | null;
  reserved_account_number: string | null;
  reserved_account_bank_name: string | null;
  checkout_url: string | null;
  created_at: string;
  updated_at: string;
  // Populated by the list/detail queries (joined category); undefined elsewhere.
  category_name?: string | null;
  category_color?: string | null;
  // Populated by the list/detail queries (joined stream); undefined elsewhere.
  stream_name?: string | null;
  // Per-link collection rollups; populated by the list query and getLinkStats.
  collection_count?: number;
  total_collected?: string;
  last_paid_at?: string | null;
}

export interface PublicLinkPayment {
  id: string;
  payment_link_id: string;
  amount: string;
  currency: string;
  payment_method: string | null;
  customer_name: string | null;
  settlement_amount: string | null;
  commission_amount: string | null;
  monnify_transaction_reference: string | null;
  paid_at: string | null;
  created_at: string;
}

export interface LinkStatusSummary {
  total: number;
  active: number;
  paused: number;
  ended: number;
  total_collected: number;
}

export interface LinkStats {
  collection_count: number;
  total_collected: number;
  average_amount: number;
  last_paid_at: string | null;
}

const LINK_COLUMNS =
  'id, merchant_id, title, item, slug, amount, currency, status, category_id, stream_id, reserved_account_reference, reserved_account_number, reserved_account_bank_name, checkout_url, created_at, updated_at';

const LINK_PAYMENT_COLUMNS =
  'id, payment_link_id, amount, currency, payment_method, customer_name, settlement_amount, commission_amount, monnify_transaction_reference, paid_at, created_at';

// Correlated rollups reused by the list query (a link's lifetime collections).
const LINK_ROLLUPS = `
  (select count(*)::int from link_payments lp where lp.payment_link_id = p.id) as collection_count,
  (select coalesce(sum(lp.amount), 0)::text from link_payments lp where lp.payment_link_id = p.id) as total_collected,
  (select max(lp.paid_at) from link_payments lp where lp.payment_link_id = p.id) as last_paid_at`;

export interface NewPaymentLink {
  merchantId: string;
  title: string;
  item: string | null;
  slug: string;
  amount: number | null;
  currency: string;
  categoryId: string | null;
  streamId: string | null;
  reservedAccountReference: string;
  reservedAccountNumber: string;
  reservedAccountBankName: string | null;
  checkoutUrl: string;
}

export async function insertPaymentLink(
  input: NewPaymentLink,
): Promise<PublicPaymentLink> {
  const rows = await query<PublicPaymentLink>(
    `insert into payment_links
       (merchant_id, title, item, slug, amount, currency, status, category_id, stream_id,
        reserved_account_reference, reserved_account_number,
        reserved_account_bank_name, checkout_url)
     values ($1, $2, $3, $4, $5, $6, 'active', $7, $8, $9, $10, $11, $12)
     returning ${LINK_COLUMNS}`,
    [
      input.merchantId,
      input.title,
      input.item,
      input.slug,
      input.amount,
      input.currency,
      input.categoryId,
      input.streamId,
      input.reservedAccountReference,
      input.reservedAccountNumber,
      input.reservedAccountBankName,
      input.checkoutUrl,
    ],
  );
  return rows[0]!;
}

export async function listPaymentLinksForMerchant(
  merchantId: string,
): Promise<PublicPaymentLink[]> {
  return query<PublicPaymentLink>(
    `select ${LINK_COLUMNS.split(', ')
      .map((c) => `p.${c}`)
      .join(', ')},
            c.name as category_name, c.color as category_color,
            s.name as stream_name,
            ${LINK_ROLLUPS}
       from payment_links p
       left join categories c on c.id = p.category_id
       left join streams s on s.id = p.stream_id
      where p.merchant_id = $1
      order by p.created_at desc`,
    [merchantId],
  );
}

export async function findPaymentLinkForMerchant(
  merchantId: string,
  linkId: string,
): Promise<PublicPaymentLink | null> {
  const rows = await query<PublicPaymentLink>(
    `select ${LINK_COLUMNS.split(', ')
      .map((c) => `p.${c}`)
      .join(', ')},
            c.name as category_name, c.color as category_color,
            s.name as stream_name
       from payment_links p
       left join categories c on c.id = p.category_id
       left join streams s on s.id = p.stream_id
      where p.id = $1 and p.merchant_id = $2
      limit 1`,
    [linkId, merchantId],
  );
  return rows[0] ?? null;
}

// Owner-scoped status change. Returns the updated row, or null if no such link
// belongs to this merchant. Transition legality is enforced in the service.
export async function updatePaymentLinkStatus(
  merchantId: string,
  linkId: string,
  status: PaymentLinkStatus,
): Promise<PublicPaymentLink | null> {
  const rows = await query<PublicPaymentLink>(
    `update payment_links set status = $3
      where id = $1 and merchant_id = $2
      returning ${LINK_COLUMNS}`,
    [linkId, merchantId, status],
  );
  return rows[0] ?? null;
}

export async function statusSummaryForMerchant(
  merchantId: string,
): Promise<LinkStatusSummary> {
  const rows = await query<LinkStatusSummary>(
    `select
       count(*)::int as total,
       count(*) filter (where status = 'active')::int as active,
       count(*) filter (where status = 'paused')::int as paused,
       count(*) filter (where status = 'ended')::int as ended,
       coalesce(
         (select sum(lp.amount)
            from link_payments lp
            join payment_links p2 on p2.id = lp.payment_link_id
           where p2.merchant_id = $1), 0)::float8 as total_collected
     from payment_links
     where merchant_id = $1`,
    [merchantId],
  );
  return rows[0]!;
}

export async function getLinkStats(linkId: string): Promise<LinkStats> {
  const rows = await query<LinkStats>(
    `select
       count(*)::int as collection_count,
       coalesce(sum(amount), 0)::float8 as total_collected,
       coalesce(round(avg(amount)::numeric, 2), 0)::float8 as average_amount,
       max(paid_at) as last_paid_at
     from link_payments
     where payment_link_id = $1`,
    [linkId],
  );
  return rows[0]!;
}

export async function listLinkPaymentsForLink(
  linkId: string,
): Promise<PublicLinkPayment[]> {
  return query<PublicLinkPayment>(
    `select ${LINK_PAYMENT_COLUMNS} from link_payments
      where payment_link_id = $1
      order by coalesce(paid_at, created_at) desc`,
    [linkId],
  );
}

// The webhook finds a link by the reserved account reference Monnify echoes back.
export async function findPaymentLinkByAccountReference(
  reference: string,
): Promise<PublicPaymentLink | null> {
  const rows = await query<PublicPaymentLink>(
    `select ${LINK_COLUMNS} from payment_links
      where reserved_account_reference = $1 limit 1`,
    [reference],
  );
  return rows[0] ?? null;
}

// Safe subset for the buyer-facing pay page: what the link is, who it is from
// (business name only), and how to pay. No merchant contact, no settlement/
// commission figures, no internal reference.
export interface PublicPaymentLinkLookup {
  slug: string;
  business_name: string;
  title: string;
  item: string | null;
  amount: string | null;
  currency: string;
  status: PaymentLinkStatus;
  reserved_account_number: string | null;
  reserved_account_bank_name: string | null;
  checkout_url: string | null;
}

export async function findPublicPaymentLinkBySlug(
  slug: string,
): Promise<PublicPaymentLinkLookup | null> {
  const rows = await query<PublicPaymentLinkLookup>(
    `select p.slug, m.business_name, p.title, p.item, p.amount, p.currency, p.status,
            p.reserved_account_number, p.reserved_account_bank_name, p.checkout_url
       from payment_links p
       join merchants m on m.id = p.merchant_id
      where p.slug = $1
      limit 1`,
    [slug],
  );
  return rows[0] ?? null;
}

export interface RecordLinkPaymentInput {
  paymentLinkId: string;
  eventKey: string;
  transactionReference: string;
  amountPaid: number;
  currency: string;
  paymentMethod: string | null;
  customerName: string | null;
  paidAt: string | null;
  settlementAmount: number;
  commissionAmount: number;
  raw: unknown;
}

// Idempotent: the unique event_key means a replayed webhook inserts nothing.
// Returns true if THIS call recorded the collection, false if it was a duplicate.
export async function recordLinkPaymentIfNew(
  input: RecordLinkPaymentInput,
): Promise<boolean> {
  const rows = await query<{ id: string }>(
    `insert into link_payments
       (payment_link_id, event_key, monnify_transaction_reference, amount, currency,
        payment_method, customer_name, settlement_amount, commission_amount, paid_at, raw)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     on conflict (event_key) do nothing
     returning id`,
    [
      input.paymentLinkId,
      input.eventKey,
      input.transactionReference,
      input.amountPaid,
      input.currency,
      input.paymentMethod,
      input.customerName,
      input.settlementAmount,
      input.commissionAmount,
      input.paidAt,
      JSON.stringify(input.raw),
    ],
  );
  return rows.length > 0;
}

// Slug uniqueness is enforced by the unique index; the service retries on the
// rare collision, so this just reports whether one exists to pre-empt most.
export async function slugExists(slug: string): Promise<boolean> {
  const rows = await query<{ one: number }>(
    `select 1 as one from payment_links where slug = $1 limit 1`,
    [slug],
  );
  return rows.length > 0;
}
