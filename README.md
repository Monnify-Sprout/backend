# Sprout - Backend

Express + TypeScript API for Sprout (APIConf Lagos x Monnify Developer Challenge).
Merchants are verified by BVN/NIN and onboarded as sub-accounts under Sprout's own
master Monnify contract. See `CLAUDE.md` and `../Sprout_Claude_Code_Build_Plan_v2.md`
for the full context.

## Requirements

- Node.js >= 20
- A Supabase project (used as managed Postgres - not Supabase Auth)
- Monnify sandbox credentials for Sprout's master contract

## Setup

```bash
npm install
cp .env.example .env   # then fill in real values
```

Leave `MONNIFY_VERIFICATION_MODE=mock` for local dev - BVN/NIN verification is
Live Mode only on Monnify's side.

## Database

Migrations are plain SQL in `migrations/`, applied via a direct Postgres
connection (set `SUPABASE_DB_URL`):

```bash
npm run migrate        # applies unapplied migrations/*.sql, idempotently
```

Alternatively, paste `migrations/0001_init.sql` into the Supabase SQL editor.

## Run

```bash
npm run dev            # dev server with reload (tsx watch), default port 4000
npm run build          # compile to dist/
npm start              # run compiled output
```

Health check: `curl http://localhost:4000/health` → `{"status":"ok",...}`.

## Auth API (Phase 1)

- `POST /api/auth/register` - `{ business_name, owner_name, phone, email, password }`
- `POST /api/auth/login` - `{ email, password }` → `{ token, merchant }`
- `GET  /api/me` - protected; requires `Authorization: Bearer <token>`

A freshly registered merchant defaults to `verification_status: "pending"` and
`status: "onboarding"` - it is **not** `active` until Phase 2 completes.

End-to-end proof (server must be running against a migrated DB):

```bash
npm run smoke          # register → login → protected route + assertions
```

`requests.http` covers the same flow manually (VS Code REST Client / JetBrains).

## Quality

```bash
npm run lint           # ESLint
npm run format         # Prettier (write)
npm run format:check   # Prettier (check only)
```
