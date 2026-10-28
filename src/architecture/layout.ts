import { measure, wrap } from "./text.js";
import type {
  ArchNodeType,
  Confidence,
  DeltaStatus,
  DiagramLayout,
  DriftMark,
  LayoutBoundary,
  LayoutEdge,
  LayoutNode,
  NodeShape,
  Point,
  Rect,
  RelationshipType,
  ViewType,
} from "./types.js";

/**
 * Deterministic layered layout for architecture views (Sugiyama-style):
 *
 *   semantic bands → layer assignment → wide-layer splitting → dummy corridors
 *   → crossing minimization → x placement → ports → channel routing → labels
 *   → boundaries → viewBox
 *
 * Rows of nodes alternate with routing channels. Edges only run horizontally
 * inside channels, on tracks assigned so no two horizontal segments share a
 * line, and only run vertically at their own ports or in a dummy corridor
 * reserved between nodes — so by construction an edge never crosses a node.
 * `validate.ts` checks the result independently; this module never marks its
 * own output as valid.
 */

export interface LayoutInputNode {
  id: string;
  type: ArchNodeType;
  name: string;
  subtitle?: string;
  tag: string;
  /** Semantic band: actors/upstream context on top, stores/externals/downstream context at the bottom. */
  band: "top" | "middle" | "bottom";
  /**
   * Finer band order (overrides `band`): nodes of one rank are laid out
   * together, ranks stack top to bottom. Used for zones and deployment groups,
   * so each boundary owns its own rows.
   */
  rank?: number;
  context?: boolean;
  expandable?: boolean;
  status?: DeltaStatus;
}

export interface LayoutInputEdge {
  id: string;
  source: string;
  target: string;
  weight: number;
  type: RelationshipType;
  confidence: Confidence;
  label?: string;
  status?: DeltaStatus;
  /** Feature 3.4: how the dependency relates to the reference architecture. */
  drift?: DriftMark;
}

export interface LayoutInputBoundary {
  id: string;
  title: string;
  members: string[];
}

export interface LayoutInput {
  view: ViewType;
  focus?: string;
  nodes: LayoutInputNode[];
  edges: LayoutInputEdge[];
  boundaries: LayoutInputBoundary[];
  /**
   * architecture: cycles share a layer, foundations sink to the bottom.
   * flow: cycles are broken at DFS back edges (loops, retries) so a process
   * reads top to bottom; nothing is pushed down.
   */
  layering?: "architecture" | "flow";
}

export interface LayoutConfig {
  nodeGap: number;
  dummyGap: number;
  mixedGap: number;
  channelPad: number;
  labelPad: number;
  trackGap: number;
  minChannel: number;
  margin: number;
  boundaryPad: number;
  maxRowWidth: number;
  maxRowNodes: number;
  portGap: number;
  sweeps: number;
}

export const BASE_CONFIG: LayoutConfig = {
  nodeGap: 44,
  dummyGap: 14,
  mixedGap: 26,
  channelPad: 22,
  labelPad: 34,
  trackGap: 11,
  minChannel: 60,
  margin: 32,
  boundaryPad: 26,
  maxRowWidth: 1500,
  maxRowNodes: 7,
  portGap: 12,
  sweeps: 12,
};

/** Each repair attempt loosens spacing; semantics never change. */
export function escalate(attempt: number): LayoutConfig {
  const a = attempt;
  return {
    ...BASE_CONFIG,
    nodeGap: BASE_CONFIG.nodeGap + 22 * a,
    dummyGap: BASE_CONFIG.dummyGap + 6 * a,
    mixedGap: BASE_CONFIG.mixedGap + 10 * a,
    channelPad: BASE_CONFIG.channelPad + 8 * a,
    labelPad: BASE_CONFIG.labelPad + 12 * a,
    trackGap: BASE_CONFIG.trackGap + 3 * a,
    portGap: BASE_CONFIG.portGap + 3 * a,
    boundaryPad: BASE_CONFIG.boundaryPad + 6 * a,
  };
}

// ─── node boxes ────────────────────────────────────────────────────

export const FONT = { title: 13, subtitle: 11, tag: 9.5, label: 11, boundary: 11.5 } as const;
const TITLE_LINE = 17;
const SUB_LINE = 15;
const TAG_ROW = 13;
const MIN_W = 128;
const MAX_W = 244;
export const LABEL_H = 17;
const TITLE_H = 18;

export function shapeOf(type: ArchNodeType): NodeShape {
  if (type === "actor" || type === "start" || type === "end" || type === "failure") return "pill";
  if (type === "database" || type === "filesystem" || type === "secret") return "cylinder";
  if (type === "external-system" || type === "platform" || type === "sink") return "dashed";
  if (type === "decision" || type === "loop" || type === "gateway") return "hexagon";
  if (type === "state") return "rounded";
  return "box";
}

export function box(n: LayoutInputNode): Omit<LayoutNode, "x" | "y" | "layer"> {
  const shape = shapeOf(n.type);
  const padX = shape === "pill" ? 22 : shape === "hexagon" ? 30 : 14;
  const lines = wrap(n.name, MAX_W - 2 * padX, FONT.title, 600, 2);
  const titleW = Math.max(...lines.map((l) => measure(l, FONT.title, 600)));
  const subW = n.subtitle ? measure(n.subtitle, FONT.subtitle) : 0;
  const tagW = measure(n.tag.toUpperCase(), FONT.tag, 600) * 1.12;
  const width = Math.round(Math.min(MAX_W, Math.max(MIN_W, Math.max(titleW, subW, tagW) + 2 * padX)));
  const capPad = shape === "cylinder" ? 9 : 0;
  const height = Math.round(10 + TAG_ROW + 3 + lines.length * TITLE_LINE + (n.subtitle ? SUB_LINE : 0) + 9 + 2 * capPad);
  const out: Omit<LayoutNode, "x" | "y" | "layer"> = { id: n.id, type: n.type, shape, lines, tag: n.tag, width, height };
  if (n.subtitle) out.subtitle = n.subtitle.length > 60 ? `${n.subtitle.slice(0, 59)}…` : n.subtitle;
  if (n.context) out.context = true;
  if (n.expandable) out.expandable = true;
  if (n.status) out.status = n.status;
  return out;
}

// ─── layout ────────────────────────────────────────────────────────

