import { authenticateUser } from "../src/auth/authenticate";
import { createConnection } from "../src/db/connection";
import { signToken } from "../src/auth/token";

export async function testLoginSucceeds(): Promise<void> {
  const db = createConnection("postgres://test");
  await authenticateUser(db, "a@b.c", signToken("u1", 1000));
}
