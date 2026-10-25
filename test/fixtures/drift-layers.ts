/**
 * A small layered service for Feature 3.4 tests:
 *
 *   src/api          HTTP routes (interface)       — also runs SQL directly: bypasses data access
 *   src/services     service logic (application)
 *   src/repositories SQL (data access)
 *   src/db           database client (data access)
 *   src/utils        shared helpers                — one imports a service: an upward dependency
 *
 * Plus quality patterns: a copied function, a placeholder, a pass-through
 * wrapper and a TODO marker.
 */
export const LAYERED: Record<string, string> = {
  "package.json": JSON.stringify({ name: "layered-shop", version: "1.0.0", main: "src/api/users.ts", dependencies: { express: "^4.19.0", pg: "^8.11.0", "left-pad": "^1.3.0" } }, null, 2),
  "src/api/users.ts": `import express from "express";
import { listUsers, renameUser } from "../services/users";
import { query } from "../db/client";

export const app = express();

app.get("/users", async (_req, res) => {
  res.json(await listUsers());
});

app.post("/users/:id/name", async (req, res) => {
  res.json(await renameUser(req.params.id, req.body.name));
});

app.get("/users/count", async (_req, res) => {
  // Reaches the database directly instead of going through a repository.
  const rows = await query("SELECT COUNT(*) AS n FROM users");
  res.json(rows[0]);
});
`,
  "src/services/users.ts": `import { findUsers, updateName } from "../repositories/users";
import { formatName } from "../utils/format";

export async function listUsers() {
  const users = await findUsers();
  return users.map((u) => ({ ...u, name: formatName(u.name) }));
}

export async function renameUser(id: string, name: string) {
  return updateName(id, name);
}

export function exportUsers(): string {
  throw new Error("not implemented");
}
`,
  "src/repositories/users.ts": `import { query } from "../db/client";

export async function findUsers(): Promise<{ id: string; name: string }[]> {
  return query("SELECT id, name FROM users ORDER BY name");
}

export async function updateName(id: string, name: string) {
  return query("UPDATE users SET name = $1 WHERE id = $2", [name, id]);
}
`,
  "src/db/client.ts": `import { Pool } from "pg";

const pool = new Pool();

export async function query(sql: string, params: unknown[] = []): Promise<any[]> {
  const result = await pool.query(sql, params);
  return result.rows;
}
`,
  "src/utils/format.ts": `import { listUsers } from "../services/users";

export function formatName(name: string): string {
  const trimmed = name.trim();
  const parts = trimmed.split(/\\s+/);
  const first = parts[0] ?? "";
  const rest = parts.slice(1).join(" ");
  const cap = first.charAt(0).toUpperCase() + first.slice(1);
  return rest ? cap + " " + rest : cap;
}

export function formatTitle(name: string): string {
  const trimmed = name.trim();
  const parts = trimmed.split(/\\s+/);
  const first = parts[0] ?? "";
  const rest = parts.slice(1).join(" ");
  const cap = first.charAt(0).toUpperCase() + first.slice(1);
  return rest ? cap + " " + rest : cap;
}

// TODO: cache this
export async function userCount(): Promise<number> {
  return (await listUsers()).length;
}
`,
  "src/utils/strings.ts": `export function pad(value: string, width: number): string {
  return value.padStart(width);
}
`,
};