interface Item {
  id: string;
  dummy: boolean;
  w: number;
  h: number;
  row: number;
  x: number;
  node?: Omit<LayoutNode, "x" | "y" | "layer">;
}

interface Hop {
  edge: string;
  upper: string;
  lower: string;
  /** Channel index = upper row. */
  channel: number;
  ux: number;
  lx: number;
  track: number;
}

interface Flat {
  edge: string;
  a: string;
  b: string;
  channel: number;
  ax: number;
  bx: number;
  track: number;
}

const TYPE_ORDER: ArchNodeType[] = ["actor", "cli", "api", "frontend", "worker", "service", "component", "module", "file", "data-access", "shared", "database", "filesystem", "external-system"];

export function layoutDiagram(input: LayoutInput, config: LayoutConfig = BASE_CONFIG): DiagramLayout {
  const nodeById = new Map(input.nodes.map((n) => [n.id, n]));
  const edges = input.edges.filter((e) => nodeById.has(e.source) && nodeById.has(e.target) && e.source !== e.target);

  // 1. Layers: bands first (semantic constraint), dependency depth inside the middle band.
  const layerOf = assignLayers(input.nodes, edges, input.layering ?? "architecture");

  // 2. Rows: split layers that would be too wide into consecutive rows.
  const boxes = new Map(input.nodes.map((n) => [n.id, box(n)]));
  // Ports need room: widen nodes that carry many attachments on one side.
  const sideCount = new Map<string, number>();
  const labelled = new Map<string, { n: number; w: number }>();
  for (const e of edges) {
    const ls = layerOf.get(e.source)!;
    const lt = layerOf.get(e.target)!;
    const [up, down] = ls <= lt ? [e.source, e.target] : [e.target, e.source];
    const k1 = ls === lt ? `${e.source}:b` : `${up}:b`;
    const k2 = ls === lt ? `${e.target}:b` : `${down}:t`;
    sideCount.set(k1, (sideCount.get(k1) ?? 0) + 1);
    sideCount.set(k2, (sideCount.get(k2) ?? 0) + 1);
    // Labels sit beside the segment entering the target: that side needs room for them between its ports.
    if (e.label) {
      const kt = e.target === up ? k1 : k2;
      const lw = Math.ceil(measure(e.label, FONT.label, 500)) + 12;
      const cur = labelled.get(kt) ?? { n: 0, w: 0 };
      labelled.set(kt, { n: cur.n + 1, w: Math.max(cur.w, lw) });
    }
  }
  for (const b of boxes.values()) {
    const need = Math.max(sideCount.get(`${b.id}:b`) ?? 0, sideCount.get(`${b.id}:t`) ?? 0) * config.portGap + 36;
    const room = Math.max(...(["b", "t"] as const).map((side) => {
      const l = labelled.get(`${b.id}:${side}`);
      return l && l.n >= 2 ? (l.n + 1) * (l.w + 22) + 36 : 0;
    }));
    if (Math.max(need, room) > b.width) b.width = Math.round(Math.max(need, room));
  }
  const layers = new Map<number, string[]>();
  for (const n of input.nodes) layers.set(layerOf.get(n.id)!, [...(layers.get(layerOf.get(n.id)!) ?? []), n.id]);
  const rowOf = new Map<string, number>();
  const rows: string[][] = [];
  for (const l of [...layers.keys()].sort((a, b) => a - b)) {
    const ids = layers.get(l)!.sort((a, b) => TYPE_ORDER.indexOf(nodeById.get(a)!.type) - TYPE_ORDER.indexOf(nodeById.get(b)!.type) || (nodeById.get(a)!.name < nodeById.get(b)!.name ? -1 : 1) || (a < b ? -1 : 1));
    const total = ids.reduce((s, id) => s + boxes.get(id)!.width + config.nodeGap, 0);
    const parts = Math.max(Math.ceil(total / config.maxRowWidth), Math.ceil(ids.length / config.maxRowNodes), 1);
    const per = Math.ceil(ids.length / parts);
    for (let p = 0; p < parts; p += 1) {
      const chunk = ids.slice(p * per, (p + 1) * per);
      if (!chunk.length) continue;
      for (const id of chunk) rowOf.set(id, rows.length);
      rows.push(chunk);
    }
  }

  // 3. Items (nodes + dummy corridor slots) and hops between adjacent rows.
  const items = new Map<string, Item>();
  for (const [id, b] of boxes) items.set(id, { id, dummy: false, w: b.width, h: b.height, row: rowOf.get(id)!, x: 0, node: b });
  const hops: Hop[] = [];
  const flats: Flat[] = [];
  const chains = new Map<string, { items: string[]; reversed: boolean }>();
  for (const e of [...edges].sort((a, b) => (a.id < b.id ? -1 : 1))) {
    const rs = rowOf.get(e.source)!;
    const rt = rowOf.get(e.target)!;
    if (rs === rt) {
      flats.push({ edge: e.id, a: e.source, b: e.target, channel: rs, ax: 0, bx: 0, track: 0 });
      chains.set(e.id, { items: [e.source, e.target], reversed: false });
      continue;
    }
    const reversed = rs > rt;
    const [top, bottom] = reversed ? [e.target, e.source] : [e.source, e.target];
    const chain = [top];
    for (let r = Math.min(rs, rt) + 1; r < Math.max(rs, rt); r += 1) {
      const id = `~${e.id}#${r}`;
      items.set(id, { id, dummy: true, w: 2, h: 0, row: r, x: 0 });
      rows[r]!.push(id);
      chain.push(id);
    }
    chain.push(bottom);
    for (let i = 0; i < chain.length - 1; i += 1) hops.push({ edge: e.id, upper: chain[i]!, lower: chain[i + 1]!, channel: items.get(chain[i]!)!.row, ux: 0, lx: 0, track: 0 });
    chains.set(e.id, { items: chain, reversed });
  }
  const up = new Map<string, string[]>();
  const down = new Map<string, string[]>();
  for (const h of hops) {
    down.set(h.upper, [...(down.get(h.upper) ?? []), h.lower]);
    up.set(h.lower, [...(up.get(h.lower) ?? []), h.upper]);
  }

  // 4. Crossing minimization: barycenter sweeps, keeping the best ordering seen.
  orderRows(rows, up, down, hops, config.sweeps);

  // 5. X placement: isotonic regression toward neighbour barycenters with minimum separation.
  placeX(rows, items, up, down, config);

  // 6. Ports on node sides, sorted by the x of the other end.
  assignPorts(items, hops, flats, config);
  separateStubs(rows, items, hops, flats, config);

  // 7. Tracks per channel (left-edge algorithm).
  const channelTracks = assignTracks(rows.length, hops, flats, config);

  // 8. Row and channel y positions (reserve space for boundary titles and labels).
  const labeledChannels = new Set<number>();
  for (const e of edges) if (e.label) for (const h of hops) if (h.edge === e.id) labeledChannels.add(h.channel);
  for (const f of flats) if (edges.find((e) => e.id === f.edge)?.label) labeledChannels.add(f.channel);
  const bRows = input.boundaries
    .map((b) => {
      const rs = b.members.map((m) => rowOf.get(m)).filter((r): r is number => r !== undefined);
      return rs.length ? { b, r0: Math.min(...rs), r1: Math.max(...rs) } : undefined;
    })
    .filter((x): x is { b: LayoutInputBoundary; r0: number; r1: number } => Boolean(x));
  const topReserve = (r: number): number => bRows.filter((x) => x.r0 === r).length * (config.boundaryPad + TITLE_H + 6);
  const bottomReserve = (r: number): number => bRows.filter((x) => x.r1 === r).length * config.boundaryPad;
  const rowTop: number[] = [];
  const rowH: number[] = [];
  const trackY0: number[] = [];
  let y = config.margin + topReserve(0);
  for (let r = 0; r < rows.length; r += 1) {
    rowTop[r] = y;
    rowH[r] = Math.max(0, ...rows[r]!.map((id) => items.get(id)!.h));
    y += rowH[r]!;
    const pad = labeledChannels.has(r) ? config.labelPad : config.channelPad;
    const tracks = channelTracks[r] ?? 0;
    const inner = Math.max(config.minChannel, 2 * pad + Math.max(0, tracks - 1) * config.trackGap);
    const lastRow = r === rows.length - 1;
    trackY0[r] = y + bottomReserve(r) + (inner - Math.max(0, tracks - 1) * config.trackGap) / 2;
    if (lastRow && !flats.some((f) => f.channel === r)) y += bottomReserve(r);
    else y += bottomReserve(r) + inner + (lastRow ? 0 : topReserve(r + 1));
  }
  const trackY = (channel: number, track: number): number => trackY0[channel]! + track * config.trackGap;

  // 9. Nodes.
  const nodes: LayoutNode[] = [];
  for (const it of items.values()) {
    if (it.dummy) continue;
    const top = rowTop[it.row]! + (rowH[it.row]! - it.h) / 2;
    nodes.push({ ...it.node!, x: round(it.x - it.w / 2), y: round(top), layer: it.row, width: it.w, height: it.h });
  }
  const nodeAt = new Map(nodes.map((n) => [n.id, n]));
  const bottomOf = (id: string): number => {
    const n = nodeAt.get(id);
    return n ? n.y + n.height : rowTop[items.get(id)!.row]! + rowH[items.get(id)!.row]!;
  };
  const topOf = (id: string): number => nodeAt.get(id)?.y ?? rowTop[items.get(id)!.row]!;

  // 10. Routes.
  const hopsByEdge = new Map<string, Hop[]>();
  for (const h of hops) hopsByEdge.set(h.edge, [...(hopsByEdge.get(h.edge) ?? []), h]);
  const flatByEdge = new Map(flats.map((f) => [f.edge, f]));
  const layoutEdges: LayoutEdge[] = [];
  for (const e of edges) {
    const chain = chains.get(e.id)!;
    let pts: Point[] = [];
    const flat = flatByEdge.get(e.id);
    if (flat) {
      const ty = trackY(flat.channel, flat.track);
      pts = [
        { x: flat.ax, y: bottomOf(flat.a) },
        { x: flat.ax, y: ty },
        { x: flat.bx, y: ty },
        { x: flat.bx, y: bottomOf(flat.b) },
      ];
    } else {
      const hs = (hopsByEdge.get(e.id) ?? []).sort((a, b) => a.channel - b.channel);
      for (const h of hs) {
        pts.push({ x: h.ux, y: bottomOf(h.upper) });
        if (h.ux !== h.lx) {
          const ty = trackY(h.channel, h.track);
          pts.push({ x: h.ux, y: ty }, { x: h.lx, y: ty });
        }
        pts.push({ x: h.lx, y: topOf(h.lower) });
      }
      if (chain.reversed) pts.reverse();
    }
    const le: LayoutEdge = { id: e.id, source: e.source, target: e.target, points: simplify(pts.map((p) => ({ x: round(p.x), y: round(p.y) }))), weight: e.weight, type: e.type, confidence: e.confidence };
    if (chain.reversed || flat) le.reversed = true;
    if (e.status) le.status = e.status;
    if (e.drift) le.drift = e.drift;
    layoutEdges.push(le);
  }

  // 11. Boundaries (before labels, so labels avoid their titles and borders).
  const boundaries: LayoutBoundary[] = [];
  for (const { b, r0, r1 } of bRows) {
    const inRows = [...items.values()].filter((it) => it.row >= r0 && it.row <= r1);
    const left = Math.min(...inRows.map((it) => it.x - it.w / 2)) - config.boundaryPad;
    const right = Math.max(...inRows.map((it) => it.x + it.w / 2)) + config.boundaryPad;
    const top = rowTop[r0]! - config.boundaryPad - TITLE_H - 4;
    const bottom = rowTop[r1]! + rowH[r1]! + config.boundaryPad - 6;
    const tw = Math.ceil(measure(b.title, FONT.boundary, 600)) + 12;
    const rect = { x: round(left), y: round(top), width: round(right - left), height: round(bottom - top) };
    const segs = segmentsOf(layoutEdges);
    const candidates: Rect[] = [
      { x: rect.x + 10, y: rect.y + 6, width: tw, height: TITLE_H },
      { x: rect.x + rect.width - 10 - tw, y: rect.y + 6, width: tw, height: TITLE_H },
    ];
    let titleRect = candidates.find((c) => c.x >= rect.x + 4 && !segs.some((s) => segHitsRect(s, inflate(c, 3))));
    if (!titleRect) {
      // Gutter: widen the boundary on the left so the title sits clear of every route.
      rect.x = round(rect.x - tw - 12);
      rect.width = round(rect.width + tw + 12);
      titleRect = { x: rect.x + 10, y: rect.y + 6, width: tw, height: TITLE_H };
    }
    boundaries.push({ id: b.id, title: b.title, members: [...b.members], ...rect, titleRect });
  }

  // 12. Edge labels: beside the segment entering the target, else other segments; checked against everything placed.
  const placedLabels: Rect[] = [];
  const allSegs = segmentsOf(layoutEdges);
  const borderSegs = boundaries.flatMap((b) => rectSegments(b));
  const obstacles: Rect[] = [...nodes.map((n) => inflate(n, 6)), ...boundaries.map((b) => inflate(b.titleRect, 4))];
  for (const e of [...edges].filter((x) => x.label).sort((a, b) => (a.id < b.id ? -1 : 1))) {
    const le = layoutEdges.find((x) => x.id === e.id)!;
    const text = e.label!;
    const w = Math.ceil(measure(text, FONT.label, 500)) + 12;
    const rect = placeLabel(le, w, obstacles, placedLabels, allSegs, borderSegs);
    if (rect) {
      le.label = { text, ...rect };
      placedLabels.push(rect);
    } else le.label = { text, x: NaN, y: NaN, width: w, height: LABEL_H };
  }

  // 13. ViewBox around everything drawn.
  const xs: number[] = [];
  const ys: number[] = [];
  const addRect = (r: Rect): void => {
    if (!Number.isFinite(r.x) || !Number.isFinite(r.y)) return;
    xs.push(r.x, r.x + r.width);
    ys.push(r.y, r.y + r.height);
  };
  nodes.forEach(addRect);
  boundaries.forEach(addRect);
  for (const le of layoutEdges) {
    for (const p of le.points) (xs.push(p.x), ys.push(p.y));
    if (le.label) addRect(le.label);
  }
  const minX = Math.min(...xs, 0) - config.margin;
  const minY = Math.min(...ys, 0) - config.margin;
  const viewBox = { x: round(minX), y: round(minY), width: round(Math.max(...xs, 0) + config.margin - minX), height: round(Math.max(...ys, 0) + config.margin - minY) };

  const out: DiagramLayout = {
    view: input.view,
    nodes: nodes.sort((a, b) => a.layer - b.layer || a.x - b.x),
    edges: layoutEdges,
    boundaries,
    viewBox,
    metrics: { crossings: countCrossings(layoutEdges), bends: layoutEdges.reduce((s, e) => s + Math.max(0, e.points.length - 2), 0), layers: rows.length },
  };
  if (input.focus) out.focus = input.focus;
  return out;
}

