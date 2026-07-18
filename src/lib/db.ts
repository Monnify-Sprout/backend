import { Pool, type QueryResultRow } from 'pg';

import { env } from '../config/env';

// Single shared connection pool to Supabase Postgres via the session pooler.
// We treat Supabase as plain managed Postgres (no supabase-js, no PostgREST) -
// this avoids the REST schema-cache lag and keeps raw SQL available for the
// Phase 4 analytics aggregations.
export const pool = new Pool({
  connectionString: env.SUPABASE_DB_URL,
  // Supabase requires TLS; the pooler cert isn't in the local trust store.
  ssl: { rejectUnauthorized: false },
});

export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: unknown[],
): Promise<T[]> {
  const result = await pool.query<T>(text, params);
  return result.rows;
}
