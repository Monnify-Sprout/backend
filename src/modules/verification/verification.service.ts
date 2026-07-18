import { getMonnifyProvider } from '../../lib/monnify';
import { HttpError } from '../../middleware/error';
import type { PublicMerchant } from '../auth/auth.repo';

import {
  getMerchantVerificationState,
  markMerchantFailed,
  markMerchantVerified,
} from './verification.repo';
import type { VerificationInput } from './verification.schema';

// Never store the raw BVN/NIN (PRD §10) — keep a masked reference only.
function maskId(idType: 'BVN' | 'NIN', idNumber: string): string {
  return `${idType}:*******${idNumber.slice(-4)}`;
}

// Orchestrates PRD §7.1: verify identity → create sub-account → activate.
export async function verifyMerchantIdentity(
  merchantId: string,
  input: VerificationInput,
): Promise<PublicMerchant> {
  const current = await getMerchantVerificationState(merchantId);
  if (!current) {
    throw new HttpError(404, 'Merchant not found.');
  }
  if (current.status === 'active' || current.verification_status === 'verified') {
    throw new HttpError(409, 'This merchant is already verified.');
  }

  const provider = getMonnifyProvider();
  const maskedRef = maskId(input.id_type, input.id_number);

  const identity = await provider.verifyIdentity({
    idType: input.id_type,
    idNumber: input.id_number,
    name: current.owner_name,
  });

  if (!identity.verified) {
    const reason = identity.reason ?? 'Identity verification failed.';
    console.log(
      `[verification] merchant=${merchantId} outcome=FAILED mode=${provider.mode} reason="${reason}"`,
    );
    return markMerchantFailed(merchantId, {
      reason,
      bvnOrNinRef: maskedRef,
      mode: provider.mode,
    });
  }

  // A merchant only becomes Active once the sub-account ALSO exists (PRD §7.1).
  // Sub-account creation runs before any DB write, so if it throws the merchant
  // stays 'pending' and can retry — no partial "verified but inactive" state.
  const sub = await provider.createSubAccount({
    businessName: current.business_name,
    email: current.email,
    bankCode: input.settlement_bank_code,
    accountNumber: input.settlement_account_number,
  });

  console.log(
    `[verification] merchant=${merchantId} outcome=VERIFIED mode=${provider.mode} subAccount=${sub.subAccountCode}`,
  );
  return markMerchantVerified(merchantId, {
    subAccountCode: sub.subAccountCode,
    bvnOrNinRef: maskedRef,
    mode: provider.mode,
  });
}
