import { createHash } from "node:crypto";
import { posix } from "node:path";
import { BriefingFacts } from "../codebase-briefing/facts.js";
import { humanizeModule, moduleLabels } from "../codebase-briefing/builder.js";
import type { TechCategory } from "../codebase-briefing/catalog.js";
import type { FehmEngine } from "../engine.js";
import type { EdgeKind, Provenance } from "../model.js";
import { ROLE_LABEL } from "./labels.js";
import {
  ARCHITECTURE_SCHEMA,
  ARCHITECTURE_VERSION,
  LAYOUT_VERSION,
  type ArchEvidence,
  type ArchitectureModel,
  type ArchNode,
  type ArchNodeType,
  type ArchRelationship,
  type CodeLink,
  type Confidence,
  type FileLink,
  type EvidenceCoverage,
  type RelationshipType,
  type ViewDescriptor,
} from "./types.js";

/**
 * Feature 3.3's semantic model: a curated projection of the Feature 1 graph
 * (through 3.2's `BriefingFacts`, the one extraction pass) onto architecture
 * components, their roles, their dependencies and the systems outside them.
 *
 * Evidence priority, strongest first: declarations and compiler/AST facts
 * (imports, calls, route nodes, manifest bins) → pattern-extracted source
 * lines (route registrations, SQL, CLI dispatch) → directory naming →
 * dependency shape. A lower tier never overrides a higher one, and nothing
 * without evidence is drawn: no database, queue or cloud appears unless the
 * code reaches it.
 */

/** System-view density target; clustering stops here. */
export const MAX_COMPONENTS = 12;
/** Dependency-view density cap (modules), the rest are summarized. */
export const MAX_DEPENDENCY_MODULES = 30;

