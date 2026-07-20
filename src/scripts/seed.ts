import 'dotenv/config';

import { env } from '../config/env';
import { pool, query } from '../lib/db';
import { findMerchantByEmail, type MerchantRow } from '../modules/auth/auth.repo';
import { registerMerchant } from '../modules/auth/auth.service';
import { createCategory, listCategories } from '../modules/categories/categories.service';
import {
  connectAccount,
  syncConnectedAccount,
} from '../modules/connected/connected.service';
import { listConnectedAccounts } from '../modules/connected/connected.repo';
import { createInvoice } from '../modules/invoices/invoice.service';
import { listPaymentLinksForMerchant } from '../modules/payment-links/payment-links.repo';
import {
  createPaymentLink,
  setPaymentLinkStatus,
  simulateLinkCollection,
} from '../modules/payment-links/payment-links.service';
import { listStreamsForMerchant } from '../modules/streams/streams.repo';
import { createStream, setStreamStatus } from '../modules/streams/streams.service';
import { verifyMerchantIdentity } from '../modules/verification/verification.service';
import { processMonnifyWebhook } from '../modules/webhooks/webhook.service';

// Seed data for the PRD v2.0 §13 hackathon demo (Phase 9a).
//
// Populates, idempotently, everything the demo relies on so the presenter can
// run §13's nine steps without touching the database by hand:
//   - one verified, Active demo merchant with a Monnify sub-account (steps 1-3
//     are pre-done so the live BVN/NIN Live-Mode limitation never blocks the
//     demo; the flow itself is still shown live on a throwaway signup),
//   - a spread of that merchant's own invoices (paid / pending / expired) with
//     backdated payments so its dashboard shows a real trend + breakdowns
//     (step 7),
//   - a second, already-existing Monnify contract connected read-only and
//     synced, standing in for "an existing merchant" per §7.6's demo note
//     (steps 8-9).
//
// It drives the REAL service layer in-process, so the seeded rows are identical
// to what the running app produces. Paying an invoice works because the mock
// Monnify provider's ledger is per-process: this script both creates and pays,
// so verifyTransaction recognises the invoice. That also means the seed only
// makes sense in mock mode - a live payment can't be faked - so it refuses to
// run under MONNIFY_VERIFICATION_MODE=live.

const DEMO_MERCHANT = {
  business_name: 'Ada Textiles',
  owner_name: 'Ada Obiora',
  phone: '08000000001',
  email: 'demo@sprout.test',
  password: 'SproutDemo2026!',
};

// A BVN not ending in 0000 passes the mock check; settlement account is required
// at verification (DECIDED 2026-07-18).
const DEMO_VERIFICATION = {
  id_type: 'BVN' as const,
  id_number: '22212345678',
  settlement_bank_code: '058',
  settlement_bank_name: 'Guaranty Trust Bank',
  settlement_account_number: '0123456789',
  settlement_account_name: 'Ada Obiora',
};

// The "already-existing Monnify merchant" for the connected-account demo. Any
// api_key not ending in "BAD" authenticates against the mock; the contract code
// deterministically seeds a ~40-transaction history on sync.
const CONNECTED_ACCOUNT = {
  business_name: 'Lagos Beauty Hub',
  api_key: 'MK_TEST_SEED_CONNECTED',
  secret_key: 'SK_TEST_SEED_SECRET',
  contract_code: '7042215',
};

type PaymentMethod = 'ACCOUNT_TRANSFER' | 'CARD';

// Merchant categories (Phase 11): name + display colour. Assigned to seed
// invoices below so the demo's category breakdown has real volume. One paid
// invoice is left uncategorised on purpose, to show the "Uncategorised" slice.
const SEED_CATEGORIES: { name: string; color: string }[] = [
  { name: 'Fabric', color: '#16a34a' },
  { name: 'Ready-to-wear', color: '#6366f1' },
  { name: 'Custom orders', color: '#a855f7' },
  { name: 'Accessories', color: '#f59e0b' },
];

