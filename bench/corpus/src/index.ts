import { createServer } from "./api/server";
import { createConnection } from "./db/connection";

/** Boot the shop: open the database, then start the HTTP server. */
export async function main(): Promise<void> {
  const db = createConnection(process.env.DATABASE_URL ?? "postgres://localhost/shop");
  const server = createServer(db);
  server.listen(3000);
}

main();
