import { edgeStyle, HIERARCHY_EDGE_KINDS, nodeStyle, type GraphViewPayload } from "../model.js";

/**
 * On-screen core radius of a node's star, in CSS pixels. Grows with zoom like
 * a map, but saturates at a per-kind cap so a zoomed-in entity stays a point
 * of light rather than a disc. Mirrored in the renderer's star shader.
 */
export function starRadius(radius: number, minPixels: number, zoom: number): number {
  return Math.min(Math.max(radius * zoom * 0.55, minPixels * 0.6), radius * 3.2);
}

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/**
 * Immutable, render-ready form of the Feature 1 graph. UI interaction never
 * mutates it; selection, filters, hover and zoom live in separate state.
 */
export class GraphModel {
  readonly payload: GraphViewPayload;
  readonly n: number;
  readonly m: number;
  readonly ids: readonly string[];
  readonly names: readonly string[];
  readonly lowerNames: readonly string[];
  readonly kindNames: readonly string[];
  readonly edgeKindNames: readonly string[];
  readonly kind: Uint8Array;
  readonly x: Float32Array;
  readonly y: Float32Array;
  readonly radius: Float32Array;
  readonly minPixels: Float32Array;
  readonly rank: Uint8Array;
  readonly parent: Int32Array;
  readonly depth: Uint16Array;
  readonly line: Int32Array;
  readonly pathIndex: Int32Array;
  readonly flags: Uint8Array;
  readonly childStart: Int32Array;
  readonly childList: Int32Array;
  readonly source: Int32Array;
  readonly target: Int32Array;
  readonly edgeKind: Uint8Array;
  readonly confidence: Uint8Array;
  /** Per edge kind index: hierarchy (contains/defines) or semantic. */
  readonly hierarchyKind: readonly boolean[];
  readonly outStart: Int32Array;
  readonly outList: Int32Array;
  readonly inStart: Int32Array;
  readonly inList: Int32Array;
  /** Quadratic Bézier control point per edge (subtle hierarchical bundling). */
  readonly ctrlX: Float32Array;
  readonly ctrlY: Float32Array;
  readonly indexById: ReadonlyMap<string, number>;
  readonly bounds: Bounds;
  readonly maxRadius: number;
  readonly nodeKindCounts: ReadonlyMap<string, number>;
  readonly edgeKindCounts: ReadonlyMap<string, number>;
  readonly semanticEdges: number;

  constructor(payload: GraphViewPayload) {
    this.payload = payload;
    const pn = payload.nodes;
    const pe = payload.edges;
    const n = (this.n = pn.id.length);
    const m = (this.m = pe.source.length);
    this.ids = pn.id;
    this.names = pn.name;
    this.lowerNames = pn.name.map((s) => s.toLowerCase());
    this.kindNames = payload.nodeKinds;
    this.edgeKindNames = payload.edgeKinds;
    this.kind = Uint8Array.from(pn.kind);
    this.x = Float32Array.from(pn.x);
    this.y = Float32Array.from(pn.y);
    this.parent = Int32Array.from(pn.parent);
    this.line = Int32Array.from(pn.line);
    this.pathIndex = Int32Array.from(pn.path);
    this.flags = Uint8Array.from(pn.flags);
    this.radius = new Float32Array(n);
    this.minPixels = new Float32Array(n);
    this.rank = new Uint8Array(n);
    const styles = this.kindNames.map(nodeStyle);
    const kindCounts = new Map<string, number>();
    let maxRadius = 0;
    const b: Bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
    for (let i = 0; i < n; i += 1) {
      const s = styles[this.kind[i]!]!;
      this.radius[i] = s.radius;
      this.minPixels[i] = s.minPixels;
      this.rank[i] = s.rank;
      maxRadius = Math.max(maxRadius, s.radius);
      const k = this.kindNames[this.kind[i]!]!;
      kindCounts.set(k, (kindCounts.get(k) ?? 0) + 1);
      b.minX = Math.min(b.minX, this.x[i]! - s.radius);
      b.minY = Math.min(b.minY, this.y[i]! - s.radius);
      b.maxX = Math.max(b.maxX, this.x[i]! + s.radius);
      b.maxY = Math.max(b.maxY, this.y[i]! + s.radius);
    }
    this.bounds = n ? b : { minX: -1, minY: -1, maxX: 1, maxY: 1 };
    this.maxRadius = maxRadius;
    this.nodeKindCounts = kindCounts;
    this.indexById = new Map(pn.id.map((id, i) => [id, i]));

    this.depth = new Uint16Array(n);
    for (let i = 0; i < n; i += 1) {
      let d = 0;
      for (let p = this.parent[i]!; p >= 0 && d < 65_000; p = this.parent[p]!) d += 1;
      this.depth[i] = d;
    }
    [this.childStart, this.childList] = csr(n, n, (i) => this.parent[i]!);

    this.source = Int32Array.from(pe.source);
    this.target = Int32Array.from(pe.target);
    this.edgeKind = Uint8Array.from(pe.kind);
    this.confidence = Uint8Array.from(pe.confidence);
    this.hierarchyKind = this.edgeKindNames.map((k) => HIERARCHY_EDGE_KINDS.has(k));
    [this.outStart, this.outList] = csr(n, m, (e) => this.source[e]!);
    [this.inStart, this.inList] = csr(n, m, (e) => this.target[e]!);
    const edgeCounts = new Map<string, number>();
    let semantic = 0;
    for (let e = 0; e < m; e += 1) {
      const k = this.edgeKindNames[this.edgeKind[e]!]!;
      edgeCounts.set(k, (edgeCounts.get(k) ?? 0) + 1);
      if (!this.hierarchyKind[this.edgeKind[e]!]) semantic += 1;
    }
    this.edgeKindCounts = edgeCounts;
    this.semanticEdges = semantic;

    this.ctrlX = new Float32Array(m);
    this.ctrlY = new Float32Array(m);
    for (let e = 0; e < m; e += 1) this.controlPoint(e);
  }

