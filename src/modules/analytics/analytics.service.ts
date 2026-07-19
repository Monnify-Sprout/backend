import { query } from '../../lib/db';

// PRD §7.5 / FR-09 / FR-11 - one analytics engine, two data sources:
//   merchant           → its own paid invoices (payments ⋈ invoices)
//   connected account  → pulled external_transactions
// Both feed the SAME aggregation SQL over a normalised base row set
// (ts, amount, method, customer, item, settlement, commission), so the two
// scopes cannot drift apart in shape. A few metrics need data a connected
// account simply does not have (Sprout's settlement split; per-invoice items;
// the invoice lifecycle) - those are returned as null for the connected scope
// (top_items, funnel) or fall back to the gross figure (net_amount/fees_amount),
// so the frontend renders one component and only shows the merchant-only depth
// when it is present.

export interface AnalyticsScope {
  type: 'merchant' | 'connected_account';
  id: string;
}

interface Bucket {
  count: number;
  amount: number;
}

export interface AnalyticsResult {
  scope: AnalyticsScope;
  window_days: number;
  totals: {
    transaction_count: number;
    gross_amount: number;
    average_amount: number;
    largest_amount: number;
    net_amount: number;
    fees_amount: number;
    unique_customers: number;
  };
  trend: Array<{ date: string } & Bucket>;
  day_of_week: Array<{ day: string } & Bucket>;
  time_of_day: Array<{ bucket: string } & Bucket>;
  amount_ranges: Array<{ range: string } & Bucket>;
  payment_methods: Array<{ method: string } & Bucket>;
  top_customers: Array<{ customer: string } & Bucket>;
  // Merchant-only (connected transactions carry no per-item detail).
  top_items: Array<{ item: string } & Bucket> | null;
  // Merchant-only sales-by-category (Phase 11). Each row carries the category's
  // display colour; invoices with no category collapse into an "Uncategorised"
  // row (null colour). Null for a connected account, which has no categories.
  by_category: Array<{ category: string; color: string | null } & Bucket> | null;
  // Merchant-only sales-by-payment-link (Phase 12). Each row is one static
  // link's collections in the window. Null for a connected account.
  by_link: Array<{ link: string } & Bucket> | null;
  // Merchant-only invoice funnel: connected accounts expose settled money only,
  // with no invoice lifecycle to measure conversion against.
  funnel: {
    total_invoiced: Bucket;
    paid: Bucket;
    outstanding: Bucket;
    overdue: Bucket;
    cancelled: Bucket;
    collection_rate: number; // paid / total invoiced, by count (0..1)
    collection_rate_amount: number; // paid / total invoiced, by amount (0..1)
    avg_hours_to_payment: number | null;
  } | null;
}

// Normalised source rows per scope. Each exposes the SAME columns so the
// aggregation SQL below is identical for both. A connected account keeps all of
// its own money (Sprout takes no cut on read-only analytics), so settlement =
// amount and commission = 0; and it has no per-item breakdown, so item is null.
//
// The merchant scope is a UNION of two revenue streams so every metric below
// counts BOTH: paid Dynamic Invoices AND static-payment-link collections
// (Phase 12). Each row carries a `link` column (the link's title for a collection,
// null for an invoice) that mirrors `item` (the invoice's item, null for a
// collection), so top_items stays invoice-only and by_link stays link-only while
// totals/trend/methods/etc. cover both.
const MERCHANT_BASE = `
  select p.paid_at as ts,
         p.amount::float8 as amount,
         coalesce(p.payment_method, 'UNKNOWN') as method,
         coalesce(nullif(btrim(i.customer_name), ''),
                  nullif(btrim(i.customer_social_handle), ''),
                  nullif(btrim(i.customer_phone), ''),
                  nullif(btrim(i.customer_email), ''),
                  'Customer') as customer,
         nullif(btrim(i.item), '') as item,
         null::text as link,
         c.name as category,
         c.color as category_color,
         coalesce(p.settlement_amount, p.amount)::float8 as settlement,
         coalesce(p.commission_amount, 0)::float8 as commission
    from payments p
    join invoices i on i.id = p.invoice_id
    left join categories c on c.id = i.category_id
   where i.merchant_id = $1 and p.paid_at is not null
  union all
  select lp.paid_at as ts,
         lp.amount::float8 as amount,
         coalesce(lp.payment_method, 'UNKNOWN') as method,
         coalesce(nullif(btrim(lp.customer_name), ''), 'Customer') as customer,
         null::text as item,
         pl.title as link,
         plc.name as category,
         plc.color as category_color,
         coalesce(lp.settlement_amount, lp.amount)::float8 as settlement,
         coalesce(lp.commission_amount, 0)::float8 as commission
    from link_payments lp
    join payment_links pl on pl.id = lp.payment_link_id
    left join categories plc on plc.id = pl.category_id
   where pl.merchant_id = $1 and lp.paid_at is not null`;

