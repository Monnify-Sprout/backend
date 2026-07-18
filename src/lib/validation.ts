import type { ZodError } from 'zod';

export interface FieldError {
  field: string;
  message: string;
}

// Flatten a Zod error into a compact, client-friendly shape.
export function formatZodError(error: ZodError): FieldError[] {
  return error.issues.map((issue) => ({
    field: issue.path.join('.') || '(root)',
    message: issue.message,
  }));
}
