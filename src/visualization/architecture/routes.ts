import type { IncomingMessage } from "node:http";
import { VIEW_TYPES, type ViewType } from "../../architecture/types.js";
import { pageAsset } from "../graph/assets.js";
import { pageHeaders, renderPage, type Reply, type ViewContext, type ViewRoutes } from "../http.js";
import { ARCHITECTURE_PAGE } from "./page.js";
import { ArchitectureService, type ArchitectureServiceOptions } from "./service.js";

const PAGE_HEADERS = pageHeaders();
const VIEWS = new Set<string>(VIEW_TYPES);

/** Feature 3.3 routes: `/architecture` page and `/api/architecture/*`. */
export function createArchitectureRoutes(options: ArchitectureServiceOptions = {}): ViewRoutes & { service: ArchitectureService } {
  const service = new ArchitectureService(options);
  return {
    service,
    handle(req: IncomingMessage, url: URL, ctx: ViewContext, reply: Reply): boolean {
      const path = url.pathname;
      if (path === "/architecture" || path === "/architecture/") {
        reply(200, renderPage(ARCHITECTURE_PAGE, url), "text/html; charset=utf-8", PAGE_HEADERS);
        return true;
      }
      if (path.startsWith("/architecture/assets/")) {
        const code = pageAsset(path.slice("/architecture/assets/".length));
        if (code === undefined) reply(404, { error: "not found" });
        else reply(200, code, "text/javascript; charset=utf-8", PAGE_HEADERS);
        return true;
      }
      if (!path.startsWith("/api/architecture")) return false;
      const q = (k: string): string => url.searchParams.get(k) ?? "";
      const engine = ctx.engine();
      switch (path) {
        case "/api/architecture":
          reply(200, service.summary(engine));
          return true;
        case "/api/architecture/view": {
          const type = q("type") || "system";
          if (!VIEWS.has(type as ViewType)) {
            reply(400, { error: `type must be one of ${[...VIEWS].join(", ")}` });
            return true;
          }
          const view = service.view(engine, type as ViewType, q("focus") || undefined);
          // "Nothing to show" (no changes, no evidence for this choice) is an answer, not a server error.
          reply(200, view);
          return true;
        }
        case "/api/architecture/node": {
          const detail = service.node(engine, q("id"));
          reply(detail ? 200 : 404, detail ?? { error: "unknown architecture node" });
          return true;
        }
        case "/api/architecture/relationship": {
          const detail = service.relationship(engine, q("id"));
          reply(detail ? 200 : 404, detail ?? { error: "unknown relationship" });
          return true;
        }
        case "/api/architecture/source": {
          // Only files in the index are readable; anything else is not found.
          const excerpt = service.source(engine, q("path"), Number(q("line")) || 1);
          reply(excerpt ? 200 : 404, excerpt ?? { error: "not an indexed file" });
          return true;
        }
        case "/api/architecture/search":
          reply(200, service.search(engine, q("q"), Math.min(Number(q("limit")) || 12, 30)));
          return true;
        case "/api/architecture/refresh":
          if (req.method !== "POST") reply(405, { error: "POST required" });
          else reply(200, service.summary(ctx.reindex()));
          return true;
        default:
          reply(404, { error: "not found" });
          return true;
      }
    },
  };
}
