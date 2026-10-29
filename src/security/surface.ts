import type { BriefingFacts, Route } from "../codebase-briefing/facts.js";
import { cleanLine } from "./sast.js";
import type { FehmEngine } from "../engine.js";
import { secFinding } from "./rules.js";
import type { AttackSurface, RouteControl, SecurityFinding, SurfaceRoute } from "./types.js";

/**
 * Attack surface: every route the 3.2 facts found, with the controls in
 * front of it. A control is "detected" when there is evidence at the route
 * (middleware in its registration, a decorator, a guard or dependency), in
 * front of it (`app.use(auth)` earlier in the file) or in its handler (a
 * session/user check). "Not detected" means no such evidence, not that the
 * route is exposed: authentication can live in a proxy or gateway Fehm
 * cannot see. Findings are phrased that way.
 */

const AUTHN = /\b(?:auth|authn|authMiddleware|authGuard|authRequired|authenticate\w*|requireUser|requireLogin|ensureLoggedIn|isAuthenticated|isLoggedIn|passport\.authenticate|verifyToken|verifyJwt|checkJwt|expressjwt|jwtAuth|protect(?:ed)?|requireSession|withAuth|clerkMiddleware|requireAuth|login_required|jwt_required|fresh_jwt_required|IsAuthenticated|get_current_user|current_user|getServerSession|getSession|currentUser|UseGuards|Authorize|authenticated|session\.user|req\.user|request\.user|ctx\.state\.user|bearer)\b/i;
const AUTHZ = /\b(?:requireRole|hasRole|checkRole|requireRoles?|authorize\w*|permit\w*|can\(|ability|isAdmin|requireAdmin|adminOnly|ensureAdmin|permissions?|policy|PreAuthorize|Secured|RolesAllowed|has_permission|permission_required|permission_classes|IsAdminUser|staff_member_required|user_passes_test|is_superuser|is_staff|role\s*(?:===?|!==?|in|==)|\.role\b|roles\.includes|ownerId|owner_id|userId\s*(?:===?|!==?))/i;
const VALIDATE = /\b(?:z\.object|\.safeParse\(|\.parse\(|Joi\.|yup\.|celebrate\(|validationResult|checkSchema|body\(\s*["']|param\(\s*["']|query\(\s*["']|validate\w*\(|ajv|class-validator|ValidationPipe|@Valid\b|BaseModel|pydantic|Schema\(|marshmallow|serializer\.is_valid|form\.validate)/;
const RATE = /\b(?:rateLimit\w*|RateLimit\w*|limiter|slowDown|throttle\w*|Throttle|@limiter\.limit|ratelimit|rate_limit|express-rate-limit|express-slow-down|slowapi|django_ratelimit|bottleneck)\b/i;
const WEBHOOK_PATH = /webhook|\/hooks?\b|callback|\/stripe|\/github|\/slack|\/twilio|\/events?\b/i;
const WEBHOOK_VERIFY = /signature|constructEvent|verifyWebhook|webhooks\.verify|validateRequest|x-hub-signature|stripe-signature|x-slack-signature|svix|hmac|timingSafeEqual|compare_digest|verify_signature|x-twilio-signature/i;
const SENSITIVE_PATH: [RegExp, string][] = [
  [/admin|internal|manage|superuser|staff/i, "administrative"],
  [/users?\b|accounts?|profile|me\b/i, "user data"],
  [/pay|billing|checkout|invoice|charge|refund|order/i, "payments"],
  [/login|logout|signin|signup|register|password|reset|token|auth|session|oauth|mfa|otp/i, "authentication"],
  [/upload|import|files?\b|download|export/i, "files"],
  [/delete|remove|destroy/i, "destructive"],
  [/debug|config|settings|\benv\b|secret|\bkeys?\b/i, "operational"],
];
/** ANY (switch or comparison dispatch) is not assumed to change state: the method is unknown. */
const STATE_CHANGING = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const DB_PKG = /^(?:pg|mysql2?|mariadb|sqlite3|better-sqlite3|@prisma\/client|prisma|mongoose|mongodb|sequelize|knex|typeorm|drizzle-orm|redis|ioredis|psycopg2?|sqlalchemy|pymongo|django\.db|asyncpg|aiosqlite|gorm)/;
const LLM_PKG = /^(?:openai|@anthropic-ai\/sdk|anthropic|@google\/generative-ai|@google\/genai|google\.generativeai|cohere|cohere-ai|mistralai|@mistralai\/mistralai|ollama|groq-sdk|groq|ai|@ai-sdk\/\w+|langchain|@langchain\/\w+|llamaindex|llama_index|litellm)$/;

function ctrl(state: RouteControl["state"], ev?: { path: string; line: number; text: string }): RouteControl {
  return ev ? { state, evidence: { ...ev, text: ev.text.trim().slice(0, 160) } } : { state };
}

export interface SurfaceInputs {
  engine: FehmEngine;
  facts: BriefingFacts;
  skip: (p: string) => boolean;
  /** Findings per file:line for route counts (taint and pattern findings). */
  findingLines: Map<string, number>;
}

export function analyzeSurface({ engine, facts, skip, findingLines }: SurfaceInputs): { surface: AttackSurface; findings: SecurityFinding[]; hasAuth: boolean; hasRateLimit: boolean; localOnly: boolean } {
  const routes = facts.signals.routes.filter((r) => !skip(r.path));
  const globalControls: AttackSurface["globalControls"] = [];
  // app.use / router.use middleware, per file, in order.
  const uses = new Map<string, { line: number; text: string }[]>();
  for (const f of facts.sourceFiles) {
    if (skip(f)) continue;
    facts.lines(f).forEach((raw, i) => {
      const l = code(raw, f);
      if (/\b(?:app|router|server|api|fastify)\.(?:use|register|addHook)\(/.test(l) || /\bMIDDLEWARE\s*=|app\.add_middleware\(|@app\.before_request/.test(l)) {
        uses.set(f, [...(uses.get(f) ?? []), { line: i + 1, text: l }]);
        const name = AUTHN.test(l) ? "authentication middleware" : RATE.test(l) ? "rate limiting" : /helmet|csp|securityHeaders/i.test(l) ? "security headers" : /csrf|csurf|lusca/i.test(l) ? "CSRF protection" : /cors\(/.test(l) ? "CORS" : undefined;
        if (name) globalControls.push({ name, evidence: { path: f, line: i + 1, text: l.trim().slice(0, 160) } });
      }
    });
  }
  function code(line: string, path: string): string {
    return /^\s*(?:\/\/|#(?!\[)|\*|\/\*)/.test(line) ? "" : cleanLine(line, /\.py$/.test(path) ? "py" : "js");
  }
  const pkgFiles = (re: RegExp): Set<string> => new Set(facts.packages.filter((p) => re.test(p.name)).flatMap((p) => p.importers));
  const dbFiles = new Set([...pkgFiles(DB_PKG), ...[...facts.signals.tables.values()].flat().map((t) => t.path)]);
  const llmFiles = pkgFiles(LLM_PKG);
  const writeFiles = new Set(facts.signals.fileWrites.map((w) => w.path));
  const netFiles = new Set(facts.signals.outbound.map((o) => o.path));
  const procFiles = new Set(facts.signals.sinks.filter((s) => s.kind === "process execution").map((s) => s.path));

  const out: SurfaceRoute[] = [];
  const seen = new Set<string>();
  for (const r of routes) {
    const id = `${r.method} ${r.route} @ ${r.path}:${r.line}`;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(routeOf(r, id));
  }

  function routeOf(r: Route, id: string): SurfaceRoute {
    const raw = facts.lines(r.path);
    const lines = raw.map((l) => code(l, r.path));
    // The registration call only: continue onto the next lines while it is still open (trailing "," or "(").
    let registration = lines[r.line - 1] ?? "";
    for (let j = r.line; j < r.line + 3 && /[,(]\s*$/.test(lines[j - 1] ?? ""); j += 1) registration += ` ${lines[j] ?? ""}`;
    const above = lines.slice(Math.max(0, r.line - 7), r.line - 1);
    const handler = r.handler;
    // A named handler's body; an inline handler inside the registration call; or the function under a route decorator.
    const decorated = /^\s*@/.test(raw[r.line - 1] ?? "");
    const inline = !handler && (decorated || /=>|\bfunction\s*\(|\basync\s*\(/.test(registration));
    const inlineRange = (): [number, number] => {
      if (decorated) {
        const def = raw.slice(r.line, r.line + 6).findIndex((l) => /^\s*(?:async\s+)?def\s+\w+|^\s*(?:public|private|protected)?\s*[\w<>[\]]+\s+\w+\s*\(/.test(l));
        if (def < 0) return [r.line, r.line];
        const start = r.line + def + 1;
        const indent = (raw[start - 1] ?? "").search(/\S/);
        let end = start;
        for (let j = start; j < Math.min(raw.length, start + 200); j += 1) {
          const l = raw[j] ?? "";
          if (l.trim() && l.search(/\S/) <= indent) break;
          end = j + 1;
        }
        return [start, end];
      }
      let end = r.line;
      for (let j = r.line - 1; j < Math.min(lines.length, r.line + 80); j += 1) {
        end = j + 1;
        if (j > r.line - 1 && /^\s*\}\s*\)\s*;?\s*$/.test(raw[j] ?? "")) break;
        if (j === r.line - 1 && /\}\s*\)\s*;?\s*$/.test(raw[j] ?? "")) break;
      }
      return [r.line, end];
    };
    const range: { path: string; from: number; to: number } | undefined = handler?.path && handler.location?.endLine ? { path: handler.path, from: handler.location.line, to: Math.min(handler.location.endLine, handler.location.line + 150) } : inline ? (([a, b]) => ({ path: r.path, from: a, to: b }))(inlineRange()) : undefined;
    const body = range ? facts.lines(range.path).slice(range.from - 1, range.to).map((l) => code(l, range.path)) : [];
    const hLoc = handler?.path && handler.location ? { path: handler.path, line: handler.location.line } : { path: r.path, line: r.line };
    const before = (uses.get(r.path) ?? []).filter((u) => u.line < r.line);
    const find = (re: RegExp): RouteControl => {
      // Registration arguments only (not the path string or handler body in the same line).
      const args = registration.replace(/["'`][^"'`]*["'`]/, "");
      if (re.test(args) && re !== VALIDATE) return ctrl("detected", { path: r.path, line: r.line, text: raw[r.line - 1] ?? "" });
      const dec = above.findIndex((l) => /^\s*@/.test(l) && re.test(l));
      if (dec >= 0) return ctrl("detected", { path: r.path, line: r.line - above.length + dec, text: above[dec]! });
      const glob = before.find((u) => re.test(u.text));
      if (glob) return ctrl("detected", { path: r.path, line: glob.line, text: glob.text });
      const inBody = body.findIndex((l) => re.test(l));
      if (inBody >= 0) return ctrl("detected", { path: hLoc.path, line: hLoc.line + inBody, text: body[inBody]! });
      return ctrl(handler || inline || r.style === "decorator" || r.style === "annotation" ? "not-detected" : "unknown");
    };
    const flow = handler ? engine.flow(handler.id, 3) : undefined;
    // Files the handler reaches: through the graph's call tree for a resolved handler, or the functions an inline body calls.
    const files = new Set<string>(handler?.path ? [handler.path] : []);
    if (flow?.status === "found") {
      const walk = (s: typeof flow.result): void => {
        if (s.path) files.add(s.path);
        s.children.forEach(walk);
      };
      walk(flow.result);
    } else if (body.length) {
      for (const m of body.join("\n").matchAll(/\b([A-Za-z_$][\w$]*)\s*\(/g)) {
        for (const n of engine.graph.findByName(m[1]!).slice(0, 3)) if ((n.kind === "function" || n.kind === "method") && n.path && n.path !== r.path) {
          files.add(n.path);
          const f = engine.flow(n.id, 2);
          if (f.status === "found") {
            const walk = (s: typeof f.result): void => {
              if (s.path) files.add(s.path);
              s.children.forEach(walk);
            };
            walk(f.result);
          }
        }
      }
    }
    const bodyText = body.join("\n");
    const any = (set: Set<string>): boolean => [...files].some((f) => set.has(f));
    const method = r.method.toUpperCase();
    const kind: SurfaceRoute["kind"] = /graphql/i.test(r.route) ? "graphql" : /\bmcp\b/i.test(r.route) ? "mcp" : WEBHOOK_PATH.test(r.route) ? "webhook" : "http";
    const validation = find(VALIDATE);
    return {
      id,
      method,
      route: r.route,
      path: r.path,
      line: r.line,
      ...(handler ? { handler: { name: handler.name, nodeId: handler.id } } : {}),
      kind,
      stateChanging: STATE_CHANGING.has(method),
      sensitive: SENSITIVE_PATH.filter(([re]) => re.test(r.route)).map(([, label]) => label),
      authentication: find(AUTHN),
      authorization: find(AUTHZ),
      validation: method === "GET" && validation.state !== "detected" ? ctrl("not-applicable") : validation,
      rateLimit: find(RATE),
      reaches: {
        database: any(dbFiles) || /\.(?:query|execute|raw)\(|\bprisma\.|\bcursor\b|\bknex\(/.test(bodyText),
        filesystem: any(writeFiles) || /\b(?:writeFile|writeFileSync|unlink|createWriteStream|appendFile)\(|\bopen\([^)]*["'][wa]/.test(bodyText),
        network: any(netFiles) || /\bfetch\(|\baxios\b|\brequests\.|\bhttpx\./.test(bodyText),
        process: any(procFiles) || /(?<![\w.])(?:exec|execSync|spawn|execFile)\(|\bsubprocess\.|\bos\.system\(/.test(bodyText),
        llm: any(llmFiles) || /\.(?:chat\.completions\.create|messages\.create|responses\.create|generateContent)\(|\b(?:generateText|streamText)\(/.test(bodyText),
      },
      // Findings inside the handler's own lines.
      findings: range ? [...findingLines].filter(([k]) => {
        const at = k.lastIndexOf(":");
        const line = Number(k.slice(at + 1));
        return k.slice(0, at) === range.path && line >= range.from && line <= range.to;
      }).reduce((a, [, n]) => a + n, 0) : 0,
    };
  }

  const hasAuth = out.some((r) => r.authentication.state === "detected") || globalControls.some((g) => g.name === "authentication middleware");
  const hasRateLimit = out.some((r) => r.rateLimit.state === "detected") || globalControls.some((g) => g.name === "rate limiting");
  const hosts = facts.signals.listenHosts;
  const localOnly = hosts.length > 0 && hosts.every((h) => /127\.0\.0\.1|localhost|::1/.test(h.text));
  const findings: SecurityFinding[] = [];
  // Webhooks authenticate by signature (checked separately), not by user session.
  const unauth = out.filter((r) => r.kind !== "webhook" && r.authentication.state === "not-detected" && (r.stateChanging || r.sensitive.length));

  if (out.length && !hasAuth) {
    findings.push(
      secFinding("sec/route-no-authentication", {
        id: "sec:auth:none",
        severity: localOnly ? "low" : "medium",
        title: `No authentication mechanism was detected for ${out.length} ${out.length === 1 ? "route" : "routes"}`,
        message: `No route, middleware, decorator or handler shows an authentication check.${localOnly ? " Every server found listens on localhost only, which limits who can reach it." : ""} Authentication may still be enforced by a proxy or gateway outside this repository.`,
        why: "Without authentication, anyone who can reach the service can call every route.",
        action: localOnly ? "Keep the service bound to localhost, or add authentication before exposing it." : "Add authentication middleware in front of the routes (or document the gateway that enforces it).",
        confidence: "inferred",
        evidence: out.slice(0, 30).map((r) => ({ type: "absence" as const, path: r.path, line: r.line, detail: `${r.method} ${r.route}` })),
        total: out.length,
        controlsMissing: ["authentication"],
        missing: ["Gateway, proxy or platform authentication (not visible in code)."],
      }),
    );
  } else {
    for (const r of unauth.slice(0, 40)) {
      findings.push(
        secFinding("sec/route-no-authentication", {
          id: `sec:auth:${r.id}`,
          severity: r.stateChanging && r.sensitive.length ? "high" : "medium",
          title: `No authentication control detected on ${r.method} ${r.route}`,
          message: `Other routes in this application authenticate; this one shows no middleware, decorator or handler check${r.sensitive.length ? ` and handles ${r.sensitive.join(", ")}` : ""}.`,
          why: "One route without the check the others have is a common way into an otherwise protected application.",
          action: "Add the same authentication middleware as the other routes, or document why this route is public.",
          confidence: "inferred",
          file: r.path,
          line: r.line,
          ...(r.handler ? { nodeId: r.handler.nodeId } : {}),
          evidence: [{ type: "absence", path: r.path, line: r.line, detail: `${r.method} ${r.route}: no authentication at the registration, in a decorator, in earlier middleware or in the handler` }],
          controlsMissing: ["authentication"],
          missing: ["Authentication applied by a mounting router in another file, a gateway or a proxy."],
        }),
      );
    }
  }
  for (const r of out.filter((x) => x.authentication.state === "detected" && x.authorization.state !== "detected" && x.sensitive.includes("administrative")).slice(0, 20)) {
    findings.push(
      secFinding("sec/route-no-authorization", {
        id: `sec:authz:${r.id}`,
        title: `No authorization control detected on ${r.method} ${r.route}`,
        message: "Authentication is detected, but no role, permission or ownership check was found for this administrative route.",
        why: "Authenticated is not the same as allowed: without an authorization check, any signed-in user may reach administrative functions.",
        action: "Check the caller's role or permission before acting (and ownership for per-object routes).",
        confidence: "inferred",
        file: r.path,
        line: r.line,
        evidence: [r.authentication.evidence ? { type: "framework", path: r.authentication.evidence.path, line: r.authentication.evidence.line, detail: `authentication: ${r.authentication.evidence.text}` } : { type: "framework", path: r.path, line: r.line, detail: "authentication detected" }, { type: "absence", path: r.path, line: r.line, detail: "no role / permission / ownership check found" }],
        controlsDetected: ["authentication"],
        controlsMissing: ["authorization"],
      }),
    );
  }
  for (const r of out.filter((x) => x.kind === "webhook" && x.stateChanging)) {
    const texts = [r.path, ...(r.handler ? [] : [])].map((p) => facts.lines(p).join("\n")).join("\n");
    if (WEBHOOK_VERIFY.test(texts)) continue;
    findings.push(secFinding("sec/webhook-unverified", { id: `sec:webhook:${r.id}`, title: `Webhook ${r.method} ${r.route} does not appear to verify a signature`, message: "No signature, HMAC or provider verification call was found in the file that registers it.", why: "Anyone who knows the URL can send forged events.", action: "Verify the provider's signature header (for example stripe.webhooks.constructEvent, or an HMAC with timingSafeEqual) before trusting the payload.", confidence: "inferred", file: r.path, line: r.line, evidence: [{ type: "absence", path: r.path, line: r.line, detail: "no signature verification detected" }] }));
  }
  const unvalidated = out.filter((r) => r.stateChanging && r.validation.state === "not-detected");
  if (unvalidated.length && !localOnly) findings.push(secFinding("sec/route-no-validation", { id: "sec:validation", title: `${unvalidated.length} state-changing ${unvalidated.length === 1 ? "route shows" : "routes show"} no input validation`, message: "No schema or validator (zod, Joi, yup, express-validator, pydantic, class-validator …) at the route or in its handler.", why: "Unvalidated input reaches business logic and storage in whatever shape the client sends.", action: "Validate request bodies against a schema at the edge.", confidence: "inferred", evidence: unvalidated.slice(0, 30).map((r) => ({ type: "absence" as const, path: r.path, line: r.line, detail: `${r.method} ${r.route}` })), total: unvalidated.length }));
  const authRoutes = out.filter((r) => r.sensitive.includes("authentication") && r.rateLimit.state !== "detected");
  if (authRoutes.length && !hasRateLimit) findings.push(secFinding("sec/no-rate-limit", { id: "sec:rate-limit", severity: "medium", title: `Login and credential routes have no rate limiting`, message: `${authRoutes.length} authentication-related ${authRoutes.length === 1 ? "route" : "routes"}; no rate limiter anywhere in the application.`, why: "Without a limit, passwords and tokens can be guessed at full speed.", action: "Add a rate limiter (express-rate-limit, slowapi, a gateway limit) at least to authentication routes.", confidence: "inferred", evidence: authRoutes.map((r) => ({ type: "absence" as const, path: r.path, line: r.line, detail: `${r.method} ${r.route}` })) }));

  const surface: AttackSurface = {
    routes: out,
    totals: { routes: out.length, unauthenticated: out.filter((r) => r.authentication.state !== "detected").length, unauthenticatedStateChanging: out.filter((r) => r.authentication.state !== "detected" && r.stateChanging).length, sensitive: out.filter((r) => r.sensitive.length).length, withFindings: out.filter((r) => r.findings).length, webhooks: out.filter((r) => r.kind === "webhook").length, mcp: out.filter((r) => r.kind === "mcp").length },
    globalControls,
  };
  return { surface, findings, hasAuth, hasRateLimit, localOnly };
}
