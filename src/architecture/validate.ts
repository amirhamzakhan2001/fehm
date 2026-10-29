import { crossingsOf, inflate, overlaps, rectSegments, segHitsRect, segmentsOf, type Seg } from "./layout.js";
import type { DiagramLayout, Diagnostic, LayoutNode, QualityProfile, Rect, ValidationReport } from "./types.js";

/**
 * Independent geometry validation of a Layout IR. The layout engine's
 * construction is not trusted: every rule is re-measured on the final
 * rectangles and polylines. In the `showcase` profile (what the page
 * publishes) every readability rule is a hard failure; `standard` downgrades
 * spacing and crossing rules to warnings.
 */

export interface Clearances {
  nodeNode: number;
  edgeNode: number;
  labelNode: number;
  labelLabel: number;
  labelEdge: number;
  boundaryPad: number;
  terminal: number;
  crossingEnd: number;
}

export const CLEARANCE: Record<QualityProfile, Clearances> = {
  standard: { nodeNode: 12, edgeNode: 2, labelNode: 2, labelLabel: 1, labelEdge: 1, boundaryPad: 8, terminal: 8, crossingEnd: 3 },
  showcase: { nodeNode: 16, edgeNode: 4, labelNode: 6, labelLabel: 4, labelEdge: 2, boundaryPad: 12, terminal: 12, crossingEnd: 5 },
};

/** Rules that are warnings in `standard` and errors in `showcase`. */
const SOFT = new Set(["node/tight-spacing", "edge/ambiguous-crossing", "edge/collinear-overlap", "label/overlap-edge", "edge/short-terminal"]);