// ─── layering ──────────────────────────────────────────────────────

const BAND_RANK = { top: 0, middle: 1, bottom: 2 } as const;

function assignLayers(nodes: LayoutInputNode[], edges: LayoutInputEdge[], mode: "architecture" | "flow"): Map<string, number> {
  const out = new Map<string, number>();
  const rankOf = (n: LayoutInputNode): number => n.rank ?? BAND_RANK[n.band];
  const ranks = [...new Set(nodes.map(rankOf))].sort((a, b) => a - b);
  let offset = 0;
  for (const rank of ranks) {
    const group = nodes.filter((n) => rankOf(n) === rank).map((n) => n.id).sort();
    const depth = mode === "flow" ? flowDepth(group, edges) : architectureDepth(group, edges);
    let max = 0;
    for (const id of group) max = Math.max(max, depth.get(id)!);
    for (const id of group) out.set(id, offset + depth.get(id)!);
    offset += max + 1;
  }
  return out;
}

/** Depth inside one band: cycles share a layer; foundations and isolated parts sit at the bottom. */
function architectureDepth(ids: string[], edges: LayoutInputEdge[]): Map<string, number> {
  const out = new Map<string, number>();
  const mid = new Set(ids);
  const succ = new Map<string, string[]>(ids.map((id) => [id, []]));
  for (const e of edges) if (mid.has(e.source) && mid.has(e.target)) succ.get(e.source)!.push(e.target);
  // Condense cycles (Tarjan, iterative) so depth is well-defined; a cycle shares one layer.
  const comp = scc(ids, (id) => succ.get(id)!);
  const compSucc = new Map<number, Set<number>>();
  for (const id of ids) for (const t of succ.get(id)!) if (comp.get(id) !== comp.get(t)) compSucc.set(comp.get(id)!, (compSucc.get(comp.get(id)!) ?? new Set()).add(comp.get(t)!));
  const compIds = [...new Set(comp.values())];
  const indeg = new Map<number, number>(compIds.map((c) => [c, 0]));
  for (const set of compSucc.values()) for (const t of set) indeg.set(t, indeg.get(t)! + 1);
  const depth = new Map<number, number>();
  const queue = compIds.filter((c) => indeg.get(c) === 0).sort((a, b) => a - b);
  for (const c of queue) depth.set(c, 0);
  while (queue.length) {
    const c = queue.shift()!;
    for (const t of [...(compSucc.get(c) ?? [])].sort((a, b) => a - b)) {
      depth.set(t, Math.max(depth.get(t) ?? 0, depth.get(c)! + 1));
      indeg.set(t, indeg.get(t)! - 1);
      if (indeg.get(t) === 0) queue.push(t);
    }
  }
  let maxDepth = 0;
  for (const id of ids) maxDepth = Math.max(maxDepth, depth.get(comp.get(id)!) ?? 0);
  for (const id of ids) {
    const c = comp.get(id)!;
    const sink = !compSucc.get(c)?.size;
    out.set(id, sink && maxDepth > 0 ? maxDepth : (depth.get(c) ?? 0));
  }
  return out;
}

