import type { DiagramLayout } from '../../../architecture/types.js';

/** An undirected neighborhood for exploration; edge arrows retain their original direction. */
export function focusNeighborhood(layout: DiagramLayout, id: string, hops: 1 | 2): { nodes: Set<string>; edges: Set<string> } {
  const nodes = new Set([id]);
  let frontier = new Set([id]);
  for (let step = 0; step < hops; step++) {
    const next = new Set<string>();
    for (const edge of layout.edges) {
      if (frontier.has(edge.source) && !nodes.has(edge.target)) next.add(edge.target);
      if (frontier.has(edge.target) && !nodes.has(edge.source)) next.add(edge.source);
    }
    for (const nextId of next) nodes.add(nextId);
    frontier = next;
  }
  return { nodes, edges: new Set(layout.edges.filter(e => nodes.has(e.source) && nodes.has(e.target)).map(e => e.id)) };
}