// Revenue streams (Phase 13): where each sale came from. "Ikeja shop" is ROUTED
// (its own settlement account -> its own sub-account, demonstrating money
// routing); "Instagram" is tracking-only; the archived pop-up shows the archived
// state on the manager page. Some invoices/links stay unassigned on purpose, to
// show the "Unassigned" analytics bucket.
interface StreamSpec {
  name: string;
  settlement?: {
    bank_code: string;
    bank_name: string;
    account_number: string;
    account_name: string;
  };
  archived?: boolean;
}

const SEED_STREAMS: StreamSpec[] = [
  {
    name: 'Ikeja shop',
    settlement: {
      bank_code: '044',
      bank_name: 'Access Bank',
      account_number: '0987654321',
      account_name: 'Ada Obiora (Ikeja)',
    },
  },
  { name: 'Instagram' },
  { name: 'Eid pop-up', archived: true },
];

interface InvoiceSpec {
  customer_name?: string;
  customer_phone?: string;
  customer_email?: string;
  customer_social_handle?: string;
  customer_social_platform?: string;
  item: string;
  notes?: string;
  amount: number;
  status: 'paid' | 'pending' | 'expired';
  method?: PaymentMethod; // only for paid
  daysAgo: number; // how far back created (and, for paid, settled)
  dueInDays?: number; // due date relative to today (negative = past)
  category?: string; // one of SEED_CATEGORIES' names; omitted = uncategorised
  stream?: string; // one of SEED_STREAMS' names; omitted = unassigned
}

// A realistic Nigerian social-commerce mix: amounts hit every analytics bucket,
// payments split across transfer/card, buyers identified variously by name,
// handle+platform, or phone. Paid rows are spread over ~3 weeks so the trend is
// not a single spike.
const SEED_INVOICES: InvoiceSpec[] = [
  {
    customer_name: 'Chidi Okafor',
    customer_social_handle: '@chidi_styles',
    customer_social_platform: 'instagram',
    item: '2 yards of ankara fabric',
    stream: 'Instagram',
    amount: 15000,
    status: 'paid',
    method: 'ACCOUNT_TRANSFER',
    daysAgo: 22,
    category: 'Fabric',
  },
  {
    customer_name: 'Ngozi Ade',
    customer_phone: '08031234567',
    customer_social_handle: '08031234567',
    customer_social_platform: 'whatsapp',
    item: 'Lace gown (custom sew)',
    stream: 'Ikeja shop',
    notes: 'Deliver before the weekend',
    amount: 45000,
    status: 'paid',
    method: 'CARD',
    daysAgo: 19,
    category: 'Custom orders',
  },
  {
    customer_social_handle: '@tunde.wears',
    customer_social_platform: 'instagram',
    item: 'Agbada set (3 pieces)',
    stream: 'Instagram',
    amount: 85000,
    status: 'paid',
    method: 'ACCOUNT_TRANSFER',
    daysAgo: 16,
    category: 'Ready-to-wear',
  },
  {
    customer_name: 'Amara Eze',
    item: 'Ankara headwrap bundle',
    amount: 4500,
    status: 'paid',
    method: 'CARD',
    daysAgo: 13,
    category: 'Accessories',
  },
  {
    customer_name: 'Bisi Kola',
    customer_social_handle: 'bisi.kollections',
    customer_social_platform: 'facebook',
    item: 'Senator wear (navy)',
    stream: 'Ikeja shop',
    amount: 32000,
    status: 'paid',
    method: 'ACCOUNT_TRANSFER',
    daysAgo: 9,
    category: 'Ready-to-wear',
  },
  {
    customer_name: 'Yusuf Ibrahim',
    customer_email: 'yusuf.ibrahim@example.com',
    item: 'Kaftan gift set',
    stream: 'Ikeja shop',
    amount: 120000,
    status: 'paid',
    method: 'CARD',
    daysAgo: 6,
    category: 'Custom orders',
  },
  {
    customer_name: 'Chinwe Obi',
    customer_social_handle: '@chinwe_styles',
    customer_social_platform: 'instagram',
    item: 'Adire two-piece',
    stream: 'Instagram',
    amount: 12500,
    status: 'paid',
    method: 'ACCOUNT_TRANSFER',
    daysAgo: 3,
    // left uncategorised on purpose (shows the "Uncategorised" breakdown slice)
  },
  {
    customer_name: 'Zainab Musa',
    customer_social_handle: '@zainab.m',
    customer_social_platform: 'snapchat',
    item: 'Aso-oke (wedding order)',
    amount: 60000,
    status: 'pending',
    daysAgo: 2,
    dueInDays: 5,
    category: 'Custom orders',
  },
  {
    customer_name: 'Emeka Nwosu',
    customer_phone: '08055512345',
    item: 'Vintage denim jacket',
    stream: 'Ikeja shop',
    amount: 18000,
    status: 'pending',
    daysAgo: 1,
    dueInDays: 9,
    category: 'Ready-to-wear',
  },
  {
    customer_name: 'Kelechi Nnamdi',
    item: 'Fabric deposit balance',
    amount: 5000,
    status: 'expired',
    daysAgo: 8,
    dueInDays: -4,
    category: 'Fabric',
  },
];

