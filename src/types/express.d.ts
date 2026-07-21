import 'express';

// Populated by requireAuth after a valid JWT is verified.
declare global {
  namespace Express {
    interface Request {
      merchant?: {
        id: string;
        email: string;
      };
      // Populated by attachStream (Phase 14): the workspace stream the request
      // is scoped to, resolved from the `X-Stream-Id` header or the merchant's
      // default. Present on stream-scoped routes (invoices, payment links).
      streamId?: string;
      // Raw request body bytes, captured by express.json's verify hook for
      // webhook signature validation.
      rawBody?: Buffer;
    }
  }
}

export {};
