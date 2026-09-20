import type { CodeGraph, FocusResult, GraphEdge, GraphNode, GraphStats, RelationshipExplorerReport } from "./model.js";

export class GraphBuilder {
  private readonly nodes = new Map<string, GraphNode>();
  private readonly edges = new Map<string, GraphEdge>();

  addNode(node: GraphNode): void {
    const existing = this.nodes.get(node.id);
    this.nodes.set(node.id, existing ? { ...existing, ...node } : node);
  }

  addEdge(edge: Omit<GraphEdge, "id">): void {
    const id = `${edge.kind}:${edge.source}->${edge.target}`;
    const existing = this.edges.get(id);
    if (!existing || edge.evidence.confidence > existing.evidence.confidence) {
      this.edges.set(id, { ...edge, id });
    }
  }

  hasNode(id: string): boolean {
    return this.nodes.has(id);
  }

  getNodes(): GraphNode[] {
    return [...this.nodes.values()].sort((a, b) => a.id.localeCompare(b.id));
  }

  getEdges(): GraphEdge[] {
    return [...this.edges.values()].sort((a, b) => a.id.localeCompare(b.id));
  }
}

export function calculateStats(nodes: GraphNode[], edges: GraphEdge[], unresolvedCalls = 0): GraphStats {
  const symbolKinds = new Set(["class", "interface", "function", "method", "variable", "type"]);
  return {
    nodes: nodes.length,
    edges: edges.length,
    files: nodes.filter((node) => node.kind === "file").length,
    symbols: nodes.filter((node) => symbolKinds.has(node.kind)).length,
    calls: edges.filter((edge) => edge.kind === "calls").length,
    imports: edges.filter((edge) => edge.kind === "imports").length,
    tests: nodes.filter((node) => node.kind === "file" && node.test === true).length,
    unresolvedCalls,
  };
}

export function focusGraph(graph: CodeGraph, query: string, depth = 1, limit = 250): FocusResult {
  depth = Number.isFinite(depth) ? Math.max(0, Math.floor(depth)) : 1;
  limit = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : 250;
  const normalized = query.toLowerCase();
  const exactMatches = graph.nodes.filter(
    (node) => node.id === query || node.name.toLowerCase() === normalized || node.qualifiedName.toLowerCase() === normalized,
  );
  const matches = exactMatches.length > 0
    ? exactMatches
    : graph.nodes.filter((node) => node.qualifiedName.toLowerCase().includes(normalized));
  const selected = new Set(matches.slice(0, limit).map((node) => node.id));
  const nodeIds = new Set(graph.nodes.map((node) => node.id));
  let truncated = matches.length > limit;
  let frontier = new Set(selected);

  for (let level = 0; level < depth && frontier.size; level += 1) {
    const next = new Set<string>();
    for (const edge of graph.edges) {
      if (frontier.has(edge.source) && nodeIds.has(edge.target) && !selected.has(edge.target)) next.add(edge.target);
      if (frontier.has(edge.target) && nodeIds.has(edge.source) && !selected.has(edge.source)) next.add(edge.source);
    }
    frontier = next;
    for (const id of next) {
      if (selected.size >= limit) { truncated = true; break; }
      selected.add(id);
    }
    if (truncated) break;
  }

  return {
    matches: matches.slice(0, limit),
    nodes: graph.nodes.filter((node) => selected.has(node.id)),
    edges: graph.edges.filter((edge) => selected.has(edge.source) && selected.has(edge.target)),
    truncated,
  };
}

export function exploreRelationships(
  graph: CodeGraph,
  query: string,
  direction: RelationshipExplorerReport["direction"] = "both",
  depth = 4,
  limit = 300,
): RelationshipExplorerReport {
  depth = Number.isFinite(depth) ? Math.max(0, Math.floor(depth)) : 4;
  limit = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : 300;
  const normalized = query.toLowerCase();
  const root = graph.nodes.find((node) => node.id === query || node.qualifiedName.toLowerCase() === normalized)
    ?? graph.nodes.find((node) => node.name.toLowerCase() === normalized)
    ?? graph.nodes.find((node) => node.qualifiedName.toLowerCase().includes(normalized));
  if (!root) return { query, direction, related: [], edges: [], truncated: false };
  const nodeMap = new Map(graph.nodes.map((node) => [node.id, node]));
  const traversable = new Set(["calls", "imports", "references", "uses", "extends", "implements", "defines"]);
  const adjacency = new Map<string, GraphEdge[]>();
  for (const edge of graph.edges) {
    if (!traversable.has(edge.kind)) continue;
    const endpoints = direction === "callers" ? [edge.target] : direction === "dependencies" ? [edge.source] : [...new Set([edge.source, edge.target])];
    for (const id of endpoints) {
      const neighbors = adjacency.get(id);
      if (neighbors) neighbors.push(edge);
      else adjacency.set(id, [edge]);
    }
  }
  const visited = new Set([root.id]);
  let frontier: Array<{ id: string; path: string[]; confidence: number }> = [{ id: root.id, path: [root.qualifiedName], confidence: 1 }];
  const related: RelationshipExplorerReport["related"] = [];
  const edges: CodeGraph["edges"] = [];
  let truncated = false;
  for (let distance = 1; distance <= depth && frontier.length; distance += 1) {
    const next: typeof frontier = [];
    for (const current of frontier) {
      for (const edge of adjacency.get(current.id) ?? []) {
        const callerMatch = (direction === "callers" || direction === "both") && edge.target === current.id;
        const dependencyMatch = (direction === "dependencies" || direction === "both") && edge.source === current.id;
        if (!callerMatch && !dependencyMatch) continue;
        const targetId = callerMatch ? edge.source : edge.target;
        if (visited.has(targetId)) continue;
        const node = nodeMap.get(targetId);
        if (!node) continue;
        if (related.length >= limit) { truncated = true; break; }
        visited.add(targetId);
        edges.push(edge);
        const confidence = Math.round(current.confidence * edge.evidence.confidence * 1_000) / 1_000;
        const itemPath = [...current.path, node.qualifiedName];
        related.push({ node, distance, via: edge.kind, path: itemPath, confidence });
        next.push({ id: targetId, path: itemPath, confidence });
      }
      if (truncated) break;
    }
    frontier = next;
    if (truncated) break;
  }
  return { query, direction, root, related, edges, truncated };
}
