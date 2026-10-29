import { edgeId } from "./ids.js";
import {
  ANALYSIS_VERSION,
  GRAPH_SCHEMA_VERSION,
  type EdgeKind,
  type Evidence,
  type GraphEdge,
  type GraphNode,
  type GraphStats,
  type SerializedGraph,
  type UnresolvedReference,
} from "./model.js";

export type Direction = "out" | "in" | "both";

export interface TraversalOptions {
  /** Maximum hops from the start node. Default 1; values above 3 are clamped. */
  depth?: number;
  direction?: Direction;
  kinds?: readonly EdgeKind[];
  /** Maximum nodes returned (excluding the start). Default 200. */
  limit?: number;
  minConfidence?: number;
}

export interface TraversalStep {
  nodeId: string;
  depth: number;
  via: GraphEdge;
}

export const MAX_TRAVERSAL_DEPTH = 3;

/** In-memory code graph. Ordering of every query result is deterministic. */
export class CodeGraph {
  readonly root: string;
  private readonly nodeMap = new Map<string, GraphNode>();
  private readonly edgeMap = new Map<string, GraphEdge>();
  private readonly outgoing = new Map<string, Set<string>>();
  private readonly incoming = new Map<string, Set<string>>();
  unresolved: UnresolvedReference[] = [];

  constructor(root: string) {
    this.root = root;
  }

  /** Adds a node, or replaces it if the new evidence is at least as strong. */
  addNode(node: GraphNode): void {
    const existing = this.nodeMap.get(node.id);
    if (!existing || node.evidence.confidence >= existing.evidence.confidence) this.nodeMap.set(node.id, node);
  }

  /**
   * Adds an edge. Duplicate (kind, source, target) edges collapse to one,
   * keeping the strongest evidence. Returns false for self-loops or when an
   * endpoint is missing — edges never dangle.
   */
  addEdge(kind: EdgeKind, source: string, target: string, evidence: Evidence): boolean {
    if (source === target || !this.nodeMap.has(source) || !this.nodeMap.has(target)) return false;
    const id = edgeId(kind, source, target);
    const existing = this.edgeMap.get(id);
    if (existing && existing.evidence.confidence >= evidence.confidence) return true;
    this.edgeMap.set(id, { id, kind, source, target, evidence });
    link(this.outgoing, source, id);
    link(this.incoming, target, id);
    return true;
  }

  removeNode(id: string): void {
    for (const edge of [...this.edgesOf(id, "both")]) this.removeEdge(edge.id);
    this.nodeMap.delete(id);
    this.outgoing.delete(id);
    this.incoming.delete(id);
  }

  removeEdge(id: string): void {
    const edge = this.edgeMap.get(id);
    if (!edge) return;
    this.edgeMap.delete(id);
    this.outgoing.get(edge.source)?.delete(id);
    this.incoming.get(edge.target)?.delete(id);
  }

  node(id: string): GraphNode | undefined {
    return this.nodeMap.get(id);
  }

  edge(id: string): GraphEdge | undefined {
    return this.edgeMap.get(id);
  }

  nodes(): GraphNode[] {
    return [...this.nodeMap.values()].sort((a, b) => cmp(a.id, b.id));
  }

  edges(): GraphEdge[] {
    return [...this.edgeMap.values()].sort((a, b) => cmp(a.id, b.id));
  }

  get nodeCount(): number {
    return this.nodeMap.size;
  }

  get edgeCount(): number {
    return this.edgeMap.size;
  }

  edgesOf(id: string, direction: Direction, kinds?: readonly EdgeKind[]): GraphEdge[] {
    const ids = [
      ...(direction !== "in" ? this.outgoing.get(id) ?? [] : []),
      ...(direction !== "out" ? this.incoming.get(id) ?? [] : []),
    ];
    const out: GraphEdge[] = [];
    for (const eid of ids) {
      const edge = this.edgeMap.get(eid);
      if (edge && (!kinds || kinds.includes(edge.kind))) out.push(edge);
    }
    return out.sort((a, b) => b.evidence.confidence - a.evidence.confidence || cmp(a.id, b.id));
  }

