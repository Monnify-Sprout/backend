# Sprout - Backend Context

Express + TypeScript API for Sprout, an APIConf Lagos x Monnify Developer Challenge
hackathon project. Read `../Sprout_PRD_v2.0.docx` and
`../Sprout_Claude_Code_Build_Plan_v2.md` before starting any phase - this file is
the summary, those are the source of truth.

## Stack

Express, TypeScript, Supabase as managed Postgres accessed directly via `pg`
(node-postgres) over the session pooler - NOT Supabase Auth and NOT the
supabase-js REST client. JWT (our own auth), bcrypt, zod, dotenv.

The one DB connection string is `SUPABASE_DB_URL`; the shared pool lives in
`src/lib/db.ts` and is used by both the app and the migration runner. (The v2
build plan text still says "supabase-js" - the code intentionally supersedes it.)

## Core mechanic - pin this

Sprout holds one Monnify merchant contract. Every onboarded merchant is verified
personally by BVN or NIN, not by business registration, and becomes a sub-account
under Sprout's own master contract - never their own standalone Monnify merchant.
This is the entire product, not one feature of it.

## Two fee layers - keep distinct (PRD §7.3)

1. Monnify's own transaction fee - allocated via `feePercentage`.
2. Sprout's platform commission - a Sprout business decision, not a Monnify field.
   Applied via split config if Create Invoice supports it, otherwise the manual
   fallback (§7.3) - confirm which, in phase 3, before assuming either.

## Top risk - BVN/NIN is Live Mode only

Monnify's own docs state this feature only works in Live Mode. Build the real
verification code path, but gate it behind `MONNIFY_VERIFICATION_MODE`
(`live` | `mock`) so local dev and the hackathon demo can run without live access.
A mocked verification must never be indistinguishable from a real one in stored
records or logs.

## Second dependency - sub-account activation

Confirm Sprout's own Monnify contract has Sub-Account API access before phase 2.
This gates every merchant's onboarding, not one optional feature.

## Current phase

Phases 1–8 plus Phase 10 (analytics deepening), Phase 11 (categories), Phase 12
(static payment links) and Phase 13 (revenue streams) **complete and verified
end to end** against the live Supabase DB (`npm run smoke` → 133/133).
Migrations in `migrations/` (`npm run migrate`; Phase 10 added none, Phase 11
added `0007_categories.sql`, Phase 12 added `0008_payment_links.sql`, Phase 13
added `0009_streams.sql`).

Endpoints (all DB access via `pg`):
- `POST /api/auth/register`, `POST /api/auth/login`, protected `GET /api/me`
- protected `POST /api/verification` - BVN/NIN → verify → create sub-account →
  `active`. Also REQUIRES the merchant's settlement bank account (bank code +
  NUBAN, names optional; migration 0005), stored on the merchant and passed to
  Create-Sub-Account (DECIDED 2026-07-18; mock ignores it for its stub code)
- protected `POST /api/invoices` (create Dynamic Invoice), `GET /api/invoices`
  (the merchant list joins the payment to expose `paid_at` per invoice - added in
  Phase 10 for the dashboard "date paid" column + filter; kept out of the shared
  INVOICE_COLUMNS and the public subset), `GET /api/invoices/:id` (invoice +
  payment/settlement). An invoice is a
  required `item` plus optional `notes` (migration 0004 split the old
  `description`); the buyer needs at least one of name/phone/email/social handle
  (name is NOT required - social-commerce buyers may be just a handle), enforced
  by a zod refine and a DB CHECK. A social handle can carry its network in
  `customer_social_platform` (migration 0006; free text - known keys
  instagram/whatsapp/facebook/snapchat or a merchant-typed "Other"), stored only
  when a handle is present. Monnify's description is composed from item+notes and
  its required customerName falls back through handle/phone. An invoice may also
  carry an optional `category_id` (Phase 11) - validated to belong to the
  merchant at create time; the list/detail queries join the category to expose
  `category_name`/`category_color` (kept out of INVOICE_COLUMNS + the public subset).