/** Depth for processes: DFS back edges (loops) are ignored, then longest path from the sources. */
function flowDepth(ids: string[], edges: LayoutInputEdge[]): Map<string, number> {
  const set = new Set(ids);
  const succ = new Map<string, string[]>(ids.map((id) => [id, []]));
  const indeg = new Map<string, number>(ids.map((id) => [id, 0]));
  for (const e of edges) if (set.has(e.source) && set.has(e.target)) (succ.get(e.source)!.push(e.target), indeg.set(e.target, indeg.get(e.target)! + 1));
  // DFS in stable order from sources (then anything unvisited) to find back edges.
  const state = new Map<string, 0 | 1 | 2>();
  const back = new Set<string>();
  const roots = [...ids.filter((id) => indeg.get(id) === 0), ...ids];
  for (const root of roots) {
    if (state.get(root)) continue;
    const stack: [string, number][] = [[root, 0]];
    state.set(root, 1);
    while (stack.length) {
      const top = stack[stack.length - 1]!;
      const next = succ.get(top[0])!;
      if (top[1] < next.length) {
        const w = next[top[1]++]!;
        const st = state.get(w) ?? 0;
        if (st === 1) back.add(`${top[0]}\u0000${w}`);
        else if (st === 0) (state.set(w, 1), stack.push([w, 0]));
      } else {
        state.set(top[0], 2);
        stack.pop();
      }
    }
  }
  const forward = new Map<string, string[]>(ids.map((id) => [id, succ.get(id)!.filter((w) => !back.has(`${id}\u0000${w}`))]));
  const deg = new Map<string, number>(ids.map((id) => [id, 0]));
  for (const ws of forward.values()) for (const w of ws) deg.set(w, deg.get(w)! + 1);
  const depth = new Map<string, number>(ids.map((id) => [id, 0]));
  const queue = ids.filter((id) => deg.get(id) === 0);
  while (queue.length) {
    const v = queue.shift()!;
    for (const w of forward.get(v)!) {
      depth.set(w, Math.max(depth.get(w)!, depth.get(v)! + 1));
      deg.set(w, deg.get(w)! - 1);
      if (deg.get(w) === 0) queue.push(w);
    }
  }
  return depth;
}