  /**
   * Breadth-first, depth-bounded traversal. Each node appears once, at its
   * shortest distance; ties are resolved by edge confidence then id.
   */
  traverse(start: string, options: TraversalOptions = {}): TraversalStep[] {
    const depth = Math.min(Math.max(0, options.depth ?? 1), MAX_TRAVERSAL_DEPTH);
    const limit = options.limit ?? 200;
    const direction = options.direction ?? "both";
    const minConfidence = options.minConfidence ?? 0;
    if (!this.nodeMap.has(start) || depth === 0 || limit <= 0) return [];
    const seen = new Set([start]);
    const out: TraversalStep[] = [];
    let frontier = [start];
    for (let d = 1; d <= depth && frontier.length > 0; d += 1) {
      const next: string[] = [];
      for (const id of frontier) {
        for (const edge of this.edgesOf(id, direction, options.kinds)) {
          if (edge.evidence.confidence < minConfidence) continue;
          const other = edge.source === id ? edge.target : edge.source;
          if (seen.has(other)) continue;
          seen.add(other);
          out.push({ nodeId: other, depth: d, via: edge });
          next.push(other);
          if (out.length >= limit) return out;
        }
      }
      frontier = next;
    }
    return out;
  }

  /** Symbols whose simple or qualified name equals `name` (case-sensitive first, then insensitive). */
  findByName(name: string): GraphNode[] {
    const exact: GraphNode[] = [];
    const loose: GraphNode[] = [];
    const lower = name.toLowerCase();
    for (const node of this.nodeMap.values()) {
      const simple = node.name.split(".").at(-1)!;
      if (node.name === name || simple === name || node.path === name || node.id === name) exact.push(node);
      else if (node.name.toLowerCase() === lower || simple.toLowerCase() === lower) loose.push(node);
    }
    const order = (a: GraphNode, b: GraphNode): number => kindRank(a) - kindRank(b) || cmp(a.id, b.id);
    return exact.length ? exact.sort(order) : loose.sort(order);
  }

  stats(): GraphStats {
    const stats: GraphStats = {
      nodes: this.nodeMap.size,
      edges: this.edgeMap.size,
      files: 0,
      nodesByKind: {},
      edgesByKind: {},
      edgesByProvenance: {},
      unresolved: this.unresolved.length,
    };
    for (const node of this.nodeMap.values()) {
      stats.nodesByKind[node.kind] = (stats.nodesByKind[node.kind] ?? 0) + 1;
      if (node.kind === "file") stats.files += 1;
    }
    for (const edge of this.edgeMap.values()) {
      stats.edgesByKind[edge.kind] = (stats.edgesByKind[edge.kind] ?? 0) + 1;
      stats.edgesByProvenance[edge.evidence.provenance] = (stats.edgesByProvenance[edge.evidence.provenance] ?? 0) + 1;
    }
    return stats;
  }

  toJSON(): SerializedGraph {
    return {
      schemaVersion: GRAPH_SCHEMA_VERSION,
      analysisVersion: ANALYSIS_VERSION,
      root: this.root,
      nodes: this.nodes(),
      edges: this.edges(),
      unresolved: [...this.unresolved].sort(
        (a, b) => cmp(a.location.path, b.location.path) || a.location.line - b.location.line || cmp(a.text, b.text),
      ),
    };
  }

  static fromJSON(data: SerializedGraph): CodeGraph {
    if (data.schemaVersion !== GRAPH_SCHEMA_VERSION) {
      throw new Error(`graph schema ${data.schemaVersion} does not match ${GRAPH_SCHEMA_VERSION}`);
    }
    const graph = new CodeGraph(data.root);
    for (const node of data.nodes) graph.addNode(node);
    for (const edge of data.edges) graph.addEdge(edge.kind, edge.source, edge.target, edge.evidence);
    graph.unresolved = data.unresolved ?? [];
    return graph;
  }
}

const KIND_RANK: Record<string, number> = {
  function: 0, method: 1, route: 2, class: 3, interface: 4, enum: 5, type: 6, module: 7, field: 8, variable: 9,
  file: 10, section: 11, package: 12, directory: 13, repository: 14,
};
function kindRank(node: GraphNode): number {
  return KIND_RANK[node.kind] ?? 15;
}

function link(map: Map<string, Set<string>>, key: string, id: string): void {
  let set = map.get(key);
  if (!set) map.set(key, (set = new Set()));
  set.add(id);
}

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
