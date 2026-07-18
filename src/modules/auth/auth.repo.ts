import { query } from '../../lib/db';

export type VerificationStatus = 'pending' | 'verified' | 'failed';
export type MerchantStatus = 'onboarding' | 'active' | 'suspended';

// Full row, including secrets. Never send this to a client.
export interface MerchantRow {
  id: string;
  business_name: string;
  owner_name: string;
  phone: string;
  email: string;
  password_hash: string;
  bvn_or_nin_ref: string | null;
  verification_status: VerificationStatus;
  verification_reason: string | null;
  sub_account_code: string | null;
  status: MerchantStatus;
  created_at: string;
  updated_at: string;
}

// Safe projection returned by the API.
export interface PublicMerchant {
  id: string;
  business_name: string;
  owner_name: string;
  phone: string;
  email: string;
  verification_status: VerificationStatus;
  sub_account_code: string | null;
  status: MerchantStatus;
  created_at: string;
  updated_at: string;
}

const PUBLIC_COLUMNS =
  'id, business_name, owner_name, phone, email, verification_status, sub_account_code, status, created_at, updated_at';

export function toPublicMerchant(row: MerchantRow): PublicMerchant {
  return {
    id: row.id,
    business_name: row.business_name,
    owner_name: row.owner_name,
    phone: row.phone,
    email: row.email,
    verification_status: row.verification_status,
    sub_account_code: row.sub_account_code,
    status: row.status,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

// Postgres unique_violation — thrown by node-postgres as error.code.
export function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: string }).code === '23505'
  );
}

export interface NewMerchant {
  business_name: string;
  owner_name: string;
  phone: string;
  email: string;
  password_hash: string;
}

export async function insertMerchant(
  input: NewMerchant,
): Promise<PublicMerchant> {
  const rows = await query<PublicMerchant>(
    `insert into merchants (business_name, owner_name, phone, email, password_hash)
     values ($1, $2, $3, $4, $5)
     returning ${PUBLIC_COLUMNS}`,
    [
      input.business_name,
      input.owner_name,
      input.phone,
      input.email,
      input.password_hash,
    ],
  );
  // INSERT ... RETURNING always yields exactly one row.
  return rows[0]!;
}

// Includes password_hash — used by login only.
export async function findMerchantByEmail(
  email: string,
): Promise<MerchantRow | null> {
  const rows = await query<MerchantRow>(
    'select * from merchants where email = $1 limit 1',
    [email],
  );
  return rows[0] ?? null;
}

export async function findMerchantById(
  id: string,
): Promise<PublicMerchant | null> {
  const rows = await query<PublicMerchant>(
    `select ${PUBLIC_COLUMNS} from merchants where id = $1 limit 1`,
    [id],
  );
  return rows[0] ?? null;
}
