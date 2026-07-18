import 'dotenv/config';
import { z } from 'zod';

// Validated, typed environment. Import this instead of reading process.env
// directly so a misconfigured deployment fails fast at boot.
//
// Phase 1 only needs the DB connection + JWT config. Monnify/encryption vars
// arrive in later phases and are intentionally optional here.
const envSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  PORT: z.coerce.number().int().positive().default(4000),

  // Supabase as managed Postgres, accessed directly via node-postgres (pg).
  // This is the app's only DB connection and is used by the migration runner too.
  SUPABASE_DB_URL: z.string().min(1),

  // Our own JWT auth (not Supabase Auth).
  JWT_SECRET: z.string().min(16, 'JWT_SECRET must be at least 16 characters'),
  JWT_EXPIRES_IN: z.string().default('1h'),

  // 'mock' (default) simulates Monnify's Live-Mode-only BVN/NIN check for local dev
  // and the demo; 'live' calls the real API. See PRD §5.
  MONNIFY_VERIFICATION_MODE: z.enum(['live', 'mock']).default('mock'),

  // Live Monnify integration — required ONLY when MONNIFY_VERIFICATION_MODE=live.
  // Kept optional so mock mode boots without them; the live provider asserts their
  // presence at call time.
  MONNIFY_BASE_URL: z.string().url().optional(),
  MONNIFY_API_KEY: z.string().optional(),
  MONNIFY_SECRET_KEY: z.string().optional(),
  MONNIFY_CONTRACT_CODE: z.string().optional(),

  // Phase 3 — invoices, webhook, settlement.
  // Shared secret Monnify signs collection webhooks with (HMAC-SHA512). Required
  // to accept webhooks; the mock/demo signs with this same value.
  MONNIFY_WEBHOOK_SECRET: z.string().optional(),
  // Sprout's platform commission as a percentage of each invoice (a Sprout
  // business decision, not a Monnify fee). PRD §7.3.
  SPROUT_COMMISSION_PERCENT: z.coerce.number().min(0).max(100).default(1),
  // Whether Monnify's Create Invoice accepts incomeSplitConfig (UNCONFIRMED —
  // PRD §7.3). 'true' → apply the split at settlement; 'false' → safe manual
  // fallback (100% to merchant, Sprout's cut as a separate transfer).
  MONNIFY_INVOICE_SPLIT_SUPPORTED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),

  // Phase 4 — AES-256-GCM key for connected-account Monnify credentials at rest
  // (32 bytes as 64 hex chars). Optional so earlier phases boot without it; the
  // crypto lib asserts presence when a credential is actually (de)encrypted.
  CREDENTIALS_ENCRYPTION_KEY: z
    .string()
    .regex(/^[0-9a-f]{64}$/i, 'must be 32 bytes as 64 hex chars')
    .optional(),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌ Invalid environment configuration:');
  for (const issue of parsed.error.issues) {
    console.error(`  - ${issue.path.join('.') || '(root)'}: ${issue.message}`);
  }
  console.error('See .env.example for the required variables.');
  process.exit(1);
}

export const env = parsed.data;
