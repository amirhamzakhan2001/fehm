import type { DatabaseConnection } from "../db/connection";
import { loadUser } from "../db/users";
import { validateToken } from "./token";
import { createSession, type Session } from "./session";

/**
 * Authenticate a user from an email and bearer token and open a session.
 * Throws when the token is invalid or the user does not exist.
 */
export async function authenticateUser(db: DatabaseConnection, email: string, token: string): Promise<Session> {
  const claims = validateToken(token);
  const user = await loadUser(db, email);
  if (!user || user.id !== claims.subject) {
    throw new Error("authentication failed");
  }
  return createSession(user.id);
}
