import { z } from 'zod';

// Phase 13: revenue streams. A stream is just a name until a settlement account
// is attached; the account fields mirror the verification schema (migration
// 0005): NIP/CBN bank code (3-6 digits), 10-digit NUBAN, display-only names.
// Bank code and account number must come together or not at all - the DB CHECK
// enforces the same rule.

const bankCodeField = z
  .string()
  .trim()
  .regex(/^\d{3,6}$/, 'Select a valid bank');

const accountNumberField = z
  .string()
  .trim()
  .regex(/^\d{10}$/, 'Account number must be 10 digits');

const settlementTogether = (v: {
  settlement_bank_code?: string;
  settlement_account_number?: string;
}): boolean => Boolean(v.settlement_bank_code) === Boolean(v.settlement_account_number);

export const createStreamSchema = z
  .object({
    name: z.string().trim().min(1, 'Name is required').max(60),
    settlement_bank_code: bankCodeField.optional(),
    settlement_bank_name: z.string().trim().min(1).max(120).optional(),
    settlement_account_number: accountNumberField.optional(),
    settlement_account_name: z.string().trim().min(1).max(200).optional(),
  })
  .refine(settlementTogether, {
    message: 'A settlement account needs both a bank and an account number.',
    path: ['settlement_account_number'],
  });

export type CreateStreamInput = z.infer<typeof createStreamSchema>;

// PATCH: rename and/or change the settlement destination. `clear_settlement`
// detaches the account (back to tracking-only); it cannot be combined with new
// account fields.
export const updateStreamSchema = z
  .object({
    name: z.string().trim().min(1, 'Name is required').max(60).optional(),
    settlement_bank_code: bankCodeField.optional(),
    settlement_bank_name: z.string().trim().min(1).max(120).optional(),
    settlement_account_number: accountNumberField.optional(),
    settlement_account_name: z.string().trim().min(1).max(200).optional(),
    clear_settlement: z.boolean().optional(),
  })
  .refine(settlementTogether, {
    message: 'A settlement account needs both a bank and an account number.',
    path: ['settlement_account_number'],
  })
  .refine((v) => !(v.clear_settlement && v.settlement_account_number), {
    message: 'Either clear the settlement account or set a new one, not both.',
    path: ['clear_settlement'],
  });

export type UpdateStreamInput = z.infer<typeof updateStreamSchema>;

// active <-> archived, reversible in both directions.
export const updateStreamStatusSchema = z.object({
  status: z.enum(['active', 'archived']),
});

export type UpdateStreamStatusInput = z.infer<typeof updateStreamStatusSchema>;