function scc(ids: string[], next: (id: string) => string[]): Map<string, number> {
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const comp = new Map<string, number>();
  let i = 0;
  let c = 0;
  for (const start of ids) {
    if (index.has(start)) continue;
    const work: [string, number][] = [[start, 0]];
    while (work.length) {
      const frame = work[work.length - 1]!;
      const [v] = frame;
      if (frame[1] === 0) {
        index.set(v, i);
        low.set(v, i);
        i += 1;
        stack.push(v);
        onStack.add(v);
      }
      const ns = next(v);
      if (frame[1] < ns.length) {
        const w = ns[frame[1]]!;
        frame[1] += 1;
        if (!index.has(w)) work.push([w, 0]);
        else if (onStack.has(w)) low.set(v, Math.min(low.get(v)!, index.get(w)!));
        continue;
      }
      work.pop();
      if (work.length) {
        const parent = work[work.length - 1]![0];
        low.set(parent, Math.min(low.get(parent)!, low.get(v)!));
      }
      if (low.get(v) === index.get(v)) {
        let w: string;
        do {
          w = stack.pop()!;
          onStack.delete(w);
          comp.set(w, c);
        } while (w !== v);
        c += 1;
      }
    }
  }
  return comp;
}

// ─── ordering ──────────────────────────────────────────────────────

function orderRows(rows: string[][], up: Map<string, string[]>, down: Map<string, string[]>, hops: Hop[], sweeps: number): void {
  const pos = new Map<string, number>();
  const index = (): void => rows.forEach((r) => r.forEach((id, i) => pos.set(id, i)));
  index();
  const crossings = (): number => {
    let total = 0;
    const byChannel = new Map<number, Hop[]>();
    for (const h of hops) byChannel.set(h.channel, [...(byChannel.get(h.channel) ?? []), h]);
    for (const hs of byChannel.values()) {
      for (let i = 0; i < hs.length; i += 1) {
        for (let j = i + 1; j < hs.length; j += 1) {
          const a = hs[i]!;
          const b = hs[j]!;
          if ((pos.get(a.upper)! - pos.get(b.upper)!) * (pos.get(a.lower)! - pos.get(b.lower)!) < 0) total += 1;
        }
      }
    }
    return total;
  };
  let best = rows.map((r) => [...r]);
  let bestCount = crossings();
  const sortRow = (r: number, neighbours: Map<string, string[]>): void => {
    const row = rows[r]!;
    const key = new Map<string, number>();
    for (const id of row) {
      const ns = neighbours.get(id) ?? [];
      key.set(id, ns.length ? ns.reduce((s, n) => s + pos.get(n)!, 0) / ns.length : pos.get(id)!);
    }
    row.sort((a, b) => key.get(a)! - key.get(b)! || pos.get(a)! - pos.get(b)!);
    row.forEach((id, i) => pos.set(id, i));
  };
  for (let s = 0; s < sweeps && bestCount > 0; s += 1) {
    if (s % 2 === 0) for (let r = 1; r < rows.length; r += 1) sortRow(r, up);
    else for (let r = rows.length - 2; r >= 0; r -= 1) sortRow(r, down);
    const c = crossings();
    if (c < bestCount) {
      bestCount = c;
      best = rows.map((r) => [...r]);
    }
  }
  rows.forEach((r, i) => r.splice(0, r.length, ...best[i]!));
}

// ─── x placement ───────────────────────────────────────────────────

function placeX(rows: string[][], items: Map<string, Item>, up: Map<string, string[]>, down: Map<string, string[]>, config: LayoutConfig): void {
  const gap = (a: Item, b: Item): number => (a.dummy && b.dummy ? config.dummyGap : a.dummy || b.dummy ? config.mixedGap : config.nodeGap);
  for (const row of rows) {
    let x = 0;
    row.forEach((id, i) => {
      const it = items.get(id)!;
      if (i > 0) {
        const prev = items.get(row[i - 1]!)!;
        x += prev.w / 2 + gap(prev, it) + it.w / 2;
      } else x = it.w / 2;
      it.x = x;
    });
  }
  // Center rows on the widest one before balancing.
  const width = (row: string[]): number => (row.length ? items.get(row.at(-1)!)!.x + items.get(row.at(-1)!)!.w / 2 : 0);
  const widest = Math.max(...rows.map(width));
  for (const row of rows) {
    const shift = (widest - width(row)) / 2;
    for (const id of row) items.get(id)!.x += shift;
  }
  const passes = 10;
  for (let p = 0; p < passes; p += 1) {
    const order = p % 2 === 0 ? rows.map((_, i) => i) : rows.map((_, i) => rows.length - 1 - i);
    for (const r of order) {
      const row = rows[r]!;
      if (!row.length) continue;
      const desired: number[] = [];
      const weight: number[] = [];
      for (const id of row) {
        const it = items.get(id)!;
        const ns = p >= passes - 2 ? [...(up.get(id) ?? []), ...(down.get(id) ?? [])] : p % 2 === 0 ? (up.get(id) ?? []) : (down.get(id) ?? []);
        const all = ns.length ? ns : [...(up.get(id) ?? []), ...(down.get(id) ?? [])];
        desired.push(all.length ? all.reduce((s, n) => s + items.get(n)!.x, 0) / all.length : it.x);
        weight.push(it.dummy ? 4 : all.length ? 1 : 0.25);
      }
      const offsets: number[] = [0];
      for (let i = 1; i < row.length; i += 1) {
        const a = items.get(row[i - 1]!)!;
        const b = items.get(row[i]!)!;
        offsets.push(offsets[i - 1]! + a.w / 2 + gap(a, b) + b.w / 2);
      }
      const fitted = isotonic(desired.map((d, i) => d - offsets[i]!), weight);
      row.forEach((id, i) => (items.get(id)!.x = fitted[i]! + offsets[i]!));
    }
  }
  let minLeft = Infinity;
  for (const it of items.values()) minLeft = Math.min(minLeft, it.x - it.w / 2);
  for (const it of items.values()) it.x = round(it.x - minLeft + config.margin);
}