  kindOf(i: number): string {
    return this.kindNames[this.kind[i]!]!;
  }

  edgeKindOf(e: number): string {
    return this.edgeKindNames[this.edgeKind[e]!]!;
  }

  path(i: number): string | undefined {
    const p = this.pathIndex[i]!;
    return p >= 0 ? this.payload.paths[p] : undefined;
  }

  children(i: number): Int32Array {
    return this.childList.subarray(this.childStart[i]!, this.childStart[i + 1]!);
  }

  outEdges(i: number): Int32Array {
    return this.outList.subarray(this.outStart[i]!, this.outStart[i + 1]!);
  }

  inEdges(i: number): Int32Array {
    return this.inList.subarray(this.inStart[i]!, this.inStart[i + 1]!);
  }

  /** Every descendant of `i` (excluding `i`), pre-order. */
  descendants(i: number): number[] {
    const out: number[] = [];
    const stack = [...this.children(i)].reverse();
    while (stack.length) {
      const c = stack.pop()!;
      out.push(c);
      const kids = this.children(c);
      for (let k = kids.length - 1; k >= 0; k -= 1) stack.push(kids[k]!);
    }
    return out;
  }

  ancestors(i: number): number[] {
    const out: number[] = [];
    for (let p = this.parent[i]!; p >= 0 && out.length < 65_000; p = this.parent[p]!) out.push(p);
    return out;
  }

  /** Bounds of a set of nodes, including their radii. */
  boundsOf(nodes: Iterable<number>): Bounds | undefined {
    let b: Bounds | undefined;
    for (const i of nodes) {
      const r = this.radius[i]!;
      if (!b) b = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
      b.minX = Math.min(b.minX, this.x[i]! - r);
      b.minY = Math.min(b.minY, this.y[i]! - r);
      b.maxX = Math.max(b.maxX, this.x[i]! + r);
      b.maxY = Math.max(b.maxY, this.y[i]! + r);
    }
    return b;
  }

  edgeColor(e: number): string {
    return edgeStyle(this.edgeKindOf(e)).color;
  }

  /**
   * Semantic edges bend toward their endpoints' lowest common ancestor, so
   * relationships between two regions flow through a shared corridor instead
   * of crossing as independent straight lines. Purely visual; hierarchy
   * edges stay straight.
   */
  private controlPoint(e: number): void {
    const s = this.source[e]!;
    const t = this.target[e]!;
    const mx = (this.x[s]! + this.x[t]!) / 2;
    const my = (this.y[s]! + this.y[t]!) / 2;
    const dx = this.x[t]! - this.x[s]!;
    const dy = this.y[t]! - this.y[s]!;
    if (this.hierarchyKind[this.edgeKind[e]!]) {
      this.ctrlX[e] = mx;
      this.ctrlY[e] = my;
      return;
    }
    let a = s;
    let b = t;
    while (this.depth[a]! > this.depth[b]!) a = this.parent[a]!;
    while (this.depth[b]! > this.depth[a]!) b = this.parent[b]!;
    while (a !== b && a >= 0 && b >= 0) {
      a = this.parent[a]!;
      b = this.parent[b]!;
    }
    let cx = mx - dy * 0.12;
    let cy = my + dx * 0.12;
    if (a >= 0 && a === b && a !== s && a !== t) {
      cx += (this.x[a]! - mx) * 0.3;
      cy += (this.y[a]! - my) * 0.3;
    }
    this.ctrlX[e] = cx;
    this.ctrlY[e] = cy;
  }
}

/** Compressed adjacency: items grouped by `key(item)` (−1 keys are skipped). */
function csr(n: number, count: number, key: (item: number) => number): [Int32Array, Int32Array] {
  const start = new Int32Array(n + 1);
  for (let k = 0; k < count; k += 1) {
    const g = key(k);
    if (g >= 0) start[g + 1]! += 1;
  }
  for (let i = 0; i < n; i += 1) start[i + 1]! += start[i]!;
  const fill = start.slice(0, n);
  const list = new Int32Array(start[n]!);
  for (let k = 0; k < count; k += 1) {
    const g = key(k);
    if (g >= 0) list[fill[g]!++] = k;
  }
  return [start, list];
}
