import { createGuardrailRoutes } from "./visualization/guardrails/routes.js";
import { createConceptRoutes } from "./visualization/concepts/routes.js";
import { createGitMemoryRoutes } from "./visualization/git-memory/routes.js";
import { createServer, type Server } from "node:http";
import { FehmEngine } from "./engine.js";
import type { IndexOptions } from "./indexer.js";
import { createArchitectureRoutes } from "./visualization/architecture/routes.js";
import { createBriefingRoutes } from "./visualization/briefing/routes.js";
import { createDashboardRoutes } from "./visualization/dashboard/routes.js";
import { createDriftRoutes } from "./visualization/drift/routes.js";
import { createEngineRoutes } from "./visualization/engine/routes.js";
import { createGraphRoutes } from "./visualization/graph/routes.js";
import { createHealthRoutes } from "./visualization/health/routes.js";
import { createPromptRoutes } from "./visualization/prompts/routes.js";
import { createSecurityRoutes } from "./visualization/security/routes.js";
import type { ViewContext, ViewRoutes } from "./visualization/http.js";

/**
 * The localhost server. Every view — the dashboard (`/`), the Feature 1
 * engine page (`/engine`), the Feature 3.1 graph (`/graph`), the Feature 3.2
 * briefing (`/explain`), the Feature 3.3 architecture (`/architecture`) and
 * the Feature 3.4 architecture drift (`/drift`), the Feature 3.5 project
 * health (`/health`) and the Feature 3.6 security review (`/security`) — is a
 * `ViewRoutes` module
 * sharing one FehmEngine instance. The dashboard's feature list is
 * `src/visualization/features.ts`.
 */
export function startServer(root: string, port: number, options: IndexOptions = {}): Promise<Server> {
  let engine = FehmEngine.open(root, options);
  const ctx: ViewContext = {
    engine: () => engine,
    reindex: () => (engine = FehmEngine.open(root, options)),
  };
  const viewOptions = { ...(options.stateDirectory ? { stateDirectory: options.stateDirectory } : {}), ...(options.dryRun ? { dryRun: true } : {}) };
  const architecture = createArchitectureRoutes(viewOptions);
  const security = createSecurityRoutes({ ...viewOptions, architecture: architecture.service });
  const health = createHealthRoutes({ ...viewOptions, architecture: architecture.service });
  const prompts = createPromptRoutes({ ...viewOptions, architecture: architecture.service, security: security.service });
  const concepts = createConceptRoutes({ ...viewOptions, architecture: architecture.service, security: security.service, health: health.service, prompts: prompts.service });
  const views: ViewRoutes[] = [
    createDashboardRoutes(),
    createEngineRoutes(),
    createGraphRoutes({ root, ...viewOptions }),
    createBriefingRoutes(viewOptions),
    architecture,
    // Drift evaluates 3.3's model: share it instead of building a second one per engine.
    createDriftRoutes({ ...viewOptions, architecture: architecture.service }),
    health,
    security,
    prompts,
    concepts,
    createGitMemoryRoutes(viewOptions),
    createGuardrailRoutes(),
  ];
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const send = (status: number, body: unknown, type = "application/json", headers: Record<string, string> = {}): void => {
      res.writeHead(status, { "content-type": type, "cache-control": "no-store", ...headers });
      res.end(type === "application/json" ? JSON.stringify(body) : String(body));
    };
    try {
      for (const view of views) if (view.handle(req, url, ctx, send)) return;
      send(404, { error: "not found" });
    } catch (error) {
      send(500, { error: (error as Error).message });
    }
  });
  server.on("close", () => concepts.service.close());
  return new Promise((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolvePromise(server));
  });
}
