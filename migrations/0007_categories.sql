-- 0007_categories.sql - merchant-defined categories (Phase 11).
--
-- A merchant tags each invoice with an optional category (a name + a colour) so
-- their analytics can break sales down by their own dimensions (e.g. "Fabric" vs
-- "Ready-to-wear"). Categories belong to a single merchant and are reused across
-- invoices; a future phase may also tag connected-account transactions.
--
-- Design notes (consistent with earlier migrations):
--   * UUID primary key, created_at/updated_at with the shared set_updated_at trigger.
--   * Colour is a required #rrggbb hex, CHECK-constrained (cheap to validate here).
--   * Category names are unique per merchant, case-insensitively, via a functional
--     unique index - so "Fabric" and "fabric" cannot both exist for one merchant.
--   * invoices.category_id is a nullable FK with ON DELETE SET NULL: deleting a
--     category un-categorises its invoices, it never deletes them.
-- Additive and idempotent - never destructive.

-- categories ---------------------------------------------------------------
create table if not exists categories (
  id          uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references merchants(id) on delete cascade,
  name        text not null check (btrim(name) <> ''),
  -- Display colour as a #rrggbb hex string (validated; the UI offers a palette).
  color       text not null check (color ~ '^#[0-9a-fA-F]{6}$'),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

drop trigger if exists categories_set_updated_at on categories;
create trigger categories_set_updated_at
  before update on categories
  for each row execute function set_updated_at();

create index if not exists categories_merchant_idx on categories(merchant_id);

-- One category name per merchant, case-insensitive.
create unique index if not exists categories_merchant_name_unique
  on categories(merchant_id, lower(name));

-- invoices.category_id -----------------------------------------------------
alter table invoices
  add column if not exists category_id uuid references categories(id) on delete set null;

create index if not exists invoices_category_idx on invoices(category_id);

-- Row Level Security (matches the other tables: no policies => anon key denied).
alter table categories enable row level security;