// Static payment links (Phase 12): reusable links that take many "collections".
// A spread of statuses (active/paused/ended) populates the status cards, a mix
// of fixed and buyer-entered pricing shows both link kinds, and backdated
// collections give the per-link and general analytics real volume.
interface LinkCollectionSpec {
  customer: string;
  amount?: number; // required only for a buyer-entered (null-amount) link
  method: PaymentMethod;
  daysAgo: number;
}
interface LinkSpec {
  title: string;
  item: string;
  amount: number | null; // null = buyer enters the amount
  category?: string;
  stream?: string; // one of SEED_STREAMS' names; omitted = unassigned
  status: 'active' | 'paused' | 'ended';
  collections: LinkCollectionSpec[];
}

const SEED_LINKS: LinkSpec[] = [
  {
    title: 'Ankara fabric bundle',
    item: '6 yards premium ankara',
    amount: 15000,
    category: 'Fabric',
    stream: 'Instagram',
    status: 'active',
    collections: [
      { customer: 'Ngozi Ade', method: 'ACCOUNT_TRANSFER', daysAgo: 12 },
      { customer: 'Tunde Bello', method: 'CARD', daysAgo: 7 },
      { customer: 'Amara Eze', method: 'ACCOUNT_TRANSFER', daysAgo: 2 },
    ],
  },
  {
    title: 'Support the tailoring class',
    item: 'Weekend beginner sewing class',
    amount: null, // buyer enters what they want to give
    category: 'Custom orders',
    status: 'active',
    collections: [
      { customer: 'Bisi Kola', amount: 5000, method: 'CARD', daysAgo: 9 },
      { customer: 'Yusuf Ibrahim', amount: 7500, method: 'ACCOUNT_TRANSFER', daysAgo: 4 },
      { customer: 'Chinwe Obi', amount: 12000, method: 'CARD', daysAgo: 1 },
    ],
  },
  {
    title: 'Eid ready-to-wear promo',
    item: 'Eid special (navy senator)',
    amount: 25000,
    category: 'Ready-to-wear',
    stream: 'Ikeja shop',
    status: 'paused',
    collections: [
      { customer: 'Zainab Musa', method: 'ACCOUNT_TRANSFER', daysAgo: 15 },
      { customer: 'Emeka Nwosu', method: 'CARD', daysAgo: 11 },
    ],
  },
  {
    title: 'Launch week discount',
    item: 'Accessory gift box',
    amount: 8000,
    category: 'Accessories',
    status: 'ended',
    collections: [
      { customer: 'Kelechi Nnamdi', method: 'ACCOUNT_TRANSFER', daysAgo: 24 },
      { customer: 'Fatima Sani', method: 'CARD', daysAgo: 21 },
    ],
  },
];

function log(msg: string): void {
  console.log(`  ${msg}`);
}

