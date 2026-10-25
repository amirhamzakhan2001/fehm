import type { IncomingMessage } from "node:http";
import { pageAsset } from "../graph/assets.js";
import { pageHeaders, renderPage, type Reply, type ViewContext, type ViewRoutes } from "../http.js";
import { SECURITY_PAGE } from "./page.js";
import { SecurityService, type SecurityServiceOptions } from "./service.js";

const PAGE_HEADERS = pageHeaders();

/**
 * Feature 3.6 routes: `/security` page and `/api/security/*`. Writes (review,
 * baseline) need POST and an `x-fehm` header, as in 3.4 and 3.5.
 */
export function createSecurityRoutes(options: SecurityServiceOptions = {}): ViewRoutes & { service: SecurityService } {
  const service = new SecurityService(options);
  return {
    service,
    handle(req: IncomingMessage, url: URL, ctx: ViewContext, reply: Reply): boolean {
      const path = url.pathname;
      if (path === "/security" || path === "/security/") {
        reply(200, renderPage(SECURITY_PAGE, url), "text/html; charset=utf-8", PAGE_HEADERS);
        return true;
      }
      if (path.startsWith("/security/assets/")) {
        const code = pageAsset(path.slice("/security/assets/".length));
        if (code === undefined) reply(404, { error: "not found" });
        else reply(200, code, "text/javascript; charset=utf-8", PAGE_HEADERS);
        return true;
      }
      if (!path.startsWith("/api/security")) return false;
      const q = (k: string): string => url.searchParams.get(k) ?? "";
      const scope = q("scope") === "changed" ? "changed" : "all";
      const write = (run: () => { error: string } | object): void => {
        if (req.method !== "POST") return reply(405, { error: "POST required" });
        if (req.headers["x-fehm"] !== "1") return reply(403, { error: "missing x-fehm header" });
        const r = run();
        reply("error" in r ? 409 : 200, r);
      };
      const engine = ctx.engine();
      switch (path) {
        case "/api/security":
          reply(200, service.payload(engine, scope));
          return true;
        case "/api/security/report":
          reply(200, service.report(engine, scope), "application/json", { "content-disposition": "attachment; filename=\"security-review.json\"" });
          return true;
        case "/api/security/sarif":
          reply(200, service.sarif(engine, scope), "application/json", { "content-disposition": "attachment; filename=\"fehm-security.sarif\"" });
          return true;
        case "/api/security/review":
          write(() => service.review(engine, q("id"), q("status"), q("note") || undefined));
          return true;
        case "/api/security/baseline":
          write(() => (q("clear") ? service.clearBaseline(engine) : service.setBaseline(engine)));
          return true;
        case "/api/security/source": {
          const excerpt = service.source(engine, q("path"), Number(q("line")) || 1);
          reply(excerpt ? 200 : 404, excerpt ?? { error: "not an indexed file" });
          return true;
        }
        case "/api/security/refresh":
          if (req.method !== "POST") reply(405, { error: "POST required" });
          else reply(200, service.payload(ctx.reindex(), scope));
          return true;
        default:
          reply(404, { error: "not found" });
          return true;
      }
    },
  };
}
