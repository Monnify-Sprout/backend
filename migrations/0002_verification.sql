-- 0002_verification.sql - Phase 2 (BVN/NIN verification & sub-account creation).
-- Reference: PRD v2.0 §5, §7.1, §11.
--
-- The merchant verification columns themselves (bvn_or_nin_ref, verification_status,
-- verification_reason, sub_account_code) already exist from 0001. Phase 2 adds a
-- flag recording HOW a verification was produced, plus when it happened.

-- Which Monnify mode produced the current verification_status. 'mock' means the
-- BVN/NIN check was simulated (Monnify's real check is Live-Mode-only, PRD §5) and
-- must never be mistaken for a real KYC pass - enforced in the DB, not just in logs.
alter table merchants
  add column if not exists verification_mode text
    check (verification_mode in ('live', 'mock'));

alter table merchants
  add column if not exists verified_at timestamptz;

comment on column merchants.verification_mode is
  'live | mock - mock verifications are simulated (dev/hackathon) and are NOT real KYC.';
