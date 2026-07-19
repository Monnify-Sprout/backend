-- 0006_invoice_social_platform.sql - which platform the buyer's handle is on.
--
-- Nigerian social-commerce buyers are reached on a specific network, not a
-- generic "social handle". The same "@chidi_styles" lives on Instagram OR
-- Snapchat, and a WhatsApp buyer is a number/name, so the merchant needs to
-- record WHERE to contact them. Add an optional free-text platform label
-- (known values: instagram / whatsapp / facebook / snapchat, or anything the
-- merchant types under "Other"). Additive and idempotent - never destructive.

alter table invoices add column if not exists customer_social_platform text;
