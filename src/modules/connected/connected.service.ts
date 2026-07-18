import { encryptSecret, decryptSecret } from '../../lib/crypto';
import { getMonnifyProvider } from '../../lib/monnify';
import { HttpError } from '../../middleware/error';

import {
  findConnectedAccount,
  insertConnectedAccount,
  markSynced,
  readCredentialCiphertexts,
  upsertExternalTransactions,
  type PublicConnectedAccount,
} from './connected.repo';
import type { ConnectAccountInput } from './connected.schema';

// PRD §7.6 / FR-10: link an existing Monnify account read-only. Credentials are
// checked against Monnify first, then stored encrypted. From here on they exist
// in plaintext only transiently inside the sync flow - never in logs, responses,
// or error messages.
export async function connectAccount(
  merchantId: string,
  input: ConnectAccountInput,
): Promise<PublicConnectedAccount> {
  const provider = getMonnifyProvider();
  const validation = await provider.validateExternalCredentials({
    apiKey: input.api_key,
    secretKey: input.secret_key,
    contractCode: input.contract_code,
  });
  if (!validation.ok) {
    // Fixed reason text from the provider; nothing the user typed is echoed.
    throw new HttpError(
      422,
      validation.reason ?? 'Could not authenticate with Monnify.',
    );
  }

  return insertConnectedAccount({
    merchantId,
    businessName: input.business_name,
    apiKeyCiphertext: encryptSecret(input.api_key),
    secretKeyCiphertext: encryptSecret(input.secret_key),
    contractCode: input.contract_code,
  });
}

export interface SyncResult {
  account: PublicConnectedAccount;
  fetched: number;
  inserted: number;
}

// FR-11 data source: pull the account's transaction history into
// external_transactions. Idempotent - re-syncing inserts only new references.
export async function syncConnectedAccount(
  merchantId: string,
  accountId: string,
): Promise<SyncResult> {
  const stored = await readCredentialCiphertexts(merchantId, accountId);
  if (!stored) {
    throw new HttpError(404, 'Connected account not found.');
  }

  const provider = getMonnifyProvider();
  let records;
  try {
    records = await provider.searchExternalTransactions({
      apiKey: decryptSecret(stored.api_key_ciphertext),
      secretKey: decryptSecret(stored.secret_key_ciphertext),
      contractCode: stored.contract_code,
    });
  } catch (err) {
    await markSynced(accountId, 'error');
    throw err;
  }

  const inserted = await upsertExternalTransactions(accountId, records);
  await markSynced(accountId, 'connected');

  const account = await findConnectedAccount(merchantId, accountId);
  console.log(
    `[connected] account=${accountId} sync fetched=${records.length} inserted=${inserted}`,
  );
  return { account: account!, fetched: records.length, inserted };
}
