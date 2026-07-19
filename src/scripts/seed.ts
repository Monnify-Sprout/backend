import 'dotenv/config';

import { env } from '../config/env';
import { pool, query } from '../lib/db';
import { findMerchantByEmail, type MerchantRow } from '../modules/auth/auth.repo';
import { registerMerchant } from '../modules/auth/auth.service';
import {
  connectAccount,
  syncConnectedAccount,
} from '../modules/connected/connected.service';
import { listConnectedAccounts } from '../modules/connected/connected.repo';
import { createInvoice } from '../modules/invoices/invoice.service';
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
    amount: 15000,
    status: 'paid',
    method: 'ACCOUNT_TRANSFER',
    daysAgo: 22,
  },
  {
    customer_name: 'Ngozi Ade',
    customer_phone: '08031234567',
    customer_social_handle: '08031234567',
    customer_social_platform: 'whatsapp',
    item: 'Lace gown (custom sew)',
    notes: 'Deliver before the weekend',
    amount: 45000,
    status: 'paid',
    method: 'CARD',
    daysAgo: 19,
  },
  {
    customer_social_handle: '@tunde.wears',
    customer_social_platform: 'instagram',
    item: 'Agbada set (3 pieces)',
    amount: 85000,
    status: 'paid',
    method: 'ACCOUNT_TRANSFER',
    daysAgo: 16,
  },
  {
    customer_name: 'Amara Eze',
    item: 'Ankara headwrap bundle',
    amount: 4500,
    status: 'paid',
    method: 'CARD',
    daysAgo: 13,
  },
  {
    customer_name: 'Bisi Kola',
    customer_social_handle: 'bisi.kollections',
    customer_social_platform: 'facebook',
    item: 'Senator wear (navy)',
    amount: 32000,
    status: 'paid',
    method: 'ACCOUNT_TRANSFER',
    daysAgo: 9,
  },
  {
    customer_name: 'Yusuf Ibrahim',
    customer_email: 'yusuf.ibrahim@example.com',
    item: 'Kaftan gift set',
    amount: 120000,
    status: 'paid',
    method: 'CARD',
    daysAgo: 6,
  },
  {
    customer_name: 'Chinwe Obi',
    customer_social_handle: '@chinwe_styles',
    customer_social_platform: 'instagram',
    item: 'Adire two-piece',
    amount: 12500,
    status: 'paid',
    method: 'ACCOUNT_TRANSFER',
    daysAgo: 3,
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
  },
  {
    customer_name: 'Emeka Nwosu',
    customer_phone: '08055512345',
    item: 'Vintage denim jacket',
    amount: 18000,
    status: 'pending',
    daysAgo: 1,
    dueInDays: 9,
  },
  {
    customer_name: 'Kelechi Nnamdi',
    item: 'Fabric deposit balance',
    amount: 5000,
    status: 'expired',
    daysAgo: 8,
    dueInDays: -4,
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

async function seedInvoices(merchantId: string): Promise<void> {
  // Idempotency marker: the first seed item is distinctive enough to tell a
  // seeded merchant from a fresh one, so a re-run adds nothing.
  const marker = SEED_INVOICES[0]!.item;
  const already = await query(
    'select 1 from invoices where merchant_id = $1 and item = $2 limit 1',
    [merchantId, marker],
  );
  if (already.length > 0) {
    log('demo invoices already seeded - skipping');
    return;
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
  await seedInvoices(merchant.id);
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
