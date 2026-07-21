import type { NextFunction, Request, Response } from 'express';

import { resolveStreamScope } from '../modules/streams/streams.service';

// Phase 14: streams as the workspace scope. On stream-scoped routes (invoices,
// payment links) this resolves which stream the request belongs to from the
// client's `X-Stream-Id` header, falling back to the merchant's default when the
// header is missing, unknown, or points at an archived stream. Attaches
// `req.streamId`. Must run AFTER requireAuth (it needs `req.merchant`).
export function attachStream(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  const merchantId = req.merchant?.id;
  if (!merchantId) {
    // requireAuth should have set this; if not, let the route's own guard 401.
    next();
    return;
  }
  const header = req.header('x-stream-id') ?? undefined;
  resolveStreamScope(merchantId, header)
    .then((stream) => {
      req.streamId = stream.id;
      next();
    })
    .catch(next);
}
