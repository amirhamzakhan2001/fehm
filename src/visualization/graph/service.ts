import { basename, join } from "node:path";
import type { FehmEngine } from "../../engine.js";
import { readJson, stateDir, writeJsonAtomic } from "../../persistence.js";
import { adaptCodeGraph } from "./adapter.js";
import { computeLayout, type PreviousLayout } from "./layout.js";
import {
  GRAPH_VIEW_SCHEMA,
  HIERARCHY_EDGE_KINDS,
  LAYOUT_VERSION,
  NODE_FLAG_EXPORTED,
  NODE_FLAG_TEST,
  viewEdgeKind,
  type GraphNodeDetail,
  type GraphSearchHit,
  type GraphStatus,
  type GraphViewPayload,
} from "./model.js";

interface LayoutFile {
  version: string;
  positions: Record<string, [number, number]>;
}

export interface GraphViewOptions {
  stateDirectory?: string;
  /** Do not persist the layout. */
  dryRun?: boolean;
}

export const layoutPath = (root: string, dir?: string): string => join(stateDir(root, dir), "graph-layout.json");

/**
 * Feature 3.1's server side: a read-only consumer of the Feature 1 engine.
 * It adapts the engine's graph into the columnar view payload, owns the
 * persisted layout, and forwards search/detail requests to the engine's own
 * index. It never scans, parses or links source itself.
 */
export class GraphViewService {
  private readonly views = new WeakMap<FehmEngine, GraphViewPayload>();

  constructor(private readonly options: GraphViewOptions = {}) {}

  status(engine: FehmEngine): GraphStatus {
    const stats = engine.graph.stats();
    return {
      state: stats.files === 0 ? "empty" : "ready",
      root: engine.root,
      project: basename(engine.root),
      layoutCached: this.views.has(engine) || this.layoutCovers(engine),
      stats: { nodes: stats.nodes, edges: stats.edges, files: stats.files },
      sync: { mode: engine.sync.mode, durationMs: Math.round(engine.sync.durationMs) },
    };
  }

  view(engine: FehmEngine): GraphViewPayload {
    const cached = this.views.get(engine);
    if (cached) return cached;
    const started = performance.now();
    const view = adaptCodeGraph(engine.graph);
    const { nodes, edges, parent, index } = view;

    const previous = this.readLayout(engine.root);
    const layout = computeLayout(
      {
        ids: nodes.map((n) => n.id),
        kinds: nodes.map((n) => n.kind),
        parent,
        edges: edges.map((e) => ({ source: index.get(e.source)!, target: index.get(e.target)!, kind: e.kind })),
      },
      previous,
    );
    const round = (v: number): number => Math.round(v * 100) / 100;
    if (!this.options.dryRun && layout.placed > 0) {
      const positions: Record<string, [number, number]> = {};
      for (let i = 0; i < nodes.length; i += 1) positions[nodes[i]!.id] = [round(layout.x[i]!), round(layout.y[i]!)];
      writeJsonAtomic(layoutPath(engine.root, this.options.stateDirectory), { version: LAYOUT_VERSION, positions } satisfies LayoutFile);
    }

    const nodeKinds: string[] = [];
    const edgeKinds: string[] = [];
    const provenances: string[] = [];
    const paths: string[] = [];
    const intern = (table: string[], lookup: Map<string, number>, value: string): number => {
      let k = lookup.get(value);
      if (k === undefined) {
        k = table.length;
        table.push(value);
        lookup.set(value, k);
      }
      return k;
    };
    const nodeKindIdx = new Map<string, number>();
    const edgeKindIdx = new Map<string, number>();
    const provIdx = new Map<string, number>();
    const pathIdx = new Map<string, number>();

    const payload: GraphViewPayload = {
      schema: GRAPH_VIEW_SCHEMA,
      root: engine.root,
      project: basename(engine.root),
      generatedAt: new Date().toISOString(),
      nodeKinds,
      edgeKinds,
      provenances,
      paths,
      nodes: { id: [], kind: [], name: [], path: [], line: [], parent: [], flags: [], x: [], y: [] },
      edges: { source: [], target: [], kind: [], confidence: [], provenance: [] },
      stats: { nodes: nodes.length, edges: edges.length, files: 0, directories: 0, symbols: 0, semanticEdges: 0, unresolved: engine.graph.unresolved.length },
      layout: {
        mode: layout.placed === 0 ? "cached" : layout.mode,
        version: LAYOUT_VERSION,
        durationMs: 0,
        reused: layout.reused,
        placed: layout.placed,
      },
      sync: { mode: engine.sync.mode, durationMs: Math.round(engine.sync.durationMs) },
    };
    const pn = payload.nodes;
    for (let i = 0; i < nodes.length; i += 1) {
      const node = nodes[i]!;
      pn.id.push(node.id);
      pn.kind.push(intern(nodeKinds, nodeKindIdx, node.kind));
      pn.name.push(node.name);
      pn.path.push(node.path ? intern(paths, pathIdx, node.path) : -1);
      pn.line.push(node.location?.line ?? 0);
      pn.parent.push(parent[i]!);
      pn.flags.push((node.exported ? NODE_FLAG_EXPORTED : 0) | (node.isTest ? NODE_FLAG_TEST : 0));
      pn.x.push(round(layout.x[i]!));
      pn.y.push(round(layout.y[i]!));
      if (node.kind === "file") payload.stats.files += 1;
      else if (node.kind === "directory") payload.stats.directories += 1;
      else if (node.kind !== "repository" && node.kind !== "package") payload.stats.symbols += 1;
    }
    const pe = payload.edges;
    for (const edge of edges) {
      pe.source.push(index.get(edge.source)!);
      pe.target.push(index.get(edge.target)!);
      pe.kind.push(intern(edgeKinds, edgeKindIdx, viewEdgeKind(edge.kind, nodes[index.get(edge.target)!]!.kind)));
      pe.confidence.push(Math.round(edge.evidence.confidence * 100));
      pe.provenance.push(intern(provenances, provIdx, edge.evidence.provenance));
      if (!HIERARCHY_EDGE_KINDS.has(edge.kind)) payload.stats.semanticEdges += 1;
    }
    payload.layout.durationMs = Math.round(performance.now() - started);
    this.views.set(engine, payload);
    return payload;
  }

