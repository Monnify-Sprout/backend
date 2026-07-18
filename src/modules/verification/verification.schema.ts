import { z } from 'zod';

// PRD §7.1: capture BVN or NIN for the authenticated merchant. Both are 11 digits.
export const verificationSchema = z.object({
  id_type: z.enum(['BVN', 'NIN']),
  id_number: z
    .string()
    .trim()
    .regex(/^\d{11}$/, 'BVN/NIN must be exactly 11 digits'),
  // Settlement destination - required ONLY by the live Monnify sub-account call
  // (Nigerian bank code = 3 digits, NUBAN account = 10 digits). Optional here so
  // the mock/demo path stays a single field; ignored in mock mode.
  settlement_bank_code: z
    .string()
    .trim()
    .regex(/^\d{3}$/, 'Bank code must be 3 digits')
    .optional(),
  settlement_account_number: z
    .string()
    .trim()
    .regex(/^\d{10}$/, 'Account number must be 10 digits')
    .optional(),
});

export type VerificationInput = z.infer<typeof verificationSchema>;
