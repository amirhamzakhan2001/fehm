import type { IncomingMessage } from "node:http";
import type { BriefingDepth } from "../../codebase-briefing/render.js";
import { SECTION_IDS, type SectionId } from "../../codebase-briefing/types.js";
import { pageAsset } from "../graph/assets.js";
import { pageHeaders, renderPage, type Reply, type ViewContext, type ViewRoutes } from "../http.js";
import { BRIEFING_PAGE } from "./page.js";
import { BriefingService } from "./service.js";

const PAGE_HEADERS = pageHeaders();

const DEPTHS = new Set<BriefingDepth>(["minimal", "standard", "deep"]);

/** Feature 3.2 routes: `/explain` page and `/api/briefing/*`. */
export function createBriefingRoutes(options: { stateDirectory?: string; dryRun?: boolean } = {}): ViewRoutes & { service: BriefingService } {
  const service = new BriefingService(options);
  return {
    service,
    handle(req: IncomingMessage, url: URL, ctx: ViewContext, reply: Reply): boolean {
      const path = url.pathname;
      if (path === "/explain" || path === "/explain/") {
        reply(200, renderPage(BRIEFING_PAGE, url), "text/html; charset=utf-8", PAGE_HEADERS);
        return true;
      }
      if (path.startsWith("/explain/assets/")) {
        const code = pageAsset(path.slice("/explain/assets/".length));
        if (code === undefined) reply(404, { error: "not found" });
        else reply(200, code, "text/javascript; charset=utf-8", PAGE_HEADERS);
        return true;
      }
      if (!path.startsWith("/api/briefing")) return false;
      const q = (k: string): string => url.searchParams.get(k) ?? "";
      switch (path) {
        case "/api/briefing":
          reply(200, service.briefing(ctx.engine()));
          return true;
        case "/api/briefing/freshness":
          reply(200, service.freshness(ctx.engine()));
          return true;
        case "/api/briefing/refresh":
          if (req.method !== "POST") reply(405, { error: "POST required" });
          else reply(200, service.briefing(ctx.reindex()));
          return true;
        case "/api/briefing/flow":
          reply(200, service.flow(ctx.engine(), q("id"), Number(q("depth")) || 3));
          return true;
        case "/api/briefing/ask":
          reply(200, service.ask(ctx.engine(), q("q"), Math.min(Number(q("limit")) || 8, 20)));
          return true;
        case "/api/briefing/markdown": {
          const depth = (DEPTHS.has(q("depth") as BriefingDepth) ? q("depth") : "deep") as BriefingDepth;
          const sections = q("sections").split(",").filter((s): s is SectionId => (SECTION_IDS as readonly string[]).includes(s));
          reply(200, service.markdown(ctx.engine(), depth, sections), "text/markdown; charset=utf-8");
          return true;
        }
        default:
          reply(404, { error: "not found" });
          return true;
      }
    },
  };
}
