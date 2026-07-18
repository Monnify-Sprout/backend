import 'dotenv/config';
import { createHmac } from 'node:crypto';

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
interface InvoiceView {
  id?: string;
  status?: string;
  customer_name?: string | null;
  item?: string | null;
  invoice_reference?: string | null;
  virtual_account_number?: string | null;
  checkout_url?: string | null;
  monnify_transaction_reference?: string | null;
  settlement_path?: string | null;
  amount?: string;
}
interface PaymentView {
  settlement_amount?: string | null;
  commission_amount?: string | null;
}
interface InvoiceCreateResponse {
  invoice?: InvoiceView;
  settlement?: {
    path?: string;
    commission_amount?: number;
    settlement_amount?: number;
    commission_percent?: number;
  };
}
interface InvoiceDetailResponse {
  invoice?: InvoiceView;
  payment?: PaymentView | null;
}
interface WebhookAck {
  received?: boolean;
  outcome?: string;
}
interface PublicInvoiceView {
  invoice_reference?: string;
  business_name?: string;
  status?: string;
  virtual_account_number?: string | null;
  checkout_url?: string | null;
}
interface PublicLookupResponse {
  invoice?: PublicInvoiceView;
  payment?: { amount?: string; paid_at?: string | null } | null;
}
interface ConnectedAccountView {
  id?: string;
  status?: string;
  business_name?: string;
}
interface ConnectResponse {
  account?: ConnectedAccountView;
}
interface SyncResponse {
  fetched?: number;
  inserted?: number;
  account?: ConnectedAccountView;
}
interface AnalyticsResponse {
  scope?: { type?: string };
  totals?: Record<string, unknown>;
  trend?: unknown[];
  [key: string]: unknown;
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
      `  ✗ ${name}${detail === undefined ? '' : ` - ${JSON.stringify(detail)}`}`,
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

  // 9. Failure path - a second merchant whose id fails the mock check (ends 0000)
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

  // ── Phase 3: invoices, webhook, settlement (mock mode) ─────────────────────

