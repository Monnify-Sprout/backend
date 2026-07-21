import { randomBytes } from 'node:crypto';

import { env } from '../../config/env';
import { getMonnifyProvider } from '../../lib/monnify';
import { MonnifyMockProvider } from '../../lib/monnify/mock';
import { computeSplit, round2 } from '../../lib/money';
import { HttpError } from '../../middleware/error';
import { findMerchantById } from '../auth/auth.repo';
import { assertOwnedCategory } from '../categories/categories.service';
import { assertOwnedStream } from '../streams/streams.service';
import { processMonnifyWebhook, type WebhookOutcome } from '../webhooks/webhook.service';

import {
  findInvoiceForMerchant,
  insertInvoice,
  type PublicInvoice,
  type SettlementPath,
} from './invoice.repo';
import type { CreateInvoiceInput } from './invoice.schema';

export interface InvoiceWithSettlement {
  invoice: PublicInvoice;
  settlement: {
    path: SettlementPath;
    commission_percent: number;
    commission_amount: number; // Sprout's cut
    settlement_amount: number; // merchant's take-home
  };
}

// PRD §7.2 / §7.3 / FR-04, FR-12.
// Phase 14: `streamId` is the current workspace stream (from the request scope),
// so a new invoice is auto-assigned to whichever stream the merchant is on - no
// picker. A routed stream carries the sub-account this sale should settle to.
export async function createInvoice(
  merchantId: string,
  streamId: string,
  input: CreateInvoiceInput,
): Promise<InvoiceWithSettlement> {
  const merchant = await findMerchantById(merchantId);
  if (!merchant) {
    throw new HttpError(404, 'Merchant not found.');
  }
  // Only a verified, sub-account-holding merchant can collect (PRD §7.1).
  if (merchant.status !== 'active' || !merchant.sub_account_code) {
    throw new HttpError(403, 'Complete BVN/NIN verification before creating invoices.');
  }

  // If a category was chosen, it must be one of this merchant's own (Phase 11).
  await assertOwnedCategory(merchantId, input.category_id);
  // The scoped stream must belong to the merchant and be active (Phase 14) - and
  // a routed stream carries the sub-account this sale should settle to.
  const stream = await assertOwnedStream(merchantId, streamId);

  const amount = round2(input.amount);
  const { commission, settlement } = computeSplit(amount, env.SPROUT_COMMISSION_PERCENT);

  // Split applied at settlement only if Monnify's Create Invoice supports it
  // (UNCONFIRMED, PRD §7.3); otherwise the safe manual fallback.
  const splitSupported = env.MONNIFY_INVOICE_SPLIT_SUPPORTED;
  const settlementPath: SettlementPath = splitSupported ? 'split' : 'manual';

  const invoiceReference = `SPT-${Date.now().toString(36).toUpperCase()}-${randomBytes(3)
    .toString('hex')
    .toUpperCase()}`;
  // Monnify requires an email; when the buyer gave none we synthesise a
  // placeholder for the API call ONLY - the DB keeps the real value (or null),
  // so the "at least one identifier" rule stays meaningful.
  const monnifyEmail =
    input.customer_email ?? `invoice+${invoiceReference.toLowerCase()}@sprout.invalid`;

  // Monnify's Create Invoice requires a customer name; the buyer may only have
  // given a handle or phone, so fall back through whatever identifies them.
  const handle = input.customer_social_handle
    ? input.customer_social_handle.startsWith('@')
      ? input.customer_social_handle
      : `@${input.customer_social_handle}`
    : null;
  // The platform only means something alongside a handle; drop it otherwise.
  const socialPlatform = handle ? (input.customer_social_platform ?? null) : null;
  const customerName =
    input.customer_name ?? handle ?? input.customer_phone ?? 'Customer';
  // The Monnify description is the item, with notes appended when present.
  const description = input.notes ? `${input.item} (${input.notes})` : input.item;

  const provider = getMonnifyProvider();
  const created = await provider.createInvoice({
    invoiceReference,
    amount,
    currency: 'NGN',
    description,
    customerName,
    customerEmail: monnifyEmail,
    dueDate: input.due_date,
    incomeSplit: splitSupported
      ? {
          // Money routing (Phase 13): a routed stream settles to its own
          // sub-account; otherwise the merchant's default.
          subAccountCode: stream?.sub_account_code ?? merchant.sub_account_code,
          splitPercentage: round2((settlement / amount) * 100),
        }
      : undefined,
  });

  const invoice = await insertInvoice({
    merchantId,
    invoiceReference,
    customerName: input.customer_name ?? null,
    customerEmail: input.customer_email ?? null,
    customerPhone: input.customer_phone ?? null,
    customerSocialHandle: handle,
    customerSocialPlatform: socialPlatform,
    item: input.item,
    notes: input.notes ?? null,
    amount,
    currency: 'NGN',
    dueDate: input.due_date ?? null,
    categoryId: input.category_id ?? null,
    streamId: stream?.id ?? null,
    transactionReference: created.transactionReference,
    virtualAccountNumber: created.virtualAccountNumber,
    checkoutUrl: created.checkoutUrl,
    settlementPath,
  });

  return {
    invoice,
    settlement: {
      path: settlementPath,
      commission_percent: env.SPROUT_COMMISSION_PERCENT,
      commission_amount: commission,
      settlement_amount: settlement,
    },
  };
}

