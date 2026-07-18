import 'dotenv/config';

// End-to-end proof for Phase 1: register -> login -> access a protected route,
// and confirm a freshly registered merchant is NOT active.
//
// Requires the API to be running (npm run dev) against a migrated database.
//   npm run smoke
const BASE =
  process.env.SMOKE_BASE_URL ?? `http://localhost:${process.env.PORT ?? 4000}`;

interface MerchantView {
  status?: string;
  verification_status?: string;
  verification_mode?: string | null;
  verification_reason?: string | null;
  sub_account_code?: string | null;
  email?: string;
}
interface RegisterResponse {
  merchant?: MerchantView;
}
interface LoginResponse {
  token?: string;
  merchant?: MerchantView;
}

// Node's fetch types `.json()` as unknown; parse into a known shape.
async function readBody<T>(res: Response): Promise<T> {
  return (await res.json().catch(() => ({}))) as T;
}

let passed = 0;
let failed = 0;

function check(name: string, ok: boolean, detail?: unknown): void {
  if (ok) {
    passed += 1;
    console.log(`  ✓ ${name}`);
  } else {
    failed += 1;
    console.error(
      `  ✗ ${name}${detail === undefined ? '' : ` — ${JSON.stringify(detail)}`}`,
    );
  }
}

async function main(): Promise<void> {
  const stamp = Date.now();
  const email = `demo+${stamp}@sprout.test`;
  const password = 'sprout-demo-1234';
  const phone = `080${String(10000000 + (stamp % 89999999))}`;

  console.log(`Target: ${BASE}\n`);

  // 1. Register
  const reg = await fetch(`${BASE}/api/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      business_name: 'Demo Store',
      owner_name: 'Ada Demo',
      phone,
      email,
      password,
    }),
  });
  const regBody = await readBody<RegisterResponse>(reg);
  check('register returns 201', reg.status === 201, reg.status);
  check(
    'new merchant status is not "active"',
    regBody.merchant?.status !== undefined && regBody.merchant.status !== 'active',
    regBody.merchant?.status,
  );
  check(
    'new merchant verification_status is "pending"',
    regBody.merchant?.verification_status === 'pending',
    regBody.merchant?.verification_status,
  );
  check(
    'register does not leak password_hash',
    regBody.merchant !== undefined && !('password_hash' in regBody.merchant),
  );

  // 2. Duplicate register is rejected
  const dup = await fetch(`${BASE}/api/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      business_name: 'Demo Store',
      owner_name: 'Ada Demo',
      phone,
      email,
      password,
    }),
  });
  check('duplicate register is rejected (409)', dup.status === 409, dup.status);

  // 3. Login
  const login = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const loginBody = await readBody<LoginResponse>(login);
  check('login returns 200', login.status === 200, login.status);
  check('login returns a token', typeof loginBody.token === 'string');
  const token: string = loginBody.token ?? '';

  // 4. Wrong password is rejected
  const badLogin = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: 'wrong-password' }),
  });
  check('wrong password is rejected (401)', badLogin.status === 401, badLogin.status);

  // 5. Protected route: missing / invalid / valid token
  const noToken = await fetch(`${BASE}/api/me`);
  check('protected route rejects missing token (401)', noToken.status === 401, noToken.status);

  const badToken = await fetch(`${BASE}/api/me`, {
    headers: { authorization: 'Bearer not-a-real-token' },
  });
  check('protected route rejects invalid token (401)', badToken.status === 401, badToken.status);

  const me = await fetch(`${BASE}/api/me`, {
    headers: { authorization: `Bearer ${token}` },
  });
  const meBody = await readBody<RegisterResponse>(me);
  check('protected route accepts valid token (200)', me.status === 200, me.status);
  check('protected route returns the right merchant', meBody.merchant?.email === email);
  check(
    'merchant is still not "active"',
    meBody.merchant?.status !== 'active',
    meBody.merchant?.status,
  );

  // ── Phase 2: BVN/NIN verification (mock mode) ──────────────────────────────

  // 6. Unauthenticated / invalid verification requests are rejected
  const verifyNoAuth = await fetch(`${BASE}/api/verification`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id_type: 'BVN', id_number: '22212345678' }),
  });
  check('verification rejects missing token (401)', verifyNoAuth.status === 401, verifyNoAuth.status);

  const verifyBad = await fetch(`${BASE}/api/verification`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ id_type: 'PASSPORT', id_number: '123' }),
  });
  check('verification rejects invalid payload (422)', verifyBad.status === 422, verifyBad.status);

  // 7. Successful verification → verified + active + sub-account, flagged mock
  const verifyOk = await fetch(`${BASE}/api/verification`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ id_type: 'BVN', id_number: '22212345678' }),
  });
  const verifyOkBody = await readBody<RegisterResponse>(verifyOk);
  check('verification returns 200', verifyOk.status === 200, verifyOk.status);
  check(
    'verified merchant status is "active"',
    verifyOkBody.merchant?.status === 'active',
    verifyOkBody.merchant?.status,
  );
  check(
    'verified merchant verification_status is "verified"',
    verifyOkBody.merchant?.verification_status === 'verified',
    verifyOkBody.merchant?.verification_status,
  );
  check(
    'verified merchant has a sub_account_code',
    typeof verifyOkBody.merchant?.sub_account_code === 'string' &&
      verifyOkBody.merchant.sub_account_code.length > 0,
    verifyOkBody.merchant?.sub_account_code,
  );
  check(
    'verification is flagged as mock',
    verifyOkBody.merchant?.verification_mode === 'mock',
    verifyOkBody.merchant?.verification_mode,
  );

  // 8. Re-verifying an already-verified merchant is rejected
  const reVerify = await fetch(`${BASE}/api/verification`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ id_type: 'BVN', id_number: '22212345678' }),
  });
  check('re-verifying an active merchant is rejected (409)', reVerify.status === 409, reVerify.status);

  // 9. Failure path — a second merchant whose id fails the mock check (ends 0000)
  const stamp2 = Date.now() + 1;
  const email2 = `demo+${stamp2}@sprout.test`;
  const phone2 = `081${String(10000000 + (stamp2 % 89999999))}`;
  await fetch(`${BASE}/api/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      business_name: 'Fail Store',
      owner_name: 'Ben Demo',
      phone: phone2,
      email: email2,
      password,
    }),
  });
  const login2 = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: email2, password }),
  });
  const token2 = (await readBody<LoginResponse>(login2)).token ?? '';
  const verifyFail = await fetch(`${BASE}/api/verification`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token2}` },
    body: JSON.stringify({ id_type: 'NIN', id_number: '22212340000' }),
  });
  const verifyFailBody = await readBody<RegisterResponse>(verifyFail);
  check('failed verification returns 200', verifyFail.status === 200, verifyFail.status);
  check(
    'failed merchant verification_status is "failed"',
    verifyFailBody.merchant?.verification_status === 'failed',
    verifyFailBody.merchant?.verification_status,
  );
  check(
    'failed merchant is NOT active',
    verifyFailBody.merchant?.status !== 'active',
    verifyFailBody.merchant?.status,
  );
  check(
    'failed verification stores a reviewable reason',
    typeof verifyFailBody.merchant?.verification_reason === 'string' &&
      verifyFailBody.merchant.verification_reason.length > 0,
    verifyFailBody.merchant?.verification_reason,
  );
  check(
    'failed merchant has no sub_account_code',
    !verifyFailBody.merchant?.sub_account_code,
  );

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error('Smoke test failed to run:', err);
  process.exit(1);
});
