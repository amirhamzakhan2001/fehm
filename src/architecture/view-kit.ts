import type { BriefingFacts } from "../codebase-briefing/facts.js";
import type { FehmEngine } from "../engine.js";
import type { GraphNode } from "../model.js";
import { TAG } from "./labels.js";
import type { LayoutInput, LayoutInputEdge, LayoutInputNode } from "./layout.js";
import type { SequenceInput } from "./sequence-layout.js";
import type { ArchEvidence, ArchitectureModel, ArchNode, ArchNodeType, ArchRelationship, Confidence, RelationshipType, ViewOption, ViewType } from "./types.js";

/**
 * Shared vocabulary for view builders. Structural views (system, components,
 * dependencies) project the semantic model; behaviour and operations views
 * (runtime, data flow, workflow, lifecycle, deployment, security, delta)
 * derive their nodes from Feature 1 facts on demand. Those nodes exist only
 * in the view that shows them, so each view carries its own ArchNodes.
 */

export interface ViewContext {
  engine: FehmEngine;
  facts: BriefingFacts;
  model: ArchitectureModel;
  byId: Map<string, ArchNode>;
}

export interface ViewSpec {
  view: ViewType;
  focus?: string;
  title: string;
  nodes: ArchNode[];
  relationships: ArchRelationship[];
  input: LayoutInput | SequenceInput;
  path: { id: string; name: string }[];
  notes: string[];
}

export type ViewResult = ViewSpec | { error: string };

export interface Availability {
  available: boolean;
  reason?: string;
  optionLabel?: string;
  options?: ViewOption[];
}

export function node(id: string, type: ArchNodeType, name: string, o: { confidence?: Confidence; reasons?: string[]; description?: string; evidence?: ArchEvidence[]; files?: string[]; graphNodeId?: string; tier?: ArchNode["tier"]; technologies?: string[] } = {}): ArchNode {
  const n: ArchNode = {
    id,
    type,
    level: 2,
    name,
    role: { confidence: o.confidence ?? "strong", reasons: o.reasons ?? [] },
    children: [],
    files: o.files ?? [],
    symbols: 0,
    technologies: o.technologies ?? [],
    evidence: o.evidence ?? [],
    tier: o.tier ?? 1,
  };
  if (o.description) n.description = o.description;
  if (o.graphNodeId) n.graphNodeId = o.graphNodeId;
  return n;
}

export function relation(source: string, target: string, type: RelationshipType, o: { label?: string; confidence?: Confidence; evidence?: ArchEvidence[]; weight?: number; id?: string } = {}): ArchRelationship {
  const r: ArchRelationship = { id: o.id ?? `rel:${source}→${target}`, source, target, type, counts: { signal: o.weight ?? 1 }, weight: o.weight ?? 1, confidence: o.confidence ?? "strong", evidence: o.evidence ?? [] };
  if (o.label) r.label = o.label;
  return r;
}

/** Merge relationships with the same id (weights and evidence add up; the strongest confidence wins). */
export function mergeRelations(rels: ArchRelationship[]): ArchRelationship[] {
  const RANK: Record<Confidence, number> = { verified: 0, strong: 1, inferred: 2, unknown: 3 };
  const out = new Map<string, ArchRelationship>();
  for (const r of rels) {
    const prev = out.get(r.id);
    if (!prev) {
      out.set(r.id, { ...r, counts: { ...r.counts }, evidence: [...r.evidence] });
      continue;
    }
    prev.weight += r.weight;
    prev.counts.signal = (prev.counts.signal ?? 0) + (r.counts.signal ?? 0);
    if (RANK[r.confidence] < RANK[prev.confidence]) prev.confidence = r.confidence;
    for (const e of r.evidence) if (prev.evidence.length < 8) prev.evidence.push(e);
    if (!prev.label && r.label) prev.label = r.label;
  }
  return [...out.values()];
}

export function layoutNode(n: ArchNode, band: LayoutInputNode["band"], o: { rank?: number; subtitle?: string; context?: boolean; tag?: string } = {}): LayoutInputNode {
  const out: LayoutInputNode = { id: n.id, type: n.type, name: n.name, tag: o.tag ?? TAG[n.type], band };
  if (o.rank !== undefined) out.rank = o.rank;
  if (o.subtitle) out.subtitle = o.subtitle;
  if (o.context) out.context = true;
  if (n.status) out.status = n.status;
  return out;
}

