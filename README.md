# Sprout — Backend

Express + TypeScript API for Sprout (APIConf Lagos x Monnify Developer Challenge).
Merchants are verified by BVN/NIN and onboarded as sub-accounts under Sprout's own
master Monnify contract. See `CLAUDE.md` and `../Sprout_Claude_Code_Build_Plan_v2.md`
for the full context.

## Requirements

- Node.js >= 20
- A Supabase project (used as managed Postgres — not Supabase Auth)
- Monnify sandbox credentials for Sprout's master contract

## Setup

```bash
npm install
cp .env.example .env   # then fill in real values
```

Leave `MONNIFY_VERIFICATION_MODE=mock` for local dev — BVN/NIN verification is
Live Mode only on Monnify's side.

## Run

```bash
npm run dev            # dev server with reload (tsx watch), default port 4000
npm run build          # compile to dist/
npm start              # run compiled output
```

Smoke test: `curl http://localhost:4000/health` → `{"status":"ok",...}`.

## Quality

```bash
npm run lint           # ESLint
npm run format         # Prettier (write)
npm run format:check   # Prettier (check only)
```
