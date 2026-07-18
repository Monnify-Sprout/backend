import 'express';

// Populated by requireAuth after a valid JWT is verified.
declare global {
  namespace Express {
    interface Request {
      merchant?: {
        id: string;
        email: string;
      };
    }
  }
}

export {};
