import { z } from 'zod';

// PRD §7.2, refined pre-Phase-8:
// - The sale is described by a required `item` (what was bought) plus optional
//   `notes`, not one free-text blob.
// - A buyer in social commerce is often known only by a handle or a phone
//   number, so name is optional; instead we require AT LEAST ONE identifier
//   among name / phone / email / social handle. Monnify still needs a customer
//   name + email, which the service synthesises from whatever is provided.
const emailField = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .refine((v) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v), {
    message: 'Enter a valid email address',
  });

const phoneField = z
  .string()
  .trim()
  .regex(/^\+?[0-9]{7,15}$/, 'Enter a valid phone number');

// A handle like "@chidi_styles" or "chidi_styles"; the leading @ is optional.
const socialHandleField = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .regex(/^@?[a-zA-Z0-9._]+$/, 'Enter a valid handle, e.g. @chidi_styles');

// Which network the handle is on. Known values (instagram/whatsapp/facebook/
// snapchat) are sent lowercase by the client; "Other" is whatever the merchant
// typed, so this is free text, only length- and charset-bounded.
const socialPlatformField = z
  .string()
  .trim()
  .min(1)
  .max(30)
  .regex(/^[a-zA-Z0-9 .&/_-]+$/, 'Enter a valid platform');

export const createInvoiceSchema = z
  .object({
    customer_name: z.string().trim().min(1).max(200).optional(),
    customer_email: emailField.optional(),
    customer_phone: phoneField.optional(),
    customer_social_handle: socialHandleField.optional(),
    customer_social_platform: socialPlatformField.optional(),
    item: z.string().trim().min(1, 'Item is required').max(200),
    notes: z.string().trim().max(500).optional(),
    amount: z.coerce
      .number()
      .positive('Amount must be greater than 0')
      .max(1_000_000_000),
    due_date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'due_date must be YYYY-MM-DD')
      .optional(),
    // Optional merchant category (Phase 11); ownership is checked in the service.
    category_id: z.string().uuid('Invalid category').optional(),
  })
  .refine(
    (v) =>
      Boolean(
        v.customer_name ||
        v.customer_phone ||
        v.customer_email ||
        v.customer_social_handle,
      ),
    {
      message:
        'Add at least one way to identify the buyer: name, phone, email, or social handle.',
      path: ['customer_name'],
    },
  );

export type CreateInvoiceInput = z.infer<typeof createInvoiceSchema>;