export interface SimulateInvoicePaymentResult {
  outcome: WebhookOutcome;
  amount: number;
  // Returned so callers (smoke) can replay the same webhook and prove idempotency.
  transaction_reference: string;
  payment_reference: string;
}

// Demo/testing only (mock mode). Drives the REAL webhook path (verify-before-mark,
// idempotent, split recorded) so a simulated invoice payment is indistinguishable
// from a genuine one in the stored data - the invoice's OWN Dynamic Invoice
// transaction is paid, not a fabricated one. A live payment cannot be faked, so
// this refuses to run under MONNIFY_VERIFICATION_MODE=live.
//
// It re-seeds the mock ledger from the stored invoice BEFORE driving the webhook,
// so it still works after the backend has restarted (the in-process ledger seeded
// by createInvoice is gone whenever the process cycled - e.g. a hosted backend
// that slept between creating the invoice and paying it).
export async function simulateInvoicePayment(
  merchantId: string,
  invoiceId: string,
): Promise<SimulateInvoicePaymentResult> {
  const provider = getMonnifyProvider();
  if (provider.mode !== 'mock' || !(provider instanceof MonnifyMockProvider)) {
    throw new HttpError(403, 'Simulated payments are only available in mock mode.');
  }

  const invoice = await findInvoiceForMerchant(merchantId, invoiceId);
  if (!invoice) {
    throw new HttpError(404, 'Invoice not found.');
  }
  if (invoice.status === 'paid') {
    throw new HttpError(409, 'This invoice is already paid.');
  }
  if (invoice.status !== 'pending') {
    throw new HttpError(422, `A ${invoice.status} invoice can no longer be paid.`);
  }
  const transactionReference = invoice.monnify_transaction_reference;
  if (!transactionReference) {
    throw new HttpError(422, 'This invoice has no transaction to pay.');
  }

  const amount = Number(invoice.amount);
  provider.registerInvoicePayment({
    transactionReference,
    amount,
    currency: invoice.currency,
  });

  const paymentReference = `SIM-${Date.now().toString(36).toUpperCase()}-${randomBytes(3)
    .toString('hex')
    .toUpperCase()}`;

  const outcome = await processMonnifyWebhook({
    eventType: 'SUCCESSFUL_TRANSACTION',
    eventData: {
      transactionReference,
      paymentReference,
      paymentStatus: 'PAID',
      product: { reference: invoice.invoice_reference ?? undefined },
      customer: invoice.customer_name ? { name: invoice.customer_name } : undefined,
    },
  });

  return {
    outcome,
    amount,
    transaction_reference: transactionReference,
    payment_reference: paymentReference,
  };
}