  // 10. A non-active merchant cannot create invoices (token2 = onboarding)
  const invForbidden = await fetch(`${BASE}/api/invoices`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token2}` },
    body: JSON.stringify({ customer_name: 'Blocked', item: 'Test item', amount: 5000 }),
  });
  check('non-active merchant cannot create invoice (403)', invForbidden.status === 403, invForbidden.status);

  // 10b. Input validation (active merchant): item is required, and a buyer must
  // be identified by at least one of name/phone/email/social handle.
  const noItem = await fetch(`${BASE}/api/invoices`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ customer_name: 'No Item', amount: 1000 }),
  });
  check('invoice without an item is rejected (422)', noItem.status === 422, noItem.status);

  const noIdentity = await fetch(`${BASE}/api/invoices`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ item: 'Ghost order', amount: 1000 }),
  });
  check('invoice with no buyer identifier is rejected (422)', noIdentity.status === 422, noIdentity.status);

  // 10c. A buyer known only by a social handle (no name) is accepted.
  const handleOnly = await fetch(`${BASE}/api/invoices`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ customer_social_handle: '@handle_only', item: 'Ankara bag', amount: 3000 }),
  });
  const handleOnlyBody = await readBody<InvoiceCreateResponse>(handleOnly);
  check('handle-only buyer (no name) is accepted (201)', handleOnly.status === 201, handleOnly.status);
  check(
    'handle-only invoice stores no customer name',
    handleOnlyBody.invoice?.customer_name == null,
    handleOnlyBody.invoice?.customer_name,
  );

  // 11. Active merchant creates a Dynamic Invoice
  const invAmount = 15000;
  const createInv = await fetch(`${BASE}/api/invoices`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({
      customer_name: 'Chidi Buyer',
      item: 'Order #42',
      notes: '3 yards of ankara',
      amount: invAmount,
      due_date: '2026-12-31',
    }),
  });
  const createInvBody = await readBody<InvoiceCreateResponse>(createInv);
  const invoice = createInvBody.invoice;
  check('invoice creation returns 201', createInv.status === 201, createInv.status);
  check('invoice status is "pending"', invoice?.status === 'pending', invoice?.status);
  check(
    'invoice has a virtual account number',
    typeof invoice?.virtual_account_number === 'string' &&
      invoice.virtual_account_number.length > 0,
    invoice?.virtual_account_number,
  );
  check(
    'invoice has a checkout url',
    typeof invoice?.checkout_url === 'string' && invoice.checkout_url.length > 0,
  );
  check(
    'invoice records a settlement path',
    invoice?.settlement_path === 'manual' || invoice?.settlement_path === 'split',
    invoice?.settlement_path,
  );
  check(
    'settlement split is computed (merchant < total)',
    typeof createInvBody.settlement?.settlement_amount === 'number' &&
      createInvBody.settlement.settlement_amount < invAmount,
    createInvBody.settlement,
  );

  const txnRef = invoice?.monnify_transaction_reference ?? '';
  const invId = invoice?.id ?? '';
  const secret = process.env.MONNIFY_WEBHOOK_SECRET ?? '';
  const webhookBody = JSON.stringify({
    eventType: 'SUCCESSFUL_TRANSACTION',
    eventData: {
      transactionReference: txnRef,
      paymentReference: `PAYREF-${stamp}`,
      paymentStatus: 'PAID',
      product: { reference: invoice?.invoice_reference },
    },
  });

  // ── Phase 7: public (buyer-facing) invoice lookup ──────────────────────────

  // 11b. Public lookup of a PENDING invoice: no auth, payment channels offered,
  // and no merchant PII or internal identifiers in the response.
  const pubPending = await fetch(
    `${BASE}/api/public/invoices/${invoice?.invoice_reference}`,
  );
  const pubPendingText = await pubPending.text();
  const pubPendingBody = JSON.parse(pubPendingText) as PublicLookupResponse;
  check('public lookup needs no auth (200)', pubPending.status === 200, pubPending.status);
  check(
    'public pending invoice offers both payment channels',
    typeof pubPendingBody.invoice?.virtual_account_number === 'string' &&
      typeof pubPendingBody.invoice?.checkout_url === 'string',
    pubPendingBody.invoice,
  );
  check(
    'public lookup shows the business name',
    pubPendingBody.invoice?.business_name === 'Demo Store',
    pubPendingBody.invoice?.business_name,
  );
  check(
    'public lookup leaks no merchant PII or internals',
    !pubPendingText.includes(email) &&
      !pubPendingText.includes(phone) &&
      !pubPendingText.includes('customer_email') &&
      !pubPendingText.includes('merchant_id') &&
      !pubPendingText.includes(invId),
  );

  // 11c. Unknown reference is a clean 404
  const pubMissing = await fetch(`${BASE}/api/public/invoices/SPT-DOES-NOT-EXIST`);
  check('unknown public reference is a 404', pubMissing.status === 404, pubMissing.status);

  // 12. Webhook with a bad signature is rejected
  const badSig = await fetch(`${BASE}/api/webhooks/monnify`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'monnify-signature': 'deadbeef' },
    body: webhookBody,
  });
  check('webhook rejects bad signature (401)', badSig.status === 401, badSig.status);

  // 13. Webhook with a valid signature → invoice paid
  const goodSig = createHmac('sha512', secret).update(webhookBody).digest('hex');
  const goodHook = await fetch(`${BASE}/api/webhooks/monnify`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'monnify-signature': goodSig },
    body: webhookBody,
  });
  const goodHookBody = await readBody<WebhookAck>(goodHook);
  check('valid webhook accepted (200)', goodHook.status === 200, goodHook.status);
  check('webhook outcome is "processed"', goodHookBody.outcome === 'processed', goodHookBody.outcome);

  // 14. Invoice now shows paid, with settlement + commission recorded
  const paidInv = await readBody<InvoiceDetailResponse>(
    await fetch(`${BASE}/api/invoices/${invId}`, {
      headers: { authorization: `Bearer ${token}` },
    }),
  );
  check('paid invoice status is "paid"', paidInv.invoice?.status === 'paid', paidInv.invoice?.status);
  check(
    'payment records settlement + commission',
    paidInv.payment != null &&
      paidInv.payment.settlement_amount != null &&
      paidInv.payment.commission_amount != null,
    paidInv.payment,
  );

  // 15. Replaying the same webhook is a no-op
  const replay = await fetch(`${BASE}/api/webhooks/monnify`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'monnify-signature': goodSig },
    body: webhookBody,
  });
  const replayBody = await readBody<WebhookAck>(replay);
  check(
    'replayed webhook is a no-op (duplicate)',
    replay.status === 200 && replayBody.outcome === 'duplicate',
    replayBody.outcome,
  );

  // 16. Invoice still paid after the replay
  const afterReplay = await readBody<InvoiceDetailResponse>(
    await fetch(`${BASE}/api/invoices/${invId}`, {
      headers: { authorization: `Bearer ${token}` },
    }),
  );
  check('invoice still paid after replay', afterReplay.invoice?.status === 'paid', afterReplay.invoice?.status);

  // 16b. Public lookup of a PAID invoice: terminal state, channels withheld,
  // minimal payment info shown, settlement/commission stay private.
  const pubPaid = await fetch(
    `${BASE}/api/public/invoices/${invoice?.invoice_reference}`,
  );
  const pubPaidText = await pubPaid.text();
  const pubPaidBody = JSON.parse(pubPaidText) as PublicLookupResponse;
  check('public paid invoice reads "paid"', pubPaidBody.invoice?.status === 'paid', pubPaidBody.invoice?.status);
  check(
    'paid invoice withholds payment channels',
    pubPaidBody.invoice?.virtual_account_number === null &&
      pubPaidBody.invoice?.checkout_url === null,
    pubPaidBody.invoice,
  );
  check(
    'paid invoice shows the payment received',
    pubPaidBody.payment != null && typeof pubPaidBody.payment.amount === 'string',
    pubPaidBody.payment,
  );
  check(
    'public payment omits settlement/commission',
    !pubPaidText.includes('settlement_amount') &&
      !pubPaidText.includes('commission_amount'),
  );

  // 16c. An overdue pending invoice flips to "expired" on public read and no
  // longer offers payment (Phase 7 acceptance).
  const overdue = await readBody<InvoiceCreateResponse>(
    await fetch(`${BASE}/api/invoices`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({
        customer_name: 'Late Buyer',
        item: 'Order #43 (overdue)',
        amount: 2500,
        due_date: '2026-01-01',
      }),
    }),
  );
  const pubExpired = await readBody<PublicLookupResponse>(
    await fetch(
      `${BASE}/api/public/invoices/${overdue.invoice?.invoice_reference}`,
    ),
  );
  check(
    'overdue invoice reads as "expired" on public lookup',
    pubExpired.invoice?.status === 'expired',
    pubExpired.invoice?.status,
  );
  check(
    'expired invoice withholds payment channels',
    pubExpired.invoice?.virtual_account_number === null &&
      pubExpired.invoice?.checkout_url === null,
    pubExpired.invoice,
  );

  // ── Phase 4: connected accounts + shared analytics (mock mode) ─────────────

  // Distinctive credential values so we can assert they never appear anywhere.
  const extApiKey = 'MK_TEST_EXTERNAL_ACCT_1';
  const extSecret = 'SK_TEST_SUPERSECRET_XYZ9';
  const extContract = `${(stamp % 9000000) + 1000000}`;

  // 17. Bad credentials are rejected (mock: api key ending in "BAD")
  const connBad = await fetch(`${BASE}/api/connected-accounts`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({
      business_name: 'External Shop',
      api_key: 'MK_TEST_BAD',
      secret_key: extSecret,
      contract_code: extContract,
    }),
  });
  const connBadText = await connBad.text();
  check('bad external creds are rejected (422)', connBad.status === 422, connBad.status);
  check(
    'rejection response does not echo the secret',
    !connBadText.includes(extSecret) && !connBadText.includes('MK_TEST_BAD'),
  );

  // 18. Valid credentials connect; response contains no credential material
  const connOk = await fetch(`${BASE}/api/connected-accounts`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({
      business_name: 'External Shop',
      api_key: extApiKey,
      secret_key: extSecret,
      contract_code: extContract,
    }),
  });
  const connOkText = await connOk.text();
  const connOkBody = JSON.parse(connOkText) as ConnectResponse;
  const accountId = connOkBody.account?.id ?? '';
  check('connect account returns 201', connOk.status === 201, connOk.status);
  check(
    'connect response contains no plaintext credentials',
    !connOkText.includes(extApiKey) && !connOkText.includes(extSecret),
  );
  check(
    'connect response has no credential ref fields',
    !connOkText.includes('monnify_api_key_ref') &&
      !connOkText.includes('monnify_secret_key_ref'),
  );

  // 19. Listing never exposes credentials either
  const listConn = await fetch(`${BASE}/api/connected-accounts`, {
    headers: { authorization: `Bearer ${token}` },
  });
  const listConnText = await listConn.text();
  check(
    'account list contains no plaintext credentials',
    listConn.status === 200 &&
      !listConnText.includes(extApiKey) &&
      !listConnText.includes(extSecret),
  );

  // 20. Sync pulls the account's history…
  const sync1 = await readBody<SyncResponse>(
    await fetch(`${BASE}/api/connected-accounts/${accountId}/sync`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
    }),
  );
  check(
    'sync pulls external transactions',
    (sync1.fetched ?? 0) > 0 && (sync1.inserted ?? 0) > 0,
    sync1,
  );
  check('synced account status is "connected"', sync1.account?.status === 'connected', sync1.account?.status);

  // 21. …and re-syncing is idempotent
  const sync2 = await readBody<SyncResponse>(
    await fetch(`${BASE}/api/connected-accounts/${accountId}/sync`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
    }),
  );
  check(
    're-sync inserts nothing new (idempotent)',
    sync2.fetched === sync1.fetched && sync2.inserted === 0,
    sync2,
  );

  // 22. Shared analytics: merchant scope vs connected scope, SAME shape
  const merchantAnalytics = await readBody<AnalyticsResponse>(
    await fetch(`${BASE}/api/analytics`, {
      headers: { authorization: `Bearer ${token}` },
    }),
  );
  const connectedAnalytics = await readBody<AnalyticsResponse>(
    await fetch(`${BASE}/api/analytics?connected_account_id=${accountId}`, {
      headers: { authorization: `Bearer ${token}` },
    }),
  );
  check(
    'merchant analytics returns data',
    merchantAnalytics.scope?.type === 'merchant' &&
      Array.isArray(merchantAnalytics.trend),
    merchantAnalytics.scope,
  );
  check(
    'connected analytics returns data',
    connectedAnalytics.scope?.type === 'connected_account' &&
      (connectedAnalytics.trend?.length ?? 0) > 0,
    connectedAnalytics.scope,
  );
  const keysOf = (o: object): string => Object.keys(o).sort().join(',');
  check(
    'both scopes return the SAME top-level shape',
    keysOf(merchantAnalytics) === keysOf(connectedAnalytics),
    { merchant: keysOf(merchantAnalytics), connected: keysOf(connectedAnalytics) },
  );
  check(
    'both scopes return the SAME totals shape',
    keysOf(merchantAnalytics.totals ?? {}) === keysOf(connectedAnalytics.totals ?? {}),
  );

  // 23. Ownership: another merchant cannot read this connected account
  const foreign = await fetch(
    `${BASE}/api/analytics?connected_account_id=${accountId}`,
    { headers: { authorization: `Bearer ${token2}` } },
  );
  check("another merchant's analytics access is rejected (404)", foreign.status === 404, foreign.status);

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error('Smoke test failed to run:', err);
  process.exit(1);
});