/** Weighted pool-adjacent-violators: the nondecreasing sequence closest to `v`. */
function isotonic(v: number[], w: number[]): number[] {
  const blocks: { value: number; weight: number; count: number }[] = [];
  for (let i = 0; i < v.length; i += 1) {
    blocks.push({ value: v[i]!, weight: Math.max(w[i]!, 1e-6), count: 1 });
    while (blocks.length > 1 && blocks[blocks.length - 2]!.value > blocks[blocks.length - 1]!.value) {
      const b = blocks.pop()!;
      const a = blocks.pop()!;
      const weight = a.weight + b.weight;
      blocks.push({ value: (a.value * a.weight + b.value * b.weight) / weight, weight, count: a.count + b.count });
    }
  }
  const out: number[] = [];
  for (const b of blocks) for (let i = 0; i < b.count; i += 1) out.push(b.value);
  return out;
}

// ─── ports and stubs ───────────────────────────────────────────────

interface Attachment {
  key: string;
  other: string;
  set: (x: number) => void;
  get: () => number;
}

function assignPorts(items: Map<string, Item>, hops: Hop[], flats: Flat[], config: LayoutConfig): void {
  const sides = new Map<string, Attachment[]>();
  const attach = (id: string, side: "t" | "b", a: Attachment): void => {
    const k = `${id}:${side}`;
    sides.set(k, [...(sides.get(k) ?? []), a]);
  };
  for (const h of hops) {
    attach(h.upper, "b", { key: `${h.edge}@${h.channel}`, other: h.lower, set: (x) => (h.ux = x), get: () => h.ux });
    attach(h.lower, "t", { key: `${h.edge}@${h.channel}`, other: h.upper, set: (x) => (h.lx = x), get: () => h.lx });
  }
  for (const f of flats) {
    attach(f.a, "b", { key: `${f.edge}:a`, other: f.b, set: (x) => (f.ax = x), get: () => f.ax });
    attach(f.b, "b", { key: `${f.edge}:b`, other: f.a, set: (x) => (f.bx = x), get: () => f.bx });
  }
  for (const [k, list] of sides) {
    const id = k.slice(0, k.lastIndexOf(":"));
    const it = items.get(id)!;
    if (it.dummy) {
      for (const a of list) a.set(it.x);
      continue;
    }
    list.sort((a, b) => items.get(a.other)!.x - items.get(b.other)!.x || (a.key < b.key ? -1 : 1));
    const inset = Math.min(18, it.w * 0.18);
    const lo = it.x - it.w / 2 + inset;
    const hi = it.x + it.w / 2 - inset;
    if (list.length === 1) {
      list[0]!.set(round(Math.min(hi, Math.max(lo, items.get(list[0]!.other)!.x))));
      continue;
    }
    const step = Math.min(Math.max(config.portGap, (hi - lo) / (list.length + 1)), (hi - lo) / Math.max(1, list.length - 1));
    const span = step * (list.length - 1);
    const center = Math.min(hi - span / 2, Math.max(lo + span / 2, list.reduce((s, a) => s + items.get(a.other)!.x, 0) / list.length));
    list.forEach((a, i) => a.set(round(center - span / 2 + i * step)));
  }
  // Straighten single hops between two single-attachment sides whose ranges overlap.
  const count = (id: string, side: string): number => sides.get(`${id}:${side}`)?.length ?? 0;
  for (const h of hops) {
    const u = items.get(h.upper)!;
    const l = items.get(h.lower)!;
    if (count(h.upper, "b") !== 1 && !u.dummy) continue;
    if (count(h.lower, "t") !== 1 && !l.dummy) continue;
    // Dummy corridors never move, so two of them can only be joined where they already line up.
    if (u.dummy && l.dummy) continue;
    const range = (it: Item): [number, number] => (it.dummy ? [it.x, it.x] : [it.x - it.w / 2 + Math.min(18, it.w * 0.18), it.x + it.w / 2 - Math.min(18, it.w * 0.18)]);
    const [a0, a1] = range(u);
    const [b0, b1] = range(l);
    const lo = Math.max(a0, b0);
    const hi = Math.min(a1, b1);
    if (lo > hi) continue;
    const x = round(u.dummy ? u.x : l.dummy ? l.x : (lo + hi) / 2);
    h.ux = x;
    h.lx = x;
  }
}

/**
 * Keep every vertical stub in a channel at least MIN apart from the stubs of
 * other edges, so no two vertical runs share a line and no crossing lands next
 * to a bend. Real-node ports move along their side; a dummy corridor moves
 * sideways as a whole (both of its stubs) when its row neighbours leave room.
 */
