import 'express';

// Populated by requireAuth after a valid JWT is verified.
declare global {
  namespace Express {
    interface Request {
      merchant?: {
        id: string;
        email: string;
      };
      // Raw request body bytes, captured by express.json's verify hook for
      // webhook signature validation.
      rawBody?: Buffer;
    }
  }
}

export {};
