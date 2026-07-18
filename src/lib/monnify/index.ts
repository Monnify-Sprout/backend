import { env } from '../../config/env';

import { MonnifyLiveProvider } from './live';
import { MonnifyMockProvider } from './mock';
import type { MonnifyProvider } from './types';

let provider: MonnifyProvider | undefined;

// Selects the provider from MONNIFY_VERIFICATION_MODE once, then reuses it (the
// live provider caches its auth token). This is the ONLY place mode is branched.
export function getMonnifyProvider(): MonnifyProvider {
  if (!provider) {
    if (env.MONNIFY_VERIFICATION_MODE === 'live') {
      provider = new MonnifyLiveProvider();
    } else {
      provider = new MonnifyMockProvider();
      console.warn(
        '[monnify] MOCK verification mode — BVN/NIN checks are simulated and must NOT ' +
          'be treated as real KYC. Set MONNIFY_VERIFICATION_MODE=live for the real integration.',
      );
    }
  }
  return provider;
}

export type { MonnifyProvider } from './types';