function separateStubs(rows: string[][], items: Map<string, Item>, hops: Hop[], flats: Flat[], config: LayoutConfig): void {
  const MIN = 8;
  interface Stub {
    edge: string;
    item: string;
    channel: number;
    /** down: descends from the row above into the channel; up: rises from the row below. */
    side: "down" | "up";
    straight: () => boolean;
    get: () => number;
    set: (x: number) => void;
  }
  const stubs: Stub[] = [];
  for (const h of hops) {
    const straight = (): boolean => h.ux === h.lx;
    stubs.push({ edge: h.edge, item: h.upper, channel: h.channel, side: "down", straight, get: () => h.ux, set: (x) => (h.ux = x) });
    stubs.push({ edge: h.edge, item: h.lower, channel: h.channel, side: "up", straight, get: () => h.lx, set: (x) => (h.lx = x) });
  }
  for (const f of flats) {
    const straight = (): boolean => false;
    stubs.push({ edge: f.edge, item: f.a, channel: f.channel, side: "down", straight, get: () => f.ax, set: (x) => (f.ax = x) });
    stubs.push({ edge: f.edge, item: f.b, channel: f.channel, side: "down", straight, get: () => f.bx, set: (x) => (f.bx = x) });
  }
  const byChannel = new Map<number, Stub[]>();
  for (const st of stubs) byChannel.set(st.channel, [...(byChannel.get(st.channel) ?? []), st]);
  const ofItem = new Map<string, Stub[]>();
  for (const st of stubs) ofItem.set(st.item, [...(ofItem.get(st.item) ?? []), st]);
  // Opposite-side stubs also need separation: cyclic track-order constraints
  // can force a crossing next to a bend even when their preferred order is known.
  const clashAt = (st: Stub, x: number, ignore: Set<Stub>): boolean =>
    (byChannel.get(st.channel) ?? []).some((o) => !ignore.has(o) && o.edge !== st.edge && Math.abs(o.get() - x) < MIN);
  const rowIndex = new Map<string, number>();
  rows.forEach((r) => r.forEach((id, i) => rowIndex.set(id, i)));
  const neighbourRoom = (it: Item, x: number): boolean => {
    const row = rows[it.row]!;
    const i = rowIndex.get(it.id)!;
    const need = (o: Item): number => (o.dummy ? config.dummyGap : 12) + o.w / 2;
    const left = i > 0 ? items.get(row[i - 1]!)! : undefined;
    const right = i < row.length - 1 ? items.get(row[i + 1]!)! : undefined;
    return (!left || x - left.x >= need(left)) && (!right || right.x - x >= need(right));
  };
  const OFFSETS = [9, -9, 16, -16, 24, -24, 33, -33, 42, -42, 54, -54];
  for (let pass = 0; pass < 4; pass += 1) {
    let moved = false;
    for (const st of stubs) {
      if (!clashAt(st, st.get(), new Set([st]))) continue;
      const it = items.get(st.item)!;
      if (!it.dummy) {
        const siblings = (ofItem.get(st.item) ?? []).filter((o) => o !== st && o.channel === st.channel);
        for (const d of OFFSETS) {
          const x = round(st.get() + d);
          if (withinSide(it, x) && !clashAt(st, x, new Set([st])) && !siblings.some((o) => Math.abs(o.get() - x) < 6)) {
            st.set(x);
            moved = true;
            break;
          }
        }
        continue;
      }
      // A dummy's stubs (above and below) move together with the corridor.
      const own = ofItem.get(st.item) ?? [];
      const ignore = new Set(own);
      for (const d of OFFSETS) {
        const x = round(it.x + d);
        if (!neighbourRoom(it, x) || own.some((o) => clashAt(o, x, ignore))) continue;
        it.x = x;
        for (const o of own) o.set(x);
        moved = true;
        break;
      }
    }
    if (!moved) break;
  }
  // Snap: a hop whose ends differ by a hair becomes straight where a real end can take the other's x.
  for (const h of hops) {
    const d = Math.abs(h.ux - h.lx);
    if (d === 0 || d >= 2) continue;
    const lower = items.get(h.lower)!;
    const upper = items.get(h.upper)!;
    if (!lower.dummy && withinSide(lower, h.ux, 2)) h.lx = h.ux;
    else if (!upper.dummy && withinSide(upper, h.lx, 2)) h.ux = h.lx;
  }
}

function withinSide(it: Item, x: number, inset = Math.min(10, it.w * 0.12)): boolean {
  return x >= it.x - it.w / 2 + inset && x <= it.x + it.w / 2 - inset;
}

// ─── tracks ────────────────────────────────────────────────────────

/**
 * Constrained left-edge channel routing. Horizontal segments in one channel
 * get distinct tracks when they overlap; and where one edge descends near the
 * x at which another rises, the descending one takes a higher track, so their
 * vertical runs can never share a line or cross next to a bend. A constraint
 * cycle is broken at the segment with the fewest pending predecessors.
 */
function assignTracks(rowCount: number, hops: Hop[], flats: Flat[], config: LayoutConfig): number[] {
  const out: number[] = Array.from({ length: rowCount }, () => 0);
  interface S {
    id: string;
    lo: number;
    hi: number;
    down: number[];
    up: number[];
    set: (t: number) => void;
  }
  const byChannel = new Map<number, S[]>();
  const add = (c: number, seg: S): void => void byChannel.set(c, [...(byChannel.get(c) ?? []), seg]);
  for (const h of hops) {
    if (h.ux === h.lx) continue;
    add(h.channel, { id: `${h.edge}@${h.channel}`, lo: Math.min(h.ux, h.lx), hi: Math.max(h.ux, h.lx), down: [h.ux], up: [h.lx], set: (t) => (h.track = t) });
  }
  for (const f of flats) add(f.channel, { id: f.edge, lo: Math.min(f.ax, f.bx), hi: Math.max(f.ax, f.bx), down: [f.ax, f.bx], up: [], set: (t) => (f.track = t) });
  const sep = Math.max(8, config.trackGap);
  const NEAR = 9;
  for (const [channel, segs] of byChannel) {
    segs.sort((a, b) => a.lo - b.lo || a.hi - b.hi || (a.id < b.id ? -1 : 1));
    // above.get(b) = segments that must sit on a higher track than b.
    const above = new Map<S, Set<S>>(segs.map((x) => [x, new Set<S>()]));
    for (const a of segs) for (const b of segs) if (a !== b && a.down.some((x) => b.up.some((y) => Math.abs(x - y) < NEAR))) above.get(b)!.add(a);
    const placed = new Set<S>();
    let track = 0;
    while (placed.size < segs.length) {
      const ready = segs.filter((x) => !placed.has(x) && [...above.get(x)!].every((p) => placed.has(p)));
      const pool = ready.length ? ready : [segs.filter((x) => !placed.has(x)).sort((a, b) => [...above.get(a)!].filter((p) => !placed.has(p)).length - [...above.get(b)!].filter((p) => !placed.has(p)).length)[0]!];
      let end = -Infinity;
      for (const seg of pool) {
        if (seg.lo < end + sep) continue;
        seg.set(track);
        end = seg.hi;
        placed.add(seg);
      }
      track += 1;
    }
    out[channel] = track;
  }
  return out;
}

