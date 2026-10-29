import { HIERARCHY_EDGE_KINDS, nodeStyle } from "./model.js";

/**
 * Hierarchy-aware layout. Deterministic: the same input always yields the
 * same coordinates, and a previous layout is reused so ordinary refreshes do
 * not move what the user has already learned where to find.
 *
 * Full layout, bottom-up:
 *   1. every entity's children are packed as circles around it — largest
 *      first, each placed on the free spot closest to the cluster centre and
 *      to already-placed siblings it has semantic relationships with;
 *   2. a short force pass lets semantic edges pull endpoints slightly toward
 *      each other while an anchor keeps each node in its hierarchical place
 *      and collision keeps nodes apart.
 * The overall shape emerges from the packing; nothing places nodes on a
 * predetermined circle or sphere.
 */

export interface LayoutInput {
  ids: readonly string[];
  kinds: readonly string[];
  /** Parent index per node, -1 for roots. Must be acyclic. */
  parent: ArrayLike<number>;
  edges: readonly { source: number; target: number; kind: string }[];
}

export interface LayoutResult {
  x: Float64Array;
  y: Float64Array;
  mode: "full" | "incremental";
  /** Nodes whose previous position was kept. */
  reused: number;
  /** Nodes placed by this run. */
  placed: number;
}

export type PreviousLayout = ReadonlyMap<string, readonly [number, number]>;

/** Gap between sibling clusters, in world units. */
const PAD = 1.4;
/** Candidate directions tried around each placed circle. */
const ANGLES = 12;
/** Reuse the previous layout when at least this share of nodes already has a position. */
const REUSE_THRESHOLD = 0.5;

export function computeLayout(input: LayoutInput, previous?: PreviousLayout): LayoutResult {
  const n = input.ids.length;
  const radius = Float64Array.from(input.kinds, (k) => nodeStyle(k).radius);
  const semantic = input.edges.filter((e) => !HIERARCHY_EDGE_KINDS.has(e.kind) && e.source !== e.target && e.source < n && e.target < n);
  if (previous && n > 0) {
    let known = 0;
    for (const id of input.ids) if (previous.has(id)) known += 1;
    if (known / n >= REUSE_THRESHOLD) return incremental(input, radius, previous, known);
  }
  return full(input, radius, semantic);
}

function full(input: LayoutInput, radius: Float64Array, semantic: LayoutInput["edges"]): LayoutResult {
  const n = input.ids.length;
  const { children, roots, preorder, depth } = hierarchy(input);
  const affinity = siblingAffinity(input.parent, depth, semantic);
  // Per node: radius of its packed cluster and the cluster's centre relative to the node.
  const cluster = Float64Array.from(radius);
  const ccx = new Float64Array(n);
  const ccy = new Float64Array(n);
  const ox = new Float64Array(n);
  const oy = new Float64Array(n);

  // Reverse pre-order visits every child before its parent.
  for (let k = preorder.length - 1; k >= 0; k -= 1) {
    const i = preorder[k]!;
    const kids = children[i]!;
    if (kids.length === 0) continue;
    const c = pack(radius[i]!, kids, { cluster, ccx, ccy, ox, oy }, affinity, input.ids);
    cluster[i] = c.r;
    ccx[i] = c.x;
    ccy[i] = c.y;
  }
  if (roots.length > 1) pack(0, roots, { cluster, ccx, ccy, ox, oy }, affinity, input.ids);

  const x = new Float64Array(n);
  const y = new Float64Array(n);
  for (const i of preorder) {
    const p = input.parent[i]!;
    x[i] = (p >= 0 ? x[p]! : 0) + ox[i]!;
    y[i] = (p >= 0 ? y[p]! : 0) + oy[i]!;
  }
  refine(x, y, radius, input.parent, semantic);
  return { x, y, mode: "full", reused: 0, placed: n };
}

/**
 * Keeps every known position; new nodes are inserted near their parent on
 * the nearest free spot, parents before children, so a new function lands
 * beside its file and a new folder's files cluster around the folder.
 */
