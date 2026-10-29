import { rmSync } from "node:fs";
import type { IncomingMessage } from "node:http";
import { pageHeaders, renderPage, type Reply, type ViewContext, type ViewRoutes } from "../http.js";
import { graphAsset, IMPORT_MAP_HASH, vendorAsset } from "./assets.js";
import { GRAPH_PAGE } from "./page.js";
import { GraphViewService, layoutPath, type GraphViewOptions } from "./service.js";

/** Same-origin only; nothing on the page is loaded from outside localhost. */
const PAGE_HEADERS = pageHeaders(`'${IMPORT_MAP_HASH}'`);

export function createGraphRoutes(options: GraphViewOptions & { root: string }): ViewRoutes & { service: GraphViewService } {
  const service = new GraphViewService(options);
  return {
    service,
    /** Returns true when the request was handled. */
    handle(req: IncomingMessage, url: URL, ctx: ViewContext, reply: Reply): boolean {
      const path = url.pathname;
      if (path === "/graph" || path === "/graph/") {
        reply(200, renderPage(GRAPH_PAGE, url), "text/html; charset=utf-8", PAGE_HEADERS);
        return true;
      }
      if (path.startsWith("/graph/assets/")) {
        const code = graphAsset(path.slice("/graph/assets/".length));
        if (code === undefined) reply(404, { error: "not found" });
        else reply(200, code, "text/javascript; charset=utf-8", PAGE_HEADERS);
        return true;
      }
      if (path.startsWith("/graph/vendor/")) {
        const code = vendorAsset(path.slice("/graph/vendor/".length));
        if (code === undefined) reply(404, { error: "not found" });
        else reply(200, code, "text/javascript; charset=utf-8", { ...PAGE_HEADERS, "cache-control": "public, max-age=86400" });
        return true;
      }
      if (!path.startsWith("/api/graph")) return false;
      const post = (): boolean => {
        if (req.method === "POST") return true;
        reply(405, { error: "POST required" });
        return false;
      };
      switch (path) {
        case "/api/graph":
          reply(200, service.view(ctx.engine()));
          return true;
        case "/api/graph/status":
          reply(200, service.status(ctx.engine()));
          return true;
        case "/api/graph/search":
          reply(200, service.search(ctx.engine(), url.searchParams.get("q") ?? "", Math.min(Number(url.searchParams.get("limit")) || 30, 100)));
          return true;
        case "/api/graph/node": {
          const detail = service.detail(ctx.engine(), url.searchParams.get("id") ?? "");
          if (detail) reply(200, detail);
          else reply(404, { error: "no such node" });
          return true;
        }
        case "/api/graph/freshness":
          reply(200, ctx.engine().freshness());
          return true;
        case "/api/graph/refresh":
          if (post()) reply(200, service.view(ctx.reindex()));
          return true;
        case "/api/graph/relayout":
          if (post()) {
            rmSync(layoutPath(options.root, options.stateDirectory), { force: true });
            reply(200, service.view(ctx.reindex()));
          }
          return true;
        default:
          reply(404, { error: "not found" });
          return true;
      }
    },
  };
}
