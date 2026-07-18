import { createHash } from 'node:crypto';

import type {
  CreateInvoiceInput,
  CreateInvoiceResult,
  CreateSubAccountInput,
  CreateSubAccountResult,
  MonnifyProvider,
  VerifyIdentityInput,
  VerifyIdentityResult,
  VerifyTransactionResult,
} from './types';

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
    // Stable per-merchant code so re-runs are idempotent in appearance.
    const suffix = createHash('sha1')
      .update(input.email)
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
}