// ─── labels ────────────────────────────────────────────────────────

function placeLabel(edge: LayoutEdge, w: number, obstacles: Rect[], placed: Rect[], segs: Seg[], borders: Seg[]): Rect | undefined {
  const pts = edge.points;
  const segments: [Point, Point][] = [];
  for (let i = pts.length - 1; i > 0; i -= 1) segments.push([pts[i - 1]!, pts[i]!]);
  const candidates: Rect[] = [];
  // Slide along each segment (the one entering the target first), on both sides: the preferred
  // positions first, then a fine sweep (~6px steps, outward from the middle) for crowded channels.
  const FRACTIONS = [0.5, 0.35, 0.65, 0.2, 0.8, 0.1, 0.9];
  const sweep = (room: number): number[] => {
    const n = Math.max(1, Math.floor(room / 6));
    const fine = Array.from({ length: n + 1 }, (_, k) => k / n).sort((p, q) => Math.abs(p - 0.5) - Math.abs(q - 0.5) || p - q);
    return [...FRACTIONS, ...fine.filter((t) => !FRACTIONS.includes(t))];
  };
  for (const [a, b] of segments) {
    if (a.x === b.x) {
      const len = Math.abs(b.y - a.y);
      if (len < LABEL_H + 16) continue;
      const y0 = Math.min(a.y, b.y) + 8;
      const room = len - LABEL_H - 16;
      for (const t of sweep(room)) {
        const y = round(y0 + t * room);
        candidates.push({ x: a.x + 7, y, width: w, height: LABEL_H }, { x: a.x - 7 - w, y, width: w, height: LABEL_H });
      }
    } else {
      const len = Math.abs(b.x - a.x);
      if (len < w + 16) continue;
      const x0 = Math.min(a.x, b.x) + 8;
      const room = len - w - 16;
      for (const t of sweep(room)) {
        const x = round(x0 + t * room);
        candidates.push({ x, y: a.y - 6 - LABEL_H, width: w, height: LABEL_H }, { x, y: a.y + 6, width: w, height: LABEL_H });
      }
    }
  }
  // Crowded channels can block the nearest offset while leaving space a few
  // pixels farther away. Keep these as fallbacks and retain every collision check.
  const nearby = candidates.flatMap(c => [6, 12].flatMap(offset => [
    {...c, x:c.x + offset}, {...c, x:c.x - offset},
    {...c, y:c.y + offset}, {...c, y:c.y - offset},
  ]));
  return [...candidates, ...nearby].find(
    (c) =>
      !obstacles.some((o) => overlaps(c, o)) &&
      !placed.some((p) => overlaps(inflate(c, 4), p)) &&
      !segs.some((s) => segHitsRect(s, inflate(c, s.edge === edge.id ? 2 : 3))) &&
      !borders.some((s) => segHitsRect(s, inflate(c, 2))),
  );
}

// ─── geometry helpers (shared with validation) ─────────────────────

export interface Seg {
  edge: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export function segmentsOf(edges: LayoutEdge[]): Seg[] {
  const out: Seg[] = [];
  for (const e of edges) for (let i = 1; i < e.points.length; i += 1) out.push({ edge: e.id, x1: e.points[i - 1]!.x, y1: e.points[i - 1]!.y, x2: e.points[i]!.x, y2: e.points[i]!.y });
  return out;
}

export function rectSegments(r: Rect, edge = "#boundary"): Seg[] {
  return [
    { edge, x1: r.x, y1: r.y, x2: r.x + r.width, y2: r.y },
    { edge, x1: r.x + r.width, y1: r.y, x2: r.x + r.width, y2: r.y + r.height },
    { edge, x1: r.x, y1: r.y + r.height, x2: r.x + r.width, y2: r.y + r.height },
    { edge, x1: r.x, y1: r.y, x2: r.x, y2: r.y + r.height },
  ];
}

export function inflate(r: Rect, d: number): Rect {
  return { x: r.x - d, y: r.y - d, width: r.width + 2 * d, height: r.height + 2 * d };
}

/** Strict interior overlap (touching edges do not count). */
export function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

/** Axis-aligned segment against a rectangle's interior. */
export function segHitsRect(s: Seg, r: Rect): boolean {
  const minX = Math.min(s.x1, s.x2);
  const maxX = Math.max(s.x1, s.x2);
  const minY = Math.min(s.y1, s.y2);
  const maxY = Math.max(s.y1, s.y2);
  return maxX > r.x && minX < r.x + r.width && maxY > r.y && minY < r.y + r.height;
}

/** Proper crossings between perpendicular segments of different edges. */
export function crossingsOf(segs: Seg[]): { a: Seg; b: Seg; at: Point }[] {
  const out: { a: Seg; b: Seg; at: Point }[] = [];
  const vertical = segs.filter((s) => s.x1 === s.x2 && s.y1 !== s.y2);
  const horizontal = segs.filter((s) => s.y1 === s.y2 && s.x1 !== s.x2);
  for (const v of vertical) {
    const vy0 = Math.min(v.y1, v.y2);
    const vy1 = Math.max(v.y1, v.y2);
    for (const h of horizontal) {
      if (h.edge === v.edge) continue;
      const hx0 = Math.min(h.x1, h.x2);
      const hx1 = Math.max(h.x1, h.x2);
      if (v.x1 > hx0 && v.x1 < hx1 && h.y1 > vy0 && h.y1 < vy1) out.push({ a: v, b: h, at: { x: v.x1, y: h.y1 } });
    }
  }
  return out;
}

function countCrossings(edges: LayoutEdge[]): number {
  return crossingsOf(segmentsOf(edges)).length;
}

function simplify(pts: Point[]): Point[] {
  const out: Point[] = [];
  for (const p of pts) {
    const last = out[out.length - 1];
    if (last && last.x === p.x && last.y === p.y) continue;
    const prev = out[out.length - 2];
    if (last && prev && ((prev.x === last.x && last.x === p.x) || (prev.y === last.y && last.y === p.y))) out[out.length - 1] = p;
    else out.push(p);
  }
  return out;
}

function round(v: number): number {
  return Math.round(v * 2) / 2;
}
