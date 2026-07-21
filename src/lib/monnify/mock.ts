import { createHash } from 'node:crypto';

import type {
  CreateInvoiceInput,
  CreateInvoiceResult,
  CreateReservedAccountInput,
  CreateReservedAccountResult,
  CreateSubAccountInput,
  CreateSubAccountResult,
  ExternalCredentials,
  ExternalTransactionRecord,
  MonnifyProvider,
  ValidateCredentialsResult,
  VerifyIdentityInput,
  VerifyIdentityResult,
  VerifyTransactionResult,
} from './types';

// Small deterministic PRNG (mulberry32) so a mock connected account always
// yields the same transaction history - re-syncs must hit the same references.
function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seedFrom(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  }
  return h >>> 0;
}

// Deterministic stand-in for Monnify's Live-Mode-only BVN/NIN verification, for
// local dev and the hackathon demo. Its results are recorded with
// verification_mode='mock' in the DB and logged loudly, so a simulated pass is
// never mistaken for a real KYC check.
export class MonnifyMockProvider implements MonnifyProvider {
  readonly mode = 'mock' as const;

  // In-process stand-in for Monnify's ledger: createInvoice records the expected
  // amount so verifyTransaction can later confirm it, exactly like the real
  // server-side check. Lives as long as the process (fine for dev + the demo).
  private readonly ledger = new Map<string, { amount: number; currency: string }>();

  verifyIdentity(input: VerifyIdentityInput): Promise<VerifyIdentityResult> {
    // Demo rule: an id ending in "0000" fails so the failure path can be shown on
    // demand; every other 11-digit id verifies.
    if (input.idNumber.endsWith('0000')) {
      return Promise.resolve({
        verified: false,
        reason: `Mock ${input.idType} check: identity could not be confirmed.`,
      });
    }
    return Promise.resolve({
      verified: true,
      reference: `MOCK-VER-${input.idNumber.slice(-4)}`,
    });
  }

  createSubAccount(
    input: CreateSubAccountInput,
  ): Promise<CreateSubAccountResult> {
    // Stable per-destination code so re-runs are idempotent in appearance. The
    // settlement account joins the hash (Phase 13): a merchant and its routed
    // streams share an email but settle to different accounts, and each
    // destination must map to its own sub-account - two callers only collide
    // when they truly settle to the same place.
    const suffix = createHash('sha1')
      .update(`${input.email}|${input.bankCode ?? ''}|${input.accountNumber ?? ''}`)
      .digest('hex')
      .slice(0, 10)
      .toUpperCase();
    return Promise.resolve({ subAccountCode: `MOCK-SUB-${suffix}` });
  }

  createInvoice(input: CreateInvoiceInput): Promise<CreateInvoiceResult> {
    const hex = createHash('sha1')
      .update(input.invoiceReference)
      .digest('hex');
    const transactionReference = `MOCK-TXN-${hex.slice(0, 12).toUpperCase()}`;
    // Deterministic 10-digit "virtual account" derived from the reference.
    const virtualAccountNumber = String(
      parseInt(hex.slice(0, 12), 16) % 10_000_000_000,
    ).padStart(10, '0');

    this.ledger.set(transactionReference, {
      amount: input.amount,
      currency: input.currency,
    });

    return Promise.resolve({
      invoiceReference: input.invoiceReference,
      transactionReference,
      virtualAccountNumber,
      virtualAccountBankName: 'Mock Bank',
      checkoutUrl: `https://mock.monnify.local/checkout/${input.invoiceReference}`,
    });
  }

  createReservedAccount(
    input: CreateReservedAccountInput,
  ): Promise<CreateReservedAccountResult> {
    // Deterministic permanent account number derived from the reference, so a
    // re-created link (same reference) appears stable, exactly like createInvoice.
    const hex = createHash('sha1').update(input.accountReference).digest('hex');
    const reservedAccountNumber = String(
      parseInt(hex.slice(0, 12), 16) % 10_000_000_000,
    ).padStart(10, '0');
    return Promise.resolve({
      accountReference: input.accountReference,
      reservedAccountNumber,
      bankName: 'Mock Bank',
      checkoutUrl: `https://mock.monnify.local/link/${input.accountReference}`,
    });
  }

