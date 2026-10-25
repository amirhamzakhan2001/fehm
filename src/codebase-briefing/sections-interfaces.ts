import { posix } from "node:path";
import { listText, plural, type SectionBuilder } from "./builder.js";
import { CATEGORY_LABEL, techInfo, type TechCategory } from "./catalog.js";
import { ClaimSet, ev } from "./evidence.js";
import type { BriefingFacts } from "./facts.js";
import { languagesOf, stripItem } from "./sections-structure.js";
import type { Block, BriefingItem } from "./types.js";

type Pkg = BriefingFacts["packages"][number];

function usedPackages(facts: BriefingFacts, categories: TechCategory[]): Pkg[] {
  return facts.packages.filter((p) => p.info && categories.includes(p.info.category) && facts.runtimeImporters(p).length);
}

function declaredOnly(facts: BriefingFacts, categories: TechCategory[]): { name: string; path: string; line: number }[] {
  const imported = new Set(facts.packages.map((p) => p.name));
  return facts.declaredDependencies.filter((d) => !d.dev && !imported.has(d.name) && categories.includes(techInfo(d.name)?.category as TechCategory));
}

function pkgEvidence(facts: BriefingFacts, p: Pkg, max = 4) {
  return facts.runtimeImporters(p).slice(0, max).map((path) => ev(path, facts.graph.edgesOf(p.nodeId, "in", ["imports"]).find((e) => facts.fileOf(e.source) === path)?.evidence.location?.line, { nodeId: `file:${path}`, provenance: p.provenance, detail: `imports ${p.name}` }));
}

// ─── 11 API design ────────────────────────────────────────────────

