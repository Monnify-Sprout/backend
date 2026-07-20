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
  settlement_bank_code?: string | null;
  settlement_account_number?: string | null;
  email?: string;
}

// Settlement bank account now required at verification (DECIDED 2026-07-18).
const SETTLEMENT = {
  settlement_bank_code: '058',
  settlement_bank_name: 'Guaranty Trust Bank',
  settlement_account_number: '0123456789',
  settlement_account_name: 'Ada Demo',
};
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
  category_id?: string | null;
  category_name?: string | null;
  category_color?: string | null;
  stream_id?: string | null;
  stream_name?: string | null;
}
interface StreamView {
  id?: string;
  name?: string;
  status?: string;
  sub_account_code?: string | null;
  settlement_account_number?: string | null;
  invoice_count?: number;
  link_count?: number;
  total_collected?: number;
}
interface StreamResponse {
  stream?: StreamView;
}
interface StreamListResponse {
  streams?: StreamView[];
}
interface CategoryView {
  id?: string;
  name?: string;
  color?: string;
  invoice_count?: number;
}
interface CategoryResponse {
  category?: CategoryView;
}
interface CategoryListResponse {
  categories?: CategoryView[];
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
  top_items?: unknown[] | null;
  by_category?: Array<{ category?: string; color?: string | null }> | null;
  by_link?: Array<{ link?: string }> | null;
  by_stream?: Array<{ stream?: string }> | null;
  funnel?: Record<string, unknown> | null;
  [key: string]: unknown;
}

interface PaymentLinkView {
  id?: string;
  title?: string;
  slug?: string;
  amount?: string | null;
  status?: string;
  category_name?: string | null;
  stream_id?: string | null;
  stream_name?: string | null;
  reserved_account_reference?: string | null;
  reserved_account_number?: string | null;
  reserved_account_bank_name?: string | null;
  checkout_url?: string | null;
  collection_count?: number;
  total_collected?: string;
}
interface PaymentLinkCreateResponse {
  link?: PaymentLinkView;
}
interface PaymentLinkListResponse {
  links?: PaymentLinkView[];
  summary?: {
    total?: number;
    active?: number;
    paused?: number;
    ended?: number;
    total_collected?: number;
  };
}
interface LinkPaymentView {
  amount?: string;
  settlement_amount?: string | null;
  commission_amount?: string | null;
  customer_name?: string | null;
}
interface PaymentLinkDetailResponse {
  link?: PaymentLinkView;
  stats?: {
    collection_count?: number;
    total_collected?: number;
    average_amount?: number;
    last_paid_at?: string | null;
  };
  collections?: LinkPaymentView[];
}
interface PublicLinkView {
  slug?: string;
  business_name?: string;
  title?: string;
  amount?: string | null;
  status?: string;
  reserved_account_number?: string | null;
  reserved_account_bank_name?: string | null;
  checkout_url?: string | null;
}
interface PublicLinkResponse {
  link?: PublicLinkView;
}
interface SimulateResponse {
  outcome?: string;
  amount?: number;
  transaction_reference?: string;
  payment_reference?: string;
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
    body: JSON.stringify({ id_type: 'BVN', id_number: '22212345678', ...SETTLEMENT }),
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
  check(
    'verified merchant stored its settlement account',
    verifyOkBody.merchant?.settlement_bank_code === SETTLEMENT.settlement_bank_code &&
      verifyOkBody.merchant?.settlement_account_number ===
        SETTLEMENT.settlement_account_number,
    {
      code: verifyOkBody.merchant?.settlement_bank_code,
      acct: verifyOkBody.merchant?.settlement_account_number,
    },
  );