export function validateLayout(layout: DiagramLayout, profile: QualityProfile = "showcase"): ValidationReport {
  const c = CLEARANCE[profile];
  const out: Diagnostic[] = [];
  const push = (d: Omit<Diagnostic, "severity">): void => {
    out.push({ ...d, severity: profile === "standard" && SOFT.has(d.code) ? "warning" : "error" });
  };
  const nodes = new Map(layout.nodes.map((n) => [n.id, n]));

  // Finite geometry and references.
  const finite = (r: Rect): boolean => [r.x, r.y, r.width, r.height].every(Number.isFinite) && r.width >= 0 && r.height >= 0;
  for (const n of layout.nodes) if (!finite(n)) push({ code: "geometry/non-finite", message: `Node ${n.id} has non-finite geometry.`, subjects: [n.id], suggestions: ["Re-run layout; check node sizing input."] });
  for (const e of layout.edges) {
    if (!nodes.has(e.source) || !nodes.has(e.target)) push({ code: "ref/unknown-endpoint", message: `Edge ${e.id} references a node that is not in the view.`, subjects: [e.id, e.source, e.target], suggestions: ["Filter relationships to the view's node set."] });
    if (e.points.length < 2 || e.points.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y))) push({ code: "geometry/non-finite", message: `Edge ${e.id} has a missing or non-finite route.`, subjects: [e.id], suggestions: ["Re-run routing."] });
  }
  for (const b of layout.boundaries) for (const m of b.members) if (!nodes.has(m)) push({ code: "ref/unknown-member", message: `Boundary ${b.id} lists ${m}, which is not in the view.`, subjects: [b.id, m], suggestions: ["Drop members that are not drawn."] });
  if (out.length) return report(profile, out);

  // Node ↔ node clearance (measured as the clear gap between boxes).
  const list = layout.nodes;
  for (let i = 0; i < list.length; i += 1) {
    for (let j = i + 1; j < list.length; j += 1) {
      const a = list[i]!;
      const b = list[j]!;
      const gap = Math.max(b.x - (a.x + a.width), a.x - (b.x + b.width), b.y - (a.y + a.height), a.y - (b.y + b.height));
      if (gap < 0) push({ code: "node/overlap", message: `${a.id} and ${b.id} overlap.`, subjects: [a.id, b.id], measured: round(gap), required: c.nodeNode, suggestions: ["Increase node spacing and re-run layout.", "Split the row."] });
      else if (gap < c.nodeNode) push({ code: "node/tight-spacing", message: `${a.id} and ${b.id} are ${round(gap)}px apart.`, subjects: [a.id, b.id], measured: round(gap), required: c.nodeNode, suggestions: ["Increase node spacing."] });
    }
  }

  // Edges: orthogonality, endpoints on their nodes (or lifelines), no unrelated node crossed, terminal length.
  const sequence = layout.kind === "sequence";
  const lifelines = new Map((layout.lifelines ?? []).map((l) => [l.node, l]));
  if (sequence) for (const n of layout.nodes) if (!lifelines.has(n.id)) push({ code: "sequence/no-lifeline", message: `Participant ${n.id} has no lifeline.`, subjects: [n.id], suggestions: ["Recompute the sequence layout."] });
  const lifelineSegs: Seg[] = (layout.lifelines ?? []).map((l) => ({ edge: `#lifeline:${l.node}`, x1: l.x, y1: l.y1, x2: l.x, y2: l.y2 }));
  const segs = segmentsOf(layout.edges);
  for (const e of layout.edges) {
    const s = nodes.get(e.source)!;
    const t = nodes.get(e.target)!;
    const first = e.points[0]!;
    const last = e.points[e.points.length - 1]!;
    for (let i = 1; i < e.points.length; i += 1) {
      const p = e.points[i - 1]!;
      const q = e.points[i]!;
      if (p.x !== q.x && p.y !== q.y) push({ code: "edge/non-orthogonal", message: `Edge ${e.id} has a diagonal segment.`, subjects: [e.id], suggestions: ["Route through a channel track."] });
    }
    const attached = (p: { x: number; y: number }, n: LayoutNode): boolean => (sequence ? onLifeline(p, lifelines.get(n.id)) : onBorder(p, n));
    if (!attached(first, s)) push({ code: "edge/detached", message: `Edge ${e.id} does not start on ${e.source}.`, subjects: [e.id, e.source], suggestions: ["Recompute ports."] });
    if (!attached(last, t)) push({ code: "edge/detached", message: `Edge ${e.id} does not end on ${e.target}.`, subjects: [e.id, e.target], suggestions: ["Recompute ports."] });
    const prev = e.points[e.points.length - 2]!;
    const terminal = Math.abs(last.x - prev.x) + Math.abs(last.y - prev.y);
    if (terminal < c.terminal) push({ code: "edge/short-terminal", message: `The final segment of ${e.id} is too short to show its arrowhead.`, subjects: [e.id], measured: round(terminal), required: c.terminal, suggestions: ["Increase channel padding."] });
    for (const n of layout.nodes) {
      if (n.id === e.source || n.id === e.target) continue;
      const hit = segs.find((sg) => sg.edge === e.id && segHitsRect(sg, inflate(n, c.edgeNode)));
      if (hit) push({ code: "edge/through-node", message: `Edge ${e.id} passes through ${n.id}.`, subjects: [e.id, n.id], suggestions: ["Route through a dedicated corridor.", "Increase spacing so a corridor opens."] });
    }
  }

  // Edges ↔ edges: no shared collinear runs, no crossing that could be read as a junction.
  const byAxis = { v: segs.filter((s) => s.x1 === s.x2), h: segs.filter((s) => s.y1 === s.y2) };
  for (const group of [byAxis.v, byAxis.h]) {
    const vertical = group === byAxis.v;
    const sorted = [...group].sort((a, b) => (vertical ? a.x1 - b.x1 : a.y1 - b.y1));
    for (let i = 0; i < sorted.length; i += 1) {
      for (let j = i + 1; j < sorted.length; j += 1) {
        const a = sorted[i]!;
        const b = sorted[j]!;
        const off = vertical ? b.x1 - a.x1 : b.y1 - a.y1;
        if (off >= 2) break;
        if (a.edge === b.edge) continue;
        const [a0, a1] = vertical ? [Math.min(a.y1, a.y2), Math.max(a.y1, a.y2)] : [Math.min(a.x1, a.x2), Math.max(a.x1, a.x2)];
        const [b0, b1] = vertical ? [Math.min(b.y1, b.y2), Math.max(b.y1, b.y2)] : [Math.min(b.x1, b.x2), Math.max(b.x1, b.x2)];
        const shared = Math.min(a1, b1) - Math.max(a0, b0);
        if (shared > 1 && !sameEndpointFan(a, b, layout)) push({ code: "edge/collinear-overlap", message: `${a.edge} and ${b.edge} run along the same line for ${round(shared)}px.`, subjects: [a.edge, b.edge], measured: round(shared), required: 0, suggestions: ["Separate the ports.", "Assign distinct tracks."] });
      }
    }
  }
  for (const x of crossingsOf(segs)) {
    const d = Math.min(...[x.a, x.b].flatMap((s) => [dist(x.at, s.x1, s.y1), dist(x.at, s.x2, s.y2)]));
    if (d < c.crossingEnd) push({ code: "edge/ambiguous-crossing", message: `${x.a.edge} crosses ${x.b.edge} ${round(d)}px from a bend, which reads as a junction.`, subjects: [x.a.edge, x.b.edge], measured: round(d), required: c.crossingEnd, suggestions: ["Move one track or port."] });
  }

  // Labels.
  const labels = layout.edges.filter((e) => e.label).map((e) => ({ edge: e.id, rect: e.label! }));
  for (const l of labels) {
    if (!finite(l.rect)) {
      push({ code: "label/unplaced", message: `No clear position for the "${l.rect.text}" label on ${l.edge}.`, subjects: [l.edge], suggestions: ["Increase channel padding so the label has room.", "Never drop a semantic label to make a layout pass."] });
      continue;
    }
    for (const n of layout.nodes) if (overlaps(l.rect, inflate(n, c.labelNode))) push({ code: "label/overlap-node", message: `The label on ${l.edge} touches ${n.id}.`, subjects: [l.edge, n.id], required: c.labelNode, suggestions: ["Move the label to another segment."] });
    for (const o of labels) if (o.edge > l.edge && finite(o.rect) && overlaps(inflate(l.rect, c.labelLabel), o.rect)) push({ code: "label/overlap-label", message: `Labels on ${l.edge} and ${o.edge} collide.`, subjects: [l.edge, o.edge], required: c.labelLabel, suggestions: ["Move one label."] });
    for (const s of [...segs, ...lifelineSegs]) if (segHitsRect(s, inflate(l.rect, s.edge === l.edge ? 0 : c.labelEdge))) push({ code: "label/overlap-edge", message: `The label on ${l.edge} sits on ${s.edge === l.edge ? "its own line" : s.edge.startsWith("#lifeline:") ? `the lifeline of ${s.edge.slice(10)}` : `edge ${s.edge}`}.`, subjects: [l.edge, s.edge], required: c.labelEdge, suggestions: ["Offset the label from the line.", "Widen the gap beside the caller."] });
    for (const b of layout.boundaries) {
      if (overlaps(l.rect, b.titleRect)) push({ code: "label/overlap-label", message: `The label on ${l.edge} collides with the "${b.title}" boundary title.`, subjects: [l.edge, b.id], suggestions: ["Move the label."] });
      if (rectSegments(b).some((s) => segHitsRect(s, l.rect))) push({ code: "label/overlap-boundary", message: `The label on ${l.edge} sits on the "${b.title}" boundary line.`, subjects: [l.edge, b.id], suggestions: ["Move the label inside or outside the boundary."] });
    }
  }

  // Boundaries: membership is containment; no partial overlaps; titles clear.
  for (const b of layout.boundaries) {
    const members = new Set(b.members);
    for (const n of layout.nodes) {
      if (members.has(n.id)) {
        const pad = Math.min(n.x - b.x, n.y - b.y, b.x + b.width - (n.x + n.width), b.y + b.height - (n.y + n.height));
        if (pad < c.boundaryPad) push({ code: "boundary/membership", message: `${n.id} is not fully inside boundary "${b.title}".`, subjects: [b.id, n.id], measured: round(pad), required: c.boundaryPad, suggestions: ["Recompute the boundary from its members."] });
      } else if (overlaps(n, b)) push({ code: "boundary/intrusion", message: `${n.id} is drawn inside boundary "${b.title}" but is not a member.`, subjects: [b.id, n.id], suggestions: ["Move non-members to another row."] });
    }
    const t = b.titleRect;
    if (t.x < b.x || t.y < b.y || t.x + t.width > b.x + b.width || t.y + t.height > b.y + b.height) push({ code: "boundary/title-outside", message: `The title of "${b.title}" leaves its boundary.`, subjects: [b.id], suggestions: ["Widen the boundary."] });
    for (const n of layout.nodes) if (overlaps(t, n)) push({ code: "boundary/title-collision", message: `The title of "${b.title}" overlaps ${n.id}.`, subjects: [b.id, n.id], suggestions: ["Reserve title space above the first member row."] });
    for (const s of segs) if (segHitsRect(s, t)) push({ code: "boundary/title-collision", message: `Edge ${s.edge} runs through the title of "${b.title}".`, subjects: [b.id, s.edge], suggestions: ["Place the title in a gutter."] });
    for (const o of layout.boundaries) {
      if (o.id <= b.id) continue;
      const contains = (p: Rect, q: Rect): boolean => q.x >= p.x && q.y >= p.y && q.x + q.width <= p.x + p.width && q.y + q.height <= p.y + p.height;
      if (overlaps(b, o) && !contains(b, o) && !contains(o, b)) push({ code: "boundary/partial-overlap", message: `Boundaries "${b.title}" and "${o.title}" partially overlap.`, subjects: [b.id, o.id], suggestions: ["Nest one boundary inside the other or separate them."] });
    }
  }

  // ViewBox contains everything.
  const vb = layout.viewBox;
  const inside = (r: Rect): boolean => r.x >= vb.x && r.y >= vb.y && r.x + r.width <= vb.x + vb.width && r.y + r.height <= vb.y + vb.height;
  if (!finite(vb) || vb.width <= 0 || vb.height <= 0) push({ code: "viewbox/invalid", message: "The viewBox is empty or non-finite.", subjects: [], suggestions: ["Recompute bounds."] });
  else {
    for (const n of layout.nodes) if (!inside(n)) push({ code: "viewbox/clip", message: `${n.id} is clipped by the viewBox.`, subjects: [n.id], suggestions: ["Recompute bounds."] });
    for (const b of layout.boundaries) if (!inside(b)) push({ code: "viewbox/clip", message: `Boundary "${b.title}" is clipped by the viewBox.`, subjects: [b.id], suggestions: ["Recompute bounds."] });
    for (const e of layout.edges) if (e.points.some((p) => !inside({ x: p.x, y: p.y, width: 0, height: 0 }))) push({ code: "viewbox/clip", message: `Edge ${e.id} leaves the canvas.`, subjects: [e.id], suggestions: ["Recompute bounds."] });
    for (const e of layout.edges) if (e.label && Number.isFinite(e.label.x) && !inside(e.label)) push({ code: "viewbox/clip", message: `The label on ${e.id} is clipped by the viewBox.`, subjects: [e.id], suggestions: ["Recompute bounds."] });
    for (const l of layout.lifelines ?? []) if (!inside({ x: l.x, y: l.y1, width: 0, height: l.y2 - l.y1 })) push({ code: "viewbox/clip", message: `The lifeline of ${l.node} is clipped by the viewBox.`, subjects: [l.node], suggestions: ["Recompute bounds."] });
  }
  return report(profile, out);
}