const SAMPLE = 8;
const STRUCTURAL = new Set<EdgeKind>(["contains", "defines"]);
const DOM_API = /\bdocument\.(?:getElementById|querySelector(?:All)?|createElement(?:NS)?|body)\b|\bwindow\.addEventListener\(|\bcustomElements\.define\(/;
const NAME_ROLE: [RegExp, ArchNodeType][] = [
  [/(^|\/)(routes?|controllers?|handlers?|api|endpoints?|resolvers?)(\/|\*?$)/, "api"],
  [/(^|\/)(services?|domain|usecases?|use-cases|logic|business)(\/|\*?$)/, "service"],
  [/(^|\/)(repositor(y|ies)|db|dal|models?|entities|persistence|dao|database)(\/|\*?$)/, "data-access"],
  [/(^|\/)(ui|components?|pages?|views?|public|frontend|client|web)(\/|\*?$)/, "frontend"],
  [/(^|\/)(workers?|jobs?|queues?|consumers?|tasks?|cron)(\/|\*?$)/, "worker"],
  [/(^|\/)(utils?|shared|common|helpers?|lib|support)(\/|\*?$)/, "shared"],
];
/** Evidenced roles, most specific interface first. */
const ROLE_PRIORITY: ArchNodeType[] = ["api", "cli", "frontend", "worker", "data-access", "service", "shared"];
const EXTERNAL_CATEGORIES = new Set<TechCategory>(["payments", "email", "sms", "ai", "cloud", "storage", "queue", "cache", "observability", "auth"]);
const DB_CATEGORIES = new Set<TechCategory>(["database", "orm"]);
const LIBRARY_CATEGORIES = new Set<TechCategory>(["auth", "observability"]);

const INTERFACE = new Set<ArchNodeType>(["api", "cli", "frontend"]);
const RANK: Record<Confidence, number> = { verified: 0, strong: 1, inferred: 2, unknown: 3 };
const stronger = (a: Confidence, b: Confidence): Confidence => (RANK[a] <= RANK[b] ? a : b);

export function confidenceOf(p: Provenance | "declared"): Confidence {
  return p === "heuristic" ? "strong" : "verified";
}

interface RoleEvidence {
  role: ArchNodeType;
  confidence: Confidence;
  reason: string;
  evidence: ArchEvidence[];
}

interface Group {
  key: string;
  modules: string[];
  files: string[];
  /** Directory used for collapsing; a filename-prefix module anchors at its directory. */
  anchor: string;
  parent: string;
  kind: "module" | "directory" | "cluster";
}


export function buildArchitectureModel(engine: FehmEngine, facts = new BriefingFacts(engine)): ArchitectureModel {
  const graph = engine.graph;
  const sourceFiles = new Set(facts.sourceFiles);
  const modules = facts.modules;
  const moduleOfFile = new Map<string, string>();
  for (const m of modules) for (const f of m.files) moduleOfFile.set(f, m.name);

  // ─── per-file role evidence ─────────────────────────────────────
  const fileRoles = new Map<string, RoleEvidence[]>();
  const note = (path: string, role: ArchNodeType, confidence: Confidence, reason: string, evidence: ArchEvidence): void => {
    if (!sourceFiles.has(path)) return;
    const list = fileRoles.get(path) ?? [];
    const hit = list.find((r) => r.role === role && r.reason === reason);
    if (hit) {
      hit.confidence = stronger(hit.confidence, confidence);
      if (hit.evidence.length < SAMPLE) hit.evidence.push(evidence);
    } else list.push({ role, confidence, reason, evidence: [evidence] });
    fileRoles.set(path, list);
  };
  const signals = facts.signals;
  for (const r of signals.routes) note(r.path, "api", "strong", "registers HTTP routes", { path: r.path, line: r.line, provenance: "heuristic", detail: `${r.method} ${r.route}` });
  for (const n of graph.nodes()) {
    if (n.kind !== "route" || !n.path) continue;
    note(n.path, "api", confidenceOf(n.evidence.provenance), "declares HTTP route nodes", { path: n.path, ...(n.location ? { line: n.location.line } : {}), nodeId: n.id, provenance: n.evidence.provenance, detail: n.name });
  }
  for (const p of facts.binTargets) note(p, "cli", "verified", "package bin target", { path: p, provenance: "declared", detail: "declared as an executable in the manifest" });
  for (const c of signals.cli) note(c.path, "cli", "strong", "dispatches CLI commands", { path: c.path, line: c.line, provenance: "heuristic", detail: `command ${c.name}` });
  for (const p of facts.cliSourceFiles) note(p, "cli", "strong", "reads command-line arguments", { path: p, provenance: "heuristic" });
  for (const s of signals.runtime) {
    if (s.kind === "server") note(s.path, "api", "strong", "starts a server", { path: s.path, line: s.line, provenance: "heuristic", detail: s.text });
    else if (s.kind === "worker" || s.kind === "scheduled" || s.kind === "watcher" || s.kind === "interval") note(s.path, "worker", "strong", `${s.kind} runtime`, { path: s.path, line: s.line, provenance: "heuristic", detail: s.text });
  }
  for (const [table, uses] of signals.tables) for (const u of uses) note(u.path, "data-access", "strong", "queries SQL tables", { path: u.path, line: u.line, provenance: "heuristic", detail: `${u.op} ${table}` });
  for (const m of signals.models) note(m.path, "data-access", "strong", "declares data models", { path: m.path, line: m.line, provenance: "heuristic", detail: m.text });
  const packages = facts.packages.filter((p) => !p.builtin);
  for (const pkg of packages) {
    const cat = pkg.info?.category;
    if (!cat) continue;
    for (const file of facts.runtimeImporters(pkg)) {
      const ev: ArchEvidence = { path: file, provenance: pkg.provenance, nodeId: pkg.nodeId, detail: `imports ${pkg.name}` };
      if (cat === "frontend") note(file, "frontend", confidenceOf(pkg.provenance), `imports ${pkg.info!.label}`, ev);
      else if (DB_CATEGORIES.has(cat)) note(file, "data-access", confidenceOf(pkg.provenance), `imports ${pkg.info!.label}`, ev);
      else if (cat === "web-framework") note(file, "api", confidenceOf(pkg.provenance), `imports ${pkg.info!.label}`, ev);
    }
  }
  for (const path of sourceFiles) {
    const lines = facts.lines(path);
    const limit = Math.min(lines.length, 4000);
    for (let i = 0; i < limit; i += 1) {
      if (DOM_API.test(lines[i]!)) {
        note(path, "frontend", "strong", "uses browser DOM APIs", { path, line: i + 1, provenance: "heuristic", detail: lines[i]!.trim().slice(0, 100) });
        break;
      }
    }
  }

  // ─── grouping: modules → components ─────────────────────────────
  const fileDeps = facts.fileDeps.out;
  const groups = clusterModules(modules, (a, b) => {
    let n = 0;
    for (const fa of a) for (const fb of fileDeps.get(fa) ?? []) if (b.has(fb)) n += 1;
    return n;
  }, (files) => evidencedRole(files, fileRoles));
  const labels = moduleLabels(modules.map((m) => m.name));
  const groupLabels = moduleLabels(groups.map((g) => g.key));

  // ─── nodes ──────────────────────────────────────────────────────
  const nodes: ArchNode[] = [];
  const byId = new Map<string, ArchNode>();
  const add = (n: ArchNode): ArchNode => {
    nodes.push(n);
    byId.set(n.id, n);
    return n;
  };
  const tech = (files: string[]): string[] => {
    const set = new Set(files);
    return packages.filter((p) => p.info && p.info.category !== "build" && p.info.category !== "testing" && facts.runtimeImporters(p).some((f) => set.has(f))).map((p) => p.info!.label).slice(0, 8);
  };
  const symbolCount = (files: string[]): number => files.reduce((s, f) => s + facts.symbolsIn(f).length, 0);
  const describe = (files: string[]): string | undefined => {
    const central = [...files].sort((a, b) => (facts.metrics.get(b)?.dependents ?? 0) - (facts.metrics.get(a)?.dependents ?? 0) || (a < b ? -1 : 1));
    for (const f of central.slice(0, 4)) {
      const d = facts.describe(f);
      if (d) return d.length > 180 ? `${d.slice(0, 177)}…` : d;
    }
    return undefined;
  };
  const graphTarget = (dirOrModule: string, files: string[]): string | undefined => {
    const dir = dirOrModule.replace(/\*$/, "");
    if (!dirOrModule.endsWith("*") && graph.node(`directory:${dir}`)) return `directory:${dir}`;
    return files[0] ? `file:${files[0]}` : undefined;
  };
  const fileEvidence = (files: string[]): ArchEvidence[] => files.slice(0, 12).map((f) => ({ path: f, nodeId: `file:${f}`, provenance: "filesystem" as const }));

  const componentIds: string[] = [];
  const componentOfFile = new Map<string, string>();
  const moduleDependents = new Map<string, number>(modules.map((m) => [m.name, m.dependents.size]));
  const moduleDependsOn = new Map<string, number>(modules.map((m) => [m.name, m.dependsOn.size]));

  for (const g of groups) {
    const id = `component:${g.key}`;
    // A cluster's name is its hub's; naming conventions say nothing about the other members.
    const role = resolveRole(g.files, fileRoles, g.kind === "cluster" ? "" : g.key, structuralShared(g, groups, fileDeps));
    const name = groupLabels.get(g.key) ?? humanizeModule(g.key);
    const multi = g.modules.length > 1;
    const node = add({
      id,
      type: role.type === "module" ? "component" : role.type,
      level: 1,
      name,
      role: { confidence: role.confidence, reasons: [...role.reasons, g.kind === "cluster" ? `groups ${g.modules.length} tightly coupled modules around ${labels.get(g.key) ?? g.key}` : g.kind === "directory" ? `directory ${g.key}/ (${g.modules.length} modules)` : `module ${g.key}`] },
      children: multi ? g.modules.map((m) => `module:${m}`) : g.files.map((f) => `file:${f}`),
      files: g.files,
      symbols: symbolCount(g.files),
      technologies: tech(g.files),
      evidence: [...role.evidence, ...fileEvidence(g.files)],
      tier: 1,
    });
    // A cluster is described by its hub (the orchestrator it is named after), not by its most shared file.
    const hubFiles = g.kind === "cluster" ? (modules.find((m) => m.name === g.key)?.files ?? []) : [];
    const desc = (hubFiles.length ? describe(hubFiles) : undefined) ?? describe(g.files);
    if (desc) node.description = desc;
    const target = g.kind === "directory" ? graphTarget(g.key, g.files) : g.modules.length === 1 ? graphTarget(g.modules[0]!, g.files) : `file:${g.files[0]}`;
    if (target) node.graphNodeId = target;
    componentIds.push(id);
    for (const f of g.files) componentOfFile.set(f, id);
    for (const m of g.modules) {
      const mod = modules.find((x) => x.name === m)!;
      const mRole = resolveRole(mod.files, fileRoles, m, (moduleDependents.get(m) ?? 0) >= 3 && (moduleDependsOn.get(m) ?? 0) === 0 ? moduleDependents.get(m)! : 0);
      const mNode = add({
        id: `module:${m}`,
        type: mRole.type === "component" ? "module" : mRole.type,
        level: 3,
        name: labels.get(m) ?? humanizeModule(m),
        role: { confidence: mRole.confidence, reasons: [...mRole.reasons, `module ${m} (${mod.files.length} ${mod.files.length === 1 ? "file" : "files"})`] },
        children: mod.files.map((f) => `file:${f}`),
        parent: id,
        files: mod.files,
        symbols: symbolCount(mod.files),
        technologies: tech(mod.files),
        evidence: [...mRole.evidence, ...fileEvidence(mod.files)],
        tier: 1,
      });
      const mDesc = describe(mod.files);
      if (mDesc) mNode.description = mDesc;
      const mTarget = graphTarget(m, mod.files);
      if (mTarget) mNode.graphNodeId = mTarget;
      for (const f of mod.files) {
        const fRole = resolveRole([f], fileRoles, f, 0);
        const fNode = add({
          id: `file:${f}`,
          type: "file",
          level: 4,
          name: posix.basename(f),
          role: { confidence: fRole.type === "component" ? "unknown" : fRole.confidence, reasons: fRole.type === "component" ? ["source file"] : [`${ROLE_LABEL[fRole.type]}: ${fRole.reasons.join("; ")}`] },
          children: [],
          parent: multi ? `module:${m}` : id,
          files: [f],
          symbols: facts.symbolsIn(f).length,
          graphNodeId: `file:${f}`,
          technologies: tech([f]),
          evidence: [...fRole.evidence, { path: f, nodeId: `file:${f}`, provenance: "filesystem" }],
          tier: 1,
        });
        const fd = facts.describe(f);
        if (fd) fNode.description = fd.length > 180 ? `${fd.slice(0, 177)}…` : fd;
      }
    }
  }

  // ─── outside the codebase: actors, stores, external systems ─────
  const links: FileLink[] = [];
  const routeLines = new Map<string, ArchEvidence[]>();
  for (const [path, list] of fileRoles) for (const r of list) if (r.role === "api" && !r.reason.startsWith("imports ")) routeLines.set(path, [...(routeLines.get(path) ?? []), ...r.evidence]);
  if (routeLines.size) {
    add(external("actor:http-client", "actor", "HTTP clients", "Anything that sends HTTP requests to the routes this code registers.", 0, "strong", ["route registrations observed in source"]));
    for (const [file, evs] of routeLines) for (const ev of evs.slice(0, 4)) links.push({ file, target: "actor:http-client", type: "requests", inbound: true, evidence: ev });
  }
  const cliLines = new Map<string, ArchEvidence[]>();
  for (const [path, list] of fileRoles) for (const r of list) if (r.role === "cli") cliLines.set(path, [...(cliLines.get(path) ?? []), ...r.evidence]);
  if (cliLines.size) {
    const declared = [...cliLines.values()].flat().some((e) => e.provenance === "declared");
    add(external("actor:cli-user", "actor", "CLI user", "Runs the command-line entry points.", 0, declared ? "verified" : "strong", [declared ? "executable declared in a manifest" : "command-line argument handling observed"]));
    for (const [file, evs] of cliLines) for (const ev of evs.slice(0, 4)) links.push({ file, target: "actor:cli-user", type: "invokes", inbound: true, evidence: ev });
  }

  const dbPkgs = packages.filter((p) => p.info && DB_CATEGORIES.has(p.info.category) && facts.runtimeImporters(p).length);
  if (signals.tables.size || dbPkgs.length) {
    const engines = [...new Set(dbPkgs.filter((p) => p.info!.category === "database").map((p) => p.info!.purpose.replace(/ access$/i, "")))];
    const name = engines.length === 1 ? engines[0]! : engines.length > 1 ? "Databases" : "SQL database";
    const reasons = [
      ...(signals.tables.size ? [`SQL against ${signals.tables.size} ${signals.tables.size === 1 ? "table" : "tables"}: ${[...signals.tables.keys()].slice(0, 6).join(", ")}`] : []),
      ...dbPkgs.map((p) => `imports ${p.info!.label}`),
    ];
    const n = add(external("store:database", "database", name, dbPkgs.length ? `Reached through ${dbPkgs.map((p) => p.info!.label).join(", ")}.` : "Inferred from SQL statements in source; the engine is not declared.", 3, dbPkgs.length ? "verified" : "strong", reasons));
    n.technologies = dbPkgs.map((p) => p.info!.label);
    for (const [table, uses] of signals.tables) {
      for (const u of uses) {
        const writes = /^(INSERT|UPDATE|DELETE|CREATE)$/.test(u.op);
        links.push({ file: u.path, target: "store:database", type: writes ? "writes" : "reads", evidence: { path: u.path, line: u.line, provenance: "heuristic", detail: `${u.op} ${table}` } });
      }
    }
    for (const p of dbPkgs) for (const f of facts.runtimeImporters(p)) links.push({ file: f, target: "store:database", type: "uses", evidence: { path: f, nodeId: p.nodeId, provenance: p.provenance, detail: `imports ${p.name}` } });
  }
  if (signals.fileWrites.length) {
    add(external("store:filesystem", "filesystem", "Local files", "The code writes files on the local filesystem.", 3, "strong", [`${signals.fileWrites.length} file-write call sites`]));
    for (const w of signals.fileWrites) links.push({ file: w.path, target: "store:filesystem", type: "writes", evidence: { path: w.path, line: w.line, provenance: "heuristic", detail: facts.lines(w.path)[w.line - 1]?.trim().slice(0, 100) ?? "file write" } });
  }
  for (const pkg of packages) {
    const info = pkg.info;
    // A category only implies a network service where the category is one (payments, AI, queues…); auth libraries like JWT are code.
    if (!info || !(info.service || (EXTERNAL_CATEGORIES.has(info.category) && !LIBRARY_CATEGORIES.has(info.category)))) continue;
    const importers = facts.runtimeImporters(pkg);
    if (!importers.length) continue;
    const id = `external:${pkg.name}`;
    const n = add(external(id, "external-system", info.label, `${info.purpose}.`, 3, confidenceOf(pkg.provenance), [`imports ${pkg.name} (${info.category})`]));
    n.technologies = [info.label];
    for (const f of importers) links.push({ file: f, target: id, type: "calls", evidence: { path: f, nodeId: pkg.nodeId, provenance: pkg.provenance, detail: `imports ${pkg.name}` } });
  }
  if (signals.outbound.length) {
    add(external("external:http", "external-system", "External HTTP APIs", "Outbound HTTP requests to literal URLs.", 3, "strong", [`${signals.outbound.length} outbound HTTP call sites`]));
    for (const o of signals.outbound) links.push({ file: o.path, target: "external:http", type: "calls", evidence: { path: o.path, line: o.line, provenance: "heuristic", detail: facts.lines(o.path)[o.line - 1]?.trim().slice(0, 100) ?? "HTTP request" } });
  }

  // ─── relationships (component and module level) ─────────────────
  const codeLinks = collectCodeLinks(engine, facts);
  const hasNode = (id: string): boolean => byId.has(id);
  const relationships = [
    ...aggregate(codeLinks, links, (f) => componentOfFile.get(f), hasNode),
    ...aggregate(codeLinks, links, (f) => (moduleOfFile.has(f) ? `module:${moduleOfFile.get(f)}` : undefined), hasNode),
  ];

  // ─── coverage, unknowns, views ──────────────────────────────────
  const coverage: EvidenceCoverage = { verified: 0, strong: 0, inferred: 0, unknown: 0 };
  for (const n of nodes) if (n.level === 1 || n.level === 3 || n.tier !== 1) coverage[n.role.confidence] += 1;
  for (const r of relationships) coverage[r.confidence] += 1;
  const unknowns: string[] = [];
  const unclassified = componentIds.filter((id) => byId.get(id)!.role.confidence === "unknown").length;
  if (unclassified) unknowns.push(`${unclassified} of ${componentIds.length} components have no role evidence in code; they are shown as generic components named after their directory.`);
  unknowns.push("Relationships are static code dependencies; runtime traffic between components is not observed.");
  if (!byId.has("store:database")) unknowns.push("No database access was detected (no SQL statements or database client imports).");
  unknowns.push("External services reached without an SDK import or a literal URL are not detected.");
  if (signals.truncated) unknowns.push("Source signal extraction was truncated on this large repository; some roles may be missing.");
  const moduleCount = modules.length;
  const views: ViewDescriptor[] = [
    { type: "system", group: "core", title: "System", question: "What are the major parts and what do they talk to?", available: componentIds.length > 0, ...(componentIds.length ? {} : { reason: "No source files were indexed." }) },
    { type: "components", group: "core", title: "Components", question: "What is inside a component?", available: componentIds.length > 0, ...(componentIds.length ? {} : { reason: "No source files were indexed." }) },
    { type: "dependencies", group: "core", title: "Dependencies", question: "How do modules depend on each other?", available: moduleCount > 1, ...(moduleCount > 1 ? {} : { reason: "Only one source module." }) },
  ];

  return {
    schemaVersion: ARCHITECTURE_SCHEMA,
    version: ARCHITECTURE_VERSION,
    repository: { name: facts.name, root: engine.root },
    fingerprint: fingerprintOf(engine),
    generatedAt: new Date().toISOString(),
    nodes,
    relationships,
    components: componentIds,
    coverage,
    views,
    unknowns,
    hiddenModules: Math.max(0, moduleCount - MAX_DEPENDENCY_MODULES),
    codeLinks,
    externalLinks: links,
  };
}


export function fingerprintOf(engine: FehmEngine): string {
  const h = createHash("sha256").update(`${ARCHITECTURE_VERSION}|${LAYOUT_VERSION}|`);
  for (const [path, hash] of [...engine.fileHashes().entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) h.update(`${path}:${hash}\n`);
  return h.digest("hex").slice(0, 16);
}

function external(id: string, type: ArchNodeType, name: string, description: string, tier: 0 | 3, confidence: Confidence, reasons: string[]): ArchNode {
  return { id, type, level: 1, name, description, role: { confidence, reasons }, children: [], files: [], symbols: 0, technologies: [], evidence: [], tier };
}

function evidencedRole(files: string[], fileRoles: Map<string, RoleEvidence[]>): ArchNodeType | undefined {
  let best: RoleEvidence | undefined;
  for (const f of files) for (const r of fileRoles.get(f) ?? []) if (!best || RANK[r.confidence] < RANK[best.confidence] || (RANK[r.confidence] === RANK[best.confidence] && ROLE_PRIORITY.indexOf(r.role) < ROLE_PRIORITY.indexOf(best.role))) best = r;
  return best?.role;
}

/**
 * Role of a set of files. Evidenced roles (verified/strong) win by confidence,
 * then by interface priority; naming conventions only apply when the code
 * says nothing, and are marked inferred. `sharedBy` > 0 marks a structural
 * foundation (used by that many, uses nothing).
 */
export function resolveRole(files: string[], fileRoles: Map<string, RoleEvidence[]>, name: string, sharedBy: number): { type: ArchNodeType; confidence: Confidence; reasons: string[]; evidence: ArchEvidence[] } {
  const merged = new Map<ArchNodeType, RoleEvidence[]>();
  for (const f of files) for (const r of fileRoles.get(f) ?? []) merged.set(r.role, [...(merged.get(r.role) ?? []), r]);
  const ranked = [...merged.entries()]
    .map(([role, list]) => ({ role, list, confidence: list.reduce<Confidence>((c, r) => stronger(c, r.confidence), "unknown") }))
    .sort((a, b) => RANK[a.confidence] - RANK[b.confidence] || ROLE_PRIORITY.indexOf(a.role) - ROLE_PRIORITY.indexOf(b.role));
  if (ranked.length) {
    const top = ranked[0]!;
    const reasons = [...new Set(top.list.map((r) => r.reason))].slice(0, 3);
    for (const other of ranked.slice(1, 3)) reasons.push(`also ${ROLE_LABEL[other.role].toLowerCase()}: ${other.list[0]!.reason}`);
    // Several files independently showing the same pattern strengthen it; they never make it "verified".
    return { type: top.role, confidence: top.confidence, reasons, evidence: top.list.flatMap((r) => r.evidence).slice(0, SAMPLE) };
  }
  const named = name ? NAME_ROLE.find(([re]) => re.test(name)) : undefined;
  if (named) return { type: named[1], confidence: "inferred", reasons: [`named like ${ROLE_LABEL[named[1]].toLowerCase()} (${name})`], evidence: [] };
  if (sharedBy > 0) return { type: "shared", confidence: "inferred", reasons: [`used by ${sharedBy} others and depends on none`], evidence: [] };
  return { type: "component", confidence: "unknown", reasons: ["no role evidence in code"], evidence: [] };
}

function structuralShared(g: Group, groups: Group[], fileDeps: Map<string, Set<string>>): number {
  const own = new Set(g.files);
  let outside = false;
  const users = new Set<string>();
  for (const f of g.files) for (const t of fileDeps.get(f) ?? []) if (!own.has(t)) outside = true;
  if (outside) return 0;
  for (const other of groups) {
    if (other === g) continue;
    if (other.files.some((f) => [...(fileDeps.get(f) ?? [])].some((t) => own.has(t)))) users.add(other.key);
  }
  return users.size >= 3 ? users.size : 0;
}

/**
 * Deterministic module → component clustering.
 *   1. Collapse directories, deepest first, while there are more than
 *      MAX_COMPONENTS groups (never the common source root).
 *   2. Merge sibling groups by dependency affinity (cosine of file-level
 *      dependency counts), strongest pair first, while still too many —
 *      never merging two groups whose evidenced roles differ.
 */
export function clusterModules(
  modules: { name: string; files: string[] }[],
  between: (a: string[], b: Set<string>) => number,
  roleOf: (files: string[]) => ArchNodeType | undefined,
  max = MAX_COMPONENTS,
): Group[] {
  const anchorOf = (m: string): string => (m.endsWith("*") ? posix.dirname(m) : m);
  let groups: Group[] = modules.map((m) => ({ key: m.name, modules: [m.name], files: [...m.files], anchor: anchorOf(m.name), parent: m.name.endsWith("*") ? posix.dirname(m.name) : posix.dirname(m.name), kind: "module" }));
  const segs = (p: string): number => (p === "." ? 0 : p.split("/").length);
  // Common root: the deepest directory every group lies under.
  const anchors = groups.map((g) => g.anchor);
  let root = anchors.length ? anchors[0]! : ".";
  const under = (p: string, d: string): boolean => d === "." || p === d || p.startsWith(`${d}/`);
  while (root !== "." && !anchors.every((a) => under(a, root))) root = posix.dirname(root);

  const total = groups.reduce((s, g) => s + g.files.length, 0);
  // No component should swallow much more than its fair share of the codebase.
  const cap = Math.max(8, Math.ceil((total / max) * 2.5));
  while (groups.length > max) {
    const candidates = new Map<string, Group[]>();
    for (const g of groups) {
      for (let d = g.anchor; d !== "." && d !== root && segs(d) > segs(root); d = posix.dirname(d)) {
        candidates.set(d, [...(candidates.get(d) ?? []), g]);
      }
    }
    const pick = [...candidates.entries()]
      .filter(([, gs]) => gs.length >= 2 && gs.reduce((s, g) => s + g.files.length, 0) <= cap)
      .sort((a, b) => segs(b[0]) - segs(a[0]) || a[1].reduce((s, g) => s + g.files.length, 0) - b[1].reduce((s, g) => s + g.files.length, 0) || (a[0] < b[0] ? -1 : 1))[0];
    if (!pick) break;
    const [dir, members] = pick;
    const set = new Set(members);
    const merged: Group = { key: dir, modules: members.flatMap((g) => g.modules).sort(), files: members.flatMap((g) => g.files).sort(), anchor: dir, parent: posix.dirname(dir), kind: "directory" };
    groups = [...groups.filter((g) => !set.has(g)), merged].sort((a, b) => (a.key < b.key ? -1 : 1));
  }

  const roles = new Map<Group, ArchNodeType | undefined>(groups.map((g) => [g, roleOf(g.files)]));
  while (groups.length > max) {
    const sets = new Map(groups.map((g) => [g, new Set(g.files)]));
    const pair = new Map<string, number>();
    const deg = new Map<Group, number>();
    for (const a of groups) {
      for (const b of groups) {
        if (a === b) continue;
        const n = between(a.files, sets.get(b)!);
        if (!n) continue;
        deg.set(a, (deg.get(a) ?? 0) + n);
        deg.set(b, (deg.get(b) ?? 0) + n);
        const key = a.key < b.key ? `${a.key}\u0000${b.key}` : `${b.key}\u0000${a.key}`;
        pair.set(key, (pair.get(key) ?? 0) + n);
      }
    }
    const byKey = new Map(groups.map((g) => [g.key, g]));
    let best: { a: Group; b: Group; w: number } | undefined;
    for (const [key, n] of [...pair.entries()].sort((x, y) => (x[0] < y[0] ? -1 : 1))) {
      const [ka, kb] = key.split("\u0000") as [string, string];
      const a = byKey.get(ka)!;
      const b = byKey.get(kb)!;
      // Directories are already coherent units: they only absorb their own subdirectories.
      const loose = a.kind !== "directory" && b.kind !== "directory" && a.parent === b.parent;
      const nested = a.kind === "directory" && b.kind === "directory" && (under(a.anchor, b.anchor) || under(b.anchor, a.anchor));
      if (!loose && !nested) continue;
      if (a.files.length + b.files.length > cap) continue;
      const ra = roles.get(a);
      const rb = roles.get(b);
      // Interfaces (API, CLI, UI) stay visible: they never dissolve into a role-less cluster.
      const isInterface = (r: ArchNodeType | undefined): boolean => r !== undefined && INTERFACE.has(r);
      if (ra !== rb && ((ra !== undefined && rb !== undefined) || isInterface(ra) || isInterface(rb))) continue;
      const w = n / Math.sqrt((deg.get(a) ?? 1) * (deg.get(b) ?? 1));
      if (!best || w > best.w + 1e-12) best = { a, b, w };
    }
    if (!best) break;
    const { a, b } = best;
    const members = [...new Set([...a.modules, ...b.modules])];
    const hub = a.files.length >= b.files.length ? a.key : b.key;
    const outer = segs(a.anchor) <= segs(b.anchor) ? a : b;
    const merged: Group = { key: hub, modules: members.sort(), files: [...a.files, ...b.files].sort(), anchor: outer.anchor, parent: outer.parent, kind: "cluster" };
    roles.set(merged, roles.get(a) ?? roles.get(b));
    groups = [...groups.filter((g) => g !== a && g !== b), merged].sort((x, y) => (x.key < y.key ? -1 : 1));
  }
  // A cluster is named after its hub: the member module tied to the most other members.
  const byName = new Map(modules.map((m) => [m.name, m]));
  return groups
    .map((g) => {
      if (g.kind !== "cluster") return g;
      const sets = new Map(g.modules.map((m) => [m, new Set(byName.get(m)!.files)]));
      // The orchestrator: the member that uses the most other members. Barrel files re-export, they don't orchestrate.
      const uses = (m: string): number => g.modules.filter((o) => o !== m && between(byName.get(m)!.files, sets.get(o)!) > 0).length;
      const barrel = (m: string): number => (/(^|\/)(index|mod|__init__)$/.test(m) ? 1 : 0);
      const hub = [...g.modules].sort((a, b) => barrel(a) - barrel(b) || uses(b) - uses(a) || byName.get(b)!.files.length - byName.get(a)!.files.length || (a < b ? -1 : 1))[0]!;
      return { ...g, key: hub };
    })
    .sort((a, b) => (a.key < b.key ? -1 : 1));
}

/**
 * File-level code dependencies from the Feature 1 graph (non-structural edges
 * between two different source files), each with a few evidence samples.
 * Every architecture level is an aggregation of these.
 */
function collectCodeLinks(engine: FehmEngine, facts: BriefingFacts): CodeLink[] {
  const out = new Map<string, CodeLink>();
  const graph = engine.graph;
  const code = new Set(facts.sourceFiles);
  for (const e of graph.edges()) {
    if (STRUCTURAL.has(e.kind)) continue;
    // `handles` runs from a handler function to the route that dispatches to it: the code dependency is route file → handler file.
    const [from, to] = e.kind === "handles" ? [e.target, e.source] : [e.source, e.target];
    const fa = facts.fileOf(from);
    const fb = facts.fileOf(to);
    if (!fa || !fb || fa === fb || !code.has(fa) || !code.has(fb)) continue;
    const key = `${fa}\u0000${fb}`;
    let l = out.get(key);
    if (!l) {
      l = { source: fa, target: fb, counts: {}, evidence: [] };
      out.set(key, l);
    }
    l.counts[e.kind] = (l.counts[e.kind] ?? 0) + 1;
    if (l.evidence.length < 4) {
      const loc = e.evidence.location;
      l.evidence.push({ path: loc?.path ?? fa, ...(loc ? { line: loc.line } : {}), nodeId: e.source, provenance: e.evidence.provenance, detail: `${graph.node(e.source)?.name ?? fa} ${e.kind} ${graph.node(e.target)?.name ?? fb}` });
    }
  }
  return [...out.values()].sort((a, b) => (a.source < b.source ? -1 : a.source > b.source ? 1 : a.target < b.target ? -1 : 1));
}

/**
 * Project file-level links onto an architecture level. `keyOf` maps a source
 * file to its node at that level (undefined = not shown); links inside one
 * node disappear. External links keep their actor/store/external endpoint.
 */
export function aggregate(codeLinks: CodeLink[], externalLinks: FileLink[], keyOf: (file: string) => string | undefined, hasNode: (id: string) => boolean = () => true): ArchRelationship[] {
  const out = new Map<string, ArchRelationship>();
  const kinds = new Map<string, Set<RelationshipType>>();
  const get = (source: string, target: string): ArchRelationship => {
    const id = `rel:${source}→${target}`;
    let r = out.get(id);
    if (!r) {
      r = { id, source, target, type: "imports", counts: {}, weight: 0, confidence: "unknown", evidence: [] };
      out.set(id, r);
    }
    return r;
  };
  const addEvidence = (r: ArchRelationship, ev: ArchEvidence): void => {
    r.confidence = stronger(r.confidence, confidenceOf(ev.provenance));
    if (r.evidence.length < SAMPLE && !r.evidence.some((e) => e.path === ev.path && e.line === ev.line && e.detail === ev.detail)) r.evidence.push(ev);
  };
  for (const l of codeLinks) {
    const a = keyOf(l.source);
    const b = keyOf(l.target);
    if (!a || !b || a === b) continue;
    const r = get(a, b);
    for (const [k, v] of Object.entries(l.counts) as [EdgeKind, number][]) {
      r.counts[k] = (r.counts[k] ?? 0) + v;
      r.weight += v;
    }
    for (const ev of l.evidence) addEvidence(r, ev);
  }
  for (const r of out.values()) {
    const c = r.counts;
    r.type = c.calls ? "calls" : c.extends || c.implements ? "extends" : c.references || c.uses || c.writes || c.handles || c.configures ? "uses" : "imports";
    // Several independent heuristic links make a relationship strong; one or two stay inferred.
    if (r.confidence === "strong" && r.weight < 3) r.confidence = "inferred";
  }
  for (const l of externalLinks) {
    const k = keyOf(l.file);
    if (!k || !hasNode(l.target)) continue;
    const [source, target] = l.inbound ? [l.target, k] : [k, l.target];
    const r = get(source, target);
    r.counts.signal = (r.counts.signal ?? 0) + 1;
    r.weight += 1;
    addEvidence(r, l.evidence);
    kinds.set(r.id, (kinds.get(r.id) ?? new Set()).add(l.type));
  }
  for (const [id, set] of kinds) {
    const r = out.get(id)!;
    const [type, label]: [RelationshipType, string] =
      set.has("writes") && set.has("reads") ? ["writes", "reads · writes"]
      : set.has("writes") ? ["writes", "writes"]
      : set.has("reads") ? ["reads", "reads"]
      : set.has("requests") ? ["requests", "HTTP"]
      : set.has("invokes") ? ["invokes", "runs"]
      : set.has("calls") ? ["calls", "calls"]
      : ["uses", "uses"];
    r.type = type;
    r.label = label;
  }
  return [...out.values()].sort((a, b) => (a.id < b.id ? -1 : 1));
}

export { ROLE_LABEL };
