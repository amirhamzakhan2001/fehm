import type { GraphNode } from "../model.js";
import type { ArchEvidence, ArchNode, ArchRelationship } from "./types.js";
import { callees, componentOf, entryPoints, evOf, layoutEdge, layoutNode, mergeRelations, node, relation, type Availability, type ViewContext, type ViewResult } from "./view-kit.js";

/**
 * Security view: trust zones and the controls between them, from static
 * signals. Callers sit outside; entry components form the public zone; the
 * code they reach is the trusted application zone; stores are the data zone.
 * Authentication is code importing an auth library or auth-named functions
 * that entry code actually calls. Each HTTP route is checked for whether its
 * call tree reaches authentication. Sinks (process execution, eval, raw HTML,
 * unsafe deserialization) and secrets read from the environment are shown with
 * their evidence. It is a map of static signals, not a security audit.
 */

const AUTH_NAME = /(authenticat|authoriz|login|logout|signin|sign_in|session|verif(y|ies)?_?token|jwt|oauth|password|permission|require_?auth|is_?authenticated|guard|acl|rbac|csrf)/i;
const SECRET_ENV = /(SECRET|TOKEN|PASSWORD|PASSWD|PRIVATE|API_?KEY|ACCESS_?KEY|CREDENTIAL|AUTH|SIGNING|SALT|DSN|DATABASE_URL)/;
const AUTH_DEPTH = 4;

interface AuthFinding {
  functions: Map<string, GraphNode>;
  libraries: Map<string, string[]>;
}

function authCode(ctx: ViewContext): AuthFinding {
  const functions = new Map<string, GraphNode>();
  for (const n of ctx.engine.graph.nodes()) {
    if ((n.kind !== "function" && n.kind !== "method") || !n.path || ctx.facts.roleByPath.get(n.path) !== "source") continue;
    if (AUTH_NAME.test(n.name.split(".").pop()!)) functions.set(n.id, n);
  }
  const libraries = new Map<string, string[]>();
  for (const p of ctx.facts.packages) {
    if (p.info?.category !== "auth" && p.info?.category !== "security") continue;
    const importers = ctx.facts.runtimeImporters(p);
    if (importers.length) libraries.set(p.info.label, importers);
  }
  return { functions, libraries };
}

export function securityAvailability(ctx: ViewContext): Availability {
  const s = ctx.facts.signals;
  const auth = authCode(ctx);
  if (!s.routes.length && !auth.functions.size && !auth.libraries.size && !s.sinks.length && !s.cli.length) return { available: false, reason: "No entry points, authentication code, security-sensitive sinks or secrets were detected." };
  return { available: true };
}

