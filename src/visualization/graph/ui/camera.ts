import type { Bounds } from "./graph-model.js";

type Animation =
  | { kind: "anchor"; targetLog: number; wx: number; wy: number; sx: number; sy: number }
  | { kind: "fly"; from: [number, number, number]; to: [number, number, number]; start: number; duration: number };

/**
 * 2D map camera. `zoom` is CSS pixels per world unit; (cx, cy) is the world
 * point at the viewport centre. Zoom is continuous (log-space interpolation),
 * anchored at the cursor so the point under it stays put, and bounded.
 * Holds its own high-frequency state outside the UI store.
 */
export class Camera {
  cx = 0;
  cy = 0;
  zoom = 1;
  width = 1;
  height = 1;
  minZoom = 0.005;
  maxZoom = 80;
  private anim: Animation | null = null;
  private last = 0;

  resize(width: number, height: number): void {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
  }

  toScreen(x: number, y: number): [number, number] {
    return [(x - this.cx) * this.zoom + this.width / 2, (y - this.cy) * this.zoom + this.height / 2];
  }

  toWorld(sx: number, sy: number): [number, number] {
    return [(sx - this.width / 2) / this.zoom + this.cx, (sy - this.height / 2) / this.zoom + this.cy];
  }

  /** World-space rectangle currently on screen, plus a margin in CSS pixels. */
  viewport(marginPx = 0): Bounds {
    const hw = (this.width / 2 + marginPx) / this.zoom;
    const hh = (this.height / 2 + marginPx) / this.zoom;
    return { minX: this.cx - hw, minY: this.cy - hh, maxX: this.cx + hw, maxY: this.cy + hh };
  }

  get animating(): boolean {
    return this.anim !== null;
  }

  /** Multiply the target zoom by `factor`, keeping the world point under (sx, sy) fixed. */
  zoomAt(sx: number, sy: number, factor: number): void {
    const current = this.anim?.kind === "anchor" ? this.anim.targetLog : Math.log(this.zoom);
    const targetLog = clamp(current + Math.log(factor), Math.log(this.minZoom), Math.log(this.maxZoom));
    const [wx, wy] = this.anim?.kind === "anchor" && this.anim.sx === sx && this.anim.sy === sy ? [this.anim.wx, this.anim.wy] : this.toWorld(sx, sy);
    this.anim = { kind: "anchor", targetLog, wx, wy, sx, sy };
  }

  /** Immediate pan by a screen-space delta; cancels any animation. */
  panBy(dx: number, dy: number): void {
    this.anim = null;
    this.cx -= dx / this.zoom;
    this.cy -= dy / this.zoom;
  }

  set(cx: number, cy: number, zoom: number): void {
    this.anim = null;
    this.cx = cx;
    this.cy = cy;
    this.zoom = clamp(zoom, this.minZoom, this.maxZoom);
  }

  flyTo(cx: number, cy: number, zoom: number, now: number, duration = 480): void {
    this.anim = {
      kind: "fly",
      from: [this.cx, this.cy, Math.log(this.zoom)],
      to: [cx, cy, Math.log(clamp(zoom, this.minZoom, this.maxZoom))],
      start: now,
      duration,
    };
  }

  /** Zoom level that fits `bounds` in the viewport with `paddingPx` on each side. */
  fitZoom(bounds: Bounds, paddingPx = 48): number {
    const w = Math.max(bounds.maxX - bounds.minX, 1e-3);
    const h = Math.max(bounds.maxY - bounds.minY, 1e-3);
    return clamp(Math.min((this.width - 2 * paddingPx) / w, (this.height - 2 * paddingPx) / h), this.minZoom, this.maxZoom);
  }

  fit(bounds: Bounds, now: number, options: { paddingPx?: number; animate?: boolean; maxZoom?: number } = {}): void {
    const zoom = Math.min(this.fitZoom(bounds, options.paddingPx ?? 48), options.maxZoom ?? this.maxZoom);
    const cx = (bounds.minX + bounds.maxX) / 2;
    const cy = (bounds.minY + bounds.maxY) / 2;
    if (options.animate === false) this.set(cx, cy, zoom);
    else this.flyTo(cx, cy, zoom, now);
  }

  /** Advance animation to `now` (ms). Returns true when the view changed. */
  step(now: number): boolean {
    const dt = this.last ? clamp(now - this.last, 0, 64) : 16;
    this.last = now;
    const a = this.anim;
    if (!a) return false;
    if (a.kind === "anchor") {
      const log = Math.log(this.zoom);
      const k = 1 - Math.exp(-dt / 70);
      let next = log + (a.targetLog - log) * k;
      if (Math.abs(a.targetLog - next) < 1e-3) {
        next = a.targetLog;
        this.anim = null;
      }
      this.zoom = Math.exp(next);
      this.cx = a.wx - (a.sx - this.width / 2) / this.zoom;
      this.cy = a.wy - (a.sy - this.height / 2) / this.zoom;
      return true;
    }
    const t = clamp((now - a.start) / a.duration, 0, 1);
    const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    this.cx = a.from[0] + (a.to[0] - a.from[0]) * e;
    this.cy = a.from[1] + (a.to[1] - a.from[1]) * e;
    this.zoom = Math.exp(a.from[2] + (a.to[2] - a.from[2]) * e);
    if (t >= 1) this.anim = null;
    return true;
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}
