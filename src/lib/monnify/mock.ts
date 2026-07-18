import { createHash } from 'node:crypto';

import type {
  CreateSubAccountInput,
  CreateSubAccountResult,
  MonnifyProvider,
  VerifyIdentityInput,
  VerifyIdentityResult,
} from './types';

// Deterministic stand-in for Monnify's Live-Mode-only BVN/NIN verification, for
// local dev and the hackathon demo. Its results are recorded with
// verification_mode='mock' in the DB and logged loudly, so a simulated pass is
// never mistaken for a real KYC check.
export class MonnifyMockProvider implements MonnifyProvider {
  readonly mode = 'mock' as const;

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
}
