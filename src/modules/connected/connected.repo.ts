import { query } from '../../lib/db';
import type { ExternalTransactionRecord } from '../../lib/monnify/types';

export type ConnectedStatus = 'connected' | 'disconnected' | 'error';

// Safe projection - the encrypted *_ref columns are NEVER selected here, so no
// route can leak them (even accidentally) after creation.
export interface PublicConnectedAccount {
  id: string;
  merchant_id: string;
  business_name: string;
  contract_code: string;
  last_synced_at: string | null;
  status: ConnectedStatus;
  created_at: string;
  updated_at: string;
}

const PUBLIC_COLUMNS =
  'id, merchant_id, business_name, contract_code, last_synced_at, status, created_at, updated_at';

export interface NewConnectedAccount {
  merchantId: string;
  businessName: string;
  apiKeyCiphertext: string;
  secretKeyCiphertext: string;
  contractCode: string;
}

export async function insertConnectedAccount(
  input: NewConnectedAccount,
): Promise<PublicConnectedAccount> {
  const rows = await query<PublicConnectedAccount>(
    `insert into connected_accounts
       (merchant_id, business_name, monnify_api_key_ref, monnify_secret_key_ref, contract_code)
     values ($1, $2, $3, $4, $5)
     returning ${PUBLIC_COLUMNS}`,
    [
      input.merchantId,
      input.businessName,
      input.apiKeyCiphertext,
      input.secretKeyCiphertext,
      input.contractCode,
    ],
  );
  return rows[0]!;
}

export async function listConnectedAccounts(
  merchantId: string,
): Promise<PublicConnectedAccount[]> {
  return query<PublicConnectedAccount>(
    `select ${PUBLIC_COLUMNS} from connected_accounts
      where merchant_id = $1 order by created_at desc`,
    [merchantId],
  );
}

export async function findConnectedAccount(
  merchantId: string,
  accountId: string,
): Promise<PublicConnectedAccount | null> {
  const rows = await query<PublicConnectedAccount>(
    `select ${PUBLIC_COLUMNS} from connected_accounts
      where id = $1 and merchant_id = $2 limit 1`,
    [accountId, merchantId],
  );
  return rows[0] ?? null;
}

// The one read that touches ciphertext - used only by the sync flow, decrypted
// transiently, never returned to a client.
export async function readCredentialCiphertexts(
  merchantId: string,
  accountId: string,
): Promise<{
  api_key_ciphertext: string;
  secret_key_ciphertext: string;
  contract_code: string;
} | null> {
  const rows = await query<{
    api_key_ciphertext: string;
    secret_key_ciphertext: string;
    contract_code: string;
  }>(
    `select monnify_api_key_ref as api_key_ciphertext,
            monnify_secret_key_ref as secret_key_ciphertext,
            contract_code
       from connected_accounts
      where id = $1 and merchant_id = $2
      limit 1`,
    [accountId, merchantId],
  );
  return rows[0] ?? null;
}

// Multi-row idempotent upsert; the unique (connected_account_id, monnify_reference)
// constraint makes re-syncs insert nothing. Returns how many rows were new.
export async function upsertExternalTransactions(
  accountId: string,
  records: ExternalTransactionRecord[],
): Promise<number> {
  if (records.length === 0) {
    return 0;
  }
  const rows = await query<{ id: string }>(
    `insert into external_transactions
       (connected_account_id, monnify_reference, amount, currency,
        payment_method, customer_name, transaction_date, raw)
     select $1, u.reference, u.amount, u.currency, u.method, u.customer,
            u.paid_at, u.raw::jsonb
       from unnest($2::text[], $3::numeric[], $4::text[], $5::text[],
                   $6::text[], $7::timestamptz[], $8::text[])
              as u(reference, amount, currency, method, customer, paid_at, raw)
     on conflict (connected_account_id, monnify_reference) do nothing
     returning id`,
    [
      accountId,
      records.map((r) => r.reference),
      records.map((r) => r.amount),
      records.map((r) => r.currency),
      records.map((r) => r.paymentMethod),
      records.map((r) => r.customerName),
      records.map((r) => r.paidAt),
      records.map((r) => JSON.stringify(r)),
    ],
  );
  return rows.length;
}

export async function markSynced(
  accountId: string,
  status: ConnectedStatus,
): Promise<void> {
  await query(
    `update connected_accounts
        set status = $2,
            last_synced_at = case when $2 = 'connected' then now() else last_synced_at end
      where id = $1`,
    [accountId, status],
  );
}
