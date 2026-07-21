-- 0010_streams_workspace.sql - streams become the workspace scope (Phase 14).
--
-- Phase 13 introduced streams as an OPTIONAL tag on an invoice/link ("Unassigned"
-- was valid). This phase reframes a stream as the active WORKSPACE context (the
-- Supabase-organization model): a header switcher picks the current stream and
-- invoices, payment links, the dashboard and merchant analytics are all filtered
-- through it. To make that work every merchant needs exactly one DEFAULT stream,
-- and every existing invoice/link must belong to a stream (no more nulls).
--
-- With a single stream the app looks and behaves exactly as it did before - the
-- scoping is invisible until a second stream exists.
--
-- Locked decisions this migration encodes:
--   * Default stream is named "<business name> - Main", tracking-only (no
--     settlement account, so it settles to the merchant's own account like an
--     unassigned invoice did before).
--   * One default per merchant (partial unique index).
--   * Categories and connected accounts stay MERCHANT-level and are untouched.
--
-- Additive and idempotent - never destructive. The stream_id FKs stay
-- ON DELETE SET NULL (safety net); "everything belongs to a stream" is enforced
-- by the app (create-time auto-assign) + this backfill, not by a NOT NULL column.

-- 1. Mark the default stream ------------------------------------------------
alter table streams
  add column if not exists is_default boolean not null default false;

-- At most one default per merchant.
create unique index if not exists streams_one_default_per_merchant
  on streams(merchant_id) where is_default;

-- 2. Give every merchant a default stream -----------------------------------
-- Create "<business name> - Main" for any merchant that has no default yet.
-- ON CONFLICT DO NOTHING guards the (merchant_id, lower(name)) unique index in
-- the rare case a stream with that exact name already exists.
insert into streams (merchant_id, name, is_default)
select m.id, m.business_name || ' - Main', true
  from merchants m
 where not exists (
   select 1 from streams s
    where s.merchant_id = m.id and s.is_default
 )
on conflict do nothing;

-- Cover the rare skip above: if a merchant already had a stream literally named
-- "<business> - Main", promote it to the default so they still have exactly one.
update streams s
   set is_default = true
  from merchants m
 where s.merchant_id = m.id
   and lower(s.name) = lower(m.business_name || ' - Main')
   and not exists (
     select 1 from streams s2
      where s2.merchant_id = s.merchant_id and s2.is_default
   );

-- 3. Backfill every unassigned invoice/link onto the merchant's default -----
update invoices i
   set stream_id = d.id
  from streams d
 where d.merchant_id = i.merchant_id
   and d.is_default
   and i.stream_id is null;

update payment_links pl
   set stream_id = d.id
  from streams d
 where d.merchant_id = pl.merchant_id
   and d.is_default
   and pl.stream_id is null;