export const api: SectionBuilder = ({ facts }) => {
  const set = new ClaimSet("api");
  const routes = facts.signals.routes;
  const blocks: Block[] = [];
  const frameworks = usedPackages(facts, ["web-framework"]);
  const nodeHttp = facts.packages.find((p) => (p.name === "node:http" || p.name === "node:https") && facts.runtimeImporters(p).length);
  const fw = frameworks.map((p) => p.info!.label);
  if (!fw.length && nodeHttp) fw.push("Node.js http (no framework)");
  const rows: Extract<Block, { type: "facts" }>["rows"] = [];
  if (fw.length) rows.push({ label: "Framework", value: fw.join(", "), claim: set.observed(`HTTP handled by ${fw.join(", ")}.`, [...frameworks, ...(nodeHttp ? [nodeHttp] : [])].flatMap((p) => pkgEvidence(facts, p, 2))) });
  if (!routes.length) {
    set.unknown("No HTTP routes were detected.", "Routes built dynamically (e.g. from config or loops) are not detected.");
    return { id: "api", title: "API design", question: "What APIs does it expose?", summary: fw.length ? `${fw.join(", ")} imported, but no routes detected` : "No HTTP API detected", blocks: rows.length ? [{ type: "facts", rows }] : [], set };
  }
  rows.push({ label: "Routes", value: String(routes.length) });
  const resolved = routes.filter((r) => r.handler).length;
  rows.push({ label: "Handlers resolved", value: `${resolved} / ${routes.length}` });
  const validators = usedPackages(facts, ["validation"]);
  const routeFiles = new Set(routes.map((r) => r.path));
  const validationInRoutes = facts.signals.validation.filter((v) => routeFiles.has(v.path) || [...routes].some((r) => r.handler?.path === v.path));
  rows.push({
    label: "Validation",
    value: validators.length ? validators.map((v) => v.info!.label).join(", ") : validationInRoutes.length ? "validation calls near handlers" : "no validation library detected",
    claim: validators.length || validationInRoutes.length ? set.observed("Input validation present.", [...validators.flatMap((p) => pkgEvidence(facts, p, 2)), ...validationInRoutes.slice(0, 3).map((v) => ev(v.path, v.line, { provenance: "heuristic" }))]) : set.unknown("No input-validation library or schema validation near route handlers was detected."),
  });
  const authish = routes.filter((r) => r.handler && reachesAuth(facts, r.handler.id));
  rows.push({ label: "Auth checks reachable", value: `${authish.length} / ${routes.length} routes (static call tree)`, claim: set.inferred(`${authish.length} of ${routes.length} route handlers reach an auth/session/token-named function within 3 calls.`, authish.slice(0, 5).map((r) => ev(r.handler!.path ?? r.path, r.handler!.location?.line, { nodeId: r.handler!.id, provenance: r.handler!.evidence.provenance })), 0.5, "Name-based; does not prove enforcement.") });
  blocks.push({ type: "facts", rows });
  const groups = new Map<string, typeof routes>();
  for (const r of routes) {
    const segs = r.route.split("/").filter(Boolean);
    const key = segs[0] === "api" && segs[1] ? `/api/${segs[1]}` : segs[0] ? `/${segs[0]}` : "/";
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  blocks.push({
    type: "groups",
    groups: [...groups.entries()]
      .sort((a, b) => b[1].length - a[1].length || (a[0] < b[0] ? -1 : 1))
      .slice(0, 16)
      .map(([key, rs]) => {
        const claim = set.observed(`${key}: ${plural(rs.length, "route")}.`, rs.slice(0, 6).map((r) => ev(r.path, r.line, { provenance: "heuristic", detail: `${r.method} ${r.route}` })));
        return {
          title: key,
          note: [...new Set(rs.map((r) => r.path))].join(", "),
          items: rs.slice(0, 20).map((r) => stripItem({ title: `${r.method === "ANY" ? "ANY" : r.method} ${r.route}`, detail: r.handler ? `${r.handler.name} · ${r.handler.path}:${r.handler.location?.line ?? "?"}` : `registered at ${r.path}:${r.line}`, claim, path: r.path, line: r.line, nodeId: r.handler?.id, flowFrom: r.handler?.id ?? r.enclosing?.id })),
        };
      }),
  });
  set.unknowns.push("Response models and status codes are not extracted.");
  return { id: "api", title: "API design", question: "What APIs does it expose?", summary: `${plural(routes.length, "route")} in ${plural(groups.size, "group")}${fw.length ? ` · ${fw.join(", ")}` : ""}`, blocks, set };
};

const AUTH_NAME = /auth|session|token|jwt|login|verify|permission|authori[sz]e|credential|guard/i;

function reachesAuth(facts: BriefingFacts, id: string): boolean {
  if (AUTH_NAME.test(facts.graph.node(id)?.name ?? "")) return true;
  return facts.graph.traverse(id, { depth: 3, direction: "out", kinds: ["calls"], limit: 120 }).some((s) => AUTH_NAME.test(facts.graph.node(s.nodeId)?.name ?? ""));
}

// ─── 12 Database ──────────────────────────────────────────────────

export const database: SectionBuilder = ({ facts }) => {
  const set = new ClaimSet("database");
  const blocks: Block[] = [];
  const clients = usedPackages(facts, ["database", "orm", "cache"]);
  const declared = declaredOnly(facts, ["database", "orm", "cache"]);
  const compose = composeServices(facts).filter((s) => /postgres|mysql|mariadb|mongo|redis|sqlite|cockroach|dynamodb|elasticsearch/.test(s.image));
  const items: BriefingItem[] = [];
  for (const p of clients) items.push({ title: p.info!.label, detail: `${p.info!.purpose} · used by ${listText(facts.runtimeImporters(p), 3)}`, badge: "observed", claim: set.observed(`${p.info!.label} client imported by ${plural(facts.runtimeImporters(p).length, "file")}.`, pkgEvidence(facts, p)) });
  for (const d of declared) items.push({ title: techInfo(d.name)!.label, detail: `declared in ${d.path}, no import observed`, badge: "declared", claim: set.declared(`${d.name} is declared but no source file imports it.`, [ev(d.path, d.line, { source: "manifest" })], "A declaration does not prove the application uses it.") });
  for (const s of compose) items.push({ title: `${s.name} (${s.image})`, detail: `container in ${s.path}`, badge: "config", claim: set.declared(`Compose service ${s.name} runs ${s.image}.`, [ev(s.path, s.line, { source: "configuration" })], "Declared infrastructure; the application may not connect to it in every environment.") });
  const tables = [...facts.signals.tables.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, 20);
  const models = facts.signals.models;
  const schemaFiles = facts.files.filter((f) => /(^|\/)(migrations?|schema|alembic)\//i.test(f.path) || /schema\.(prisma|sql|graphql)$/.test(f.path));
  if (tables.length) {
    blocks.push({
      type: "list",
      title: "Tables referenced in SQL (observed usage)",
      items: tables.map(([t, locs]) => ({ title: t, detail: `${[...new Set(locs.map((l) => l.op))].join("/")} · ${listText([...new Set(locs.map((l) => posix.basename(l.path)))], 3)}`, path: locs[0]!.path, line: locs[0]!.line, claim: set.observed(`Table \`${t}\` used in SQL (${[...new Set(locs.map((l) => l.op))].join(", ")}).`, locs.slice(0, 5).map((l) => ev(l.path, l.line, { provenance: "heuristic" }))) })),
    });
  }
  if (models.length) blocks.push({ type: "list", title: "Model / entity declarations", items: models.slice(0, 20).map((m) => ({ title: m.text, detail: `${m.path}:${m.line}`, path: m.path, line: m.line, claim: set.observed(`Model ${m.text} declared.`, [ev(m.path, m.line, { provenance: "heuristic" })]) })) });
  const persistence = facts.signals.fileWrites;
  const persistFiles = [...new Set(persistence.map((p) => p.path))];
  let summary: string;
  if (items.length || tables.length || models.length) {
    blocks.unshift({ type: "list", title: "Datastores", items, empty: "No datastore client detected." });
    summary = [items.map((i) => i.title).join(", "), tables.length && plural(tables.length, "table"), models.length && plural(models.length, "model")].filter(Boolean).join(" · ");
  } else if (persistFiles.length) {
    const claim = set.observed(`No database client or schema detected; state is written to the local filesystem by ${listText(persistFiles, 3)}.`, persistence.slice(0, 6).map((p) => ev(p.path, p.line, { provenance: "heuristic" })));
    blocks.push({ type: "text", text: "No database client, ORM, schema or SQL was detected. Persistence appears to be file-based:", claim });
    blocks.push({ type: "list", items: persistFiles.slice(0, 8).map((p) => ({ title: p, path: p, nodeId: `file:${p}`, detail: facts.describe(p) ?? `${persistence.filter((x) => x.path === p).length} write sites`, claim })) });
    summary = "No database — file-based persistence";
  } else {
    set.unknown("No database, ORM, SQL or file persistence was detected.");
    summary = "No persistence detected";
  }
  if (schemaFiles.length) blocks.push({ type: "list", title: "Schema / migration files", items: schemaFiles.slice(0, 10).map((f) => ({ title: f.path, path: f.path, nodeId: `file:${f.path}`, claim: set.declared(`Schema/migration file ${f.path}.`, [ev(f.path, 1, { source: "configuration" })], "Declared schema; application usage is shown separately.") })) });
  set.unknowns.push("Runtime database configuration (hosts, credentials, pool sizes) is not in the index.");
  if (!facts.files.some((f) => /\.(sql|prisma)$/.test(f.path))) set.unknowns.push("`.sql` and `.prisma` files are not indexed by Feature 1, so schema declarations in them are not visible.");
  return { id: "database", title: "Database & schema", question: "Where does data live?", summary, blocks, set };
};

function composeServices(facts: BriefingFacts): { name: string; image: string; path: string; line: number }[] {
  const out: { name: string; image: string; path: string; line: number }[] = [];
  for (const c of facts.configOf("compose")) {
    const lines = facts.lines(c.path);
    let inServices = false;
    let current: { name: string; line: number } | undefined;
    lines.forEach((l, i) => {
      if (/^services:\s*$/.test(l)) return void (inServices = true);
      if (/^\S/.test(l)) inServices = false;
      if (!inServices) return;
      const svc = /^ {2}([\w.-]+):\s*$/.exec(l);
      if (svc) current = { name: svc[1]!, line: i + 1 };
      const img = /^\s+image:\s*["']?([^"'\s]+)/.exec(l);
      if (img && current) out.push({ ...current, image: img[1]!, path: c.path });
      else if (/^\s+build:/.test(l) && current) out.push({ ...current, image: "(built locally)", path: c.path });
    });
  }
  return out;
}

// ─── 13 Integrations ──────────────────────────────────────────────

const SERVICE_CATEGORIES: TechCategory[] = ["ai", "payments", "auth", "email", "sms", "storage", "cloud", "queue", "cache", "observability", "http-client"];

export const integrations: SectionBuilder = ({ facts }) => {
  const set = new ClaimSet("integrations");
  const env = facts.signals.env;
  const groups = new Map<string, BriefingItem[]>();
  const add = (cat: string, item: BriefingItem): void => void groups.set(cat, [...(groups.get(cat) ?? []), item]);
  for (const p of usedPackages(facts, SERVICE_CATEGORIES)) {
    const importers = facts.runtimeImporters(p);
    const envs = [...env.entries()].filter(([, locs]) => locs.some((l) => importers.includes(l.path))).map(([k]) => k);
    add(CATEGORY_LABEL[p.info!.category], {
      title: p.info!.label,
      detail: `${p.info!.purpose} · used by ${listText(importers, 3)}${envs.length ? ` · config ${listText(envs, 3)}` : ""}`,
      badge: "observed",
      claim: set.observed(`${p.info!.label} (${p.info!.purpose}) is used by ${listText(importers, 3)}.`, pkgEvidence(facts, p)),
      path: importers[0]!,
      nodeId: p.nodeId,
    });
  }
  for (const d of declaredOnly(facts, SERVICE_CATEGORIES)) add(CATEGORY_LABEL[techInfo(d.name)!.category], { title: techInfo(d.name)!.label, detail: `declared in ${d.path}; no import observed`, badge: "declared", claim: set.declared(`${d.name} declared in ${d.path} but not imported.`, [ev(d.path, d.line, { source: "manifest" })]) });
  if (facts.signals.outbound.length) {
    const files = [...new Set(facts.signals.outbound.map((o) => o.path))];
    add("Outbound HTTP", { title: "Direct HTTP calls", detail: `in ${listText(files, 3)}`, claim: set.observed(`Outbound HTTP calls in ${plural(files.length, "file")}.`, facts.signals.outbound.slice(0, 5).map((o) => ev(o.path, o.line, { provenance: "heuristic" }))) });
  }
  const childProc = facts.signals.runtime.filter((r) => r.kind === "child-process");
  if (childProc.length) add("Local processes", { title: "Spawns external commands", detail: listText([...new Set(childProc.map((c) => `${c.path}:${c.line}`))], 3), claim: set.observed(`Spawns child processes in ${plural(new Set(childProc.map((c) => c.path)).size, "file")}.`, childProc.slice(0, 5).map((c) => ev(c.path, c.line, { provenance: "heuristic", detail: c.text }))) });
  const envItems = [...env.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).slice(0, 30);
  const blocks: Block[] = [{ type: "groups", groups: [...groups.entries()].filter(([, v]) => v.length).map(([title, items]) => ({ title, items })), empty: "No external services detected." }];
  if (envItems.length) blocks.push({ type: "list", title: "Environment variables read", items: envItems.map(([k, locs]) => ({ title: k, detail: listText([...new Set(locs.map((l) => `${l.path}:${l.line}`))], 2), path: locs[0]!.path, line: locs[0]!.line, badge: /KEY|SECRET|TOKEN|PASSWORD|CREDENTIAL/.test(k) ? "secret" : "", claim: set.observed(`Reads ${k}.`, locs.map((l) => ev(l.path, l.line, { provenance: "heuristic" }))) })) });
  const serviceCount = [...groups.entries()].filter(([k]) => k !== "Local processes").reduce((s, [, v]) => s + v.length, 0);
  if (!serviceCount) set.observed("No external network services were detected (no service SDK imports or outbound HTTP calls).", [ev(".", undefined, { source: "index", provenance: "filesystem", detail: "all package imports checked" })], "Services reached through generic clients configured at runtime would not be visible.");
  set.unknowns.push("Credentials and endpoints configured outside the repository are not visible.");
  return { id: "integrations", title: "External services & integrations", question: "What does it talk to?", summary: serviceCount ? `${plural(serviceCount, "integration")}: ${listText([...groups.values()].flat().map((i) => i.title), 5)}` : childProc.length ? "No network services; spawns local processes" : "No external services detected", blocks, set };
};

// ─── 14 Infrastructure & deployment ───────────────────────────────

export const infrastructure: SectionBuilder = ({ facts }) => {
  const set = new ClaimSet("infra");
  const groups: Extract<Block, { type: "groups" }>["groups"] = [];
  const docker = facts.configOf("docker");
  if (docker.length) groups.push({ title: "Containers", items: docker.map((d) => {
    const lines = facts.lines(d.path);
    const from = lines.map((l, i) => [l, i] as const).filter(([l]) => /^FROM\s/i.test(l.trim()));
    const expose = lines.find((l) => /^EXPOSE\s/i.test(l.trim()))?.trim();
    const cmd = lines.find((l) => /^(CMD|ENTRYPOINT)\s/i.test(l.trim()))?.trim();
    return { title: d.path, detail: [from.map(([l]) => l.trim().split(/\s+/)[1]).join(" → "), expose, cmd].filter(Boolean).join(" · "), path: d.path, claim: set.declared(`Container image built from ${d.path}.`, [ev(d.path, (from[0]?.[1] ?? 0) + 1, { source: "configuration" })]) };
  }) });
  const compose = composeServices(facts);
  if (compose.length) groups.push({ title: "Compose services", items: compose.map((s) => ({ title: s.name, detail: `${s.image} · ${s.path}`, path: s.path, line: s.line, claim: set.declared(`Compose service ${s.name} (${s.image}).`, [ev(s.path, s.line, { source: "configuration" })]) })) });
  const ci = facts.configOf("ci");
  const deploySteps: { path: string; line: number; text: string }[] = [];
  if (ci.length) groups.push({ title: "CI/CD", items: ci.map((c) => {
    const lines = facts.lines(c.path);
    const name = lines.find((l) => /^name:/.test(l))?.replace(/^name:\s*/, "").replace(/["']/g, "");
    const triggers = triggersOf(lines);
    lines.forEach((l, i) => {
      if (/\b(deploy|kubectl|helm |terraform apply|gcloud|aws |az |vercel|netlify|fly(ctl)? deploy|heroku|docker push|gh-pages|npm publish|twine upload)/i.test(l) && !/^\s*#/.test(l)) deploySteps.push({ path: c.path, line: i + 1, text: l.trim().slice(0, 100) });
    });
    return { title: name ? `${name}` : c.path, detail: `${c.path}${triggers ? ` · on ${triggers}` : ""}`, path: c.path, claim: set.declared(`CI workflow ${c.path}${triggers ? ` runs on ${triggers}` : ""}.`, [ev(c.path, 1, { source: "configuration" })]) };
  }) });
  const k8s = facts.configOf("kubernetes");
  if (k8s.length) groups.push({ title: "Kubernetes", items: k8s.map((k) => ({ title: k.path, detail: facts.lines(k.path).filter((l) => /^kind:/.test(l)).map((l) => l.replace("kind:", "").trim()).join(", "), path: k.path, claim: set.declared(`Kubernetes manifest ${k.path}.`, [ev(k.path, 1, { source: "configuration" })]) })) });
  const platforms = facts.configOf("platform");
  if (platforms.length) groups.push({ title: "Hosting platform config", items: platforms.map((p) => ({ title: p.label, detail: p.path, path: p.path, claim: set.declared(`${p.label} configuration present (${p.path}).`, [ev(p.path, 1, { source: "configuration" })]) })) });
  const envEx = facts.configOf("env-example");
  if (envEx.length) groups.push({ title: "Environment template", items: envEx.map((e) => ({ title: e.path, detail: facts.lines(e.path).filter((l) => /^[A-Z_][A-Z0-9_]*=/.test(l)).map((l) => l.split("=")[0]).slice(0, 8).join(", "), path: e.path, claim: set.declared(`Environment template ${e.path}.`, [ev(e.path, 1, { source: "configuration" })]) })) });
  if (deploySteps.length) groups.push({ title: "Deploy / publish steps", items: deploySteps.slice(0, 10).map((d) => ({ title: d.text, detail: `${d.path}:${d.line}`, path: d.path, line: d.line, claim: set.declared(`Deploy/publish step: ${d.text}`, [ev(d.path, d.line, { source: "configuration" })]) })) });

  // Cloud: never inferred from an SDK alone.
  const cloudSdks = usedPackages(facts, ["cloud"]);
  const deployTargets = [...platforms.map((p) => p.label), ...(k8s.length ? ["Kubernetes"] : [])];
  let deployment: string;
  if (deployTargets.length) {
    deployment = `Declared target: ${listText([...new Set(deployTargets)])}`;
    set.declared(deployment, [...platforms, ...k8s].map((c) => ev(c.path, 1, { source: "configuration" })), "Configuration declares a target; the live production environment was not inspected.");
  } else if (docker.length || deploySteps.length) {
    deployment = docker.length ? "Containerized; hosting target not declared" : "CI publish/deploy steps; hosting target not declared";
    set.inferred(deployment, [...docker, ...ci].map((c) => ev(c.path, 1, { source: "configuration" })), 0.6);
    set.unknowns.push("Production hosting provider is unknown.");
  } else {
    deployment = "No deployment configuration found";
    set.unknown("Deployment target is unknown: no Dockerfile, CI deploy step, Kubernetes or hosting-platform configuration is indexed.");
  }
  if (cloudSdks.length && !deployTargets.length) set.inferred(`${listText(cloudSdks.map((p) => p.info!.label))} dependency found, but no deployment configuration identifies the hosting provider; cloud usage is possible, the deployment target is unknown.`, cloudSdks.flatMap((p) => pkgEvidence(facts, p, 2)), 0.5);
  if (!ci.length) set.unknown("No CI configuration found in the index.");
  if (!facts.files.some((f) => /\.tf$/.test(f.path))) set.unknowns.push("Terraform/Helm sources are not indexed by Feature 1; infrastructure-as-code may exist outside the index.");
  const engines = facts.manifests.map((m) => m.engines).filter(Boolean) as string[];
  const blocks: Block[] = [{ type: "facts", rows: [{ label: "Deployment", value: deployment }, ...(engines.length ? [{ label: "Runtime requirement", value: engines.join(", "), claim: set.declared(`Requires ${engines.join(", ")}.`, facts.manifests.filter((m) => m.engines).map((m) => ev(m.path, 1, { source: "manifest" }))) }] : [])] }, { type: "groups", groups, empty: "No infrastructure configuration found." }];
  return { id: "infrastructure", title: "Infrastructure & deployment", question: "How is it built, shipped and hosted?", summary: deployment + (ci.length ? ` · ${plural(ci.length, "CI workflow")}` : ""), blocks, set };
};

function triggersOf(lines: readonly string[]): string {
  const idx = lines.findIndex((l) => /^on:/.test(l) || /^"?on"?:/.test(l));
  if (idx < 0) return "";
  const inline = lines[idx]!.replace(/^"?on"?:\s*/, "").trim();
  if (inline) return inline.replace(/[[\]]/g, "");
  const out: string[] = [];
  for (let i = idx + 1; i < lines.length && /^\s/.test(lines[i]!); i += 1) {
    const m = /^ {2}([\w-]+):/.exec(lines[i]!);
    if (m) out.push(m[1]!);
  }
  return out.join(", ");
}

// ─── 15 Security ──────────────────────────────────────────────────

export const security: SectionBuilder = ({ facts }) => {
  const set = new ClaimSet("security");
  const rows: Extract<Block, { type: "facts" }>["rows"] = [];
  const authPkgs = usedPackages(facts, ["auth"]);
  const authSymbols = facts.graph.nodes().filter((n) => (n.kind === "function" || n.kind === "method" || n.kind === "class") && !n.isTest && facts.roleByPath.get(n.path ?? "") === "source" && /^(authenticate\w*|login\w*|logout|sign(In|Out|Token)\w*|verify(Token|Jwt|Session|Password|Signature)\w*|validateToken\w*|checkAuth\w*|requireAuth\w*|isAuthenticated|hashPassword|comparePassword|createSession\w*|\w*Auth(Guard|Middleware|Service|Provider|enticator))$/i.test(n.name.split(".").at(-1)!));
  rows.push({
    label: "Authentication",
    value: authPkgs.length || authSymbols.length ? listText([...authPkgs.map((p) => p.info!.label), ...authSymbols.slice(0, 4).map((s) => `${s.name} (${s.path})`)], 5) : "none detected",
    claim: authPkgs.length || authSymbols.length ? set.observed(`Authentication code: ${listText([...authPkgs.map((p) => p.info!.label), ...authSymbols.map((s) => s.name)], 5)}.`, [...authPkgs.flatMap((p) => pkgEvidence(facts, p, 2)), ...authSymbols.slice(0, 6).map((s) => ev(s.path!, s.location?.line, { nodeId: s.id, provenance: s.evidence.provenance }))], "Identified by library and function names.") : set.unknown("No authentication library or auth-named functions were detected."),
  });
  const authz = facts.graph.nodes().filter((n) => !n.isTest && /^(authori[sz]e\w*|(check|require|ensure|has|can|assert)(Permission|Role|Access|Scope|Admin)\w*|\w*Policy|\w*(Permission|Rbac|Acl)(Guard|Check|Service))$/i.test(n.name.split(".").at(-1)!) && (n.kind === "function" || n.kind === "method"));
  rows.push({ label: "Authorization", value: authz.length ? listText(authz.slice(0, 4).map((a) => a.name), 4) : "none detected", claim: authz.length ? set.observed(`Authorization-named functions: ${listText(authz.map((a) => a.name), 4)}.`, authz.slice(0, 5).map((a) => ev(a.path!, a.location?.line, { nodeId: a.id, provenance: a.evidence.provenance }))) : set.unknown("No authorization checks were identified by name.") });
  const secrets = [...facts.signals.env.entries()].filter(([k]) => /KEY|SECRET|TOKEN|PASSWORD|CREDENTIAL|PRIVATE/.test(k));
  rows.push({ label: "Secrets", value: secrets.length ? `environment: ${listText(secrets.map(([k]) => k), 4)}` : facts.signals.env.size ? "environment configuration, no secret-named variables" : "no environment configuration read", claim: secrets.length ? set.observed(`Secrets come from environment variables (${listText(secrets.map(([k]) => k), 4)}).`, secrets.flatMap(([, l]) => l.slice(0, 2)).map((l) => ev(l.path, l.line, { provenance: "heuristic" }))) : set.inferred("No secret-named environment variables are read.", [], 0.5) });
  const validators = usedPackages(facts, ["validation"]);
  rows.push({ label: "Input validation", value: validators.length ? validators.map((v) => v.info!.label).join(", ") : facts.signals.validation.length ? `${plural(facts.signals.validation.length, "validation call")}` : "no validation library detected" });
  const headers = facts.signals.securityHeaders;
  if (headers.length) rows.push({ label: "HTTP hardening", value: listText([...new Set(headers.map((h) => (/content-security-policy/i.test(h.text) ? "CSP" : /nosniff/i.test(h.text) ? "nosniff" : /frame/i.test(h.text) ? "frame restrictions" : /cors/i.test(h.text) ? "CORS" : /helmet/i.test(h.text) ? "Helmet" : "security headers")))]), claim: set.observed("Security headers set.", headers.slice(0, 5).map((h) => ev(h.path, h.line, { provenance: "heuristic", detail: h.text }))) });
  const hosts = facts.signals.listenHosts;
  if (hosts.length) rows.push({ label: "Network exposure", value: [...new Set(hosts.map((h) => h.text))].join(", "), claim: set.observed(`Listens on ${[...new Set(hosts.map((h) => h.text))].join(", ")}.`, hosts.map((h) => ev(h.path, h.line, { provenance: "heuristic" }))) });
  const blocks: Block[] = [{ type: "facts", rows }];
  const boundaries: BriefingItem[] = [];
  const sensitiveRoutes = facts.signals.routes.filter((r) => /admin|auth|login|token|user|account|payment|checkout|refund|upload|delete|secret|key/i.test(r.route) || r.method === "POST" || r.method === "DELETE");
  for (const r of sensitiveRoutes.slice(0, 10)) boundaries.push(stripItem({ title: `${r.method} ${r.route}`, detail: `${r.path}:${r.line} — state-changing or sensitive route`, path: r.path, line: r.line, nodeId: r.handler?.id, claim: set.inferred(`${r.method} ${r.route} is a sensitive boundary.`, [ev(r.path, r.line, { provenance: "heuristic" })], 0.55) }));
  const sinks = facts.signals.sinks;
  const sinkGroups = new Map<string, typeof sinks>();
  for (const s of sinks) sinkGroups.set(s.kind, [...(sinkGroups.get(s.kind) ?? []), s]);
  for (const [kind, ss] of sinkGroups) boundaries.push({ title: `${kind} (${ss.length})`, detail: listText([...new Set(ss.map((s) => `${s.path}:${s.line}`))], 3), path: ss[0]!.path, line: ss[0]!.line, claim: set.observed(`${plural(ss.length, "site")} of ${kind}.`, ss.slice(0, 6).map((s) => ev(s.path, s.line, { provenance: "heuristic", detail: s.text })), "A sink is a place to review input handling, not a confirmed vulnerability.") });
  blocks.push({ type: "list", title: "Security-sensitive boundaries", items: boundaries, empty: "None identified." });
  blocks.push({ type: "text", text: sinks.length || sensitiveRoutes.length ? "These are review points found by static pattern checks, not confirmed vulnerabilities." : "No supported security findings were detected by the available static checks. This is not evidence that the code is secure." });
  set.unknowns.push("Dependency vulnerabilities (CVEs), secret leaks in history and runtime configuration are not checked by this briefing.");
  const summary = [rows[0]!.value !== "none detected" ? "auth code present" : "no auth detected", secrets.length ? "env-based secrets" : "", sinks.length ? `${plural(sinks.length, "sensitive sink")}` : "", hosts.some((h) => h.text === "127.0.0.1" || h.text === "localhost") ? "localhost-bound" : ""].filter(Boolean).join(" · ");
  return { id: "security", title: "Security orientation", question: "Where are the trust boundaries?", summary, blocks, set };
};

// ─── 17 Technology stack ──────────────────────────────────────────

export const technology: SectionBuilder = ({ facts }) => {
  const set = new ClaimSet("tech");
  const rows: Extract<Block, { type: "facts" }>["rows"] = [];
  const langs = languagesOf(facts);
  rows.push({ label: "Languages", value: langs.map((l) => `${l.name} (${l.files} files)`).join(", ") || "—", claim: set.observed(`Languages by file count: ${langs.map((l) => `${l.name} ${l.files}`).join(", ")}.`, [ev(".", undefined, { provenance: "filesystem", detail: "file extensions" })]) });
  const engines = facts.manifests.map((m) => m.engines).filter(Boolean) as string[];
  if (engines.length) rows.push({ label: "Runtime", value: engines.join(", "), claim: set.declared(`Runtime: ${engines.join(", ")}.`, facts.manifests.filter((m) => m.engines).map((m) => ev(m.path, 1, { source: "manifest" }))) });
  const managers = [...new Set(facts.manifests.map((m) => ({ npm: "npm", python: "pip/Python packaging", go: "Go modules", cargo: "Cargo", maven: "Maven", gradle: "Gradle" })[m.kind]))];
  if (managers.length) rows.push({ label: "Package managers", value: managers.join(", ") });
  const byCategory = new Map<TechCategory, { label: string; purpose: string; used: boolean; claim: string }[]>();
  const seen = new Set<string>();
  for (const p of facts.packages) {
    if (!p.info || seen.has(p.info.label)) continue;
    const used = facts.runtimeImporters(p).length > 0;
    const testOnly = !used && p.importers.length > 0;
    seen.add(p.info.label);
    const claim = set.observed(`${p.info.label} — ${p.info.purpose}; imported by ${plural(p.importers.length, "file")}${testOnly ? " (tests only)" : ""}.`, pkgEvidence(facts, { ...p, importers: p.importers }, 3));
    byCategory.set(p.info.category, [...(byCategory.get(p.info.category) ?? []), { label: p.info.label, purpose: p.info.purpose, used: used || testOnly, claim }]);
  }
  for (const d of facts.declaredDependencies) {
    const info = techInfo(d.name);
    if (!info || seen.has(info.label)) continue;
    seen.add(info.label);
    const claim = set.declared(`${info.label} — ${info.purpose}; declared${d.dev ? " as a dev dependency" : ""} in ${d.path}.`, [ev(d.path, d.line, { source: "manifest" })], d.dev ? "Tooling dependency; not imported by source." : "Declared but not imported by indexed source.");
    byCategory.set(info.category, [...(byCategory.get(info.category) ?? []), { label: info.label, purpose: info.purpose, used: false, claim }]);
  }
  const groups = [...byCategory.entries()]
    .sort((a, b) => ORDER.indexOf(a[0]) - ORDER.indexOf(b[0]))
    .map(([cat, list]) => ({ title: CATEGORY_LABEL[cat], items: list.map((t) => ({ title: t.label, detail: t.purpose, badge: t.used ? "imported" : "declared", claim: t.claim })) }));
  const other = facts.declaredDependencies.filter((d) => !techInfo(d.name));
  const blocks: Block[] = [{ type: "facts", rows }, { type: "groups", title: "Why each technology is here", groups, empty: "No recognised libraries." }];
  if (other.length) blocks.push({ type: "list", title: `Other declared dependencies (${other.length})`, items: other.slice(0, 24).map((d) => ({ title: d.name, detail: `${d.dev ? "dev · " : ""}${d.path}:${d.line}` })) });
  return { id: "technology", title: "Dependencies & technology stack", question: "What is it built with, and why?", summary: [langs.map((l) => l.name).join(", "), engines.join(", "), groups.slice(0, 4).flatMap((g) => g.items.slice(0, 2).map((i) => i.title)).join(", ")].filter(Boolean).join(" · "), blocks, set };
};

const ORDER: TechCategory[] = ["web-framework", "frontend", "graphics", "database", "orm", "cache", "queue", "ai", "ml", "parsing", "cli", "validation", "auth", "security", "payments", "email", "sms", "storage", "cloud", "http-client", "scheduler", "observability", "testing", "build"];

// ─── 18 Testing & quality ─────────────────────────────────────────

export const testing: SectionBuilder = ({ facts }) => {
  const set = new ClaimSet("testing");
  const tests = facts.testFiles;
  const rows: Extract<Block, { type: "facts" }>["rows"] = [];
  const blocks: Block[] = [];
  rows.push({ label: "Test files", value: String(tests.length), claim: tests.length ? set.observed(`${plural(tests.length, "test file")} in the index.`, tests.slice(0, 6).map((t) => ev(t, undefined, { source: "test", provenance: "filesystem", nodeId: `file:${t}` }))) : set.unknown("No test files were found.") });
  const frameworks = facts.packages.filter((p) => p.info?.category === "testing" || p.name === "node:test" || p.name === "unittest" || p.name === "testing");
  const declaredTest = facts.declaredDependencies.filter((d) => techInfo(d.name)?.category === "testing");
  const fwNames = [...new Set([...frameworks.map((p) => (p.name === "node:test" ? "node:test" : p.name === "testing" ? "Go testing" : p.info?.label ?? p.name)), ...declaredTest.map((d) => techInfo(d.name)!.label)])];
  if (fwNames.length) rows.push({ label: "Frameworks", value: fwNames.join(", "), claim: set.observed(`Tests use ${fwNames.join(", ")}.`, [...frameworks.flatMap((p) => p.importers.slice(0, 2).map((i) => ev(i, undefined, { source: "test", provenance: p.provenance }))), ...declaredTest.map((d) => ev(d.path, d.line, { source: "manifest" }))]) });
  const scripts = facts.manifests.flatMap((m) => m.scripts.filter((s) => /^(test|check|lint|typecheck|type-check|coverage|e2e|ci|verify)(:|$)/.test(s.name)).map((s) => ({ m, s })));
  if (scripts.length) rows.push({ label: "How to verify a change", value: scripts.map(({ s }) => `npm run ${s.name}`.replace("npm run test", "npm test")).join(" · "), claim: set.declared(`Verification scripts: ${scripts.map(({ s }) => `${s.name} = ${s.command}`).join("; ")}.`, scripts.map(({ m, s }) => ev(m.path, s.line, { source: "manifest" }))) });
  const typeCheck = facts.configOf("typescript");
  const lint = facts.configOf("lint");
  const coverage = facts.configOf("coverage");
  const coverageScript = facts.manifests.some((m) => m.scripts.some((s) => /--coverage|\bc8\b|\bnyc\b|--cov\b|coverage run/.test(s.command)));
  rows.push({ label: "Static checks", value: [typeCheck.length && "type checking", lint.length && "linting"].filter(Boolean).join(", ") || "none configured", ...(typeCheck.length || lint.length ? { claim: set.declared(`Static checks configured: ${[...typeCheck, ...lint].map((c) => c.path).join(", ")}.`, [...typeCheck, ...lint].map((c) => ev(c.path, 1, { source: "configuration" }))) } : {}) });
  rows.push({ label: "Measured coverage", value: coverage.length || coverageScript ? "coverage tooling configured (no report in index)" : "not measured", claim: set.unknown("Measured line/branch coverage is not available; figures below are static reachability.") });
  const ci = facts.configOf("ci");
  rows.push({ label: "CI", value: ci.length ? ci.map((c) => c.path).join(", ") : "none found", ...(ci.length ? { claim: set.declared(`CI configured in ${ci.map((c) => c.path).join(", ")}.`, ci.map((c) => ev(c.path, 1, { source: "configuration" }))) } : {}) });
  blocks.push({ type: "facts", rows });
  // Static test reachability per module.
  const metrics = [...facts.metrics.values()];
  const byModule = new Map<string, { files: number; reached: number }>();
  for (const m of metrics) {
    const e = byModule.get(m.module) ?? { files: 0, reached: 0 };
    e.files += 1;
    if (m.testReach > 0) e.reached += 1;
    byModule.set(m.module, e);
  }
  const reached = metrics.filter((m) => m.testReach > 0).length;
  if (metrics.length && tests.length) {
    const claim = set.observed(`${reached} of ${metrics.length} source files are statically reachable from a test file.`, tests.slice(0, 4).map((t) => ev(t, undefined, { source: "test", provenance: "filesystem" })), "Static reachability through imports/calls, not executed coverage.");
    const strong = [...byModule.entries()].filter(([, v]) => v.reached === v.files).sort((a, b) => b[1].files - a[1].files).slice(0, 8);
    const weak = [...byModule.entries()].filter(([, v]) => v.reached === 0).sort((a, b) => b[1].files - a[1].files).slice(0, 8);
    blocks.push({ type: "text", text: `${reached} / ${metrics.length} source files (${Math.round((reached / metrics.length) * 100)}%) are reachable from tests (static).`, claim });
    blocks.push({ type: "groups", groups: [
      { title: "Strongest static test reach", items: strong.map(([m, v]) => ({ title: m, detail: `${v.reached}/${v.files} files reached`, claim })) },
      { title: "No test reaches (static)", items: weak.map(([m, v]) => ({ title: m, detail: `${plural(v.files, "file")}`, claim })) },
    ] });
  }
  set.unknowns.push("Behaviour of external providers and deployment is not covered by static test analysis.");
  return { id: "testing", title: "Testing & quality", question: "If I change it, how do I know I broke something?", summary: tests.length ? `${plural(tests.length, "test file")}${fwNames.length ? ` (${fwNames.join(", ")})` : ""}${metrics.length ? ` · ${Math.round((reached / Math.max(1, metrics.length)) * 100)}% of source statically reached` : ""}` : "No tests found", blocks, set };
};
