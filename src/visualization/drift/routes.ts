import type { IncomingMessage } from "node:http";
import { isDecisionKind } from "../../drift/decisions.js";
import { pageAsset } from "../graph/assets.js";
import { pageHeaders, renderPage, type Reply, type ViewContext, type ViewRoutes } from "../http.js";
import { DRIFT_PAGE } from "./page.js";
import { DriftService, type DriftServiceOptions } from "./service.js";

const PAGE_HEADERS = pageHeaders();
const MAX_BODY = 16 * 1024;

/**
 * Feature 3.4 routes: `/drift` page and `/api/drift/*`.
 *
 * Writes (decisions, pattern approvals, baseline) need POST and an `x-fehm`
 * header. A cross-site form cannot set that header without a CORS preflight,
 * which this server never grants.
 */
export function createDriftRoutes(options: DriftServiceOptions = {}): ViewRoutes & { service: DriftService } {
  const service = new DriftService(options);
  return {
    service,
    handle(req: IncomingMessage, url: URL, ctx: ViewContext, reply: Reply): boolean {
      const path = url.pathname;
      if (path === "/drift" || path === "/drift/") {
        reply(200, renderPage(DRIFT_PAGE, url), "text/html; charset=utf-8", PAGE_HEADERS);
        return true;
      }
      if (path.startsWith("/drift/assets/")) {
        const code = pageAsset(path.slice("/drift/assets/".length));
        if (code === undefined) reply(404, { error: "not found" });
        else reply(200, code, "text/javascript; charset=utf-8", PAGE_HEADERS);
        return true;
      }
      if (!path.startsWith("/api/drift")) return false;
      const q = (k: string): string => url.searchParams.get(k) ?? "";
      const engine = ctx.engine();
      /** POST + x-fehm; JSON body (optional). */
      const write = (run: (body: Record<string, unknown>) => { error: string } | object): void => {
        if (req.method !== "POST") return reply(405, { error: "POST required" });
        if (req.headers["x-fehm"] !== "1") return reply(403, { error: "missing x-fehm header" });
        let raw = "";
        let tooBig = false;
        req.on("data", (c: Buffer) => {
          raw += c;
          if (raw.length > MAX_BODY) tooBig = true;
        });
        req.on("end", () => {
          if (tooBig) return reply(413, { error: "body too large" });
          let body: Record<string, unknown> = {};
          try {
            body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
          } catch {
            return reply(400, { error: "invalid JSON" });
          }
          try {
            const result = run(body);
            reply("error" in result ? 409 : 200, result);
          } catch (e) {
            reply(500, { error: (e as Error).message });
          }
        });
      };
      switch (path) {
        case "/api/drift":
          reply(200, service.payload(engine));
          return true;
        case "/api/drift/report":
          reply(200, service.report(engine));
          return true;
        case "/api/drift/finding/context": {
          const text = service.llmContext(engine, q("id"));
          if (text === undefined) reply(404, { error: "unknown finding" });
          else reply(200, text, "text/markdown; charset=utf-8");
          return true;
        }
        case "/api/drift/decision":
          write((b) => {
            const kind = b.kind === null || b.kind === "clear" ? null : String(b.kind ?? "");
            if (kind !== null && !isDecisionKind(kind)) return { error: "kind must be intentional, accepted, dismissed or clear" };
            return service.decideFinding(engine, String(b.id ?? ""), kind, String(b.reason ?? ""));
          });
          return true;
        case "/api/drift/pattern":
          write((b) => {
            const d = b.decision === null || b.decision === "clear" ? null : String(b.decision ?? "");
            if (d !== null && d !== "approved" && d !== "rejected" && d !== "ignored") return { error: "decision must be approved, rejected, ignored or clear" };
            return service.decidePattern(engine, String(b.id ?? ""), d);
          });
          return true;
        case "/api/drift/baseline":
          write(() => (q("clear") ? service.clearBaseline(engine) : service.setBaseline(engine)));
          return true;
        case "/api/drift/history/point": {
          if (!q("ref")) reply(400, { error: "ref required" });
          else reply(200, service.historyPoint(engine, q("ref")));
          return true;
        }
        case "/api/drift/commit": {
          const detail = service.commit(engine, q("ref"), q("path") || undefined);
          reply("error" in detail ? 404 : 200, detail);
          return true;
        }
        case "/api/drift/source": {
          const excerpt = service.source(engine, q("path"), Number(q("line")) || 1);
          reply(excerpt ? 200 : 404, excerpt ?? { error: "not an indexed file" });
          return true;
        }
        case "/api/drift/refresh":
          if (req.method !== "POST") reply(405, { error: "POST required" });
          else reply(200, service.payload(ctx.reindex()));
          return true;
        default:
          reply(404, { error: "not found" });
          return true;
      }
    },
  };
}