function incremental(input: LayoutInput, radius: Float64Array, previous: PreviousLayout, known: number): LayoutResult {
  const n = input.ids.length;
  const { preorder } = hierarchy(input);
  const x = new Float64Array(n);
  const y = new Float64Array(n);
  const grid = new CircleGrid(Math.max(4, median(radius) * 2));
  const fresh: number[] = [];
  for (const i of preorder) {
    const p = previous.get(input.ids[i]!);
    if (p) {
      x[i] = p[0];
      y[i] = p[1];
      grid.add(p[0], p[1], radius[i]!);
    } else fresh.push(i);
  }
  const placedUnder = new Map<number, number>();
  for (const i of fresh) {
    const p = input.parent[i]!;
    const bx = p >= 0 ? x[p]! : 0;
    const by = p >= 0 ? y[p]! : 0;
    const k = placedUnder.get(p) ?? 0;
    placedUnder.set(p, k + 1);
    const base = (hash(input.ids[i]!) % 360) * (Math.PI / 180) + k * GOLDEN_ANGLE;
    const r = radius[i]!;
    let dist = (p >= 0 ? radius[p]! : 0) + r + PAD;
    let spot: [number, number] | undefined;
    for (let attempt = 0; attempt < 400 && !spot; attempt += 1) {
      const a = base + attempt * 0.9;
      const cx = bx + Math.cos(a) * dist;
      const cy = by + Math.sin(a) * dist;
      if (!grid.overlaps(cx, cy, r)) spot = [cx, cy];
      else if (attempt % 7 === 6) dist += r * 1.5 + PAD;
    }
    spot ??= [bx + Math.cos(base) * dist, by + Math.sin(base) * dist];
    x[i] = spot[0];
    y[i] = spot[1];
    grid.add(spot[0], spot[1], r);
  }
  return { x, y, mode: "incremental", reused: known, placed: fresh.length };
}

interface Hierarchy {
  children: number[][];
  roots: number[];
  preorder: number[];
  depth: Int32Array;
}

function hierarchy(input: LayoutInput): Hierarchy {
  const n = input.ids.length;
  const children: number[][] = Array.from({ length: n }, () => []);
  const roots: number[] = [];
  for (let i = 0; i < n; i += 1) {
    const p = input.parent[i]!;
    if (p >= 0 && p < n) children[p]!.push(i);
    else roots.push(i);
  }
  const preorder: number[] = [];
  const depth = new Int32Array(n);
  const stack = [...roots].reverse();
  while (stack.length) {
    const i = stack.pop()!;
    preorder.push(i);
    const kids = children[i]!;
    for (let k = kids.length - 1; k >= 0; k -= 1) {
      depth[kids[k]!] = depth[i]! + 1;
      stack.push(kids[k]!);
    }
  }
  return { children, roots, preorder, depth };
}

/**
 * Lifts every semantic edge to the pair of siblings under the endpoints'
 * lowest common ancestor, so `src/api` and `src/services` attract each other
 * when their files call each other.
 */
function siblingAffinity(parent: ArrayLike<number>, depth: Int32Array, semantic: LayoutInput["edges"]): Map<number, Map<number, number>> {
  const affinity = new Map<number, Map<number, number>>();
  const add = (a: number, b: number): void => {
    let m = affinity.get(a);
    if (!m) affinity.set(a, (m = new Map()));
    m.set(b, (m.get(b) ?? 0) + 1);
  };
  for (const e of semantic) {
    let a = e.source;
    let b = e.target;
    while (depth[a]! > depth[b]!) a = parent[a]!;
    while (depth[b]! > depth[a]!) b = parent[b]!;
    if (a === b) continue;
    while (parent[a] !== parent[b]) {
      a = parent[a]!;
      b = parent[b]!;
    }
    add(a, b);
    add(b, a);
  }
  return affinity;
}

interface Placed {
  x: number;
  y: number;
  r: number;
  phase: number;
  saturated: boolean;
}

interface PackState {
  cluster: Float64Array;
  ccx: Float64Array;
  ccy: Float64Array;
  ox: Float64Array;
  oy: Float64Array;
}

/**
 * Packs the `items`' clusters around a core circle (the parent node) at the
 * origin and writes each item's node offset. Returns the enclosing circle of
 * the result — its centre is generally not the parent node, e.g. a folder
 * with a single large subfolder — so nesting grows linearly, not by doubling.
 */
