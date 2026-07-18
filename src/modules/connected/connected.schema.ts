import { z } from 'zod';

// PRD §7.6: a merchant links their own direct Monnify contract, read-only.
// The credential fields are validated for shape only — semantic validation is a
// live auth check against Monnify. Their values must never be logged or echoed.
export const connectAccountSchema = z.object({
  business_name: z.string().trim().min(1).max(200),
  api_key: z.string().trim().min(8).max(128),
  secret_key: z.string().trim().min(8).max(128),
  contract_code: z.string().trim().min(4).max(64),
});

export type ConnectAccountInput = z.infer<typeof connectAccountSchema>;
