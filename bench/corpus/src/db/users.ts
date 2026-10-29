import type { DatabaseConnection } from "./connection";

export interface User { id: string; email: string }

/** Load a user record by email. */
export async function loadUser(db: DatabaseConnection, email: string): Promise<User | undefined> {
  const rows = await db.query<User>("select * from users where email = $1", [email]);
  return rows[0];
}
