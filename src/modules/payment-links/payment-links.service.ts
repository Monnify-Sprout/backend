import { randomBytes } from 'node:crypto';

import { getMonnifyProvider } from '../../lib/monnify';
import { MonnifyMockProvider } from '../../lib/monnify/mock';
import { HttpError } from '../../middleware/error';
import { findMerchantById } from '../auth/auth.repo';
import { assertOwnedCategory } from '../categories/categories.service';
import {
  processMonnifyWebhook,
  type WebhookOutcome,
} from '../webhooks/webhook.service';

import {
  findPaymentLinkForMerchant,
  getLinkStats,
  insertPaymentLink,
  listLinkPaymentsForLink,
  listPaymentLinksForMerchant,
  slugExists,
  statusSummaryForMerchant,
  updatePaymentLinkStatus,
  type LinkStats,
  type LinkStatusSummary,
  type PaymentLinkStatus,
  type PublicLinkPayment,
  type PublicPaymentLink,
} from './payment-links.repo';
import type {
  CreatePaymentLinkInput,
  SimulateCollectionInput,
} from './payment-links.schema';

// A URL-safe slug from the title plus a short random suffix so the shared link
// is readable ("ankara-bundle-9f3a1c") and collisions are near-impossible.
function slugify(title: string): string {
  const base = title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  const suffix = randomBytes(3).toString('hex');
  return base ? `${base}-${suffix}` : `link-${suffix}`;
}

async function uniqueSlug(title: string): Promise<string> {
  // The random suffix makes a collision unlikely; retry a few times before the
  // DB unique index would reject it.
  for (let i = 0; i < 5; i += 1) {
    const slug = slugify(title);
    if (!(await slugExists(slug))) {
      return slug;
    }
  }
  // Extremely unlikely fallthrough: lean entirely on the random suffix.
  return slugify(`${title}-${Date.now().toString(36)}`);
}

export async function createPaymentLink(
  merchantId: string,
  input: CreatePaymentLinkInput,
): Promise<PublicPaymentLink> {
  const merchant = await findMerchantById(merchantId);
  if (!merchant) {
    throw new HttpError(404, 'Merchant not found.');
  }
  // Only a verified, sub-account-holding merchant can collect (PRD §7.1).
  if (merchant.status !== 'active' || !merchant.sub_account_code) {
    throw new HttpError(
      403,
      'Complete BVN/NIN verification before creating payment links.',
    );
  }

  await assertOwnedCategory(merchantId, input.category_id);

  const slug = await uniqueSlug(input.title);
  const accountReference = `RSVL-${Date.now().toString(36).toUpperCase()}-${randomBytes(3)
    .toString('hex')
    .toUpperCase()}`;

  const provider = getMonnifyProvider();
  const reserved = await provider.createReservedAccount({
    accountReference,
    accountName: input.title.slice(0, 100),
    customerName: merchant.business_name,
    customerEmail: merchant.email,
  });

  return insertPaymentLink({
    merchantId,
    title: input.title,
    item: input.item ?? null,
    slug,
    amount: input.amount ?? null,
    currency: 'NGN',
    categoryId: input.category_id ?? null,
    reservedAccountReference: reserved.accountReference,
    reservedAccountNumber: reserved.reservedAccountNumber,
    reservedAccountBankName: reserved.bankName ?? null,
    checkoutUrl: reserved.checkoutUrl,
  });
}

export interface PaymentLinksList {
  links: PublicPaymentLink[];
  summary: LinkStatusSummary;
}

export async function listPaymentLinks(
  merchantId: string,
): Promise<PaymentLinksList> {
  const [links, summary] = await Promise.all([
    listPaymentLinksForMerchant(merchantId),
    statusSummaryForMerchant(merchantId),
  ]);
  return { links, summary };
}

export interface PaymentLinkDetail {
  link: PublicPaymentLink;
  stats: LinkStats;
  collections: PublicLinkPayment[];
}

export async function getPaymentLink(
  merchantId: string,
  linkId: string,
): Promise<PaymentLinkDetail> {
  const link = await findPaymentLinkForMerchant(merchantId, linkId);
  if (!link) {
    throw new HttpError(404, 'Payment link not found.');
  }
  const [stats, collections] = await Promise.all([
    getLinkStats(link.id),
    listLinkPaymentsForLink(link.id),
  ]);
  return { link, stats, collections };
}

export async function setPaymentLinkStatus(
  merchantId: string,
  linkId: string,
  status: PaymentLinkStatus,
): Promise<PublicPaymentLink> {
  const link = await findPaymentLinkForMerchant(merchantId, linkId);
  if (!link) {
    throw new HttpError(404, 'Payment link not found.');
  }
  // Ending is terminal: an ended link can never be reopened or paused again.
  if (link.status === 'ended') {
    throw new HttpError(409, 'This link has ended and can no longer be changed.');
  }
  const updated = await updatePaymentLinkStatus(merchantId, linkId, status);
  if (!updated) {
    throw new HttpError(404, 'Payment link not found.');
  }
  return updated;
}

export interface SimulateCollectionResult {
  outcome: WebhookOutcome;
  amount: number;
  // Returned so callers (smoke) can replay the same webhook and prove idempotency.
  transaction_reference: string;
  payment_reference: string;
}

// Demo/testing only (mock mode). Registers an expected collection in the mock
// ledger, then drives the REAL webhook path (verify-before-record, idempotent,
// split recorded) so a simulated collection is indistinguishable from a genuine
// one in the data. A live payment cannot be faked, so this refuses to run under
// MONNIFY_VERIFICATION_MODE=live.
export async function simulateLinkCollection(
  merchantId: string,
  linkId: string,
  input: SimulateCollectionInput,
): Promise<SimulateCollectionResult> {
  const provider = getMonnifyProvider();
  if (provider.mode !== 'mock' || !(provider instanceof MonnifyMockProvider)) {
    throw new HttpError(
      403,
      'Simulated collections are only available in mock mode.',
    );
  }

  const link = await findPaymentLinkForMerchant(merchantId, linkId);
  if (!link) {
    throw new HttpError(404, 'Payment link not found.');
  }

  // A fixed link uses its own price; a buyer-entered link needs an amount.
  const fixed = link.amount != null ? Number(link.amount) : null;
  const amount = fixed ?? input.amount ?? null;
  if (amount == null || !(amount > 0)) {
    throw new HttpError(422, 'This link needs an amount for a simulated payment.');
  }

  const transactionReference = `MOCK-LNK-${randomBytes(6).toString('hex').toUpperCase()}`;
  const paymentReference = `SIM-${Date.now().toString(36).toUpperCase()}-${randomBytes(3)
    .toString('hex')
    .toUpperCase()}`;

  provider.registerReservedAccountPayment({
    transactionReference,
    amount,
    currency: link.currency,
  });

  const outcome = await processMonnifyWebhook({
    eventType: 'SUCCESSFUL_TRANSACTION',
    eventData: {
      transactionReference,
      paymentReference,
      paymentStatus: 'PAID',
      product: { reference: link.reserved_account_reference ?? undefined },
      customer: input.customer_name ? { name: input.customer_name } : undefined,
    },
  });

  return {
    outcome,
    amount,
    transaction_reference: transactionReference,
    payment_reference: paymentReference,
  };
}