export function layoutEdge(r: ArchRelationship, label = true): LayoutInputEdge {
  return { id: r.id, source: r.source, target: r.target, weight: r.weight, type: r.type, confidence: r.confidence, ...(label && r.label ? { label: r.label } : {}), ...(r.status ? { status: r.status } : {}) };
}

export const plural = (n: number, w: string): string => `${n} ${n === 1 ? w : `${w}s`}`;

export function evOf(n: GraphNode, detail?: string): ArchEvidence {
  const e: ArchEvidence = { path: n.path ?? "", nodeId: n.id, provenance: n.evidence.provenance };
  if (n.location) e.line = n.location.line;
  if (detail) e.detail = detail;
  return e;
}

/** The system-level component that owns a source file. */
export function componentOf(ctx: ViewContext, path: string | undefined): ArchNode | undefined {
  if (!path) return undefined;
  const f = ctx.byId.get(`file:${path}`);
  let cur = f;
  while (cur && cur.level !== 1) cur = cur.parent ? ctx.byId.get(cur.parent) : undefined;
  return cur;
}

/** Functions a function calls, in call-site order (graph `calls` edges, resolved only). */
export function callees(ctx: ViewContext, id: string): { node: GraphNode; line: number; ev: ArchEvidence }[] {
  const graph = ctx.engine.graph;
  const seen = new Set<string>();
  const out: { node: GraphNode; line: number; ev: ArchEvidence }[] = [];
  for (const e of graph.edgesOf(id, "out", ["calls"])) {
    const t = graph.node(e.target);
    if (!t || seen.has(t.id) || (t.kind !== "function" && t.kind !== "method")) continue;
    seen.add(t.id);
    const loc = e.evidence.location;
    out.push({ node: t, line: loc?.line ?? 0, ev: { path: loc?.path ?? t.path ?? "", ...(loc ? { line: loc.line } : {}), nodeId: e.source, provenance: e.evidence.provenance, detail: `calls ${t.name}` } });
  }
  return out.sort((a, b) => a.line - b.line || (a.node.name < b.node.name ? -1 : 1));
}

// ─── entry points ───────────────────────────────────────────────────

export interface EntryPoint {
  id: string;
  label: string;
  kind: "http" | "cli" | "worker" | "main";
  handler: GraphNode;
  evidence: ArchEvidence;
}

/** Entry points with a resolved handler: HTTP routes, CLI commands, background workers, `main` functions. */
export function entryPoints(ctx: ViewContext): EntryPoint[] {
  const { facts } = ctx;
  const out: EntryPoint[] = [];
  const seen = new Set<string>();
  const add = (e: EntryPoint): void => {
    if (seen.has(e.id)) return;
    seen.add(e.id);
    out.push(e);
  };
  for (const r of facts.signals.routes) if (r.handler) add({ id: `http:${r.method} ${r.route}`, label: `${r.method} ${r.route}`, kind: "http", handler: r.handler, evidence: { path: r.path, line: r.line, nodeId: r.handler.id, provenance: "heuristic", detail: `${r.method} ${r.route} → ${r.handler.name}` } });
  for (const c of facts.signals.cli) if (c.handler) add({ id: `cli:${c.group}:${c.name}`, label: `${c.name} (command)`, kind: "cli", handler: c.handler, evidence: { path: c.path, line: c.line, nodeId: c.handler.id, provenance: "heuristic", detail: `command ${c.name} → ${c.handler.name}` } });
  for (const s of facts.signals.runtime) {
    if (s.kind !== "worker" && s.kind !== "scheduled" && s.kind !== "interval") continue;
    const fn = facts.enclosing(s.path, s.line);
    if (fn && (fn.kind === "function" || fn.kind === "method")) add({ id: `fn:${fn.id}`, label: `${fn.name} (${s.kind})`, kind: "worker", handler: fn, evidence: { path: s.path, line: s.line, nodeId: fn.id, provenance: "heuristic", detail: s.text } });
  }
  for (const n of ctx.engine.graph.nodes()) {
    if ((n.kind === "function" || n.kind === "method") && /^(main|run|start|bootstrap)$/.test(n.name) && n.path && facts.roleByPath.get(n.path) === "source") add({ id: `fn:${n.id}`, label: `${n.name} (${n.path})`, kind: "main", handler: n, evidence: evOf(n, "entry function") });
  }
  return out.slice(0, 80);
}

