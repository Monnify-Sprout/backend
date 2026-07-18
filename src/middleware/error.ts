import type { NextFunction, Request, Response } from 'express';

// Errors thrown deliberately by handlers/services carry an HTTP status and a
// safe, user-facing message. Anything else becomes a generic 500.
export class HttpError extends Error {
  readonly status: number;
  readonly details?: unknown;

  constructor(status: number, message: string, details?: unknown) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.details = details;
  }
}

export function notFoundHandler(_req: Request, res: Response): void {
  res.status(404).json({ error: 'Not found' });
}

// Express identifies error handlers by their 4-arg signature — keep all four.
export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message, details: err.details });
    return;
  }
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
}
