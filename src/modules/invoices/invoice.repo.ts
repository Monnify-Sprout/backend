import { query } from '../../lib/db';

export type InvoiceStatus = 'pending' | 'paid' | 'expired' | 'cancelled';
export type SettlementPath = 'split' | 'manual';

export interface PublicInvoice {
  id: string;
  merchant_id: string;
  invoice_reference: string | null;
  customer_name: string;
  customer_email: string | null;
  description: string | null;
  amount: string; // pg returns numeric as string
  currency: string;
  due_date: string | null;
  status: InvoiceStatus;
  virtual_account_number: string | null;
  checkout_url: string | null;
  monnify_transaction_reference: string | null;
  settlement_path: SettlementPath | null;
  created_at: string;
  updated_at: string;
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
  'id, merchant_id, invoice_reference, customer_name, customer_email, description, amount, currency, due_date, status, virtual_account_number, checkout_url, monnify_transaction_reference, settlement_path, created_at, updated_at';

const PAYMENT_COLUMNS =
  'id, invoice_id, amount, currency, payment_method, settlement_amount, commission_amount, monnify_transaction_reference, paid_at, created_at';

export interface NewInvoice {
  merchantId: string;
  invoiceReference: string;
  customerName: string;
  customerEmail: string;
  description: string | null;
  amount: number;
  currency: string;
  dueDate: string | null;
  transactionReference: string;
  virtualAccountNumber: string;
  checkoutUrl: string;
  settlementPath: SettlementPath;
}

export async function insertInvoice(input: NewInvoice): Promise<PublicInvoice> {
  const rows = await query<PublicInvoice>(
    `insert into invoices
       (merchant_id, invoice_reference, customer_name, customer_email, description,
        amount, currency, due_date, status,
        monnify_transaction_reference, virtual_account_number, checkout_url, settlement_path)
     values ($1, $2, $3, $4, $5, $6, $7, $8, 'pending', $9, $10, $11, $12)
     returning ${INVOICE_COLUMNS}`,
    [
      input.merchantId,
      input.invoiceReference,
      input.customerName,
      input.customerEmail,
      input.description,
      input.amount,
      input.currency,
      input.dueDate,
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
  return query<PublicInvoice>(
    `select ${INVOICE_COLUMNS} from invoices
      where merchant_id = $1
      order by created_at desc`,
    [merchantId],
  );
}

export async function findInvoiceForMerchant(
  merchantId: string,
  invoiceId: string,
): Promise<PublicInvoice | null> {
  const rows = await query<PublicInvoice>(
    `select ${INVOICE_COLUMNS} from invoices where id = $1 and merchant_id = $2 limit 1`,
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
export async function recordPaymentIfNew(
  input: RecordPaymentInput,
): Promise<boolean> {
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
  await query(
    `update invoices set status = 'paid' where id = $1 and status <> 'paid'`,
    [invoiceId],
  );
}