export function entryById(ctx: ViewContext, id: string | undefined): EntryPoint | undefined {
  const all = entryPoints(ctx);
  if (!id) return all[0];
  return all.find((e) => e.id === id) ?? all.find((e) => e.handler.id === id);
}

// ─── data operations per function ───────────────────────────────────

export interface DataOps {
  reads: Map<string, ArchEvidence[]>;
  writes: Map<string, ArchEvidence[]>;
  fileWrites: ArchEvidence[];
  fileReads: ArchEvidence[];
  outbound: ArchEvidence[];
  /** External system node ids reached from this function's file (SDK imports). */
  externals: string[];
}

const FILE_READ = /\b(?:readFileSync|readFile|createReadStream|readdirSync|readdir)\(|\bopen\([^)]*["']r?b?["']\)|\bjson\.load\(/;

/** SQL, file and outbound-HTTP signals attributed to the function (or method) that contains them. */
export function dataOps(ctx: ViewContext): Map<string, DataOps> {
  const memo = (ctx as ViewContext & { _ops?: Map<string, DataOps> })._ops;
  if (memo) return memo;
  const { facts } = ctx;
  const out = new Map<string, DataOps>();
  const at = (path: string, line: number): DataOps | undefined => {
    const fn = facts.enclosing(path, line);
    if (!fn || (fn.kind !== "function" && fn.kind !== "method")) return undefined;
    let ops = out.get(fn.id);
    if (!ops) {
      ops = { reads: new Map(), writes: new Map(), fileWrites: [], fileReads: [], outbound: [], externals: [] };
      out.set(fn.id, ops);
    }
    return ops;
  };
  for (const [table, uses] of facts.signals.tables) {
    for (const u of uses) {
      const ops = at(u.path, u.line);
      if (!ops) continue;
      const bucket = /^(INSERT|UPDATE|DELETE|CREATE)$/.test(u.op) ? ops.writes : ops.reads;
      bucket.set(table, [...(bucket.get(table) ?? []), { path: u.path, line: u.line, provenance: "heuristic", detail: `${u.op} ${table}` }]);
    }
  }
  for (const w of facts.signals.fileWrites) at(w.path, w.line)?.fileWrites.push({ path: w.path, line: w.line, provenance: "heuristic", detail: "writes a file" });
  for (const o of facts.signals.outbound) at(o.path, o.line)?.outbound.push({ path: o.path, line: o.line, provenance: "heuristic", detail: "outbound HTTP request" });
  for (const path of facts.sourceFiles) {
    const lines = facts.lines(path);
    for (let i = 0; i < Math.min(lines.length, 20_000); i += 1) if (FILE_READ.test(lines[i]!)) at(path, i + 1)?.fileReads.push({ path, line: i + 1, provenance: "heuristic", detail: "reads a file" });
  }
  // SDK-backed external systems: functions in files that import the SDK and call into it.
  for (const n of ctx.model.nodes) {
    if (n.type !== "external-system" || n.id === "external:http") continue;
    const importers = new Set(ctx.model.externalLinks.filter((l) => l.target === n.id).map((l) => l.file));
    for (const path of importers) {
      for (const sym of facts.symbolsIn(path)) {
        if (sym.kind !== "function" && sym.kind !== "method") continue;
        let ops = out.get(sym.id);
        if (!ops) {
          ops = { reads: new Map(), writes: new Map(), fileWrites: [], fileReads: [], outbound: [], externals: [] };
          out.set(sym.id, ops);
        }
        if (!ops.externals.includes(n.id)) ops.externals.push(n.id);
      }
    }
  }
  (ctx as ViewContext & { _ops?: Map<string, DataOps> })._ops = out;
  return out;
}

export function hasData(ops: DataOps | undefined): boolean {
  return Boolean(ops && (ops.reads.size || ops.writes.size || ops.fileWrites.length || ops.fileReads.length || ops.outbound.length || ops.externals.length));
}
