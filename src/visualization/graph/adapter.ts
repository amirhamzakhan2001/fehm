import type { CodeGraph } from "../../graph.js";
import { repositoryId } from "../../ids.js";
import type { GraphEdge, GraphNode } from "../../model.js";
import { nodeStyle } from "./model.js";

export interface ViewGraph {
  /** Feature 1 nodes, sorted by id. */
  nodes: GraphNode[];
  /** Feature 1 edges, sorted by id. */
  edges: GraphEdge[];
  /** Hierarchical parent per node index, -1 for roots. */
  parent: Int32Array;
  /** Node index by id. */
  index: Map<string, number>;
}

/**
 * Reads Feature 1's graph and derives the containment hierarchy the layout
 * and renderer need. It never parses source or adds relationships: the
 * parent of a node is the source of its `defines` edge (class for methods,
 * file for top-level symbols) or its `contains` edge (directory/repository).
 * External packages have no containment edge and are grouped under the
 * repository for placement only.
 */
export function adaptCodeGraph(graph: CodeGraph): ViewGraph {
  const nodes = graph.nodes();
  const edges = graph.edges();
  const index = new Map(nodes.map((n, i) => [n.id, i]));
  const parent = new Int32Array(nodes.length).fill(-1);
  const root = index.get(repositoryId());

  for (let i = 0; i < nodes.length; i += 1) {
    const node = nodes[i]!;
    let best = -1;
    // Most specific containing entity wins: a method's class beats its file.
    for (const edge of graph.edgesOf(node.id, "in", ["defines", "contains"])) {
      const p = index.get(edge.source);
      if (p === undefined) continue;
      if (best < 0 || nodeStyle(nodes[p]!.kind).rank > nodeStyle(nodes[best]!.kind).rank) best = p;
    }
    if (best < 0 && root !== undefined && i !== root) best = root;
    parent[i] = best;
  }

  // Defensive: a malformed graph must not produce a cyclic hierarchy.
  for (let i = 0; i < nodes.length; i += 1) {
    const seen = new Set<number>([i]);
    for (let p = parent[i]!; p >= 0; p = parent[p]!) {
      if (seen.has(p)) {
        parent[i] = root !== undefined && root !== i ? root : -1;
        break;
      }
      seen.add(p);
    }
  }
  return { nodes, edges, parent, index };
}
