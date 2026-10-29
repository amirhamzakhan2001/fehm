import type { IncomingMessage } from "node:http";
import { pageAsset } from "../graph/assets.js";
import { pageHeaders, type Reply, type ViewContext, type ViewRoutes } from "../http.js";
import { DASHBOARD_PAGE } from "./page.js";

const PAGE_HEADERS = pageHeaders();

/** The dashboard shell at `/`. Its data comes from the engine routes (`/api/status`, `/api/freshness`). */
export function createDashboardRoutes(): ViewRoutes {
  return {
    handle(_req: IncomingMessage, url: URL, _ctx: ViewContext, reply: Reply): boolean {
      const path = url.pathname;
      if (path === "/") {
        reply(200, DASHBOARD_PAGE, "text/html; charset=utf-8", PAGE_HEADERS);
        return true;
      }
      if (path.startsWith("/dashboard/assets/")) {
        const code = pageAsset(path.slice("/dashboard/assets/".length));
        if (code === undefined) reply(404, { error: "not found" });
        else reply(200, code, "text/javascript; charset=utf-8", PAGE_HEADERS);
        return true;
      }
      return false;
    },
  };
}