  /** Ranked search through the engine's own index (BM25 + symbol + graph signals). */
  search(engine: FehmEngine, query: string, limit = 30): GraphSearchHit[] {
    if (!query.trim()) return [];
    return engine.search(query, { limit }).map((hit) => {
      const node = engine.graph.node(hit.nodeId);
      const out: GraphSearchHit = { id: hit.nodeId, kind: hit.kind, name: hit.name, score: Math.round(hit.score * 1000) / 1000 };
      if (hit.path) out.path = hit.path;
      if (node?.location?.line) out.line = node.location.line;
      return out;
    });
  }

  detail(engine: FehmEngine, id: string): GraphNodeDetail | undefined {
    const node = engine.graph.node(id);
    if (!node) return undefined;
    const explained = engine.explain(id);
    if (explained.status !== "found") return undefined;
    const r = explained.result;
    const out: GraphNodeDetail = {
      id: node.id,
      kind: node.kind,
      name: node.name,
      provenance: node.evidence.provenance,
      confidence: node.evidence.confidence,
      summary: r.summary,
      related: r.related.map((x) => ({ ...x })),
      unresolved: r.unknowns.map((u) => ({ text: u.text, reason: u.reason, line: u.location.line })),
    };
    if (node.path) {
      out.path = node.path;
      out.absolutePath = join(engine.root, node.path);
    }
    if (node.location?.line) out.line = node.location.line;
    if (node.location?.endLine) out.endLine = node.location.endLine;
    if (node.signature) out.signature = node.signature;
    if (node.doc) out.doc = node.doc;
    if (node.exported) out.exported = true;
    if (node.isTest) out.isTest = true;
    if (r.semanticSummary) out.semanticSummary = { text: r.semanticSummary.text, model: r.semanticSummary.model };
    return out;
  }

  private readLayout(root: string): PreviousLayout | undefined {
    const read = readJson<LayoutFile>(layoutPath(root, this.options.stateDirectory));
    if (!read.ok || read.value.version !== LAYOUT_VERSION || typeof read.value.positions !== "object" || !read.value.positions) return undefined;
    const map = new Map<string, [number, number]>();
    for (const [id, p] of Object.entries(read.value.positions)) {
      if (Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1])) map.set(id, [p[0], p[1]]);
    }
    return map;
  }

  private layoutCovers(engine: FehmEngine): boolean {
    const previous = this.readLayout(engine.root);
    if (!previous) return false;
    for (const node of engine.graph.nodes()) if (!previous.has(node.id)) return false;
    return true;
  }
}
