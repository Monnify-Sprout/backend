import { query } from '../../lib/db';

export type InvoiceStatus = 'pending' | 'paid' | 'expired' | 'cancelled';
export type SettlementPath = 'split' | 'manual';

export interface PublicInvoice {
  id: string;
  merchant_id: string;
  invoice_reference: string | null;
  customer_name: string | null;
  customer_email: string | null;
  customer_phone: string | null;
  customer_social_handle: string | null;
  customer_social_platform: string | null;
  item: string | null;
  notes: string | null;
  amount: string; // pg returns numeric as string
  currency: string;
  due_date: string | null;
  status: InvoiceStatus;
  category_id: string | null;
  stream_id: string | null;
  virtual_account_number: string | null;
  checkout_url: string | null;
  monnify_transaction_reference: string | null;
  settlement_path: SettlementPath | null;
  created_at: string;
  updated_at: string;
  // Only populated by the merchant list query (see listInvoicesForMerchant),
  // which joins the invoice's payment; undefined elsewhere.
  paid_at?: string | null;
  // Only populated by the merchant list/detail queries, which join the category
  // (kept out of the shared/public column set); undefined elsewhere.
  category_name?: string | null;
  category_color?: string | null;
  // Only populated by the merchant list/detail queries, which join the stream
  // (kept out of the shared/public column set); undefined elsewhere.
  stream_name?: string | null;
}

export interface PublicPayment {
  id: string;
  invoice_id: string;
  amount: string;
  currency: string;
  payment_method: string | null;
  settlement_amount: string | null;
  commission_amount: string | null;
  monnify_transaction_reference: string | null;
  paid_at: string | null;
  created_at: string;
}

const INVOICE_COLUMNS =
  'id, merchant_id, invoice_reference, customer_name, customer_email, customer_phone, customer_social_handle, customer_social_platform, item, notes, amount, currency, due_date, status, category_id, stream_id, virtual_account_number, checkout_url, monnify_transaction_reference, settlement_path, created_at, updated_at';

const PAYMENT_COLUMNS =
  'id, invoice_id, amount, currency, payment_method, settlement_amount, commission_amount, monnify_transaction_reference, paid_at, created_at';

export interface NewInvoice {
  merchantId: string;
  invoiceReference: string;
  customerName: string | null;
  customerEmail: string | null;
  customerPhone: string | null;
  customerSocialHandle: string | null;
  customerSocialPlatform: string | null;
  item: string;
  notes: string | null;
  amount: number;
  currency: string;
  dueDate: string | null;
  categoryId: string | null;
  streamId: string | null;
  transactionReference: string;
  virtualAccountNumber: string;
  checkoutUrl: string;
  settlementPath: SettlementPath;
}

export async function insertInvoice(input: NewInvoice): Promise<PublicInvoice> {
  const rows = await query<PublicInvoice>(
    `insert into invoices
       (merchant_id, invoice_reference, customer_name, customer_email,
        customer_phone, customer_social_handle, customer_social_platform, item, notes,
        amount, currency, due_date, category_id, stream_id, status,
        monnify_transaction_reference, virtual_account_number, checkout_url, settlement_path)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, 'pending', $15, $16, $17, $18)
     returning ${INVOICE_COLUMNS}`,
    [
      input.merchantId,
      input.invoiceReference,
      input.customerName,
      input.customerEmail,
      input.customerPhone,
      input.customerSocialHandle,
      input.customerSocialPlatform,
      input.item,
      input.notes,
      input.amount,
      input.currency,
      input.dueDate,
      input.categoryId,
      input.streamId,
      input.transactionReference,
      input.virtualAccountNumber,
      input.checkoutUrl,
      input.settlementPath,
    ],
  );
  return rows[0]!;
}

export async function listInvoicesForMerchant(
  merchantId: string,
): Promise<PublicInvoice[]> {
  // paid_at (when the invoice was settled) comes from the joined payment, and
  // the category name/colour from the joined category - the list is where the
  // dashboard needs both (paid column + filters, category chip + filter), so
  // they are added here rather than to the shared INVOICE_COLUMNS.
  return query<PublicInvoice>(
    `select ${INVOICE_COLUMNS.split(', ')
      .map((c) => `i.${c}`)
      .join(', ')},
            (select max(p.paid_at) from payments p where p.invoice_id = i.id) as paid_at,
            c.name as category_name, c.color as category_color,
            s.name as stream_name
       from invoices i
       left join categories c on c.id = i.category_id
       left join streams s on s.id = i.stream_id
      where i.merchant_id = $1
      order by i.created_at desc`,
    [merchantId],
  );
}