- protected `GET/POST /api/streams`, `PATCH /api/streams/:id`,
  `PATCH /api/streams/:id/status`, `DELETE /api/streams/:id` (Phase 13;
  `src/modules/streams/`) - "revenue streams", the merchant's own subdivisions of
  their activity (a shop branch, a market stall, the Instagram page, a sales rep,
  a pop-up, a second brand): WHERE a sale came from, vs categories' WHAT was
  sold. Named "streams" deliberately - "sub-account" already means the Monnify
  sub-account for the merchant, and "branch" implies only the physical case. A
  stream is tracking-only (a label) until a settlement bank account is attached,
  which makes it ROUTED: the service creates the stream its OWN Monnify
  sub-account (`provider.createSubAccount`; gated on the merchant being Active),
  and on the split path invoices/links assigned to it settle THERE instead of to
  the merchant's default account (the mock provider hashes email+bank+account so
  distinct destinations get distinct codes). Names unique per merchant
  case-insensitively (409). Lifecycle: active <-> archived (reversible; archived
  streams reject new assignments with 422 but keep history); DELETE only when no
  invoice/link references it (409 otherwise). PATCH can rename, attach/replace
  the settlement account (new sub-account), or `clear_settlement` back to
  tracking-only. The list carries per-stream rollups (invoice_count, link_count,
  total_collected across BOTH products, last_paid_at). Invoices and payment
  links accept an optional ownership-checked `stream_id` (FK ON DELETE SET
  NULL), joined back as `stream_name` on merchant list/detail (kept out of
  INVOICE_COLUMNS and all public subsets). Analytics gained a merchant-only
  `by_stream` breakdown (invoices + link collections, "Unassigned" bucket; null
  for a connected account). `CreateReservedAccountInput` gained an optional
  `incomeSplit` so a routed link's reserved account can carry the split config.
- protected `GET/POST /api/categories`, `PATCH/DELETE /api/categories/:id`
  (Phase 11; `src/modules/categories/`) - merchant-owned name + `#rrggbb` colour,
  case-insensitively unique per merchant (409 on a duplicate). The list carries a
  per-category `invoice_count`. Deleting a category un-categorises its invoices
  (`invoices.category_id` is ON DELETE SET NULL), never deletes them.
- protected `GET/POST /api/payment-links`, `GET /api/payment-links/:id`,
  `PATCH /api/payment-links/:id/status`, `POST /api/payment-links/:id/simulate-collection`
  (Phase 12; `src/modules/payment-links/`) - reusable, long-lived links that take
  MANY payments ("collections"), a distinct entity from one-time invoices. A link
  has a title + optional item, an OPTIONAL amount (null = buyer enters it), an
  optional `category_id`, and a lifecycle `active` -> `paused` (reversible) ->
  `ended` (terminal; the service rejects reopening an ended link). Each link is
  backed by a Monnify RESERVED (permanent) account (`createReservedAccount` on the
  provider). Collections live in their own `link_payments` table (migration 0008)
  so every invoice query stays untouched; the list carries per-link
  collection_count / total_collected / last_paid_at and a status-count summary,
  the detail carries stats + the collections. `simulate-collection` is a
  demo/testing affordance gated to mock mode (registers a mock ledger txn, then
  drives the real webhook path). PUBLIC `GET /api/public/links/:slug` mirrors the
  public invoice lookup (safe subset; payment channels withheld unless active).
- `POST /api/webhooks/monnify` - no auth; HMAC-SHA512 signature over the RAW body
  (captured in `index.ts`), idempotent via `payments.event_key`, confirms with
  Verify Transaction before marking Paid (never trusts the payload). ONE callback
  shape serves two products: it tries an invoice first (txn/invoice reference),
  else a static payment link (matched by the reserved account reference); a link
  collection is recorded in `link_payments` (idempotent on its own event_key,
  split recorded, whatever amount was actually paid - a link has no single
  expected amount).
- PUBLIC `GET /api/public/invoices/:reference` (Phase 7, no auth) - buyer-facing
  safe subset: business name + invoice basics; payment channels nulled unless
  `pending`; minimal payment info when paid; never customer email, merchant
  contact, or settlement/commission. Read paths lazily flip overdue `pending`
  invoices to `expired` server-side (public lookup + merchant list/detail), so
  clients never derive expiry.