const CONNECTED_BASE = `
  select t.transaction_date as ts,
         t.amount::float8 as amount,
         coalesce(t.payment_method, 'UNKNOWN') as method,
         coalesce(nullif(btrim(t.customer_name), ''), 'Customer') as customer,
         null::text as item,
         null::text as link,
         null::text as category,
         null::text as category_color,
         t.amount::float8 as settlement,
         0::float8 as commission
    from external_transactions t
   where t.connected_account_id = $1 and t.transaction_date is not null`;

interface AggregateRow {
  totals: AnalyticsResult['totals'];
  trend: AnalyticsResult['trend'] | null;
  day_of_week: AnalyticsResult['day_of_week'] | null;
  time_of_day: AnalyticsResult['time_of_day'] | null;
  amount_ranges: AnalyticsResult['amount_ranges'] | null;
  payment_methods: AnalyticsResult['payment_methods'] | null;
  top_customers: AnalyticsResult['top_customers'] | null;
  top_items: AnalyticsResult['top_items'];
  by_category: AnalyticsResult['by_category'];
  by_link: AnalyticsResult['by_link'];
}

async function aggregate(
  baseSql: string,
  scopeId: string,
  windowDays: number,
): Promise<AggregateRow> {
  const rows = await query<AggregateRow>(
    `with base as (${baseSql}),
     windowed as (select * from base where ts >= now() - make_interval(days => $2))
     select
       (select json_build_object(
          'transaction_count', count(*)::int,
          'gross_amount', coalesce(sum(amount), 0)::float8,
          'average_amount', coalesce(round(avg(amount)::numeric, 2), 0)::float8,
          'largest_amount', coalesce(max(amount), 0)::float8,
          'net_amount', coalesce(sum(settlement), 0)::float8,
          'fees_amount', coalesce(sum(commission), 0)::float8,
          'unique_customers', count(distinct customer)::int)
          from windowed) as totals,
       (select json_agg(json_build_object(
          'date', to_char(d.date, 'YYYY-MM-DD'),
          'count', d.count, 'amount', d.amount) order by d.date)
          from (select ts::date as date, count(*)::int as count,
                       sum(amount)::float8 as amount
                  from windowed group by 1) d) as trend,
       (select json_agg(json_build_object(
          'day', w.day, 'count', w.count, 'amount', w.amount) order by w.dow)
          from (select to_char(ts, 'Dy') as day,
                       extract(isodow from ts)::int as dow,
                       count(*)::int as count, sum(amount)::float8 as amount
                  from windowed group by 1, 2) w) as day_of_week,
       (select json_agg(json_build_object(
          'bucket', b.bucket, 'count', b.count, 'amount', b.amount) order by b.sort)
          from (select case
                         when extract(hour from ts) between 5 and 11 then 'Morning'
                         when extract(hour from ts) between 12 and 16 then 'Afternoon'
                         when extract(hour from ts) between 17 and 21 then 'Evening'
                         else 'Night'
                       end as bucket,
                       case
                         when extract(hour from ts) between 5 and 11 then 1
                         when extract(hour from ts) between 12 and 16 then 2
                         when extract(hour from ts) between 17 and 21 then 3
                         else 4
                       end as sort,
                       count(*)::int as count, sum(amount)::float8 as amount
                  from windowed group by 1, 2) b) as time_of_day,
       (select json_agg(json_build_object(
          'range', r.range, 'count', r.count, 'amount', r.amount) order by r.sort)
          from (select case
                         when amount < 5000 then '< ₦5k'
                         when amount < 20000 then '₦5k–20k'
                         when amount < 50000 then '₦20k–50k'
                         when amount < 100000 then '₦50k–100k'
                         else '₦100k+'
                       end as range,
                       case
                         when amount < 5000 then 1
                         when amount < 20000 then 2
                         when amount < 50000 then 3
                         when amount < 100000 then 4
                         else 5
                       end as sort,
                       count(*)::int as count, sum(amount)::float8 as amount
                  from windowed group by 1, 2) r) as amount_ranges,
       (select json_agg(json_build_object(
          'method', m.method, 'count', m.count, 'amount', m.amount)
          order by m.count desc)
          from (select method, count(*)::int as count,
                       sum(amount)::float8 as amount
                  from windowed group by 1) m) as payment_methods,
       (select json_agg(json_build_object(
          'customer', c.customer, 'count', c.count, 'amount', c.amount)
          order by c.amount desc)
          from (select customer, count(*)::int as count,
                       sum(amount)::float8 as amount
                  from windowed group by 1 order by sum(amount) desc limit 6) c)
          as top_customers,
       (select json_agg(json_build_object(
          'item', it.item, 'count', it.count, 'amount', it.amount)
          order by it.amount desc)
          from (select item, count(*)::int as count,
                       sum(amount)::float8 as amount
                  from windowed where item is not null
                 group by 1 order by sum(amount) desc limit 6) it) as top_items,
       (select json_agg(json_build_object(
          'category', g.category, 'color', g.color,
          'count', g.count, 'amount', g.amount) order by g.amount desc)
          from (select coalesce(category, 'Uncategorised') as category,
                       max(category_color) as color,
                       count(*)::int as count, sum(amount)::float8 as amount
                  from windowed group by 1 order by sum(amount) desc) g)
          as by_category,
       (select json_agg(json_build_object(
          'link', l.link, 'count', l.count, 'amount', l.amount)
          order by l.amount desc)
          from (select link, count(*)::int as count,
                       sum(amount)::float8 as amount
                  from windowed where link is not null
                 group by 1 order by sum(amount) desc limit 8) l) as by_link`,
    [scopeId, windowDays],
  );
  return rows[0]!;
}