export async function findInvoiceForMerchant(
  merchantId: string,
  invoiceId: string,
): Promise<PublicInvoice | null> {
  const rows = await query<PublicInvoice>(
    `select ${INVOICE_COLUMNS.split(', ')
      .map((c) => `i.${c}`)
      .join(', ')},
            c.name as category_name, c.color as category_color,
            s.name as stream_name
       from invoices i
       left join categories c on c.id = i.category_id
       left join streams s on s.id = i.stream_id
      where i.id = $1 and i.merchant_id = $2
      limit 1`,
    [invoiceId, merchantId],
  );
  return rows[0] ?? null;
}

export async function findInvoiceByTransactionReference(
  transactionReference: string,
): Promise<PublicInvoice | null> {
  const rows = await query<PublicInvoice>(
    `select ${INVOICE_COLUMNS} from invoices where monnify_transaction_reference = $1 limit 1`,
    [transactionReference],
  );
  return rows[0] ?? null;
}

export async function findInvoiceByReference(
  invoiceReference: string,
): Promise<PublicInvoice | null> {
  const rows = await query<PublicInvoice>(
    `select ${INVOICE_COLUMNS} from invoices where invoice_reference = $1 limit 1`,
    [invoiceReference],
  );
  return rows[0] ?? null;
}

// A pending invoice past its due date is expired (PRD §7.2). Expiry is applied
// lazily at read time rather than by a scheduler: any read path that can show
// an invoice's status sweeps first, so status is settled server-side and the
// client never derives it. Due "today" is still payable until the day ends.
export async function expireOverdueInvoiceByReference(
  invoiceReference: string,
): Promise<void> {
  await query(
    `update invoices set status = 'expired'
      where invoice_reference = $1 and status = 'pending'
        and due_date is not null and due_date < current_date`,
    [invoiceReference],
  );
}

export async function expireOverdueInvoicesForMerchant(
  merchantId: string,
): Promise<void> {
  await query(
    `update invoices set status = 'expired'
      where merchant_id = $1 and status = 'pending'
        and due_date is not null and due_date < current_date`,
    [merchantId],
  );
}

// Safe subset for the buyer-facing payment page: what the invoice is, who it is
// from (business name only, no merchant contact details), and how to pay.
export interface PublicInvoiceLookup {
  id: string; // internal - used to join the payment, never sent to the client
  invoice_reference: string;
  business_name: string;
  customer_name: string | null;
  customer_social_handle: string | null; // shown as the "billed to" label
  customer_social_platform: string | null;
  item: string | null;
  amount: string;
  currency: string;
  due_date: string | null;
  status: InvoiceStatus;
  virtual_account_number: string | null;
  checkout_url: string | null;
  created_at: string;
}

// Deliberately excludes `notes` (merchant-internal), customer phone/email
// (minimise what a forwarded link exposes), and all settlement figures.
export async function findPublicInvoiceByReference(
  invoiceReference: string,
): Promise<PublicInvoiceLookup | null> {
  const rows = await query<PublicInvoiceLookup>(
    `select i.id, i.invoice_reference, m.business_name,
            i.customer_name, i.customer_social_handle, i.customer_social_platform, i.item,
            i.amount, i.currency, i.due_date, i.status,
            i.virtual_account_number, i.checkout_url, i.created_at
       from invoices i
       join merchants m on m.id = i.merchant_id
      where i.invoice_reference = $1
      limit 1`,
    [invoiceReference],
  );
  return rows[0] ?? null;
}

export async function findPaymentForInvoice(
  invoiceId: string,
): Promise<PublicPayment | null> {
  const rows = await query<PublicPayment>(
    `select ${PAYMENT_COLUMNS} from payments where invoice_id = $1 order by created_at desc limit 1`,
    [invoiceId],
  );
  return rows[0] ?? null;
}

export interface RecordPaymentInput {
  invoiceId: string;
  eventKey: string;
  transactionReference: string;
  amountPaid: number;
  currency: string;
  paymentMethod: string | null;
  paidAt: string | null;
  settlementAmount: number;
  commissionAmount: number;
  raw: unknown;
}

// Idempotent: the unique event_key means a replayed webhook inserts nothing.
// Returns true if THIS call recorded the payment, false if it was a duplicate.
export async function recordPaymentIfNew(input: RecordPaymentInput): Promise<boolean> {
  const rows = await query<{ id: string }>(
    `insert into payments
       (invoice_id, event_key, monnify_transaction_reference, amount, currency,
        payment_method, settlement_amount, commission_amount, paid_at, raw)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     on conflict (event_key) do nothing
     returning id`,
    [
      input.invoiceId,
      input.eventKey,
      input.transactionReference,
      input.amountPaid,
      input.currency,
      input.paymentMethod,
      input.settlementAmount,
      input.commissionAmount,
      input.paidAt,
      JSON.stringify(input.raw),
    ],
  );
  return rows.length > 0;
}

export async function markInvoicePaid(invoiceId: string): Promise<void> {
  await query(`update invoices set status = 'paid' where id = $1 and status <> 'paid'`, [
    invoiceId,
  ]);
}
