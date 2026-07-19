import { z } from 'zod';

// PRD §7.1: capture BVN or NIN for the authenticated merchant. Both are 11 digits.
// The merchant's SETTLEMENT bank account is required here (DECIDED 2026-07-18) -
// it is where their share of every payment lands, and Monnify's live
// Create-Sub-Account needs it. Bank code is a NIP/CBN code (3 digits for banks,
// up to 6 for fintechs); NUBAN account is 10 digits. Names are for display.
export const verificationSchema = z.object({
  id_type: z.enum(['BVN', 'NIN']),
  id_number: z
    .string()
    .trim()
    .regex(/^\d{11}$/, 'BVN/NIN must be exactly 11 digits'),
  settlement_bank_code: z
    .string()
    .trim()
    .regex(/^\d{3,6}$/, 'Select a valid bank'),
  settlement_bank_name: z.string().trim().min(1).max(120).optional(),
  settlement_account_number: z
    .string()
    .trim()
    .regex(/^\d{10}$/, 'Account number must be 10 digits'),
  settlement_account_name: z.string().trim().min(1).max(200).optional(),
});

export type VerificationInput = z.infer<typeof verificationSchema>;