// Merchant-only invoice funnel, windowed on when the invoice was CREATED (so it
// answers "of the invoices I raised in this period, how many got paid"), which
// is a different window than the money view above (windowed on paid_at).
async function funnelFor(
  merchantId: string,
  windowDays: number,
): Promise<NonNullable<AnalyticsResult['funnel']>> {
  const rows = await query<{
    funnel: Omit<NonNullable<AnalyticsResult['funnel']>, 'avg_hours_to_payment'>;
    avg_hours_to_payment: number | null;
  }>(
    `select
       json_build_object(
         'total_invoiced', json_build_object(
           'count', count(*)::int,
           'amount', coalesce(sum(amount), 0)::float8),
         'paid', json_build_object(
           'count', count(*) filter (where status = 'paid')::int,
           'amount', coalesce(sum(amount) filter (where status = 'paid'), 0)::float8),
         'outstanding', json_build_object(
           'count', count(*) filter (where status = 'pending')::int,
           'amount', coalesce(sum(amount) filter (where status = 'pending'), 0)::float8),
         'overdue', json_build_object(
           'count', count(*) filter (where status = 'expired')::int,
           'amount', coalesce(sum(amount) filter (where status = 'expired'), 0)::float8),
         'cancelled', json_build_object(
           'count', count(*) filter (where status = 'cancelled')::int,
           'amount', coalesce(sum(amount) filter (where status = 'cancelled'), 0)::float8),
         'collection_rate', case when count(*) = 0 then 0
           else round((count(*) filter (where status = 'paid'))::numeric
                      / count(*), 4)::float8 end,
         'collection_rate_amount', case when coalesce(sum(amount), 0) = 0 then 0
           else round(coalesce(sum(amount) filter (where status = 'paid'), 0)::numeric
                      / sum(amount), 4)::float8 end
       ) as funnel,
       (select round(avg(extract(epoch from (p.paid_at - i2.created_at)) / 3600.0)::numeric, 2)::float8
          from invoices i2
          join payments p on p.invoice_id = i2.id
         where i2.merchant_id = $1
           and i2.created_at >= now() - make_interval(days => $2)
           and i2.status = 'paid' and p.paid_at is not null) as avg_hours_to_payment
     from invoices
     where merchant_id = $1
       and created_at >= now() - make_interval(days => $2)`,
    [merchantId, windowDays],
  );
  const row = rows[0]!;
  return { ...row.funnel, avg_hours_to_payment: row.avg_hours_to_payment };
}

export async function analyticsFor(
  scope: AnalyticsScope,
  windowDays: number,
): Promise<AnalyticsResult> {
  const isMerchant = scope.type === 'merchant';
  const base = isMerchant ? MERCHANT_BASE : CONNECTED_BASE;
  const agg = await aggregate(base, scope.id, windowDays);
  const funnel = isMerchant ? await funnelFor(scope.id, windowDays) : null;

  return {
    scope,
    window_days: windowDays,
    totals: agg.totals,
    trend: agg.trend ?? [],
    day_of_week: agg.day_of_week ?? [],
    time_of_day: agg.time_of_day ?? [],
    amount_ranges: agg.amount_ranges ?? [],
    payment_methods: agg.payment_methods ?? [],
    top_customers: agg.top_customers ?? [],
    // Per-item detail only exists for the merchant's own invoices.
    top_items: isMerchant ? (agg.top_items ?? []) : null,
    // Categories are a merchant-only dimension (a connected account's pulled
    // transactions carry no category).
    by_category: isMerchant ? (agg.by_category ?? []) : null,
    // Payment links are a merchant-only dimension too.
    by_link: isMerchant ? (agg.by_link ?? []) : null,
    funnel,
  };
}
