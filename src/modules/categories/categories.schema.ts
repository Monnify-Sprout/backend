import { z } from 'zod';

// PRD Phase 11. A category is a short name plus a display colour. The colour is
// a #rrggbb hex (the same constraint the DB enforces); the UI offers a palette
// but any valid hex is accepted.
const colorField = z
  .string()
  .trim()
  .regex(/^#[0-9a-fA-F]{6}$/, 'Colour must be a hex value like #16a34a');

export const createCategorySchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(40),
  color: colorField,
});

// Update takes the same fields (full replace of the editable pair).
export const updateCategorySchema = createCategorySchema;

export type CreateCategoryInput = z.infer<typeof createCategorySchema>;
export type UpdateCategoryInput = z.infer<typeof updateCategorySchema>;