  // Mock-only demo affordance (NOT on the MonnifyProvider interface): register an
  // expected collection so a subsequently-signed webhook's verifyTransaction can
  // confirm it, exactly as createInvoice seeds the ledger for a Dynamic Invoice.
  // Used by the "Simulate a payment" demo action, the seed, and smoke. Live
  // payments cannot be faked, so only the mock provider offers this.
  registerReservedAccountPayment(input: {
    transactionReference: string;
    amount: number;
    currency: string;
  }): void {
    this.ledger.set(input.transactionReference, {
      amount: input.amount,
      currency: input.currency,
    });
  }

  // Mock-only: re-seed the ledger for an EXISTING invoice's transaction. Same
  // shape as registerReservedAccountPayment, kept distinct for readability. The
  // "Simulate a payment" demo action calls this from the stored invoice before
  // driving the webhook, so a simulated payment still confirms after the process
  // restarted (a hosted backend that slept between createInvoice and paying would
  // otherwise have lost the in-process ledger entry and report `not_paid`).
  registerInvoicePayment(input: {
    transactionReference: string;
    amount: number;
    currency: string;
  }): void {
    this.ledger.set(input.transactionReference, {
      amount: input.amount,
      currency: input.currency,
    });
  }

  verifyTransaction(
    transactionReference: string,
  ): Promise<VerifyTransactionResult> {
    const record = this.ledger.get(transactionReference);
    if (!record) {
      return Promise.resolve({
        transactionReference,
        status: 'UNKNOWN',
        amountPaid: 0,
      });
    }
    return Promise.resolve({
      transactionReference,
      status: 'PAID',
      amountPaid: record.amount,
      currency: record.currency,
      paymentMethod: 'ACCOUNT_TRANSFER',
      paidAt: new Date().toISOString(),
    });
  }

  validateExternalCredentials(
    creds: ExternalCredentials,
  ): Promise<ValidateCredentialsResult> {
    // Demo rule: an API key ending in "BAD" fails so the rejection path can be
    // shown on demand; anything else authenticates. Reason text is fixed - it
    // must never echo the supplied credentials.
    if (creds.apiKey.endsWith('BAD')) {
      return Promise.resolve({
        ok: false,
        reason: 'Mock Monnify: could not authenticate with those credentials.',
      });
    }
    return Promise.resolve({ ok: true });
  }

  searchExternalTransactions(
    creds: ExternalCredentials,
  ): Promise<ExternalTransactionRecord[]> {
    // ~40 PAID transactions over the last 45 days, fully determined by the
    // contract code - the same account always returns the same history.
    const rand = seededRandom(seedFrom(creds.contractCode));
    const methods = ['ACCOUNT_TRANSFER', 'CARD'];
    const customers = ['Ngozi A.', 'Tunde O.', 'Amara E.', 'Yusuf I.', 'Bisi K.'];
    const now = Date.now();
    const records: ExternalTransactionRecord[] = [];
    for (let i = 0; i < 40; i += 1) {
      const daysAgo = Math.floor(rand() * 45);
      const amount = Math.round((500 + rand() * 120_000) * 100) / 100;
      records.push({
        reference: `EXT-${creds.contractCode}-${String(i).padStart(3, '0')}`,
        amount,
        currency: 'NGN',
        paymentMethod: methods[Math.floor(rand() * methods.length)] ?? null,
        customerName: customers[Math.floor(rand() * customers.length)] ?? null,
        paidAt: new Date(now - daysAgo * 86_400_000).toISOString(),
      });
    }
    return Promise.resolve(records);
  }
}
