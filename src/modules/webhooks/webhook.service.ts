import { env } from '../../config/env';
import { getMonnifyProvider } from '../../lib/monnify';
import { computeSplit } from '../../lib/money';
import {
  findInvoiceByReference,
  findInvoiceByTransactionReference,
  markInvoicePaid,
  recordPaymentIfNew,
} from '../invoices/invoice.repo';

export type WebhookOutcome =
  | 'processed'
  | 'duplicate'
  | 'unknown_invoice'
  | 'not_paid'
  | 'amount_mismatch'
  | 'ignored';

interface MonnifyEventData {
  transactionReference?: string;
  paymentReference?: string;
  paymentStatus?: string;
  product?: { reference?: string };
}
export interface MonnifyWebhookPayload {
  eventType?: string;
  eventData?: MonnifyEventData;
}

// Processes a Monnify collection webhook. Signature is validated at the route
// before this runs. FR-06/FR-07: never trust the payload — confirm server-side
// with Verify Transaction, and make replays a no-op.
export async function processMonnifyWebhook(
  payload: MonnifyWebhookPayload,
): Promise<WebhookOutcome> {
  const data = payload.eventData ?? {};
  const transactionReference = data.transactionReference;
  if (!transactionReference) {
    return 'ignored';
  }

  const invoice =
    (await findInvoiceByTransactionReference(transactionReference)) ??
    (data.product?.reference
      ? await findInvoiceByReference(data.product.reference)
      : null);
  if (!invoice) {
    return 'unknown_invoice';
  }
  // Already settled — any further delivery of this event is a no-op.
  if (invoice.status === 'paid') {
    return 'duplicate';
  }

  // Authoritative check before marking Paid (FR-07) — never the webhook alone.
  const provider = getMonnifyProvider();
  const verified = await provider.verifyTransaction(transactionReference);
  if (verified.status !== 'PAID') {
    return 'not_paid';
  }

  const invoiceAmount = Number(invoice.amount);
  if (Math.abs(verified.amountPaid - invoiceAmount) > 0.001) {
    console.warn(
      `[webhook] amount mismatch invoice=${invoice.id} expected=${invoiceAmount} paid=${verified.amountPaid}`,
    );
    return 'amount_mismatch';
  }

  const { commission, settlement } = computeSplit(
    invoiceAmount,
    env.SPROUT_COMMISSION_PERCENT,
  );

  // event_key is unique → a concurrent/duplicate delivery records nothing.
  const eventKey = data.paymentReference ?? transactionReference;
  const recorded = await recordPaymentIfNew({
    invoiceId: invoice.id,
    eventKey,
    transactionReference,
    amountPaid: verified.amountPaid,
    currency: invoice.currency,
    paymentMethod: verified.paymentMethod ?? null,
    paidAt: verified.paidAt ?? null,
    settlementAmount: settlement,
    commissionAmount: commission,
    raw: payload,
  });
  if (!recorded) {
    return 'duplicate';
  }

  await markInvoicePaid(invoice.id);
  console.log(
    `[webhook] invoice=${invoice.id} PAID amount=${invoiceAmount} settlement=${settlement} commission=${commission} path=${invoice.settlement_path}`,
  );
  return 'processed';
}
