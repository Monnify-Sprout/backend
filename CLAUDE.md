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

Phases 1–8 **complete and verified end to end** against the live Supabase DB
(`npm run smoke` → 74/74). Migrations in `migrations/` (`npm run migrate`).

Endpoints (all DB access via `pg`):
- `POST /api/auth/register`, `POST /api/auth/login`, protected `GET /api/me`
- protected `POST /api/verification` - BVN/NIN → verify → create sub-account →
  `active`. Also REQUIRES the merchant's settlement bank account (bank code +
  NUBAN, names optional; migration 0005), stored on the merchant and passed to
  Create-Sub-Account (DECIDED 2026-07-18; mock ignores it for its stub code)
- protected `POST /api/invoices` (create Dynamic Invoice), `GET /api/invoices`,
  `GET /api/invoices/:id` (invoice + payment/settlement). An invoice is a
  required `item` plus optional `notes` (migration 0004 split the old
  `description`); the buyer needs at least one of name/phone/email/social handle
  (name is NOT required - social-commerce buyers may be just a handle), enforced
  by a zod refine and a DB CHECK. Monnify's description is composed from
  item+notes and its required customerName falls back through handle/phone.
- `POST /api/webhooks/monnify` - no auth; HMAC-SHA512 signature over the RAW body
  (captured in `index.ts`), idempotent via `payments.event_key`, confirms with
  Verify Transaction before marking Paid (never trusts the payload)
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
  merchant and connected scopes return identical shapes (totals, trend,
  day-of-week, amount ranges, payment-method mix)

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

Next: Phase 9a - seed script (Phase 8 is frontend-only).