  // 7b. Verification without a settlement account is rejected up front.
  const stampS = Date.now() + 7;
  const emailS = `demo+${stampS}@sprout.test`;
  const phoneS = `082${String(10000000 + (stampS % 89999999))}`;
  await fetch(`${BASE}/api/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      business_name: 'NoBank Store',
      owner_name: 'Cee Demo',
      phone: phoneS,
      email: emailS,
      password,
    }),
  });
  const tokenS =
    (await readBody<LoginResponse>(
      await fetch(`${BASE}/api/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: emailS, password }),
      }),
    )).token ?? '';
  const verifyNoBank = await fetch(`${BASE}/api/verification`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${tokenS}` },
    body: JSON.stringify({ id_type: 'BVN', id_number: '22212345678' }),
  });
  check(
    'verification without a settlement account is rejected (422)',
    verifyNoBank.status === 422,
    verifyNoBank.status,
  );

  // 8. Re-verifying an already-verified merchant is rejected
  const reVerify = await fetch(`${BASE}/api/verification`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ id_type: 'BVN', id_number: '22212345678', ...SETTLEMENT }),
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
    body: JSON.stringify({ id_type: 'NIN', id_number: '22212340000', ...SETTLEMENT }),
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

  // ── Phase 11: categories ───────────────────────────────────────────────────

  // 10d. Create a category, and prove duplicate names + bad colours are rejected.
  const catCreate = await fetch(`${BASE}/api/categories`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ name: 'Fabric', color: '#16a34a' }),
  });
  const catCreateBody = await readBody<CategoryResponse>(catCreate);
  const categoryId = catCreateBody.category?.id ?? '';
  check('category creation returns 201', catCreate.status === 201, catCreate.status);
  check(
    'created category has an id and colour',
    categoryId.length > 0 && catCreateBody.category?.color === '#16a34a',
    catCreateBody.category,
  );

  const catDup = await fetch(`${BASE}/api/categories`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ name: 'fabric', color: '#0ea5e9' }), // same name, other case
  });
  check('duplicate category name is rejected (409)', catDup.status === 409, catDup.status);

  const catBadColor = await fetch(`${BASE}/api/categories`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ name: 'Accessories', color: 'green' }),
  });
  check(
    'category with an invalid colour is rejected (422)',
    catBadColor.status === 422,
    catBadColor.status,
  );

  // 11. Active merchant creates a Dynamic Invoice (tagged with the category)
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
      category_id: categoryId,
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
  check('invoice stores its category', invoice?.category_id === categoryId, invoice?.category_id);

  // 11a. An invoice referencing a category the merchant does not own is rejected.
  const invUnknownCat = await fetch(`${BASE}/api/invoices`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({
      customer_name: 'No Cat',
      item: 'Order #99',
      amount: 1000,
      category_id: '00000000-0000-0000-0000-000000000000',
    }),
  });
  check(
    'invoice with an unowned category is rejected (422)',
    invUnknownCat.status === 422,
    invUnknownCat.status,
  );

  // 11a2. The category list now reports the invoice count and can be edited.
  const catList = await readBody<CategoryListResponse>(
    await fetch(`${BASE}/api/categories`, {
      headers: { authorization: `Bearer ${token}` },
    }),
  );
  const fabric = catList.categories?.find((c) => c.id === categoryId);
  check(
    'category list reports invoice_count',
    (fabric?.invoice_count ?? 0) >= 1,
    fabric,
  );

  const catUpdate = await fetch(`${BASE}/api/categories/${categoryId}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ name: 'Fabrics', color: '#0ea5e9' }),
  });
  const catUpdateBody = await readBody<CategoryResponse>(catUpdate);
  check('category update returns 200', catUpdate.status === 200, catUpdate.status);
  check(
    'category update applies the new name and colour',
    catUpdateBody.category?.name === 'Fabrics' &&
      catUpdateBody.category?.color === '#0ea5e9',
    catUpdateBody.category,
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
  // Phase 10: merchant-only depth is present for the merchant and null for the
  // connected scope (which has no invoice lifecycle / per-item detail).
  check(
    'merchant scope carries the invoice funnel + top items',
    merchantAnalytics.funnel != null &&
      typeof (merchantAnalytics.funnel as { collection_rate?: unknown }).collection_rate ===
        'number' &&
      Array.isArray(merchantAnalytics.top_items),
    { funnel: merchantAnalytics.funnel, top_items: merchantAnalytics.top_items },
  );
  check(
    'connected scope nulls the merchant-only funnel + top items',
    connectedAnalytics.funnel === null && connectedAnalytics.top_items === null,
    { funnel: connectedAnalytics.funnel, top_items: connectedAnalytics.top_items },
  );
  // Phase 11: the category breakdown is merchant-only and includes the tagged
  // sale we paid above; a connected account has no categories, so it is null.
  check(
    'merchant scope carries a category breakdown incl. the tagged sale',
    Array.isArray(merchantAnalytics.by_category) &&
      merchantAnalytics.by_category.some((r) => r.category === 'Fabrics'),
    merchantAnalytics.by_category,
  );
  check(
    'connected scope nulls the category breakdown',
    connectedAnalytics.by_category === null,
    connectedAnalytics.by_category,
  );

  // 23. Ownership: another merchant cannot read this connected account
  const foreign = await fetch(
    `${BASE}/api/analytics?connected_account_id=${accountId}`,
    { headers: { authorization: `Bearer ${token2}` } },
  );
  check("another merchant's analytics access is rejected (404)", foreign.status === 404, foreign.status);

  // 24. Disconnect: another merchant can't, the owner can, and it's then gone.
  const disconnectForeign = await fetch(
    `${BASE}/api/connected-accounts/${accountId}`,
    { method: 'DELETE', headers: { authorization: `Bearer ${token2}` } },
  );
  check(
    "another merchant can't disconnect this account (404)",
    disconnectForeign.status === 404,
    disconnectForeign.status,
  );
  const disconnect = await fetch(
    `${BASE}/api/connected-accounts/${accountId}`,
    { method: 'DELETE', headers: { authorization: `Bearer ${token}` } },
  );
  check('owner can disconnect the account (200)', disconnect.status === 200, disconnect.status);
  const afterDisconnect = await fetch(`${BASE}/api/connected-accounts`, {
    headers: { authorization: `Bearer ${token}` },
  });
  const afterDisconnectText = await afterDisconnect.text();
  check(
    'disconnected account no longer appears in the list',
    !afterDisconnectText.includes(accountId),
  );

  // ── Phase 11: category ownership + delete-un-categorises ───────────────────

  // 25. Another merchant can't touch this merchant's category, and deleting a
  // category un-categorises its invoices (FK SET NULL) rather than deleting them.
  const foreignDelCat = await fetch(`${BASE}/api/categories/${categoryId}`, {
    method: 'DELETE',
    headers: { authorization: `Bearer ${token2}` },
  });
  check(
    "another merchant can't delete this category (404)",
    foreignDelCat.status === 404,
    foreignDelCat.status,
  );

  const tmpCat = await readBody<CategoryResponse>(
    await fetch(`${BASE}/api/categories`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ name: 'Temporary', color: '#ef4444' }),
    }),
  );
  const tmpCatId = tmpCat.category?.id ?? '';
  const tmpInv = await readBody<InvoiceCreateResponse>(
    await fetch(`${BASE}/api/invoices`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({
        customer_name: 'Temp Buyer',
        item: 'Order #77',
        amount: 3000,
        category_id: tmpCatId,
      }),
    }),
  );
  const tmpInvId = tmpInv.invoice?.id ?? '';
  const delCat = await fetch(`${BASE}/api/categories/${tmpCatId}`, {
    method: 'DELETE',
    headers: { authorization: `Bearer ${token}` },
  });
  check('owner can delete a category (200)', delCat.status === 200, delCat.status);
  const afterDelCat = await readBody<InvoiceDetailResponse>(
    await fetch(`${BASE}/api/invoices/${tmpInvId}`, {
      headers: { authorization: `Bearer ${token}` },
    }),
  );
  check(
    'deleting a category un-categorises its invoice (kept, not deleted)',
    afterDelCat.invoice?.id === tmpInvId && afterDelCat.invoice?.category_id === null,
    { id: afterDelCat.invoice?.id, category_id: afterDelCat.invoice?.category_id },
  );

  // ── Phase 12: static payment links ─────────────────────────────────────────

  // 26. Create a fixed-amount link and a buyer-entered link.
  const fixedLink = await readBody<PaymentLinkCreateResponse>(
    await fetch(`${BASE}/api/payment-links`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({
        title: 'Ankara bundle',
        item: '6 yards',
        amount: 15000,
        category_id: categoryId,
      }),
    }),
  );
  const fixedLinkId = fixedLink.link?.id ?? '';
  const fixedSlug = fixedLink.link?.slug ?? '';
  const fixedAccountRef = fixedLink.link?.reserved_account_reference ?? '';
  check('create fixed payment link (201)', typeof fixedLinkId === 'string' && fixedLinkId !== '', fixedLink.link);
  check(
    'new link is active with a reserved account + checkout',
    fixedLink.link?.status === 'active' &&
      typeof fixedLink.link?.reserved_account_number === 'string' &&
      typeof fixedLink.link?.checkout_url === 'string',
    fixedLink.link,
  );

  const openLink = await readBody<PaymentLinkCreateResponse>(
    await fetch(`${BASE}/api/payment-links`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ title: 'Support the class' }),
    }),
  );
  const openLinkId = openLink.link?.id ?? '';
  check(
    'create buyer-entered link (amount null)',
    openLink.link?.amount === null && openLink.link?.status === 'active',
    openLink.link,
  );

  // 27. A non-active merchant cannot create a link (token2 = onboarding).
  const lockedLink = await fetch(`${BASE}/api/payment-links`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token2}` },
    body: JSON.stringify({ title: 'Should fail', amount: 1000 }),
  });
  check('non-active merchant cannot create a link (403)', lockedLink.status === 403, lockedLink.status);

  // 28. List returns the links + a status-count summary.
  const linkList = await readBody<PaymentLinkListResponse>(
    await fetch(`${BASE}/api/payment-links`, {
      headers: { authorization: `Bearer ${token}` },
    }),
  );
  check(
    'link list returns a status summary',
    (linkList.summary?.total ?? 0) >= 2 && (linkList.summary?.active ?? 0) >= 2,
    linkList.summary,
  );

  // 29. Public lookup by slug: no auth, safe subset, active offers channels.
  const pubLink = await fetch(`${BASE}/api/public/links/${fixedSlug}`);
  const pubLinkText = await pubLink.text();
  const pubLinkBody = JSON.parse(pubLinkText) as PublicLinkResponse;
  check('public link lookup needs no auth (200)', pubLink.status === 200, pubLink.status);
  check(
    'public active link shows business name + payment channels',
    pubLinkBody.link?.business_name === 'Demo Store' &&
      typeof pubLinkBody.link?.reserved_account_number === 'string' &&
      typeof pubLinkBody.link?.checkout_url === 'string',
    pubLinkBody.link,
  );
  check(
    'public link leaks no internals (reference / merchant id / settlement)',
    !pubLinkText.includes('reserved_account_reference') &&
      !pubLinkText.includes('merchant_id') &&
      !pubLinkText.includes('settlement_amount'),
  );
  const pubLinkMissing = await fetch(`${BASE}/api/public/links/does-not-exist`);
  check('unknown public slug is a 404', pubLinkMissing.status === 404, pubLinkMissing.status);

  // 30. Simulate a collection on the fixed link, then read its stats.
  const sim1 = await readBody<SimulateResponse>(
    await fetch(`${BASE}/api/payment-links/${fixedLinkId}/simulate-collection`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ customer_name: 'Ada Buyer' }),
    }),
  );
  check(
    'simulated collection is processed at the fixed amount',
    sim1.outcome === 'processed' && sim1.amount === 15000,
    sim1,
  );
  const linkDetail = await readBody<PaymentLinkDetailResponse>(
    await fetch(`${BASE}/api/payment-links/${fixedLinkId}`, {
      headers: { authorization: `Bearer ${token}` },
    }),
  );
  check(
    'link detail shows the collection with settlement + commission',
    linkDetail.stats?.collection_count === 1 &&
      linkDetail.stats?.total_collected === 15000 &&
      linkDetail.collections?.length === 1 &&
      linkDetail.collections[0]?.settlement_amount != null &&
      linkDetail.collections[0]?.commission_amount != null,
    { stats: linkDetail.stats, collection: linkDetail.collections?.[0] },
  );

  // 31. Buyer-entered link needs an amount at collection time.
  const sim2 = await readBody<SimulateResponse>(
    await fetch(`${BASE}/api/payment-links/${openLinkId}/simulate-collection`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ amount: 6000, customer_name: 'Gift Giver' }),
    }),
  );
  check('buyer-entered collection records the entered amount', sim2.outcome === 'processed' && sim2.amount === 6000, sim2);

  // 32. Replaying the SAME collection webhook is a no-op (idempotent on event_key).
  const linkReplayBody = JSON.stringify({
    eventType: 'SUCCESSFUL_TRANSACTION',
    eventData: {
      transactionReference: sim1.transaction_reference,
      paymentReference: sim1.payment_reference,
      paymentStatus: 'PAID',
      product: { reference: fixedAccountRef },
    },
  });
  const linkReplaySig = createHmac('sha512', secret).update(linkReplayBody).digest('hex');
  const linkReplayHook = await readBody<WebhookAck>(
    await fetch(`${BASE}/api/webhooks/monnify`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'monnify-signature': linkReplaySig },
      body: linkReplayBody,
    }),
  );
  check('replayed link collection is a no-op (duplicate)', linkReplayHook.outcome === 'duplicate', linkReplayHook.outcome);
  const afterReplayDetail = await readBody<PaymentLinkDetailResponse>(
    await fetch(`${BASE}/api/payment-links/${fixedLinkId}`, {
      headers: { authorization: `Bearer ${token}` },
    }),
  );
  check('collection count unchanged after replay', afterReplayDetail.stats?.collection_count === 1, afterReplayDetail.stats);

  // 33. An unknown transaction on the reserved account is verified, not trusted.
  const unknownBody = JSON.stringify({
    eventType: 'SUCCESSFUL_TRANSACTION',
    eventData: {
      transactionReference: `MOCK-LNK-UNKNOWN-${stamp}`,
      paymentReference: `NEW-${stamp}`,
      paymentStatus: 'PAID',
      product: { reference: fixedAccountRef },
    },
  });
  const unknownSig = createHmac('sha512', secret).update(unknownBody).digest('hex');
  const unknownHook = await readBody<WebhookAck>(
    await fetch(`${BASE}/api/webhooks/monnify`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'monnify-signature': unknownSig },
      body: unknownBody,
    }),
  );
  check('unverifiable link collection is not recorded (not_paid)', unknownHook.outcome === 'not_paid', unknownHook.outcome);

  // 34. Status lifecycle: pause -> resume -> end, with ended terminal.
  const paused = await readBody<PaymentLinkCreateResponse>(
    await fetch(`${BASE}/api/payment-links/${fixedLinkId}/status`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ status: 'paused' }),
    }),
  );
  check('link can be paused (200)', paused.link?.status === 'paused', paused.link?.status);
  const pubPaused = await readBody<PublicLinkResponse>(
    await fetch(`${BASE}/api/public/links/${fixedSlug}`),
  );
  check(
    'paused link withholds payment channels publicly',
    pubPaused.link?.status === 'paused' &&
      pubPaused.link?.reserved_account_number === null &&
      pubPaused.link?.checkout_url === null,
    pubPaused.link,
  );
  const resumed = await readBody<PaymentLinkCreateResponse>(
    await fetch(`${BASE}/api/payment-links/${fixedLinkId}/status`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ status: 'active' }),
    }),
  );
  check('paused link can be resumed to active', resumed.link?.status === 'active', resumed.link?.status);
  const ended = await fetch(`${BASE}/api/payment-links/${fixedLinkId}/status`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ status: 'ended' }),
  });
  check('link can be ended (200)', ended.status === 200, ended.status);
  const reopen = await fetch(`${BASE}/api/payment-links/${fixedLinkId}/status`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ status: 'active' }),
  });
  check('an ended link cannot be reopened (409)', reopen.status === 409, reopen.status);

  // 35. Ownership: another merchant can neither read nor change this link.
  const foreignLinkGet = await fetch(`${BASE}/api/payment-links/${openLinkId}`, {
    headers: { authorization: `Bearer ${token2}` },
  });
  check("another merchant can't read this link (404)", foreignLinkGet.status === 404, foreignLinkGet.status);
  const foreignLinkStatus = await fetch(`${BASE}/api/payment-links/${openLinkId}/status`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token2}` },
    body: JSON.stringify({ status: 'paused' }),
  });
  check("another merchant can't change this link (404)", foreignLinkStatus.status === 404, foreignLinkStatus.status);

  // 36. General analytics now speaks to link collections too: a merchant-only
  // by_link breakdown carries the link, and a connected account nulls it.
  const linkAnalytics = await readBody<AnalyticsResponse>(
    await fetch(`${BASE}/api/analytics?days=90`, {
      headers: { authorization: `Bearer ${token}` },
    }),
  );
  check(
    'merchant analytics carries a by_link breakdown incl. the link',
    Array.isArray(linkAnalytics.by_link) &&
      linkAnalytics.by_link.some((r) => r.link === 'Ankara bundle'),
    linkAnalytics.by_link,
  );
  check(
    'connected scope nulls the by_link breakdown',
    connectedAnalytics.by_link === null || connectedAnalytics.by_link === undefined,
    connectedAnalytics.by_link,
  );

  // ── Phase 13: revenue streams (tracking + money routing) ───────────────────

  // 37. A tracking-only stream is just a label; a routed one (own settlement
  // account) gets its OWN sub-account, distinct from the merchant's.
  const trackingStream = await readBody<StreamResponse>(
    await fetch(`${BASE}/api/streams`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ name: 'Market stall' }),
    }),
  );
  check(
    'tracking-only stream has no sub-account',
    Boolean(trackingStream.stream?.id) && trackingStream.stream?.sub_account_code === null,
    trackingStream.stream,
  );
  const trackingStreamId = trackingStream.stream?.id ?? '';

  const routedStream = await readBody<StreamResponse>(
    await fetch(`${BASE}/api/streams`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({
        name: 'Lekki shop',
        settlement_bank_code: '044',
        settlement_bank_name: 'Access Bank',
        settlement_account_number: '1112223334',
        settlement_account_name: 'Lekki Branch',
      }),
    }),
  );
  const routedStreamId = routedStream.stream?.id ?? '';
  check(
    "routed stream has its own sub-account (not the merchant's)",
    typeof routedStream.stream?.sub_account_code === 'string' &&
      routedStream.stream.sub_account_code.length > 0 &&
      routedStream.stream.sub_account_code !== verifyOkBody.merchant?.sub_account_code,
    routedStream.stream?.sub_account_code,
  );

  // 38. Validation: duplicate names (case-insensitive) and a half-supplied
  // settlement account are both rejected.
  const dupStream = await fetch(`${BASE}/api/streams`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ name: 'market STALL' }),
  });
  check('duplicate stream name is rejected (409)', dupStream.status === 409, dupStream.status);
  const halfStream = await fetch(`${BASE}/api/streams`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ name: 'Half routed', settlement_bank_code: '058' }),
  });
  check(
    'settlement account must be complete or absent (422)',
    halfStream.status === 422,
    halfStream.status,
  );

  // 39. An invoice can be tagged with a stream; detail joins the name back.
  const streamInv = await readBody<InvoiceCreateResponse>(
    await fetch(`${BASE}/api/invoices`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({
        customer_name: 'Streamed Buyer',
        item: 'Streamed order',
        amount: 9000,
        stream_id: routedStreamId,
      }),
    }),
  );
  check(
    'invoice carries its stream_id',
    streamInv.invoice?.stream_id === routedStreamId,
    streamInv.invoice?.stream_id,
  );
  const streamInvDetail = await readBody<InvoiceDetailResponse>(
    await fetch(`${BASE}/api/invoices/${streamInv.invoice?.id}`, {
      headers: { authorization: `Bearer ${token}` },
    }),
  );
  check(
    'invoice detail joins the stream name',
    streamInvDetail.invoice?.stream_name === 'Lekki shop',
    streamInvDetail.invoice?.stream_name,
  );
  const unknownStreamInv = await fetch(`${BASE}/api/invoices`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({
      customer_name: 'X',
      item: 'X',
      amount: 100,
      stream_id: '00000000-0000-4000-8000-000000000000',
    }),
  });
  check('an unknown stream is rejected (422)', unknownStreamInv.status === 422, unknownStreamInv.status);

  // 40. Archived streams keep history but cannot take new work.
  const archived = await readBody<StreamResponse>(
    await fetch(`${BASE}/api/streams/${trackingStreamId}/status`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ status: 'archived' }),
    }),
  );
  check('stream can be archived', archived.stream?.status === 'archived', archived.stream?.status);
  const archivedInv = await fetch(`${BASE}/api/invoices`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({
      customer_name: 'X',
      item: 'X',
      amount: 100,
      stream_id: trackingStreamId,
    }),
  });
  check('an archived stream cannot be assigned (422)', archivedInv.status === 422, archivedInv.status);

  // 41. A link can be tagged too, and a collection through it lands in the
  // stream's analytics bucket.
  const streamLink = await readBody<PaymentLinkCreateResponse>(
    await fetch(`${BASE}/api/payment-links`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({
        title: `Streamed link ${stamp}`,
        amount: 2500,
        stream_id: routedStreamId,
      }),
    }),
  );
  check(
    'payment link carries its stream_id',
    streamLink.link?.stream_id === routedStreamId,
    streamLink.link?.stream_id,
  );
  const streamCollect = await readBody<SimulateResponse>(
    await fetch(`${BASE}/api/payment-links/${streamLink.link?.id}/simulate-collection`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({}),
    }),
  );
  check(
    'collection on a streamed link is processed',
    streamCollect.outcome === 'processed',
    streamCollect.outcome,
  );

  // 42. The list rollups count both products per stream.
  const streamList = await readBody<StreamListResponse>(
    await fetch(`${BASE}/api/streams`, {
      headers: { authorization: `Bearer ${token}` },
    }),
  );
  const routedRow = streamList.streams?.find((s) => s.id === routedStreamId);
  check(
    'stream rollups count its invoices, links, and collections',
    routedRow?.invoice_count === 1 &&
      routedRow?.link_count === 1 &&
      (routedRow?.total_collected ?? 0) >= 2500,
    routedRow,
  );

  // 43. Deletion is only for unused streams; in-use ones must be archived.
  const delInUse = await fetch(`${BASE}/api/streams/${routedStreamId}`, {
    method: 'DELETE',
    headers: { authorization: `Bearer ${token}` },
  });
  check('a stream in use cannot be deleted (409)', delInUse.status === 409, delInUse.status);
  const delUnused = await fetch(`${BASE}/api/streams/${trackingStreamId}`, {
    method: 'DELETE',
    headers: { authorization: `Bearer ${token}` },
  });
  check('an unused stream can be deleted (200)', delUnused.status === 200, delUnused.status);

  // 44. Ownership: another merchant can neither change nor delete this stream.
  const foreignStreamPatch = await fetch(`${BASE}/api/streams/${routedStreamId}/status`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token2}` },
    body: JSON.stringify({ status: 'archived' }),
  });
  check("another merchant can't change this stream (404)", foreignStreamPatch.status === 404, foreignStreamPatch.status);
  const foreignStreamDel = await fetch(`${BASE}/api/streams/${routedStreamId}`, {
    method: 'DELETE',
    headers: { authorization: `Bearer ${token2}` },
  });
  check("another merchant can't delete this stream (404)", foreignStreamDel.status === 404, foreignStreamDel.status);

  // 45. Analytics: merchant-only by_stream carries the stream (via the link
  // collection above); the connected scope nulls it.
  const streamAnalytics = await readBody<AnalyticsResponse>(
    await fetch(`${BASE}/api/analytics?days=90`, {
      headers: { authorization: `Bearer ${token}` },
    }),
  );
  check(
    'merchant analytics carries a by_stream breakdown incl. the stream',
    Array.isArray(streamAnalytics.by_stream) &&
      streamAnalytics.by_stream.some((r) => r.stream === 'Lekki shop'),
    streamAnalytics.by_stream,
  );
  check(
    'connected scope nulls the by_stream breakdown',
    connectedAnalytics.by_stream === null || connectedAnalytics.by_stream === undefined,
    connectedAnalytics.by_stream,
  );

  // 46. Routing is reversible: clearing the settlement account makes the stream
  // tracking-only again.
  const cleared = await readBody<StreamResponse>(
    await fetch(`${BASE}/api/streams/${routedStreamId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ clear_settlement: true }),
    }),
  );
  check(
    'clearing settlement detaches the sub-account (tracking-only again)',
    cleared.stream?.sub_account_code === null &&
      cleared.stream?.settlement_account_number === null,
    cleared.stream,
  );

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error('Smoke test failed to run:', err);
  process.exit(1);
});
