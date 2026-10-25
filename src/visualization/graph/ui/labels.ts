import { nodeStyle } from "../model.js";
import type { Camera } from "./camera.js";
import { starRadius, type GraphModel } from "./graph-model.js";
import type { SpatialIndex } from "./spatial.js";
import { LEVEL_EXTERNAL, LEVEL_RELATED, LEVEL_SELECTED, PRIMARY, type VisualState } from "./visual-state.js";

const MAX_LABELS = 320;
/** On-screen radius (px) at which an entity earns a label by size alone. */
const LABEL_RADIUS_PX = 16;
/** On-screen radius (px) at which the second, detail line appears. */
const DETAIL_RADIUS_PX = 26;
const CELL = 24;

interface Candidate {
  i: number;
  priority: number;
  sx: number;
  sy: number;
  r: number;
}

/**
 * Density-aware labels. Far away only the project and major folders are
 * named; closer in, files, then classes, then functions and variables earn
 * labels as their on-screen size grows. The selection, hover and direct
 * relationships always get priority. Labels never overlap and are capped.
 */
export class LabelLayer {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly widths = new Map<string, number>();

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext("2d")!;
  }

  resize(width: number, height: number, dpr: number): void {
    this.canvas.width = Math.max(1, Math.round(width * dpr));
    this.canvas.height = Math.max(1, Math.round(height * dpr));
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  draw(model: GraphModel, camera: Camera, index: SpatialIndex, state: VisualState, selected: number, hovered: number, enabled: boolean): void {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, camera.width, camera.height);
    const candidates: Candidate[] = [];
    const focused = selected >= 0;
    const consider = (i: number, forced: number): void => {
      if (state.visibility.node[i] !== PRIMARY || state.nodeAlpha[i]! <= 0.05) return;
      const r = Math.max(model.radius[i]! * camera.zoom, model.minPixels[i]!);
      const [sx, sy] = camera.toScreen(model.x[i]!, model.y[i]!);
      if (sx < -200 || sy < -20 || sx > camera.width + 20 || sy > camera.height + 20) return;
      const level = state.level[i]!;
      let priority = forced;
      if (!priority) {
        const bySize = r >= (model.rank[i]! <= 1 ? 3 : LABEL_RADIUS_PX);
        if (!enabled && level < LEVEL_RELATED) return;
        if (!bySize && level < LEVEL_RELATED) return;
        if (focused && level < LEVEL_EXTERNAL && state.nodeAlpha[i]! < 0.5) return;
        priority = (level >= LEVEL_RELATED ? 500 : level === LEVEL_EXTERNAL ? 300 : 0) + (12 - model.rank[i]!) * 10 + Math.min(r, 40);
      }
      candidates.push({ i, priority, sx, sy, r });
    };
    index.query(camera.viewport(40), (i) => consider(i, 0));
    if (selected >= 0) consider(selected, 2000);
    // Direct relationships of a focused node are named even when small.
    for (const i of state.related.slice(0, 60)) consider(i, 800);
    if (hovered >= 0) consider(hovered, 1500);
    candidates.sort((a, b) => b.priority - a.priority || a.i - b.i);

    const occupied = new Map<number, [number, number, number, number][]>();
    const seen = new Set<number>();
    let placed = 0;
    for (const c of candidates) {
      if (placed >= MAX_LABELS) break;
      if (seen.has(c.i)) continue;
      seen.add(c.i);
      const level = state.level[c.i]!;
      const strong = level === LEVEL_SELECTED || c.i === hovered;
      const structural = model.rank[c.i]! <= 1;
      const font = structural
        ? `600 ${model.rank[c.i] === 0 ? 14 : 12}px ui-sans-serif, system-ui, sans-serif`
        : `${strong ? 600 : 400} 11px ui-sans-serif, system-ui, sans-serif`;
      const text = model.names[c.i]!;
      const detail = c.r >= DETAIL_RADIUS_PX || strong ? detailLine(model, c.i) : "";
      ctx.font = font;
      const w = this.measure(font, text);
      const h = detail ? 26 : 14;
      const x = c.sx + starRadius(model.radius[c.i]!, model.minPixels[c.i]!, camera.zoom) * 1.3 + 6;
      const y = c.sy - 7;
      if (!strong && collides(occupied, x, y, w, h)) continue;
      reserve(occupied, x, y, w, h);
      placed += 1;
      const alpha = Math.min(1, state.nodeAlpha[c.i]! + (strong ? 0 : 0.1)) * (level >= LEVEL_RELATED || c.i === hovered ? 1 : 0.8);
      ctx.globalAlpha = alpha;
      ctx.textBaseline = "top";
      // Soft dark shadow keeps text legible over bright regions without hard outlines.
      ctx.shadowColor = "rgba(0,0,0,0.95)";
      ctx.shadowBlur = 6;
      ctx.fillStyle = strong ? "#ffffff" : structural ? tint(nodeStyle(model.kindOf(c.i)).color) : "#d4dbe8";
      ctx.fillText(text, x, y);
      if (detail) {
        ctx.font = "10px ui-monospace, SFMono-Regular, Menlo, monospace";
        ctx.fillStyle = "#7d8aa5";
        ctx.fillText(detail, x, y + 14);
      }
    }
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;
  }

  private measure(font: string, text: string): number {
    const key = `${font}\u0000${text}`;
    let w = this.widths.get(key);
    if (w === undefined) {
      w = this.ctx.measureText(text).width;
      if (this.widths.size > 20_000) this.widths.clear();
      this.widths.set(key, w);
    }
    return w;
  }
}

function detailLine(model: GraphModel, i: number): string {
  const kind = nodeStyle(model.kindOf(i)).label.toLowerCase();
  const line = model.line[i]! > 0 ? ` · L${model.line[i]}` : "";
  const path = model.rank[i]! >= 3 ? "" : (model.path(i) ?? "");
  return `${kind}${line}${path && model.kindOf(i) !== "file" ? ` · ${path}` : ""}`;
}

function collides(grid: Map<number, [number, number, number, number][]>, x: number, y: number, w: number, h: number): boolean {
  for (let gx = Math.floor(x / CELL); gx <= Math.floor((x + w) / CELL); gx += 1) {
    for (let gy = Math.floor(y / CELL); gy <= Math.floor((y + h) / CELL); gy += 1) {
      for (const [ax, ay, aw, ah] of grid.get(gx * 100_003 + gy) ?? []) {
        if (x < ax + aw + 4 && x + w + 4 > ax && y < ay + ah && y + h > ay) return true;
      }
    }
  }
  return false;
}

function reserve(grid: Map<number, [number, number, number, number][]>, x: number, y: number, w: number, h: number): void {
  for (let gx = Math.floor(x / CELL); gx <= Math.floor((x + w) / CELL); gx += 1) {
    for (let gy = Math.floor(y / CELL); gy <= Math.floor((y + h) / CELL); gy += 1) {
      const key = gx * 100_003 + gy;
      let list = grid.get(key);
      if (!list) grid.set(key, (list = []));
      list.push([x, y, w, h]);
    }
  }
}

/** Structural labels keep their kind's hue but lifted toward white, legible over bright light. */
function tint(hex: string): string {
  const v = parseInt(hex.slice(1), 16);
  const lift = (c: number): number => Math.round(c + (255 - c) * 0.6);
  return `rgb(${lift((v >> 16) & 255)},${lift((v >> 8) & 255)},${lift(v & 255)})`;
}