function pack(
  core: number,
  items: readonly number[],
  st: PackState,
  affinity: Map<number, Map<number, number>>,
  ids: readonly string[],
): { r: number; x: number; y: number } {
  const { cluster, ccx, ccy, ox, oy } = st;
  const order = [...items].sort((a, b) => cluster[b]! - cluster[a]! || (ids[a]! < ids[b]! ? -1 : 1));
  let maxR = core;
  const rs: number[] = [];
  for (const i of order) {
    rs.push(cluster[i]!);
    maxR = Math.max(maxR, cluster[i]!);
  }
  const grid = new CircleGrid(Math.max(2 * median(rs), maxR / 6, 2));
  const frontier: Placed[] = [];
  const position = new Map<number, Placed>();
  if (core > 0) {
    const c = { x: 0, y: 0, r: core, phase: 0, saturated: false };
    frontier.push(c);
    grid.add(0, 0, core);
  }
  let extent = core;
  for (const i of order) {
    const r = cluster[i]!;
    let placed: Placed;
    if (frontier.length === 0) placed = { x: 0, y: 0, r, phase: 0, saturated: false };
    else {
      let tx = 0;
      let ty = 0;
      let tw = 0;
      const aff = affinity.get(i);
      if (aff) {
        for (const [j, w] of aff) {
          const q = position.get(j);
          if (!q) continue;
          tx += q.x * w;
          ty += q.y * w;
          tw += w;
        }
      }
      if (tw > 0) {
        tx /= tw;
        ty /= tw;
      }
      let best: [number, number] | undefined;
      let bestScore = Infinity;
      for (const f of frontier) {
        if (f.saturated) continue;
        let free = false;
        const d = f.r + r + PAD;
        for (let a = 0; a < ANGLES; a += 1) {
          const theta = f.phase + (a * 2 * Math.PI) / ANGLES;
          const cx = f.x + Math.cos(theta) * d;
          const cy = f.y + Math.sin(theta) * d;
          if (grid.overlaps(cx, cy, r)) continue;
          free = true;
          const score = Math.hypot(cx, cy) + (tw > 0 ? 0.7 * Math.hypot(cx - tx, cy - ty) : 0);
          if (score < bestScore) {
            bestScore = score;
            best = [cx, cy];
          }
        }
        if (!free) f.saturated = true;
      }
      best ??= [extent + r + PAD, 0];
      placed = { x: best[0], y: best[1], r, phase: ((hash(ids[i]!) % 1000) / 1000) * ((2 * Math.PI) / ANGLES), saturated: false };
    }
    frontier.push(placed);
    position.set(i, placed);
    grid.add(placed.x, placed.y, r);
    // `placed` is the item's cluster centre; its node sits at the centre minus the cluster offset.
    ox[i] = placed.x - ccx[i]!;
    oy[i] = placed.y - ccy[i]!;
    extent = Math.max(extent, Math.hypot(placed.x, placed.y) + r);
    // Drop saturated circles occasionally so the scan stays proportional to the free boundary.
    if (frontier.length > 64 && frontier.length % 32 === 0) {
      for (let k = frontier.length - 1; k >= 0; k -= 1) if (frontier[k]!.saturated) frontier.splice(k, 1);
    }
  }
  return enclosing(core, [...position.values()]);
}

/** Enclosing circle (bounding-box centred) of the core plus placed circles. */
function enclosing(core: number, circles: readonly Placed[]): { r: number; x: number; y: number } {
  let minX = -core;
  let minY = -core;
  let maxX = core;
  let maxY = core;
  for (const c of circles) {
    minX = Math.min(minX, c.x - c.r);
    minY = Math.min(minY, c.y - c.r);
    maxX = Math.max(maxX, c.x + c.r);
    maxY = Math.max(maxY, c.y + c.r);
  }
  const x = (minX + maxX) / 2;
  const y = (minY + maxY) / 2;
  let r = core + Math.hypot(x, y);
  for (const c of circles) r = Math.max(r, Math.hypot(c.x - x, c.y - y) + c.r);
  return { r, x, y };
}

/**
 * Semantic springs (weak, degree-normalized) against a hierarchical anchor,
 * with collision. The anchor dominates, so the hierarchy stays readable and
 * semantic structure shows up as nodes leaning toward what they relate to.
 */
function refine(x: Float64Array, y: Float64Array, radius: Float64Array, parent: ArrayLike<number>, semantic: LayoutInput["edges"]): void {
  const n = x.length;
  if (n < 2) return;
  const iterations = n < 5_000 ? 60 : n < 30_000 ? 30 : 15;
  const ax = Float64Array.from(x);
  const ay = Float64Array.from(y);
  const degree = new Float64Array(n);
  const cross = semantic.filter((e) => parent[e.source] !== parent[e.target]);
  for (const e of cross) {
    degree[e.source]! += 1;
    degree[e.target]! += 1;
  }
  const dx = new Float64Array(n);
  const dy = new Float64Array(n);
  const K_ANCHOR = 0.12;
  const K_SEMANTIC = 0.003;
  for (let it = 0; it < iterations; it += 1) {
    const cool = 1 - it / iterations;
    dx.fill(0);
    dy.fill(0);
    for (const e of cross) {
      const s = e.source;
      const t = e.target;
      const vx = x[t]! - x[s]!;
      const vy = y[t]! - y[s]!;
      dx[s]! += (vx * K_SEMANTIC) / Math.sqrt(degree[s]!);
      dy[s]! += (vy * K_SEMANTIC) / Math.sqrt(degree[s]!);
      dx[t]! -= (vx * K_SEMANTIC) / Math.sqrt(degree[t]!);
      dy[t]! -= (vy * K_SEMANTIC) / Math.sqrt(degree[t]!);
    }
    for (let i = 0; i < n; i += 1) {
      let mx = (dx[i]! + (ax[i]! - x[i]!) * K_ANCHOR) * cool;
      let my = (dy[i]! + (ay[i]! - y[i]!) * K_ANCHOR) * cool;
      const cap = radius[i]! * 1.5;
      const len = Math.hypot(mx, my);
      if (len > cap) {
        mx = (mx / len) * cap;
        my = (my / len) * cap;
      }
      x[i]! += mx;
      y[i]! += my;
    }
    collide(x, y, radius);
  }
}

