# Sprout — Backend Context

Express + TypeScript API for Sprout, an APIConf Lagos x Monnify Developer Challenge
hackathon project. Read `../Sprout_PRD_v2.0.docx` and
`../Sprout_Claude_Code_Build_Plan_v2.md` before starting any phase — this file is
the summary, those are the source of truth.

## Stack

Express, TypeScript, Supabase (Postgres client, service-role key server-side only —
not Supabase Auth), JWT (our own auth), bcrypt, zod, dotenv.

## Core mechanic — pin this

Sprout holds one Monnify merchant contract. Every onboarded merchant is verified
personally by BVN or NIN, not by business registration, and becomes a sub-account
under Sprout's own master contract — never their own standalone Monnify merchant.
This is the entire product, not one feature of it.

## Two fee layers — keep distinct (PRD §7.3)

1. Monnify's own transaction fee — allocated via `feePercentage`.
2. Sprout's platform commission — a Sprout business decision, not a Monnify field.
   Applied via split config if Create Invoice supports it, otherwise the manual
   fallback (§7.3) — confirm which, in phase 3, before assuming either.

## Top risk — BVN/NIN is Live Mode only

Monnify's own docs state this feature only works in Live Mode. Build the real
verification code path, but gate it behind `MONNIFY_VERIFICATION_MODE`
(`live` | `mock`) so local dev and the hackathon demo can run without live access.
A mocked verification must never be indistinguishable from a real one in stored
records or logs.

## Second dependency — sub-account activation

Confirm Sprout's own Monnify contract has Sub-Account API access before phase 2.
This gates every merchant's onboarding, not one optional feature.

## Current phase

Phase 0 (scaffolding) complete. Next: Phase 1 — database schema & merchant auth.
