-- 0001_init.sql - Sprout initial schema (Phase 1)
-- Reference: PRD v2.0 §10 (Minimum Data Model), §9 (Functional Requirements).
--
-- Design notes:
--   * UUID primary keys via pgcrypto's gen_random_uuid().
--   * Status/verification lifecycles are modelled as separate fields - a merchant
--     is NOT 'active' until Phase 2's BVN/NIN verification and sub-account creation
--     both succeed.
--   * Enum-like columns use text + CHECK constraints (cheaper to extend in later
--     phases than real Postgres enums).

create extension if not exists pgcrypto;

-- Shared trigger to keep updated_at fresh on every UPDATE.
create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

-- merchants ----------------------------------------------------------------
create table if not exists merchants (
  id                  uuid primary key default gen_random_uuid(),
  business_name       text not null,
  owner_name          text not null,
  phone               text not null,
  email               text not null,
  password_hash       text not null,
  -- BVN/NIN reference is captured in Phase 2, not at registration.
  bvn_or_nin_ref      text,
  -- Verification lifecycle: pending -> verified | failed (Phase 2).
  verification_status text not null default 'pending'
    check (verification_status in ('pending', 'verified', 'failed')),
  -- Stored reason for a failed verification, for the admin-review flow (FR-14).
  verification_reason text,
  -- Monnify sub-account under Sprout's master contract (set in Phase 2).
  sub_account_code    text,
  -- Account lifecycle: 'onboarding' until Phase 2 completes, then 'active'.
  status              text not null default 'onboarding'
    check (status in ('onboarding', 'active', 'suspended')),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint merchants_email_unique unique (email),
  constraint merchants_phone_unique unique (phone)
);

drop trigger if exists merchants_set_updated_at on merchants;
create trigger merchants_set_updated_at
  before update on merchants
  for each row execute function set_updated_at();

-- connected_accounts (Phase 4) ---------------------------------------------
-- Merchants who already have their own direct Monnify account can connect it
-- read-only. Credentials are encrypted at rest (Phase 4) - the *_ref columns
-- hold ciphertext, never plaintext.
create table if not exists connected_accounts (
  id                     uuid primary key default gen_random_uuid(),
  merchant_id            uuid not null references merchants(id) on delete cascade,
  business_name          text not null,
  monnify_api_key_ref    text not null,
  monnify_secret_key_ref text not null,
  contract_code          text not null,
  last_synced_at         timestamptz,
  status                 text not null default 'connected'
    check (status in ('connected', 'disconnected', 'error')),
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

drop trigger if exists connected_accounts_set_updated_at on connected_accounts;
create trigger connected_accounts_set_updated_at
  before update on connected_accounts
  for each row execute function set_updated_at();

create index if not exists connected_accounts_merchant_idx
  on connected_accounts(merchant_id);

-- invoices (Phase 3) -------------------------------------------------------
create table if not exists invoices (
  id                            uuid primary key default gen_random_uuid(),
  merchant_id                   uuid not null references merchants(id) on delete cascade,
  customer_name                 text not null,
  description                   text,
  amount                        numeric(14, 2) not null check (amount > 0),
  currency                      text not null default 'NGN',
  due_date                      date,
  status                        text not null default 'pending'
    check (status in ('pending', 'paid', 'expired', 'cancelled')),
  -- Monnify Dynamic Invoicing artefacts (Phase 3).
  monnify_transaction_reference text,
  virtual_account_number        text,
  checkout_url                  text,
  -- Which settlement path was used (PRD §7.3): 'split' | 'manual'.
  settlement_path               text check (settlement_path in ('split', 'manual')),
  created_at                    timestamptz not null default now(),
  updated_at                    timestamptz not null default now()
);

drop trigger if exists invoices_set_updated_at on invoices;
create trigger invoices_set_updated_at
  before update on invoices
  for each row execute function set_updated_at();

create index if not exists invoices_merchant_idx on invoices(merchant_id);
create index if not exists invoices_status_idx on invoices(status);

-- payments (Phase 3) -------------------------------------------------------
create table if not exists payments (
  id                            uuid primary key default gen_random_uuid(),
  invoice_id                    uuid not null references invoices(id) on delete cascade,
  amount                        numeric(14, 2) not null,
  currency                      text not null default 'NGN',
  payment_method                text,
  monnify_transaction_reference text,
  -- Webhook idempotency key (Phase 3): replaying a webhook must be a no-op.
  event_key                     text,
  paid_at                       timestamptz,
  raw                           jsonb,
  created_at                    timestamptz not null default now(),
  constraint payments_event_key_unique unique (event_key)
);

create index if not exists payments_invoice_idx on payments(invoice_id);

-- external_transactions (Phase 4) ------------------------------------------
-- Transaction history pulled from a connected account's own Monnify contract.
create table if not exists external_transactions (
  id                   uuid primary key default gen_random_uuid(),
  connected_account_id uuid not null references connected_accounts(id) on delete cascade,
  monnify_reference    text not null,
  amount               numeric(14, 2) not null,
  currency             text not null default 'NGN',
  payment_method       text,
  customer_name        text,
  transaction_date     timestamptz,
  raw                  jsonb,
  created_at           timestamptz not null default now(),
  -- A transaction reference is unique within a connected account.
  constraint external_transactions_ref_unique
    unique (connected_account_id, monnify_reference)
);

create index if not exists external_transactions_account_idx
  on external_transactions(connected_account_id);

-- Row Level Security --------------------------------------------------------
-- The API talks to Postgres only with the service-role key, which bypasses RLS.
-- Enabling RLS with no policies denies the anon/public key by default, so a
-- leaked anon key cannot read these tables.
alter table merchants            enable row level security;
alter table connected_accounts   enable row level security;
alter table invoices             enable row level security;
alter table payments             enable row level security;
alter table external_transactions enable row level security;
