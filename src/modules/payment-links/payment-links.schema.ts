import { z } from 'zod';

// PRD Roadmap Phase 12: static (reusable) payment links.
// A link has a title and an optional "what this is for" item. Its amount is
// OPTIONAL: omitted (or null) means the buyer types the amount at pay time (a
// donation / top-up style link); a value means a fixed price. An optional
// category (Phase 11) lets link revenue join the same analytics breakdowns as
// invoices.
export const createPaymentLinkSchema = z.object({
  title: z.string().trim().min(1, 'Title is required').max(200),
  item: z.string().trim().max(200).optional(),
  amount: z.coerce
    .number()
    .positive('Amount must be greater than 0')
    .max(1_000_000_000)
    .optional(),
  category_id: z.string().uuid('Invalid category').optional(),
  // Optional revenue stream (Phase 13); ownership + active status are checked
  // in the service. A routed stream redirects the settlement split.
  stream_id: z.string().uuid('Invalid stream').optional(),
});

export type CreatePaymentLinkInput = z.infer<typeof createPaymentLinkSchema>;

// Status transitions: active <-> paused (reversible), and either -> ended
// (terminal). The service rejects an illegal transition (e.g. reopening an ended
// link); the schema only bounds the target value.
export const updateStatusSchema = z.object({
  status: z.enum(['active', 'paused', 'ended']),
});

export type UpdateStatusInput = z.infer<typeof updateStatusSchema>;

// The demo/testing "simulate a collection" action (mock mode only). For a
// buyer-entered link an amount is required; for a fixed link it is ignored in
// favour of the link's own price.
export const simulateCollectionSchema = z.object({
  amount: z.coerce.number().positive().max(1_000_000_000).optional(),
  customer_name: z.string().trim().min(1).max(200).optional(),
});

export type SimulateCollectionInput = z.infer<typeof simulateCollectionSchema>;