function report(profile: QualityProfile, diagnostics: Diagnostic[]): ValidationReport {
  // One diagnostic per rule and subject set is enough to act on.
  const seen = new Set<string>();
  const unique = diagnostics.filter((d) => {
    const k = `${d.code}|${[...d.subjects].sort().join(",")}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  return { profile, valid: !unique.some((d) => d.severity === "error"), diagnostics: unique };
}

function onLifeline(p: { x: number; y: number }, l: { x: number; y1: number; y2: number } | undefined): boolean {
  return Boolean(l && Math.abs(p.x - l.x) <= 1 && p.y >= l.y1 - 1 && p.y <= l.y2 + 1);
}

function onBorder(p: { x: number; y: number }, n: LayoutNode): boolean {
  const e = 1;
  const inX = p.x >= n.x - e && p.x <= n.x + n.width + e;
  const inY = p.y >= n.y - e && p.y <= n.y + n.height + e;
  return (inX && (Math.abs(p.y - n.y) <= e || Math.abs(p.y - (n.y + n.height)) <= e)) || (inY && (Math.abs(p.x - n.x) <= e || Math.abs(p.x - (n.x + n.width)) <= e));
}

/** Two edges leaving or entering the same node side through the same port are a fan, not an overlap. */
function sameEndpointFan(a: Seg, b: Seg, layout: DiagramLayout): boolean {
  const ea = layout.edges.find((e) => e.id === a.edge)!;
  const eb = layout.edges.find((e) => e.id === b.edge)!;
  const same = (p: { x: number; y: number }, q: { x: number; y: number }): boolean => p.x === q.x && p.y === q.y;
  return (same(ea.points[0]!, eb.points[0]!) && ea.source === eb.source) || (same(ea.points.at(-1)!, eb.points.at(-1)!) && ea.target === eb.target);
}

function dist(p: { x: number; y: number }, x: number, y: number): number {
  return Math.abs(p.x - x) + Math.abs(p.y - y);
}

function round(v: number): number {
  return Math.round(v * 10) / 10;
}
