import { env } from '../../config/env';
import { getMonnifyProvider } from '../../lib/monnify';
import { computeSplit } from '../../lib/money';
import {
  findInvoiceByReference,
  findInvoiceByTransactionReference,
  markInvoicePaid,
  recordPaymentIfNew,
  type PublicInvoice,
} from '../invoices/invoice.repo';
import {
  findPaymentLinkByAccountReference,
  recordLinkPaymentIfNew,
  type PublicPaymentLink,
} from '../payment-links/payment-links.repo';

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
  // Reserved-account (static payment link) collections carry who paid.
  customer?: { name?: string };
}
export interface MonnifyWebhookPayload {
  eventType?: string;
  eventData?: MonnifyEventData;
}

// Processes a Monnify collection webhook. Signature is validated at the route
// before this runs. FR-06/FR-07: never trust the payload - confirm server-side
// with Verify Transaction, and make replays a no-op.
//
// One callback shape serves two products: a Dynamic Invoice (one payment, then
// terminal) and a static payment link's reserved account (many collections). We
// try the invoice first (its transaction/invoice reference), then fall back to a
// link (matched by the reserved account reference Monnify echoes back).
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
  if (invoice) {
    return processInvoicePayment(invoice, transactionReference, data, payload);
  }

  const link = data.product?.reference
    ? await findPaymentLinkByAccountReference(data.product.reference)
    : null;
  if (link) {
    return processLinkCollection(link, transactionReference, data, payload);
  }

  return 'unknown_invoice';
}

// A Dynamic Invoice payment (FR-06/07): verify, record once, mark the invoice
// paid. Exactly one payment per invoice, so a paid invoice short-circuits.
async function processInvoicePayment(
  invoice: PublicInvoice,
  transactionReference: string,
  data: MonnifyEventData,
  payload: MonnifyWebhookPayload,
): Promise<WebhookOutcome> {
  // Already settled - any further delivery of this event is a no-op.
  if (invoice.status === 'paid') {
    return 'duplicate';
  }

  // Authoritative check before marking Paid (FR-07) - never the webhook alone.
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

// A static-link collection (Phase 12): verify, then record ONE collection
// (idempotent on event_key). Unlike an invoice, a link accepts many payments and
// has no single expected amount (buyer-entered links, or a fixed link that
// receives a different transfer), so we record whatever was actually paid rather
// than rejecting a mismatch. The split is computed and stored per collection.
async function processLinkCollection(
  link: PublicPaymentLink,
  transactionReference: string,
  data: MonnifyEventData,
  payload: MonnifyWebhookPayload,
): Promise<WebhookOutcome> {
  const provider = getMonnifyProvider();
  const verified = await provider.verifyTransaction(transactionReference);
  if (verified.status !== 'PAID') {
    return 'not_paid';
  }

  const { commission, settlement } = computeSplit(
    verified.amountPaid,
    env.SPROUT_COMMISSION_PERCENT,
  );

  const eventKey = data.paymentReference ?? transactionReference;
  const recorded = await recordLinkPaymentIfNew({
    paymentLinkId: link.id,
    eventKey,
    transactionReference,
    amountPaid: verified.amountPaid,
    currency: link.currency,
    paymentMethod: verified.paymentMethod ?? null,
    customerName: data.customer?.name ?? null,
    paidAt: verified.paidAt ?? null,
    settlementAmount: settlement,
    commissionAmount: commission,
    raw: payload,
  });
  if (!recorded) {
    return 'duplicate';
  }

  console.log(
    `[webhook] link=${link.id} COLLECTION amount=${verified.amountPaid} settlement=${settlement} commission=${commission}`,
  );
  return 'processed';
}
