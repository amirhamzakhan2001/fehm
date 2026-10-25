import type { IncomingMessage } from "node:http";
import type { RetrievalIntent } from "../../model.js";
import { pageAsset } from "../graph/assets.js";
import { pageHeaders, renderPage, type Reply, type ViewContext, type ViewRoutes } from "../http.js";
import { ENGINE_PAGE } from "./page.js";

const PAGE_HEADERS = pageHeaders();

/**
 * Feature 1 routes: the `/engine` debug page and the engine's generic APIs
 * (status, rescan, freshness, search, context, explain, system map,
 * connectivity), which the dashboard home also reads.
 */
export function createEngineRoutes(): ViewRoutes {
  return {
    handle(req: IncomingMessage, url: URL, ctx: ViewContext, reply: Reply): boolean {
      const path = url.pathname;
      if (path === "/engine" || path === "/engine/") {
        reply(200, renderPage(ENGINE_PAGE, url), "text/html; charset=utf-8", PAGE_HEADERS);
        return true;
      }
      if (path.startsWith("/engine/assets/")) {
        const code = pageAsset(path.slice("/engine/assets/".length));
        if (code === undefined) reply(404, { error: "not found" });
        else reply(200, code, "text/javascript; charset=utf-8", PAGE_HEADERS);
        return true;
      }
      const q = (k: string): string => url.searchParams.get(k) ?? "";
      switch (path) {
        case "/api/status":
          reply(200, ctx.engine().status());
          return true;
        case "/api/freshness":
          reply(200, ctx.engine().freshness());
          return true;
        case "/api/rescan":
          if (req.method !== "POST") reply(405, { error: "POST required" });
          else reply(200, ctx.reindex().status());
          return true;
        case "/api/search":
          reply(200, ctx.engine().search(q("q"), { limit: Number(q("limit")) || 20 }));
          return true;
        case "/api/context": {
          const engine = ctx.engine();
          const intent = q("intent") as RetrievalIntent | "";
          const packet = engine.context(q("q"), { budget: Number(q("budget")) || 4000, ...(intent ? { intent } : {}) });
          reply(200, { packet, markdown: engine.renderContext(packet) });
          return true;
        }
        case "/api/explain":
          reply(200, ctx.engine().explain(q("target")));
          return true;
        case "/api/system-map":
          reply(200, ctx.engine().systemMap());
          return true;
        case "/api/connectivity":
          reply(200, ctx.engine().connectivity());
          return true;
        default:
          return false;
      }
    },
  };
}
