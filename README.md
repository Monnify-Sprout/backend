# Sprout — Backend

Express + TypeScript API for **Sprout** (APIConf Lagos × Monnify Developer Challenge).
Sprout holds a single Monnify master contract and onboards each merchant — verified
personally by **BVN or NIN** — as a **sub-account** under that contract, so a solo
trader or social-commerce seller gets a real payment account without registering their
own Monnify merchant. On top of that it powers invoices, reusable payment links,
categories, revenue streams (with money routing), a public buyer-facing pay page, and a
unified analytics view.

> **This is one of two repositories.** The web app lives in a separate repo:
> **[Monnify-Sprout/frontend](https://github.com/Monnify-Sprout/frontend)**. For the
> full experience run both — this API on `:4000` and the frontend on `:3000`. This
> README is self-contained: follow it to get the whole stack running locally.

---

## What you'll run

| Repo | What it is | Stack | Port |
| --- | --- | --- | --- |
| **backend** (this repo) | REST API | Express + TypeScript, Postgres via `pg` | `4000` |
| [frontend](https://github.com/Monnify-Sprout/frontend) | Web app | Next.js (App Router) + TypeScript | `3000` |

The frontend proxies `/api/*` to this backend, so both must be running for the app to
work end to end.

---

## 1. Prerequisites

- **Node.js ≥ 20** and npm — check with `node -v`.
- **Git**.
- A **Supabase project** — used purely as managed Postgres (not Supabase Auth, not the
  `supabase-js` client). A free project is enough; you only need its **database
  connection string**.
- **Monnify sandbox credentials** — *optional.* The app defaults to a deterministic
  **mock** provider, so local dev and the demo run with no Monnify account. You only
  need real credentials if you set `MONNIFY_VERIFICATION_MODE=live`.

> **Why mock is the default:** Monnify's BVN/NIN verification only works in **Live
> Mode**, which is unavailable in sandbox. The mock provider returns deterministic,
> clearly-flagged responses so nothing is blocked on live access.

---

## 2. Clone and install

```bash
git clone git@github.com:Monnify-Sprout/backend.git
cd backend
npm install
cp .env.example .env      # then fill in real values (step 4)
```

---

## 3. Set up the database (Supabase)

1. Create a project at [supabase.com](https://supabase.com) (or use an existing one).
2. Go to **Project Settings → Database → Connection string → URI**.
3. Copy the **Shared Pooler** string in **session mode** (port `5432`) — it works on
   IPv4 networks:

   ```
   postgresql://postgres.<project-ref>:<db-password>@aws-0-<region>.pooler.supabase.com:5432/postgres
   ```

4. **Percent-encode any special characters** in the password (e.g. `@` → `%40`).

You'll paste this into `.env` as `SUPABASE_DB_URL` next.

---

## 4. Configure `.env`

Open `.env` and fill in the values. Minimum for local dev:

| Variable | What to set | Notes |
| --- | --- | --- |
| `PORT` | `4000` | Leave as-is unless taken. |
| `SUPABASE_DB_URL` | Your Supabase URI from step 3 | **Required.** |
| `MONNIFY_VERIFICATION_MODE` | `mock` | Keep `mock` for local dev/demo. |
| `JWT_SECRET` | A long random string (≥ 16 chars) | e.g. `openssl rand -hex 32`. |
| `JWT_EXPIRES_IN` | `1h` | Token lifetime. |
| `CREDENTIALS_ENCRYPTION_KEY` | 32-byte hex | e.g. `openssl rand -hex 32`. Encrypts connected-account creds. |
| `MONNIFY_API_KEY` / `MONNIFY_SECRET_KEY` / `MONNIFY_CONTRACT_CODE` / `MONNIFY_BASE_URL` | Sandbox values | Only used when mode is `live`; leave the placeholders for mock. |
| `MONNIFY_WEBHOOK_SECRET` | Webhook signing secret | Only needed for live webhooks. |

> **Generate secrets quickly:**
> ```bash
> openssl rand -hex 32     # use for JWT_SECRET and CREDENTIALS_ENCRYPTION_KEY
> ```

---

## 5. Create the schema (migrations)

Apply the SQL migrations to your Supabase database:

```bash
npm run migrate
```

Applies every unapplied file in `migrations/*.sql` **idempotently** — safe to re-run.
Creates the merchants, invoices, payments, categories, payment links, and streams
tables.

> **Alternative:** paste `migrations/0001_init.sql` (then the later files, in order)
> into the Supabase **SQL Editor**.

---

## 6. Run the backend

```bash
npm run dev        # tsx watch — reloads on change, serves on http://localhost:4000
```

Verify in another terminal:

```bash
curl http://localhost:4000/health
# → {"status":"ok",...}
```

Leave this terminal running.

---

## 7. (Recommended) Seed demo data

In a new terminal:

```bash
npm run seed
```

Idempotently creates a verified **Active** demo merchant (**`demo@sprout.test`**), ~10
of its invoices (paid / pending / overdue, backdated across ~3 weeks), demo categories,
payment links with collections, revenue streams, and a second "connected" Monnify
account with synced history. Requires `MONNIFY_VERIFICATION_MODE=mock`. **Run this
before a demo** so the dashboard has real data; re-run any time to reset.

---

## 8. Run the frontend (the other repo)

To use the actual UI, clone and run
**[Monnify-Sprout/frontend](https://github.com/Monnify-Sprout/frontend)** alongside
this API:

```bash
# in a separate folder
git clone git@github.com:Monnify-Sprout/frontend.git
cd frontend
npm install
cp .env.example .env.local     # defaults to http://localhost:4000 — no secrets
npm run dev                    # http://localhost:3000  (add `-- -p 3001` if 3000 is taken)
```

Its full setup lives in that repo's README. With both servers up, open
**http://localhost:3000** and register or sign in.

---

## 9. Verify it works

```bash
npm run smoke        # register → login → protected routes + assertions
```

A green run (e.g. `133/133`) confirms the API + DB are wired correctly. `requests.http`
covers the same flow manually (VS Code REST Client / JetBrains).

---

## API surface (high level)

- **Auth:** `POST /api/auth/register`, `POST /api/auth/login`, protected `GET /api/me`.
- **Verification:** protected `POST /api/verification` — BVN/NIN → verify → create
  sub-account → `active`. Requires the merchant's settlement bank account.
- **Invoices:** protected `POST /api/invoices`, `GET /api/invoices`,
  `GET /api/invoices/:id`; public `GET /api/public/invoices/:reference` (buyer-safe
  subset).
- **Payment links:** protected `GET/POST /api/payment-links`,
  `GET /api/payment-links/:id`, `PATCH /api/payment-links/:id/status`,
  mock-only `POST /api/payment-links/:id/simulate-collection`; public
  `GET /api/public/links/:slug`.
- **Categories:** protected `GET/POST /api/categories`, `PATCH/DELETE /api/categories/:id`.
- **Streams:** protected `GET/POST /api/streams`, `PATCH /api/streams/:id`,
  `PATCH /api/streams/:id/status`, `DELETE /api/streams/:id`.
- **Connected accounts:** protected `POST/GET /api/connected-accounts`,
  `POST /api/connected-accounts/:id/sync`, `DELETE /api/connected-accounts/:id`.
- **Analytics:** protected `GET /api/analytics[?connected_account_id][&days]`.
- **Webhooks:** `POST /api/webhooks/monnify` — HMAC-SHA512 over the raw body, idempotent,
  verifies before marking paid.

A freshly registered merchant is `verification_status: "pending"` /
`status: "onboarding"` — **not** `active` until verification completes.
Monnify sits behind a provider abstraction (`src/lib/monnify/`) selected by
`MONNIFY_VERIFICATION_MODE`.

---

## Commands

```bash
npm run dev            # dev server with reload (port 4000)
npm run migrate        # apply migrations/*.sql (idempotent)
npm run seed           # load/reset demo data (mock mode)
npm run smoke          # end-to-end API assertions
npm run build          # compile to dist/
npm start              # run compiled output
npm run lint           # ESLint
npm run format         # Prettier (write)
npm run format:check   # Prettier (check only)
```

---

## Troubleshooting

- **`/health` fails / backend won't start** — check `SUPABASE_DB_URL` and that the
  password is percent-encoded; confirm you used the **session pooler** string (port
  `5432`).
- **Migrations can't connect** — same as above; the session pooler is what works on
  IPv4. Fall back to the Supabase SQL Editor (step 5).
- **Verification "just works" with fake BVN/NIN** — expected in `mock` mode.
  Deterministic quirks: a BVN/NIN ending in `0000` fails verification; an external api
  key ending in `BAD` fails connection — useful for testing error paths.
- **Node version errors** — this backend requires Node ≥ 20 (`node -v`).

---

## Further reading

- [`CLAUDE.md`](CLAUDE.md) — endpoints, provider abstraction, fee/settlement model.
- Frontend repo: **[Monnify-Sprout/frontend](https://github.com/Monnify-Sprout/frontend)**.