function collide(x: Float64Array, y: Float64Array, radius: Float64Array): void {
  const n = x.length;
  const grid = new CircleGrid(Math.max(4, median(radius) * 2));
  for (let i = 0; i < n; i += 1) grid.add(x[i]!, y[i]!, radius[i]!, i);
  const gap = PAD * 0.5;
  for (let i = 0; i < n; i += 1) {
    grid.forNear(x[i]!, y[i]!, radius[i]! + gap, (j) => {
      if (j <= i) return;
      const vx = x[j]! - x[i]!;
      const vy = y[j]! - y[i]!;
      const min = radius[i]! + radius[j]! + gap;
      const d2 = vx * vx + vy * vy;
      if (d2 >= min * min) return;
      const d = Math.sqrt(d2) || 1e-6;
      const push = (min - d) / 2;
      // Deterministic direction for coincident points.
      const ux = d2 > 1e-12 ? vx / d : Math.cos(i + j);
      const uy = d2 > 1e-12 ? vy / d : Math.sin(i + j);
      // Larger nodes (folders) move less than the small symbols around them.
      const wi = radius[j]! / (radius[i]! + radius[j]!);
      const wj = 1 - wi;
      x[i]! -= ux * push * 2 * wi;
      y[i]! -= uy * push * 2 * wi;
      x[j]! += ux * push * 2 * wj;
      y[j]! += uy * push * 2 * wj;
    });
  }
}

/** Uniform grid over circles of mixed size; large circles occupy several cells. */
class CircleGrid {
  private readonly cells = new Map<number, number[]>();
  private readonly xs: number[] = [];
  private readonly ys: number[] = [];
  private readonly rs: number[] = [];
  private readonly tags: number[] = [];
  private stamp = new Uint32Array(0);
  private visit = 0;

  constructor(private readonly size: number) {}

  add(x: number, y: number, r: number, tag = -1): void {
    const k = this.xs.length;
    this.xs.push(x);
    this.ys.push(y);
    this.rs.push(r);
    this.tags.push(tag);
    this.eachCell(x, y, r, (key) => {
      let cell = this.cells.get(key);
      if (!cell) this.cells.set(key, (cell = []));
      cell.push(k);
    });
  }

  overlaps(x: number, y: number, r: number): boolean {
    let hit = false;
    this.forNearRaw(x, y, r + PAD, (k) => {
      const min = r + this.rs[k]! + PAD - 1e-6;
      const vx = this.xs[k]! - x;
      const vy = this.ys[k]! - y;
      if (vx * vx + vy * vy < min * min) hit = true;
      return hit;
    });
    return hit;
  }

  forNear(x: number, y: number, r: number, fn: (tag: number) => void): void {
    this.forNearRaw(x, y, r, (k) => {
      fn(this.tags[k]!);
      return false;
    });
  }

  private forNearRaw(x: number, y: number, r: number, fn: (k: number) => boolean): void {
    if (this.stamp.length < this.xs.length) this.stamp = new Uint32Array(Math.max(16, this.xs.length * 2));
    this.visit += 1;
    let stop = false;
    this.eachCell(x, y, r, (key) => {
      if (stop) return;
      for (const k of this.cells.get(key) ?? []) {
        if (this.stamp[k] === this.visit) continue;
        this.stamp[k] = this.visit;
        if (fn(k)) {
          stop = true;
          return;
        }
      }
    });
  }

  private eachCell(x: number, y: number, r: number, fn: (key: number) => void): void {
    const x0 = Math.floor((x - r) / this.size);
    const x1 = Math.floor((x + r) / this.size);
    const y0 = Math.floor((y - r) / this.size);
    const y1 = Math.floor((y + r) / this.size);
    for (let gx = x0; gx <= x1; gx += 1) for (let gy = y0; gy <= y1; gy += 1) fn(gx * 73_856_093 + gy * 19_349_663);
  }
}

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

function median(values: ArrayLike<number>): number {
  if (values.length === 0) return 1;
  const sorted = Array.from(values).sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]!;
}

/** FNV-1a, for deterministic per-id jitter. */
function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
