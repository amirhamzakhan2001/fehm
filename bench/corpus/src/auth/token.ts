import { AppError } from "../util/errors";

export interface TokenClaims { subject: string; expiresAt: number }

/** Raised when a bearer token cannot be verified. */
export class TokenError extends AppError {
  constructor(message: string) {
    super(message, 401);
  }
}

/** Validate a bearer token and return its claims. */
export function validateToken(token: string): TokenClaims {
  const [subject, expires] = token.replace(/^Bearer /, "").split(".");
  if (!subject || !expires) throw new TokenError("malformed token");
  const expiresAt = Number(expires);
  if (expiresAt < Date.now()) throw new TokenError("token expired");
  return { subject, expiresAt };
}

export function signToken(subject: string, ttlMs: number): string {
  return `${subject}.${Date.now() + ttlMs}`;
}
