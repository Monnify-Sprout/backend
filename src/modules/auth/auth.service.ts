import { signAccessToken } from '../../lib/jwt';
import { hashPassword, verifyPassword } from '../../lib/password';
import { HttpError } from '../../middleware/error';
import type { LoginInput, RegisterInput } from './auth.schema';
import {
  findMerchantByEmail,
  insertMerchant,
  isUniqueViolation,
  toPublicMerchant,
  type PublicMerchant,
} from './auth.repo';

// Registers a merchant. A freshly registered merchant defaults to
// verification_status='pending' and status='onboarding' - it is NOT active
// until Phase 2's verification + sub-account creation both succeed.
export async function registerMerchant(
  input: RegisterInput,
): Promise<PublicMerchant> {
  const password_hash = await hashPassword(input.password);

  try {
    return await insertMerchant({
      business_name: input.business_name,
      owner_name: input.owner_name,
      phone: input.phone,
      email: input.email,
      password_hash,
    });
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new HttpError(
        409,
        'An account with that email or phone already exists.',
      );
    }
    throw err;
  }
}

export interface LoginResult {
  token: string;
  merchant: PublicMerchant;
}

export async function loginMerchant(input: LoginInput): Promise<LoginResult> {
  const row = await findMerchantByEmail(input.email);

  // Uniform error whether the email is unknown or the password is wrong, so we
  // don't leak which emails are registered.
  if (!row) {
    throw new HttpError(401, 'Invalid email or password.');
  }

  const ok = await verifyPassword(input.password, row.password_hash);
  if (!ok) {
    throw new HttpError(401, 'Invalid email or password.');
  }

  const token = signAccessToken({ sub: row.id, email: row.email });
  return { token, merchant: toPublicMerchant(row) };
}