- protected `POST /api/connected-accounts` (validate then AES-256-GCM-encrypt the
  merchant's own Monnify creds - never logged/returned after creation),
  `GET /api/connected-accounts`, `POST /api/connected-accounts/:id/sync`
  (idempotent pull into `external_transactions`),
  `DELETE /api/connected-accounts/:id` (disconnect - removes the link + its
  pulled history via FK cascade, owner-scoped)
- protected `GET /api/analytics[?connected_account_id][&days]` - ONE aggregation
  SQL over a swappable base CTE (`src/modules/analytics/analytics.service.ts`), so
  merchant and connected scopes return identical shapes. Phase 10 widened the base
  rows (customer/item/settlement/commission alongside ts/amount/method) and the
  response: totals now carry largest_amount, unique_customers, net_amount
  (settled) and fees_amount (Sprout commission); breakdowns add time_of_day and
  top_customers; and there is MERCHANT-ONLY depth that is `null` for a connected
  account - `top_items` (best sellers), `by_category` (Phase 11: sales grouped by
  the merchant's categories, each row carrying the category colour, with an
  "Uncategorised" bucket) and a `funnel` (of invoices CREATED in the window:
  paid/outstanding/overdue/cancelled split, collection rate by count and value,
  avg hours-to-payment). The funnel is windowed on `invoices.created_at`, a
  different window than the money view (paid_at) - see the file's comments.
  Phase 12: the MERCHANT base is now a UNION of paid invoices AND static-link
  collections, so every metric (totals/trend/methods/customers/ranges/times)
  counts both; each base row carries a `link` column (the link title for a
  collection, null for an invoice) mirroring `item`, so top_items stays
  invoice-only and a new merchant-only `by_link` breakdown stays link-only.

Monnify is behind a provider abstraction (`src/lib/monnify/`) selected by
`MONNIFY_VERIFICATION_MODE`: `mock` (default; deterministic - BVN/NIN ending in
`0000` fails, external api_key ending in `BAD` fails, seeded 40-txn history per
contract code) vs `live` (real API, needs `MONNIFY_*` creds - un-testable in
sandbox per PRD §5). Mock verifications are flagged in
`merchants.verification_mode`.

Settlement: `SPROUT_COMMISSION_PERCENT` (default 1%); `MONNIFY_INVOICE_SPLIT_SUPPORTED`
picks the Monnify `incomeSplitConfig` split path vs the safe manual fallback
(PRD §7.3, still UNCONFIRMED). The split is recorded on every payment either way.
Connected-account credential encryption needs `CREDENTIALS_ENCRYPTION_KEY`
(32-byte hex; `src/lib/crypto.ts`).

Monnify SANDBOX credentials are complete in `.env` (2026-07-18): api key,
secret key, contract code, base URL. Monnify signs webhooks with the secret
key, so there is no separate webhook secret to obtain. The demo still runs on
mock.

Phase 9a (seed script) **complete**: `npm run seed` (`src/scripts/seed.ts`) is
idempotent and drives the real service layer in-process to set up the PRD §13
demo - one verified Active demo merchant (`demo@sprout.test`), ~10 of its own
invoices (paid/pending/overdue, paid ones backdated across ~3 weeks for a real
trend, transfer/card mix), and a second contract ("Lagos Beauty Hub") connected
+ synced. Requires MONNIFY_VERIFICATION_MODE=mock (it fabricates paid invoices
and deterministic connected history, which only the mock provider can produce).
Phase 11 added 4 demo categories assigned across the seed invoices (one paid
invoice left uncategorised on purpose); the seed also BACKFILLS categories onto
already-seeded invoices by item match, so re-running it converges a pre-Phase-11
demo without recreating anything.

Phase 10 (analytics deepening) **complete** (2026-07-19): richer analytics with
no migration (see the `/api/analytics` bullet above) and `paid_at` on the
merchant invoice list. Smoke grew two checks (merchant carries funnel + top_items;
connected nulls both) -> 76/76.

Phase 11 (categories) **complete** (2026-07-19): merchant-defined categories
(name + colour) via `src/modules/categories/`, `invoices.category_id`
(migration 0007), and a merchant-only `by_category` breakdown in the one analytics
engine (null for a connected account, like top_items/funnel). Smoke -> 90/90.

Phase 12 (static payment links) **complete** (2026-07-20): reusable links backed
by Monnify reserved accounts (`src/modules/payment-links/`, migration 0008 adds
`payment_links` + `link_payments`). The webhook routes reserved-account
collections to `link_payments` (idempotent, verify-before-record, split per
collection). Analytics now unions link collections into the merchant base and adds
a merchant-only `by_link` breakdown. The provider abstraction gained
`createReservedAccount` (mock deterministic; live structurally complete, gated).
The seed adds 4 demo links (fixed + buyer-entered; active/paused/ended) with 10
backdated collections; a mock-only `simulate-collection` action drives the real
webhook path. Smoke -> 114/114.

Phase 13 (revenue streams) **complete** (2026-07-20): tracking + money routing
(DECIDED: name "streams", scope "money routing too"). See the `/api/streams`
bullet above. Migration `0009_streams.sql`; the seed adds 3 demo streams
("Ikeja shop" ROUTED to its own Access Bank account, "Instagram" tracking-only,
"Eid pop-up" archived), assigns them across seed invoices/links, and BACKFILLS
stream assignments onto already-seeded data by item/title match. Smoke ->
133/133.

Next: nothing outstanding on the backend - the full roadmap through Phase 13 is
built.
