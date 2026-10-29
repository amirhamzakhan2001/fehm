/**
 * A five-domain Express service with clear project conventions and a few
 * planted deviations, for Feature 3.4:
 *
 *   conventions  controller → service → repository → database (pg); services get
 *                repositories injected; logging through src/lib/logger; config read in
 *                src/config; route modules use requireAuth; *.test.ts under test/ mirror src/
 *   deviations   payments.controller.ts runs SQL itself (layer bypass / database access)
 *                invoices.service.ts constructs its repository with `new` (DI)
 *                orders.controller.ts reads process.env directly (configuration)
 *                products.controller.ts logs with console.log (observability)
 *                reports.controller.ts registers routes without requireAuth (security boundary)
 *                src/utils/helperFinal.ts (provisional name)
 */

const DOMAINS = ["users", "orders", "products", "payments", "invoices", "reports"] as const;
const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

export function shopFiles(options: { bypass?: boolean } = { bypass: true }): Record<string, string> {
  const files: Record<string, string> = {
    "package.json": JSON.stringify({ name: "shop", version: "1.0.0", main: "src/server.ts", dependencies: { express: "^4.19.0", pg: "^8.11.0" }, devDependencies: { vitest: "^1.0.0" } }, null, 2),
    "src/config/index.ts": `export const config = {\n  port: Number(process.env.PORT ?? 3000),\n  databaseUrl: process.env.DATABASE_URL ?? "",\n  region: process.env.REGION ?? "eu",\n  secret: process.env.SESSION_SECRET ?? "",\n};\n`,
    "src/lib/logger.ts": `export const logger = {\n  info(message: string): void {\n    process.stdout.write(message + "\\n");\n  },\n  error(message: string): void {\n    process.stderr.write(message + "\\n");\n  },\n};\n`,
    "src/lib/db.ts": `import { Pool } from "pg";\nimport { config } from "../config";\n\nconst pool = new Pool({ connectionString: config.databaseUrl });\n\nexport async function query(sql: string, params: unknown[] = []): Promise<any[]> {\n  const result = await pool.query(sql, params);\n  return result.rows;\n}\n`,
    "src/middleware/auth.middleware.ts": `export function requireAuth(req: any, res: any, next: any): void {\n  if (!req.headers.authorization) {\n    next(new Error("unauthorised"));\n    return;\n  }\n  next();\n}\n`,
    "src/middleware/error.middleware.ts": `import { logger } from "../lib/logger";\n\nexport function errorHandler(err: Error, req: any, res: any, next: any): void {\n  logger.error(err.message);\n  res.status(500).json({ error: err.message });\n}\n`,
    "src/server.ts": `import express from "express";\nimport { config } from "./config";\nimport { errorHandler } from "./middleware/error.middleware";\n${DOMAINS.map((d) => `import { ${d}Routes } from "./controllers/${d}.controller";`).join("\n")}\n\nconst app = express();\n${DOMAINS.map((d) => `${d}Routes(app);`).join("\n")}\napp.use(errorHandler);\napp.listen(config.port);\n`,
    "src/utils/format.ts": `export function money(cents: number): string {\n  return (cents / 100).toFixed(2);\n}\n`,
    "src/utils/helperFinal.ts": `export function helper(value: string): string {\n  return value.trim();\n}\n`,
  };
  for (const d of DOMAINS) {
    const C = cap(d);
    const bypass = d === "payments" && options.bypass !== false;
    files[`src/repositories/${d}.repository.ts`] = `import { query } from "../lib/db";\n\nexport class ${C}Repository {\n  async all(): Promise<any[]> {\n    return query("SELECT * FROM ${d} ORDER BY id");\n  }\n\n  async byId(id: string): Promise<any> {\n    const rows = await query("SELECT * FROM ${d} WHERE id = $1", [id]);\n    return rows[0];\n  }\n}\n`;
    files[`src/services/${d}.service.ts`] =
      d === "invoices"
        ? `import { ${C}Repository } from "../repositories/${d}.repository";\nimport { logger } from "../lib/logger";\n\nexport class ${C}Service {\n  private readonly repository = new ${C}Repository();\n\n  async list(): Promise<any[]> {\n    logger.info("listing ${d}");\n    return this.repository.all();\n  }\n}\n`
        : `import { ${C}Repository } from "../repositories/${d}.repository";\nimport { logger } from "../lib/logger";\n\nexport class ${C}Service {\n  constructor(private readonly repository: ${C}Repository) {}\n\n  async list(): Promise<any[]> {\n    logger.info("listing ${d}");\n    return this.repository.all();\n  }\n}\n`;
    const auth = d !== "reports";
    const log = d === "products" ? `console.log("list ${d}");` : `logger.info("list ${d}");`;
    const env = d === "orders" ? `\n  const region = process.env.REGION ?? "eu";` : "";
    files[`src/controllers/${d}.controller.ts`] = `import { ${C}Service } from "../services/${d}.service";\nimport { ${C}Repository } from "../repositories/${d}.repository";\n${auth ? `import { requireAuth } from "../middleware/auth.middleware";\n` : ""}import { logger } from "../lib/logger";\n${bypass ? `import { query } from "../lib/db";\n` : ""}\nconst service = new ${C}Service(new ${C}Repository());\n\nexport function ${d}Routes(app: any): void {\n  app.get("/${d}", ${auth ? "requireAuth, " : ""}async (req: any, res: any) => {${env}\n    ${log}\n    res.json(await service.list());\n  });\n${bypass ? `\n  app.get("/${d}/total", ${auth ? "requireAuth, " : ""}async (req: any, res: any) => {\n    const rows = await query("SELECT SUM(amount) AS total FROM ${d}");\n    res.json(rows[0]);\n  });\n` : ""}}\n`;
    if (d !== "reports") files[`test/services/${d}.service.test.ts`] = `import { ${C}Service } from "../../src/services/${d}.service";\n\ntest("${d}", () => {\n  expect(${C}Service).toBeDefined();\n});\n`;
  }
  return files;
}
