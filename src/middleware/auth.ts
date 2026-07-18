import type { NextFunction, Request, Response } from 'express';

import { verifyAccessToken } from '../lib/jwt';
import { HttpError } from './error';

// Protects merchant-scoped routes. Expects `Authorization: Bearer <token>`.
// On success, attaches `req.merchant`; on any failure, responds 401.
export function requireAuth(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  const header = req.header('authorization') ?? '';
  const [scheme, token] = header.split(' ');

  if (scheme !== 'Bearer' || !token) {
    next(new HttpError(401, 'Missing or malformed Authorization header.'));
    return;
  }

  try {
    const payload = verifyAccessToken(token);
    req.merchant = { id: payload.sub, email: payload.email };
    next();
  } catch {
    next(new HttpError(401, 'Invalid or expired token.'));
  }
}
