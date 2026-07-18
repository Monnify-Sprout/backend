// Provider abstraction over Monnify. Swapping `MONNIFY_VERIFICATION_MODE` between
// 'live' and 'mock' selects a different implementation of this interface — no
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

export interface MonnifyProvider {
  readonly mode: VerificationMode;
  verifyIdentity(input: VerifyIdentityInput): Promise<VerifyIdentityResult>;
  createSubAccount(input: CreateSubAccountInput): Promise<CreateSubAccountResult>;
}
