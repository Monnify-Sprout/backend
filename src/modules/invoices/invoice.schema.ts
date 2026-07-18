import { z } from 'zod';

// PRD §7.2: customer name, description, amount, due date. Monnify also needs a
// customer email — optional here and synthesised by the service when absent.
export const createInvoiceSchema = z.object({
  customer_name: z.string().trim().min(1).max(200),
  customer_email: z
    .string()
    .trim()
    .toLowerCase()
    .max(254)
    .refine((v) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v), {
      message: 'Enter a valid email address',
    })
    .optional(),
  description: z.string().trim().max(500).optional(),
  amount: z.coerce.number().positive('Amount must be greater than 0').max(1_000_000_000),
  due_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'due_date must be YYYY-MM-DD')
    .optional(),
});

export type CreateInvoiceInput = z.infer<typeof createInvoiceSchema>;