export function securityView(ctx: ViewContext): ViewResult {
  const { facts } = ctx;
  const signals = facts.signals;
  const auth = authCode(ctx);
  const nodes = new Map<string, { n: ArchNode; rank: number }>();
  const rels: ArchRelationship[] = [];
  const put = (n: ArchNode, rank: number): string => {
    const prev = nodes.get(n.id);
    if (!prev || rank < prev.rank) nodes.set(n.id, { n, rank });
    return n.id;
  };
  const RANK = { outside: 0, public: 1, auth: 2, trusted: 3, data: 4 };
  const localOnly = signals.listenHosts.length > 0 && signals.listenHosts.every((h) => h.text === "127.0.0.1" || h.text === "localhost");

  // Entry components: those holding route handlers or CLI dispatch.
  const entries = entryPoints(ctx);
  const entryComps = new Map<string, ArchNode>();
  for (const e of entries) {
    const c = componentOf(ctx, e.handler.path);
    if (c && (e.kind === "http" || e.kind === "cli")) entryComps.set(c.id, c);
  }
  for (const r of signals.routes) {
    const c = componentOf(ctx, r.path);
    if (c) entryComps.set(c.id, c);
  }

  // Which auth functions entry code reaches, and which routes reach none.
  const reachesAuth = (start: GraphNode): GraphNode | undefined => {
    const seen = new Set<string>();
    const stack: [GraphNode, number][] = [[start, 0]];
    while (stack.length) {
      const [fn, d] = stack.pop()!;
      if (seen.has(fn.id)) continue;
      seen.add(fn.id);
      if (auth.functions.has(fn.id) && fn.id !== start.id) return fn;
      if (d < AUTH_DEPTH) for (const c of callees(ctx, fn.id)) stack.push([c.node, d + 1]);
    }
    return undefined;
  };
  const protectedRoutes: string[] = [];
  const openRoutes: ArchEvidence[] = [];
  const authUsers = new Map<string, { comp: ArchNode; via: GraphNode; ev: ArchEvidence }[]>();
  const authEndpoints: string[] = [];
  for (const e of entries) {
    if (e.kind !== "http") continue;
    if (auth.functions.has(e.handler.id)) {
      authEndpoints.push(e.label);
      continue;
    }
    const hit = reachesAuth(e.handler);
    const comp = componentOf(ctx, e.handler.path);
    if (hit && comp) {
      protectedRoutes.push(e.label);
      const owner = componentOf(ctx, hit.path)?.id ?? "?";
      authUsers.set(owner, [...(authUsers.get(owner) ?? []), { comp, via: hit, ev: { ...e.evidence, detail: `${e.label} reaches ${hit.name}` } }]);
    } else openRoutes.push({ ...e.evidence, detail: `${e.label}: no authentication check reached within ${AUTH_DEPTH} calls` });
  }

  // Callers.
  if (signals.routes.length || entries.some((e) => e.kind === "http")) put(node("sec:callers", "actor", localOnly ? "Local clients (localhost)" : "Network clients", { tier: 0, confidence: signals.listenHosts.length ? "strong" : "inferred", reasons: [localOnly ? "every server listens on localhost" : signals.listenHosts.length ? `listens on ${[...new Set(signals.listenHosts.map((h) => h.text))].join(", ")}` : "HTTP routes are registered; the bind address is not visible in code"], evidence: signals.listenHosts.slice(0, 4).map((h) => ({ path: h.path, line: h.line, provenance: "heuristic" as const, detail: `listen ${h.text}` })) }), RANK.outside);
  if (signals.cli.length || facts.binTargets.length) put(node("sec:operator", "actor", "Local operator (CLI)", { tier: 0, confidence: "strong", reasons: ["command-line entry points run with the caller's privileges"] }), RANK.outside);

  for (const c of entryComps.values()) {
    put(c, RANK.public);
    const isHttp = signals.routes.some((r) => componentOf(ctx, r.path)?.id === c.id);
    if (isHttp && nodes.has("sec:callers")) rels.push(relation("sec:callers", c.id, "requests", { label: "HTTP", confidence: "strong", evidence: signals.routes.filter((r) => componentOf(ctx, r.path)?.id === c.id).slice(0, 4).map((r) => ({ path: r.path, line: r.line, provenance: "heuristic" as const, detail: `${r.method} ${r.route}` })) }));
    else if (nodes.has("sec:operator")) rels.push(relation("sec:operator", c.id, "invokes", { label: "runs", confidence: "strong" }));
  }

  // Authentication nodes: one per component holding auth functions entry code reaches, plus auth libraries.
  const authComps = new Map<string, GraphNode[]>();
  for (const [owner, users] of authUsers) authComps.set(owner, [...new Set(users.map((u) => u.via))]);
  for (const [owner, fns] of authComps) {
    const comp = ctx.byId.get(owner);
    const id = `sec:auth:${owner}`;
    put(node(id, "auth", comp ? `${comp.name} auth` : "Authentication", { confidence: "strong", reasons: [`functions: ${fns.map((f) => f.name).slice(0, 4).join(", ")}`, "reached from HTTP handlers"], evidence: fns.slice(0, 6).map((f) => evOf(f, "authentication function")), files: [...new Set(fns.map((f) => f.path!))], graphNodeId: fns[0]!.id }), RANK.auth);
    for (const u of authUsers.get(owner)!) rels.push(relation(u.comp.id, id, "authenticates", { label: "checks", evidence: [u.ev], confidence: "strong" }));
  }
  for (const [lib, importers] of auth.libraries) {
    const id = `sec:lib:${lib}`;
    put(node(id, "auth", lib, { confidence: "verified", reasons: ["auth/security library imported by runtime code"], evidence: importers.slice(0, 6).map((f) => ({ path: f, nodeId: `file:${f}`, provenance: "ast" as const, detail: `imports ${lib}` })), technologies: [lib] }), RANK.auth);
    for (const f of importers) {
      const c = componentOf(ctx, f);
      if (c) rels.push(relation(put(c, entryComps.has(c.id) ? RANK.public : RANK.trusted), id, "uses", { label: "uses", confidence: "verified" }));
    }
  }

  // Trusted zone: components the entry components depend on (one hop), and their stores.
  for (const r of ctx.model.relationships) {
    if (!entryComps.has(r.source) || !r.target.startsWith("component:") || entryComps.has(r.target)) continue;
    put(ctx.byId.get(r.target)!, RANK.trusted);
    rels.push({ ...r });
  }
  for (const r of ctx.model.relationships) {
    const target = ctx.byId.get(r.target);
    if (!target || target.tier !== 3 || !nodes.has(r.source)) continue;
    put(target, RANK.data);
    rels.push({ ...r });
  }

  // Secrets and sinks.
  const secretUse = new Map<string, ArchEvidence[]>();
  for (const [name, uses] of signals.env) {
    if (!SECRET_ENV.test(name)) continue;
    for (const u of uses) {
      const c = componentOf(ctx, u.path);
      if (c) secretUse.set(c.id, [...(secretUse.get(c.id) ?? []), { path: u.path, line: u.line, provenance: "heuristic", detail: `reads ${name}` }]);
    }
  }
  if (secretUse.size) {
    const names = [...signals.env.keys()].filter((n) => SECRET_ENV.test(n));
    put(node("sec:secrets", "secret", "Secrets (environment)", { tier: 3, confidence: "strong", reasons: [`${names.length} secret-like variables: ${names.slice(0, 6).join(", ")}`] }), RANK.data);
    for (const [c, evs] of secretUse) rels.push(relation(put(ctx.byId.get(c)!, nodes.get(c)?.rank ?? RANK.trusted), "sec:secrets", "reads", { label: "reads", evidence: evs.slice(0, 6), confidence: "strong", weight: evs.length }));
  }
  const byKind = new Map<string, ArchEvidence[]>();
  for (const s of signals.sinks) byKind.set(s.kind, [...(byKind.get(s.kind) ?? []), { path: s.path, line: s.line, provenance: "heuristic", detail: s.text }]);
  for (const [kind, evs] of byKind) {
    const id = `sec:sink:${kind}`;
    put(node(id, "sink", kind.charAt(0).toUpperCase() + kind.slice(1), { tier: 3, confidence: "strong", reasons: [`${evs.length} call ${evs.length === 1 ? "site" : "sites"}`, "security-sensitive operation; review inputs that reach it"], evidence: evs.slice(0, 8) }), RANK.data);
    for (const e of evs) {
      const c = componentOf(ctx, e.path);
      if (c) rels.push(relation(put(c, nodes.get(c.id)?.rank ?? RANK.trusted), id, "uses", { label: "calls", evidence: [e], confidence: "strong" }));
    }
  }

  if (nodes.size < 2) return { error: "not enough security signals to draw" };
  const merged = mergeRelations(rels).filter((r) => nodes.has(r.source) && nodes.has(r.target) && r.source !== r.target);
  const shown = [...nodes.values()];
  const zone = (rank: number): string[] => shown.filter((x) => x.rank === rank).map((x) => x.n.id);
  const boundaries = [
    { id: "boundary:zone:public", title: localOnly ? "Entry points (localhost only)" : "Public entry points", members: zone(RANK.public) },
    { id: "boundary:zone:auth", title: "Authentication", members: zone(RANK.auth) },
    { id: "boundary:zone:trusted", title: "Trusted application code", members: zone(RANK.trusted) },
    { id: "boundary:zone:data", title: "Data, secrets and sinks", members: zone(RANK.data) },
  ].filter((b) => b.members.length);
  const notes = ["Static signals only — not a security audit. Absence of a finding is not evidence of safety."];
  if (authEndpoints.length) notes.push(`Authentication endpoints: ${authEndpoints.slice(0, 6).join(", ")}.`);
  if (protectedRoutes.length || openRoutes.length) notes.push(`${protectedRoutes.length} of ${protectedRoutes.length + openRoutes.length} HTTP routes reach an authentication function within ${AUTH_DEPTH} calls.`);
  // Routes without a reachable auth check are evidence on the view's own callers node (model nodes are shared, never mutated).
  const callers = nodes.get("sec:callers");
  if (openRoutes.length && callers) callers.n.evidence = [...openRoutes.slice(0, 12), ...callers.n.evidence];
  const headers = signals.securityHeaders.length;
  notes.push(headers ? `${headers} security-header / CORS call sites found.` : "No security headers or CORS configuration found in code.");
  return {
    view: "security",
    title: "Security architecture",
    nodes: shown.map((x) => x.n),
    relationships: merged,
    input: { view: "security", nodes: shown.map((x) => layoutNode(x.n, "middle", { rank: x.rank })), edges: merged.map((r) => layoutEdge(r)), boundaries },
    path: [{ id: "system", name: ctx.model.repository.name }, { id: "security", name: "Security" }],
    notes,
  };
}
