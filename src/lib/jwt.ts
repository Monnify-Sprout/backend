import jwt, { type JwtPayload, type SignOptions } from 'jsonwebtoken';

import { env } from '../config/env';

export interface AccessTokenPayload {
  sub: string; // merchant id
  email: string;
}

export function signAccessToken(payload: AccessTokenPayload): string {
  const options: SignOptions = {
    // JWT_EXPIRES_IN is validated as a string (e.g. "1h", "7d") upstream.
    expiresIn: env.JWT_EXPIRES_IN as SignOptions['expiresIn'],
  };
  return jwt.sign(payload, env.JWT_SECRET, options);
}

// Throws if the token is missing, malformed, tampered with, or expired.
export function verifyAccessToken(token: string): AccessTokenPayload {
  const decoded = jwt.verify(token, env.JWT_SECRET) as JwtPayload;
  const sub = decoded.sub;
  const email = decoded.email;
  if (typeof sub !== 'string' || typeof email !== 'string') {
    throw new Error('Malformed access token payload');
  }
  return { sub, email };
}