// ISO timestamp `days` in the past, keeping the current time-of-day so payments
// don't all land at midnight.
function daysAgoIso(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

// YYYY-MM-DD `offset` days from today (negative = past). Used for due dates.
function dateStr(offset: number): string {
  return new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
}

async function ensureDemoMerchant(): Promise<MerchantRow> {
  let merchant = await findMerchantByEmail(DEMO_MERCHANT.email);
  if (!merchant) {
    const created = await registerMerchant(DEMO_MERCHANT);
    log(`registered demo merchant (${created.email})`);
    merchant = await findMerchantByEmail(DEMO_MERCHANT.email);
  } else {
    log(`demo merchant already exists (${merchant.email})`);
  }
  if (!merchant) {
    throw new Error('demo merchant vanished immediately after creation');
  }

  if (merchant.status !== 'active') {
    await verifyMerchantIdentity(merchant.id, DEMO_VERIFICATION);
    log('verified identity + created sub-account -> Active');
    merchant = (await findMerchantByEmail(DEMO_MERCHANT.email))!;
  } else {
    log(`demo merchant already Active (sub-account ${merchant.sub_account_code})`);
  }
  return merchant;
}

// Ensure every SEED_CATEGORIES row exists for the merchant and return a
// name -> id map. Idempotent: it lists existing categories first and only
// creates the missing ones, so a re-run adds nothing.
async function ensureCategories(merchantId: string): Promise<Map<string, string>> {
  const existing = await listCategories(merchantId);
  const byName = new Map(existing.map((c) => [c.name, c.id]));
  let created = 0;
  for (const spec of SEED_CATEGORIES) {
    if (byName.has(spec.name)) continue;
    const category = await createCategory(merchantId, spec);
    byName.set(category.name, category.id);
    created += 1;
  }
  log(
    created > 0
      ? `ensured ${SEED_CATEGORIES.length} categories (${created} new)`
      : `${SEED_CATEGORIES.length} categories already present`,
  );
  return byName;
}

// Ensure every SEED_STREAMS row exists for the merchant (routed one included)
// and return a name -> id map. Idempotent like ensureCategories: existing
// streams are reused, so a re-run adds nothing (and never re-creates the routed
// stream's sub-account).
async function ensureStreams(merchantId: string): Promise<Map<string, string>> {
  const existing = await listStreamsForMerchant(merchantId);
  const byName = new Map(existing.map((s) => [s.name, s.id]));
  let created = 0;
  for (const spec of SEED_STREAMS) {
    if (byName.has(spec.name)) continue;
    const stream = await createStream(merchantId, {
      name: spec.name,
      settlement_bank_code: spec.settlement?.bank_code,
      settlement_bank_name: spec.settlement?.bank_name,
      settlement_account_number: spec.settlement?.account_number,
      settlement_account_name: spec.settlement?.account_name,
    });
    if (spec.archived) {
      await setStreamStatus(merchantId, stream.id, 'archived');
    }
    byName.set(stream.name, stream.id);
    created += 1;
  }
  log(
    created > 0
      ? `ensured ${SEED_STREAMS.length} streams (${created} new; "Ikeja shop" routed)`
      : `${SEED_STREAMS.length} streams already present`,
  );
  return byName;
}

// Assign streams to any already-seeded invoices/links that predate them
// (matching on item/title), only where still unassigned - the same self-healing
// shape as backfillInvoiceCategories, so a pre-Phase-13 demo converges.
async function backfillStreams(
  merchantId: string,
  streamIds: Map<string, string>,
): Promise<void> {
  let updated = 0;
  for (const spec of SEED_INVOICES) {
    if (!spec.stream) continue;
    const id = streamIds.get(spec.stream);
    if (!id) continue;
    const rows = await query(
      `update invoices set stream_id = $3
        where merchant_id = $1 and item = $2 and stream_id is null
        returning id`,
      [merchantId, spec.item, id],
    );
    updated += rows.length;
  }
  for (const spec of SEED_LINKS) {
    if (!spec.stream) continue;
    const id = streamIds.get(spec.stream);
    if (!id) continue;
    const rows = await query(
      `update payment_links set stream_id = $3
        where merchant_id = $1 and title = $2 and stream_id is null
        returning id`,
      [merchantId, spec.title, id],
    );
    updated += rows.length;
  }
  if (updated > 0) log(`backfilled streams onto ${updated} existing invoice(s)/link(s)`);
}

// Assign categories to any already-seeded invoices that predate them (matching
// on item), only where the invoice is still uncategorised. Keeps a re-run of the
// seed self-healing: a merchant seeded before Phase 11 converges to the intended
// category assignments without recreating any invoices.
async function backfillInvoiceCategories(
  merchantId: string,
  categoryIds: Map<string, string>,
): Promise<void> {
  let updated = 0;
  for (const spec of SEED_INVOICES) {
    if (!spec.category) continue;
    const id = categoryIds.get(spec.category);
    if (!id) continue;
    const rows = await query(
      `update invoices set category_id = $3
        where merchant_id = $1 and item = $2 and category_id is null
        returning id`,
      [merchantId, spec.item, id],
    );
    updated += rows.length;
  }
  if (updated > 0) log(`backfilled categories onto ${updated} existing invoice(s)`);
}

async function seedInvoices(
  merchantId: string,
  streamIds: Map<string, string>,
): Promise<Map<string, string>> {
  const categoryIds = await ensureCategories(merchantId);

  // Idempotency marker: the first seed item is distinctive enough to tell a
  // seeded merchant from a fresh one, so a re-run adds nothing.
  const marker = SEED_INVOICES[0]!.item;
  const already = await query(
    'select 1 from invoices where merchant_id = $1 and item = $2 limit 1',
    [merchantId, marker],
  );
  if (already.length > 0) {
    log('demo invoices already seeded - skipping creation');
    await backfillInvoiceCategories(merchantId, categoryIds);
    return categoryIds;
  }

  let paid = 0;
  let pending = 0;
  let expired = 0;

  for (const spec of SEED_INVOICES) {
    const dueDate = spec.dueInDays !== undefined ? dateStr(spec.dueInDays) : undefined;

    const { invoice } = await createInvoice(merchantId, {
      customer_name: spec.customer_name,
      customer_phone: spec.customer_phone,
      customer_email: spec.customer_email,
      customer_social_handle: spec.customer_social_handle,
      customer_social_platform: spec.customer_social_platform,
      item: spec.item,
      notes: spec.notes,
      amount: spec.amount,
      due_date: dueDate,
      category_id: spec.category ? categoryIds.get(spec.category) : undefined,
      stream_id: spec.stream ? streamIds.get(spec.stream) : undefined,
    });

    const ts = daysAgoIso(spec.daysAgo);

    if (spec.status === 'paid') {
      const outcome = await processMonnifyWebhook({
        eventType: 'SUCCESSFUL_TRANSACTION',
        eventData: {
          transactionReference: invoice.monnify_transaction_reference ?? undefined,
          paymentReference: `SEED-${invoice.invoice_reference}`,
          paymentStatus: 'PAID',
          product: { reference: invoice.invoice_reference ?? undefined },
        },
      });
      if (outcome !== 'processed') {
        throw new Error(
          `expected invoice ${invoice.invoice_reference} to be paid, got "${outcome}"`,
        );
      }
      // Backdate the payment so the merchant's own analytics (which groups by
      // payments.paid_at) shows a multi-day trend, and vary the method so the
      // payment-method breakdown isn't single-valued (the mock always reports
      // ACCOUNT_TRANSFER).
      await query(
        `update payments set paid_at = $2, created_at = $2, payment_method = $3
          where invoice_id = $1`,
        [invoice.id, ts, spec.method ?? 'ACCOUNT_TRANSFER'],
      );
      paid += 1;
    } else if (spec.status === 'expired') {
      expired += 1;
    } else {
      pending += 1;
    }

    // Align the invoice's own timestamps with the sale date for a realistic
    // list ordering. Expired rows keep their past due date and flip to
    // 'expired' lazily on the first list/detail read (Phase 7 behaviour).
    await query('update invoices set created_at = $2, updated_at = $2 where id = $1', [
      invoice.id,
      ts,
    ]);
  }

  log(
    `created ${SEED_INVOICES.length} invoices (${paid} paid, ${pending} pending, ${expired} overdue)`,
  );
  return categoryIds;
}

async function seedPaymentLinks(
  merchantId: string,
  categoryIds: Map<string, string>,
  streamIds: Map<string, string>,
): Promise<void> {
  // Idempotency marker: the first link's title tells a seeded merchant from a
  // fresh one, so a re-run adds nothing.
  const marker = SEED_LINKS[0]!.title;
  const existing = await listPaymentLinksForMerchant(merchantId);
  if (existing.some((l) => l.title === marker)) {
    log('demo payment links already seeded - skipping creation');
    return;
  }

  let links = 0;
  let collections = 0;
  for (const spec of SEED_LINKS) {
    const link = await createPaymentLink(merchantId, {
      title: spec.title,
      item: spec.item,
      amount: spec.amount ?? undefined,
      category_id: spec.category ? categoryIds.get(spec.category) : undefined,
      stream_id: spec.stream ? streamIds.get(spec.stream) : undefined,
    });
    links += 1;

    for (const c of spec.collections) {
      const outcome = await simulateLinkCollection(merchantId, link.id, {
        amount: c.amount,
        customer_name: c.customer,
      });
      if (outcome.outcome !== 'processed') {
        throw new Error(
          `expected a collection on "${spec.title}", got "${outcome.outcome}"`,
        );
      }
      // Backdate the collection just created (newest for this link) so both the
      // link's own trend and the merchant's general analytics span multiple days,
      // and vary the method (the mock always reports ACCOUNT_TRANSFER).
      const ts = daysAgoIso(c.daysAgo);
      await query(
        `update link_payments set paid_at = $2, created_at = $2, payment_method = $3
          where id = (select id from link_payments
                        where payment_link_id = $1
                        order by created_at desc limit 1)`,
        [link.id, ts, c.method],
      );
      collections += 1;
    }

    // Align the link's own created_at with its earliest collection for realistic
    // list ordering, then apply its final status (paused / ended).
    const earliest = Math.max(...spec.collections.map((c) => c.daysAgo), 0);
    await query('update payment_links set created_at = $2 where id = $1', [
      link.id,
      daysAgoIso(earliest + 1),
    ]);
    if (spec.status !== 'active') {
      await setPaymentLinkStatus(merchantId, link.id, spec.status);
    }
  }

  log(
    `created ${links} payment links with ${collections} collections ` +
      '(active / paused / ended, fixed + buyer-entered)',
  );
}

async function seedConnectedAccount(merchantId: string): Promise<void> {
  const existing = await listConnectedAccounts(merchantId);
  let account = existing.find((a) => a.business_name === CONNECTED_ACCOUNT.business_name);

  if (!account) {
    account = await connectAccount(merchantId, CONNECTED_ACCOUNT);
    log(`connected external account "${account.business_name}"`);
  } else {
    log(`external account "${account.business_name}" already connected`);
  }

  const sync = await syncConnectedAccount(merchantId, account.id);
  log(
    `synced connected account - fetched ${sync.fetched}, inserted ${sync.inserted} (re-run inserts 0)`,
  );
}

async function main(): Promise<void> {
  if (env.MONNIFY_VERIFICATION_MODE !== 'mock') {
    console.error(
      'Seed requires MONNIFY_VERIFICATION_MODE=mock: it fabricates paid invoices\n' +
        'and deterministic connected-account history, which only the mock provider\n' +
        'can produce. Set the mode to mock (the demo default) and re-run.',
    );
    process.exit(1);
  }

  console.log('Seeding Sprout demo data (PRD v2.0 §13)...\n');

  const merchant = await ensureDemoMerchant();
  const streamIds = await ensureStreams(merchant.id);
  const categoryIds = await seedInvoices(merchant.id, streamIds);
  await seedPaymentLinks(merchant.id, categoryIds, streamIds);
  // Runs on every seed (not just first creation) so a pre-Phase-13 demo
  // converges to the intended stream assignments.
  await backfillStreams(merchant.id, streamIds);
  await seedConnectedAccount(merchant.id);

  console.log('\nDone. Demo login:');
  console.log(`  email:    ${DEMO_MERCHANT.email}`);
  console.log(`  password: ${DEMO_MERCHANT.password}`);
  console.log(
    '\nDemo tips: log in as the merchant above for its own dashboard + invoices,\n' +
      `then open Connected -> "${CONNECTED_ACCOUNT.business_name}" for the same analytics\n` +
      'view built from pulled history. A fresh signup can still show onboarding live.',
  );
}

main()
  .then(() => pool.end())
  .catch((err) => {
    console.error('\nSeed failed:', err);
    return pool.end().finally(() => process.exit(1));
  });
