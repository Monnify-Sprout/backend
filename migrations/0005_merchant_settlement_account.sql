-- 0005_merchant_settlement_account.sql - collect the merchant's settlement bank
-- account (DECIDED 2026-07-18).
--
-- This is where each merchant's share of every payment settles. Monnify's live
-- Create-Sub-Account requires a bank code + NUBAN account number; we also keep
-- the bank/account NAMES for display. Collected at the verification step (that
-- is when the sub-account / payout destination is created), enforced there.
--
-- Columns are nullable at the DB level so existing verified merchants (seeded
-- before this) are untouched; new verifications require them at the API layer.

alter table merchants add column if not exists settlement_bank_code text;
alter table merchants add column if not exists settlement_bank_name text;
alter table merchants add column if not exists settlement_account_number text;
alter table merchants add column if not exists settlement_account_name text;
