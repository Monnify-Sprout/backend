-- 0003_invoices_payments.sql - Phase 3 (invoice creation, webhook, settlement).
-- Reference: PRD v2.0 §7.2, §7.3, §11, FR-04..FR-07, FR-12.
--
-- The invoices/payments tables exist from 0001; Phase 3 adds the few fields the
-- Monnify Dynamic-Invoicing + settlement flow needs.

-- Our own unique reference sent to Monnify's Create Invoice API (Monnify echoes it
-- back). Also the natural idempotency/lookup key for an invoice.
alter table invoices
  add column if not exists invoice_reference text;

-- Monnify's Create Invoice requires a customer email; the MVP form may not collect
-- it, in which case the service synthesises a placeholder.
alter table invoices
  add column if not exists customer_email text;

create unique index if not exists invoices_invoice_reference_key
  on invoices(invoice_reference);
create index if not exists invoices_txn_ref_idx
  on invoices(monnify_transaction_reference);

-- Settlement outcome recorded per payment (PRD §7.3): what the merchant receives
-- vs Sprout's commission, whichever settlement path was used.
alter table payments
  add column if not exists settlement_amount numeric(14, 2);
alter table payments
  add column if not exists commission_amount numeric(14, 2);
