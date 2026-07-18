import 'dotenv/config';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { Client } from 'pg';

// Applies every unapplied SQL file in ../../migrations, in filename order,
// each inside its own transaction, and records it in schema_migrations so
// re-running is a no-op. Uses a direct Postgres connection (SUPABASE_DB_URL)
// rather than the REST client, since supabase-js cannot run DDL.
const MIGRATIONS_DIR = join(__dirname, '..', '..', 'migrations');

async function main(): Promise<void> {
  const connectionString = process.env.SUPABASE_DB_URL;
  if (!connectionString) {
    console.error(
      'SUPABASE_DB_URL is not set - needed to run migrations. See .env.example.',
    );
    process.exit(1);
  }

  const client = new Client({
    connectionString,
    // Supabase requires TLS; its pooler cert is not in the local trust store.
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();

  try {
    await client.query(`
      create table if not exists schema_migrations (
        name text primary key,
        applied_at timestamptz not null default now()
      );
    `);

    const appliedResult = await client.query<{ name: string }>(
      'select name from schema_migrations',
    );
    const applied = new Set(appliedResult.rows.map((r) => r.name));

    const files = readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    let ran = 0;
    for (const file of files) {
      if (applied.has(file)) {
        console.log(`skip   ${file} (already applied)`);
        continue;
      }

      const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
      console.log(`apply  ${file}`);
      await client.query('begin');
      try {
        await client.query(sql);
        await client.query(
          'insert into schema_migrations (name) values ($1)',
          [file],
        );
        await client.query('commit');
        ran += 1;
      } catch (err) {
        await client.query('rollback');
        throw err;
      }
    }

    console.log(`\ndone - ${ran} migration(s) applied, ${files.length} on disk.`);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
