import { query } from '../../lib/db';

// PRD §7.5 / FR-09 / FR-11 - one analytics engine, two data sources:
//   merchant           → its own paid invoices (payments ⋈ invoices)
//   connected account  → pulled external_transactions
// Both feed the SAME aggregation SQL over a normalised base row set
// (ts, amount, method), so the two scopes cannot drift apart in shape.

export interface AnalyticsScope {
  type: 'merchant' | 'connected_account';
  id: string;
}

export interface AnalyticsResult {
  scope: AnalyticsScope;
  window_days: number;
  totals: {
    transaction_count: number;
    gross_amount: number;
    average_amount: number;
  };
  trend: Array<{ date: string; count: number; amount: number }>;
  day_of_week: Array<{ day: string; count: number; amount: number }>;
  amount_ranges: Array<{ range: string; count: number; amount: number }>;
  payment_methods: Array<{ method: string; count: number; amount: number }>;
}

// Normalised source rows per scope. Each must expose: ts, amount, method.
const MERCHANT_BASE = `
  select p.paid_at as ts, p.amount::float8 as amount,
         coalesce(p.payment_method, 'UNKNOWN') as method
    from payments p
    join invoices i on i.id = p.invoice_id
   where i.merchant_id = $1 and p.paid_at is not null`;

const CONNECTED_BASE = `
  select t.transaction_date as ts, t.amount::float8 as amount,
         coalesce(t.payment_method, 'UNKNOWN') as method
    from external_transactions t
   where t.connected_account_id = $1 and t.transaction_date is not null`;

interface AggregateRow {
  totals: AnalyticsResult['totals'];
  trend: AnalyticsResult['trend'] | null;
  day_of_week: AnalyticsResult['day_of_week'] | null;
  amount_ranges: AnalyticsResult['amount_ranges'] | null;
  payment_methods: AnalyticsResult['payment_methods'] | null;
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
          'average_amount', coalesce(round(avg(amount)::numeric, 2), 0)::float8)
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
                  from windowed group by 1) m) as payment_methods`,
    [scopeId, windowDays],
  );
  return rows[0]!;
}

export async function analyticsFor(
  scope: AnalyticsScope,
  windowDays: number,
): Promise<AnalyticsResult> {
  const base = scope.type === 'merchant' ? MERCHANT_BASE : CONNECTED_BASE;
  const agg = await aggregate(base, scope.id, windowDays);
  return {
    scope,
    window_days: windowDays,
    totals: agg.totals,
    trend: agg.trend ?? [],
    day_of_week: agg.day_of_week ?? [],
    amount_ranges: agg.amount_ranges ?? [],
    payment_methods: agg.payment_methods ?? [],
  };
}
