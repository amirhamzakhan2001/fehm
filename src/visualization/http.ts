import type { IncomingMessage } from "node:http";
import type { FehmEngine } from "../engine.js";

/** What every localhost view gets from the server: the one shared engine. */
export interface ViewContext {
  engine(): FehmEngine;
  /** Re-synchronize the Feature 1 index (incremental) and return the new engine. */
  reindex(): FehmEngine;
}

export type Reply = (status: number, body: unknown, type?: string, headers?: Record<string, string>) => void;

/** A view's route table. `handle` returns true when it answered the request. */
export interface ViewRoutes {
  handle(req: IncomingMessage, url: URL, ctx: ViewContext, reply: Reply): boolean;
}

/**
 * Headers for every HTML page and its modules. Same-origin only; the pages
 * may be framed by the dashboard (`frame-ancestors 'self'`) and nothing else.
 */
export function pageHeaders(extraScriptSource = ""): Record<string, string> {
  const script = ["'self'", extraScriptSource].filter(Boolean).join(" ");
  return {
    "content-security-policy": `default-src 'self'; script-src ${script}; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'self'`,
    "x-content-type-options": "nosniff",
  };
}

/**
 * A feature page as served. Inside the dashboard it is requested with
 * `?embedded`, and marked on `<html>` so its own brand and cross-feature
 * links are hidden before first paint (the dashboard provides them).
 */
export function renderPage(page: string, url: URL): string {
  return url.searchParams.has("embedded") ? page.replace("<html lang=\"en\">", "<html lang=\"en\" class=\"embedded\">") : page;
}
