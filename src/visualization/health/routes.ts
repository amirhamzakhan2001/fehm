import type { IncomingMessage } from "node:http";
import { pageAsset } from "../graph/assets.js";
import { pageHeaders, renderPage, type Reply, type ViewContext, type ViewRoutes } from "../http.js";
import { HEALTH_PAGE } from "./page.js";
import { HealthService, type HealthServiceOptions } from "./service.js";

const PAGE_HEADERS = pageHeaders();

/**
 * Feature 3.5 routes: `/health` page and `/api/health/*`.
 *
 * Writes (review, baseline, run a check, check advisories) need POST and an
 * `x-fehm` header, like 3.4. Running a check takes only a detected check's
 * id: the command comes from the project's own manifest, never from the
 * request.
 */
export function createHealthRoutes(options: HealthServiceOptions = {}): ViewRoutes & { service: HealthService } {
  const service = new HealthService(options);
  return {
    service,
    handle(req: IncomingMessage, url: URL, ctx: ViewContext, reply: Reply): boolean {
      const path = url.pathname;
      if (path === "/health" || path === "/health/") {
        reply(200, renderPage(HEALTH_PAGE, url), "text/html; charset=utf-8", PAGE_HEADERS);
        return true;
      }
      if (path.startsWith("/health/assets/")) {
        const code = pageAsset(path.slice("/health/assets/".length));
        if (code === undefined) reply(404, { error: "not found" });
        else reply(200, code, "text/javascript; charset=utf-8", PAGE_HEADERS);
        return true;
      }
      if (!path.startsWith("/api/health")) return false;
      const q = (k: string): string => url.searchParams.get(k) ?? "";
      const scope = q("scope") === "changed" ? "changed" : "all";
      const guard = (): boolean => {
        if (req.method !== "POST") {
          reply(405, { error: "POST required" });
          return false;
        }
        if (req.headers["x-fehm"] !== "1") {
          reply(403, { error: "missing x-fehm header" });
          return false;
        }
        return true;
      };
      const settle = (result: Promise<object>): void => {
        result.then(
          (r) => reply("error" in r ? 409 : 200, r),
          (e: Error) => reply(500, { error: e.message }),
        );
      };
      const engine = ctx.engine();
      switch (path) {
        case "/api/health":
          reply(200, service.payload(engine, scope));
          return true;
        case "/api/health/report":
          reply(200, service.report(engine, scope), "application/json", { "content-disposition": "attachment; filename=\"project-health.json\"" });
          return true;
        case "/api/health/review":
          if (guard()) {
            const r = service.review(engine, q("id"), q("status"), q("note") || undefined);
            reply("error" in r ? 409 : 200, r);
          }
          return true;
        case "/api/health/baseline":
          if (guard()) {
            const r = q("clear") ? service.clearBaseline(engine) : service.setBaseline(engine);
            reply("error" in r ? 409 : 200, r);
          }
          return true;
        case "/api/health/run":
          if (guard()) settle(service.run(engine, q("check")));
          return true;
        case "/api/health/advisories":
          if (guard()) settle(service.advisories(engine));
          return true;
        case "/api/health/sbom": {
          const format = q("format") === "spdx" ? "spdx" : "cyclonedx";
          reply(200, service.sbom(engine, format), "application/json", { "content-disposition": `attachment; filename="sbom.${format === "spdx" ? "spdx" : "cdx"}.json"` });
          return true;
        }
        case "/api/health/source": {
          // Only files in the index are readable; anything else is not found.
          const excerpt = service.source(engine, q("path"), Number(q("line")) || 1);
          reply(excerpt ? 200 : 404, excerpt ?? { error: "not an indexed file" });
          return true;
        }
        case "/api/health/refresh":
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
