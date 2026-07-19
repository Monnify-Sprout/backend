import { query } from '../../lib/db';
import type { VerificationMode } from '../../lib/monnify/types';
import {
  PUBLIC_MERCHANT_COLUMNS,
  type PublicMerchant,
} from '../auth/auth.repo';

// Minimal current-state read used to enforce the verification transition rules
// (e.g. an already-active merchant can't re-verify).
export interface MerchantVerificationState {
  id: string;
  business_name: string;
  owner_name: string;
  email: string;
  verification_status: string;
  status: string;
}

export async function getMerchantVerificationState(
  id: string,
): Promise<MerchantVerificationState | null> {
  const rows = await query<MerchantVerificationState>(
    `select id, business_name, owner_name, email, verification_status, status
       from merchants
      where id = $1
      limit 1`,
    [id],
  );
  return rows[0] ?? null;
}

// Identity confirmed AND sub-account created → the merchant becomes Active.
export async function markMerchantVerified(
  id: string,
  data: {
    subAccountCode: string;
    bvnOrNinRef: string;
    mode: VerificationMode;
    settlementBankCode: string;
    settlementBankName: string | null;
    settlementAccountNumber: string;
    settlementAccountName: string | null;
  },
): Promise<PublicMerchant> {
  const rows = await query<PublicMerchant>(
    `update merchants set
       verification_status       = 'verified',
       verification_reason       = null,
       bvn_or_nin_ref            = $2,
       sub_account_code          = $3,
       verification_mode         = $4,
       settlement_bank_code      = $5,
       settlement_bank_name      = $6,
       settlement_account_number = $7,
       settlement_account_name   = $8,
       verified_at               = now(),
       status                    = 'active'
     where id = $1
     returning ${PUBLIC_MERCHANT_COLUMNS}`,
    [
      id,
      data.bvnOrNinRef,
      data.subAccountCode,
      data.mode,
      data.settlementBankCode,
      data.settlementBankName,
      data.settlementAccountNumber,
      data.settlementAccountName,
    ],
  );
  return rows[0]!;
}

// Verification failed → status stays 'onboarding' (NOT active) and the reason is
// stored for the admin-review flow (FR-14).
export async function markMerchantFailed(
  id: string,
  data: { reason: string; bvnOrNinRef: string; mode: VerificationMode },
): Promise<PublicMerchant> {
  const rows = await query<PublicMerchant>(
    `update merchants set
       verification_status = 'failed',
       verification_reason = $2,
       bvn_or_nin_ref      = $3,
       verification_mode   = $4,
       verified_at         = null
     where id = $1
     returning ${PUBLIC_MERCHANT_COLUMNS}`,
    [id, data.reason, data.bvnOrNinRef, data.mode],
  );
  return rows[0]!;
}
