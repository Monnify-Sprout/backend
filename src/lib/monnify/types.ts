// Provider abstraction over Monnify. Swapping `MONNIFY_VERIFICATION_MODE` between
// 'live' and 'mock' selects a different implementation of this interface - no
// caller changes anywhere else (Phase 2 acceptance).

export type IdType = 'BVN' | 'NIN';
export type VerificationMode = 'live' | 'mock';

export interface VerifyIdentityInput {
  idType: IdType;
  idNumber: string;
  name: string;
}

export interface VerifyIdentityResult {
  verified: boolean;
  reason?: string; // populated when verified === false
  reference?: string; // provider-side verification reference, when available
}

export interface CreateSubAccountInput {
  businessName: string;
  email: string;
  // Settlement destination. Monnify's live sub-account endpoint requires these;
  // the MVP onboarding form doesn't collect them yet, and the mock ignores them.
  bankCode?: string;
  accountNumber?: string;
}

export interface CreateSubAccountResult {
  subAccountCode: string;
}

// ── Invoices (Phase 3) ──────────────────────────────────────────────────────

// A single sub-account (the merchant) receiving a share of the payment.
export interface IncomeSplit {
  subAccountCode: string;
  splitPercentage: number;
}

export interface CreateInvoiceInput {
  invoiceReference: string;
  amount: number;
  currency: string;
  description: string;
  customerName: string;
  customerEmail: string;
  dueDate?: string; // yyyy-mm-dd
  // Present only on the 'split' settlement path (PRD §7.3).
  incomeSplit?: IncomeSplit;
}

export interface CreateInvoiceResult {
  invoiceReference: string;
  transactionReference: string;
  virtualAccountNumber: string;
  virtualAccountBankName?: string;
  checkoutUrl: string;
}

export type TransactionStatus = 'PAID' | 'PENDING' | 'FAILED' | 'UNKNOWN';

export interface VerifyTransactionResult {
  transactionReference: string;
  status: TransactionStatus;
  amountPaid: number;
  currency?: string;
  paymentMethod?: string;
  paidAt?: string;
}

// ── Connected accounts (Phase 4) ────────────────────────────────────────────

// A connected merchant's OWN Monnify credentials (PRD §7.6) - held in plaintext
// only transiently, between decryption and the API call. Never logged.
export interface ExternalCredentials {
  apiKey: string;
  secretKey: string;
  contractCode: string;
}

export interface ValidateCredentialsResult {
  ok: boolean;
  reason?: string; // safe user-facing text; must never echo the credentials
}

// One transaction pulled from a connected account, normalised to what
// external_transactions stores.
export interface ExternalTransactionRecord {
  reference: string;
  amount: number;
  currency: string;
  paymentMethod: string | null;
  customerName: string | null;
  paidAt: string; // ISO timestamp
}

export interface MonnifyProvider {
  readonly mode: VerificationMode;
  verifyIdentity(input: VerifyIdentityInput): Promise<VerifyIdentityResult>;
  createSubAccount(input: CreateSubAccountInput): Promise<CreateSubAccountResult>;
  createInvoice(input: CreateInvoiceInput): Promise<CreateInvoiceResult>;
  verifyTransaction(
    transactionReference: string,
  ): Promise<VerifyTransactionResult>;
  // Phase 4 - these authenticate with the SUPPLIED credentials, not Sprout's own.
  validateExternalCredentials(
    creds: ExternalCredentials,
  ): Promise<ValidateCredentialsResult>;
  searchExternalTransactions(
    creds: ExternalCredentials,
  ): Promise<ExternalTransactionRecord[]>;
}
