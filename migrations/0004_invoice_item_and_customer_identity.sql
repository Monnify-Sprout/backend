-- 0004_invoice_item_and_customer_identity.sql - pre-Phase-8 data-model refinements.
--
-- Two changes to how an invoice describes a sale and its buyer, driven by the
-- realities of Nigerian social commerce (Instagram/WhatsApp vendors):
--
-- 1. Split the single free-text `description` into a required `item` (what was
--    bought) and an optional `notes`. `description` is left in place (unused by
--    the app going forward) so this migration never destroys existing data.
--
-- 2. A buyer is often known only by a handle or a phone number, not a legal
--    name. Add `customer_phone` and `customer_social_handle`, drop the NOT NULL
--    on `customer_name`, and require that AT LEAST ONE identifier is present.

alter table invoices add column if not exists item text;
alter table invoices add column if not exists notes text;
alter table invoices add column if not exists customer_phone text;
alter table invoices add column if not exists customer_social_handle text;

-- Preserve existing sales: their old free-text description becomes the item.
update invoices set item = description
  where item is null and description is not null;

-- A name is no longer mandatory (a buyer may be just "@chidi_styles").
alter table invoices alter column customer_name drop not null;

-- ...but an invoice must still identify its buyer somehow. Guarded so the
-- migration stays idempotent (Postgres has no ADD CONSTRAINT IF NOT EXISTS).
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'invoices_customer_identity_present'
  ) then
    alter table invoices
      add constraint invoices_customer_identity_present
      check (
        customer_name is not null
        or customer_phone is not null
        or customer_email is not null
        or customer_social_handle is not null
      );
  end if;
end $$;
