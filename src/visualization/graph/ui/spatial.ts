import type { Bounds, GraphModel } from "./graph-model.js";

/**
 * Uniform grid over node circles, so hit testing and label culling look at
 * nearby cells instead of every node. Large nodes (folders) are registered in
 * every cell they cover.
 */
export class SpatialIndex {
  private readonly cells = new Map<number, number[]>();
  private readonly cell: number;
  private stamp: Uint32Array;
  private visit = 0;

  constructor(private readonly model: GraphModel) {
    const { bounds, n } = model;
    const area = Math.max(1, (bounds.maxX - bounds.minX) * (bounds.maxY - bounds.minY));
    // Aim for a handful of nodes per cell, never finer than the smallest entities.
    this.cell = Math.max(4, Math.sqrt((area / Math.max(1, n)) * 4));
    this.stamp = new Uint32Array(n);
    for (let i = 0; i < n; i += 1) {
      const r = model.radius[i]!;
      this.eachCell(model.x[i]! - r, model.y[i]! - r, model.x[i]! + r, model.y[i]! + r, false, (key) => {
        let list = this.cells.get(key);
        if (!list) this.cells.set(key, (list = []));
        list.push(i);
      });
    }
  }

  /** Visit each node whose cell intersects `rect` exactly once. */
  query(rect: Bounds, fn: (i: number) => void): void {
    this.visit += 1;
    const v = this.visit;
    this.eachCell(rect.minX, rect.minY, rect.maxX, rect.maxY, true, (key) => {
      for (const i of this.cells.get(key) ?? []) {
        if (this.stamp[i] === v) continue;
        this.stamp[i] = v;
        fn(i);
      }
    });
  }

  /**
   * Node under a world point. Effective radius honours the renderer's minimum
   * on-screen size, plus `tolerancePx`; the closest hit relative to its size wins.
   */
  pick(wx: number, wy: number, zoom: number, pickable: (i: number) => boolean, tolerancePx = 3): number {
    const { model } = this;
    const reach = Math.max(model.maxRadius, 6 / zoom) + tolerancePx / zoom;
    let best = -1;
    let bestScore = Infinity;
    this.query({ minX: wx - reach, minY: wy - reach, maxX: wx + reach, maxY: wy + reach }, (i) => {
      if (!pickable(i)) return;
      const r = Math.max(model.radius[i]!, model.minPixels[i]! / zoom) + tolerancePx / zoom;
      const d = Math.hypot(model.x[i]! - wx, model.y[i]! - wy);
      if (d > r) return;
      const score = d / r - model.rank[i]! * 1e-3;
      if (score < bestScore) {
        bestScore = score;
        best = i;
      }
    });
    return best;
  }

  private eachCell(x0: number, y0: number, x1: number, y1: number, occupiedOnly: boolean, fn: (key: number) => void): void {
    const gx0 = Math.floor(x0 / this.cell);
    const gx1 = Math.floor(x1 / this.cell);
    const gy0 = Math.floor(y0 / this.cell);
    const gy1 = Math.floor(y1 / this.cell);
    // A huge query (far zoom) walks the occupied cells instead of the empty grid.
    if (occupiedOnly && (gx1 - gx0 + 1) * (gy1 - gy0 + 1) > this.cells.size * 2) {
      for (const key of this.cells.keys()) {
        const gx = Math.floor(key / CELL_STRIDE) - CELL_OFFSET;
        const gy = (key % CELL_STRIDE) - CELL_OFFSET;
        if (gx >= gx0 && gx <= gx1 && gy >= gy0 && gy <= gy1) fn(key);
      }
      return;
    }
    for (let gx = gx0; gx <= gx1; gx += 1) for (let gy = gy0; gy <= gy1; gy += 1) fn((gx + CELL_OFFSET) * CELL_STRIDE + (gy + CELL_OFFSET));
  }
}

const CELL_OFFSET = 1 << 20;
const CELL_STRIDE = 1 << 22;
