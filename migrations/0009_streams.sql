-- 0009_streams.sql - revenue streams (Phase 13).
--
-- A stream is how a merchant subdivides THEIR OWN activity: a shop branch, a
-- market stall, the Instagram page vs the WhatsApp catalogue, a sales rep, a
-- weekend pop-up, or a second brand run from the same account. It answers
-- "where (or through whom) did this sale come from", a different dimension from
-- categories ("what was sold"). Named "streams" deliberately - "sub-account"
-- already means the Monnify sub-account representing the merchant under
-- Sprout's master contract, and "branch" implies only the physical-shop case.
--
-- Streams do BOTH tracking and money routing (DECIDED 2026-07-20):
--   * Tracking-only stream: just a label - settlement columns stay null and its
--     revenue settles to the merchant's own account as usual.
--   * Routed stream: carries its OWN settlement bank account and gets its OWN
--     Monnify sub-account under Sprout's contract (sub_account_code below); on
--     the split settlement path, invoices/links assigned to it settle there.
--
-- Design notes (consistent with earlier migrations):
--   * UUID primary keys, created_at/updated_at with the shared set_updated_at trigger.
--   * Names are unique per merchant, case-insensitively (functional index).
--   * Settlement destination is all-or-nothing: bank code + account number
--     together or neither (CHECK below); the bank/account NAMES are display-only.
--   * status: 'active' <-> 'archived' (reversible). An archived stream keeps its
--     history but cannot be assigned to new invoices/links (service-enforced).
--     Deleting is allowed only while nothing references the stream (service);
--     the FKs are ON DELETE SET NULL as a safety net, never destructive.
-- Additive and idempotent - never destructive.

-- streams ------------------------------------------------------------------
create table if not exists streams (
  id                        uuid primary key default gen_random_uuid(),
  merchant_id               uuid not null references merchants(id) on delete cascade,
  name                      text not null check (btrim(name) <> ''),
  -- Optional per-stream settlement destination (money routing). Mirrors the
  -- merchant-level columns from migration 0005.
  settlement_bank_code      text,
  settlement_bank_name      text,
  settlement_account_number text,
  settlement_account_name   text,
  -- The stream's own Monnify sub-account, set when a settlement account is
  -- attached. Null = tracking-only (revenue settles to the merchant's account).
  sub_account_code          text,
  status                    text not null default 'active'
    check (status in ('active', 'archived')),
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  -- A settlement destination is bank code + account number together, or neither.
  constraint streams_settlement_all_or_none
    check ((settlement_bank_code is null) = (settlement_account_number is null))
);

drop trigger if exists streams_set_updated_at on streams;
create trigger streams_set_updated_at
  before update on streams
  for each row execute function set_updated_at();

create index if not exists streams_merchant_idx on streams(merchant_id);

-- One stream name per merchant, case-insensitive.
create unique index if not exists streams_merchant_name_unique
  on streams(merchant_id, lower(name));

-- invoices.stream_id --------------------------------------------------------
alter table invoices
  add column if not exists stream_id uuid references streams(id) on delete set null;

create index if not exists invoices_stream_idx on invoices(stream_id);

-- payment_links.stream_id ---------------------------------------------------
alter table payment_links
  add column if not exists stream_id uuid references streams(id) on delete set null;

create index if not exists payment_links_stream_idx on payment_links(stream_id);

-- Row Level Security (matches the other tables: no policies => anon key denied).
alter table streams enable row level security;
