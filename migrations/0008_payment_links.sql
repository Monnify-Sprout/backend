-- 0008_payment_links.sql - static (reusable) payment links (Phase 12).
--
-- A payment link is a long-lived, reusable way to collect money: unlike a
-- Dynamic Invoice (one buyer, one payment, then terminal), one link is shared
-- widely and receives MANY payments over its life ("collections"). It is backed
-- by a Monnify reserved (permanent) account, so the same account number / checkout
-- keeps accepting transfers.
--
-- Two entities, deliberately separate from invoices/payments:
--   * payment_links  - the reusable link itself (a merchant's product/campaign).
--   * link_payments  - each collection received against a link (one-to-many).
-- Keeping collections in their own table (rather than making payments.invoice_id
-- nullable) leaves every existing invoice query untouched.
--
-- Design notes (consistent with earlier migrations):
--   * UUID primary keys, created_at/updated_at with the shared set_updated_at trigger.
--   * amount is NULLABLE: null means "buyer enters the amount" (a donation/top-up
--     style link); a value means a fixed price. CHECK keeps a set amount positive.
--   * status lifecycle: 'active' (accepting) -> 'paused' (temporarily off, reversible)
--     -> or 'ended' (closed permanently). Transitions are enforced in the service.
--   * category_id reuses Phase 11 categories (ON DELETE SET NULL) so link revenue
--     joins the same analytics breakdowns as invoices.
--   * slug is the public URL identifier (globally unique), like invoice_reference.
--   * link_payments mirrors payments: a unique event_key makes a replayed webhook a
--     no-op, and settlement_amount/commission_amount record the split per collection.
-- Additive and idempotent - never destructive.

-- payment_links ------------------------------------------------------------
create table if not exists payment_links (
  id                          uuid primary key default gen_random_uuid(),
  merchant_id                 uuid not null references merchants(id) on delete cascade,
  title                       text not null check (btrim(title) <> ''),
  -- Optional "what this is for" line, shown to the buyer.
  item                        text,
  -- Public URL identifier (the shared link), globally unique.
  slug                        text not null,
  -- NULL = buyer enters the amount; a value = fixed price (must be > 0).
  amount                      numeric(14, 2) check (amount is null or amount > 0),
  currency                    text not null default 'NGN',
  status                      text not null default 'active'
    check (status in ('active', 'paused', 'ended')),
  category_id                 uuid references categories(id) on delete set null,
  -- Monnify reserved (permanent) account artefacts.
  reserved_account_reference  text,
  reserved_account_number     text,
  reserved_account_bank_name  text,
  checkout_url                text,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now()
);

drop trigger if exists payment_links_set_updated_at on payment_links;
create trigger payment_links_set_updated_at
  before update on payment_links
  for each row execute function set_updated_at();

create index if not exists payment_links_merchant_idx on payment_links(merchant_id);
create index if not exists payment_links_status_idx on payment_links(status);
create unique index if not exists payment_links_slug_key on payment_links(slug);
-- The webhook finds a link by the reserved account reference Monnify echoes back.
create index if not exists payment_links_reserved_ref_idx
  on payment_links(reserved_account_reference);

-- link_payments (collections) ----------------------------------------------
create table if not exists link_payments (
  id                            uuid primary key default gen_random_uuid(),
  payment_link_id               uuid not null references payment_links(id) on delete cascade,
  amount                        numeric(14, 2) not null,
  currency                      text not null default 'NGN',
  payment_method                text,
  -- What Monnify (or the buyer) supplied about who paid; optional.
  customer_name                 text,
  monnify_transaction_reference text,
  -- Webhook idempotency key: replaying a collection webhook must be a no-op.
  event_key                     text,
  -- Settlement split recorded per collection (PRD §7.3), same as payments.
  settlement_amount             numeric(14, 2),
  commission_amount             numeric(14, 2),
  paid_at                       timestamptz,
  raw                           jsonb,
  created_at                    timestamptz not null default now(),
  constraint link_payments_event_key_unique unique (event_key)
);

create index if not exists link_payments_link_idx on link_payments(payment_link_id);

-- Row Level Security (matches the other tables: no policies => anon key denied).
alter table payment_links enable row level security;
alter table link_payments enable row level security;
