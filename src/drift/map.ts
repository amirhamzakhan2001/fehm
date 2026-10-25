import type { PublishedView } from "../architecture/types.js";
import type { DriftFinding, MapView } from "./types.js";

/**
 * The drift map (spec §42–43): 3.3's validated architecture views — system
 * components, and module dependencies — with deviations emphasised. The full
 * architecture stays visible; edges and nodes involved in findings are
 * marked. No second layout engine and no new graph.
 */
export function mapView(level: MapView["level"], view: PublishedView | { error: string }, findings: DriftFinding[]): MapView {
  if ("error" in view) return { level, title: level === "components" ? "Components" : "Modules", layout: null, nodes: [], marks: { edges: {}, nodes: {} }, note: view.error };
  const layout = view.layout;
  const nodes = view.nodes.map((n) => ({ id: n.id, name: n.name, type: n.type, confidence: n.role.confidence, files: n.files.slice(0, 50) }));
  const edgeIds = new Set(layout?.edges.map((e) => e.id) ?? []);
  const nodeIds = new Set(nodes.map((n) => n.id));
  const edges: MapView["marks"]["edges"] = {};
  const byNode: MapView["marks"]["nodes"] = {};
  for (const f of findings) {
    const ns = level === "components" ? f.map.nodes : f.map.modules;
    const es = level === "components" ? f.map.edges : f.map.moduleEdges;
    const mark = f.attention === "high" || f.attention === "critical" ? "violation" : "review";
    for (const e of es) if (edgeIds.has(e) && edges[e] !== "violation") edges[e] = mark;
    for (const n of ns) if (nodeIds.has(n)) (byNode[n] ??= []).push(f.id);
  }
  const marked = layout ? { ...layout, edges: layout.edges.map((e) => (edges[e.id] ? { ...e, drift: edges[e.id]! } : e)) } : null;
  return {
    level,
    title: view.title,
    layout: marked,
    nodes,
    marks: { edges, nodes: byNode },
    ...(layout ? (view.notes.length ? { note: view.notes.join(" ") } : {}) : { note: "3.3 has no verified layout for this level; the findings list still applies." }),
  };
}
