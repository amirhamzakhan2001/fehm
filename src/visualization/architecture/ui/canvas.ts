import type { ArchNode, DiagramLayout, LayoutEdge, LayoutNode, Point, Rect } from "../../../architecture/types.js";

/**
 * SVG renderer and camera for a validated Layout IR. Geometry is drawn
 * exactly as validated; the only client-side adjustment is compressing text
 * the browser's font renders wider than the server measured, so a font
 * difference can never push text past its box.
 */

const NS = "http://www.w3.org/2000/svg";
const PAD_X: Record<string, number> = { pill: 22, hexagon: 30 };

export interface CanvasHandlers {
  selectNode(id: string, additive: boolean): void;
  selectEdge(id: string): void;
  open(id: string): void;
  clear(): void;
  zoomed(scale: number): void;
}

export interface ViewportState { x: number; y: number; scale: number }

interface Camera {
  x: number;
  y: number;
  w: number;
  h: number;
}

function el<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}, ...children: (SVGElement | string)[]): SVGElementTagNameMap[K] {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  for (const c of children) e.append(c);
  return e;
}

const reducedMotion = (): boolean => matchMedia("(prefers-reduced-motion: reduce)").matches;

export class DiagramCanvas {
  private layout: DiagramLayout | null = null;
  private cam: Camera = { x: 0, y: 0, w: 1000, h: 800 };
  private nodeEls = new Map<string, SVGGElement>();
  private edgeEls = new Map<string, SVGGElement>();
  private anim = 0;
  /** True until the user pans or zooms: resizes then keep the whole diagram in view. */
  private fitted = false;
  private fitFloor = 0;
  private readonly resizeObserver: ResizeObserver;

  constructor(
    private readonly svg: SVGSVGElement,
    private readonly handlers: CanvasHandlers,
    /** `modifier`: plain wheel scrolls the page; pinch or Ctrl/⌘+wheel zooms (diagrams embedded in a scrolling page). */
    private readonly options: { wheel?: "zoom" | "modifier"; initialMinScale?: number } = {},
  ) {
    this.bindPointer();
    this.resizeObserver = new ResizeObserver(() => (this.fitted ? this.fit(false, this.fitFloor) : this.applyCamera()));
    this.resizeObserver.observe(svg);
  }

  /** Hide a subset without changing validated geometry or deleting semantic relationships. */
  filter(visible: { nodes: Set<string>; edges: Set<string> } | null): void {
    for (const [elements, ids] of [[this.nodeEls, visible?.nodes], [this.edgeEls, visible?.edges]] as const) {
      for (const [id, element] of elements) {
        const hidden = !!ids && !ids.has(id);
        element.style.display = hidden ? "none" : "";
        if (hidden) element.dataset.filtered = "true";
        else delete element.dataset.filtered;
      }
    }
  }

  viewport(): ViewportState {
    return { x: this.cam.x + this.cam.w / 2, y: this.cam.y + this.cam.h / 2, scale: this.scale };
  }

  restoreViewport(saved: ViewportState): void {
    if (!Number.isFinite(saved.x + saved.y + saved.scale) || saved.scale <= 0) return;
    cancelAnimationFrame(this.anim);
    const r = this.svg.getBoundingClientRect();
    this.fitted = false;
    const w = r.width / saved.scale, h = r.height / saved.scale;
    this.cam = { x: saved.x - w / 2, y: saved.y - h / 2, w, h };
    this.applyCamera();
  }

  /** Fit the visible neighborhood without recomputing or moving validated geometry. */
  fitNodes(ids: Set<string>): void {
    const nodes = this.layout?.nodes.filter(n => ids.has(n.id)) ?? [];
    if (!nodes.length) return;
    const x = Math.min(...nodes.map(n => n.x)) - 55, y = Math.min(...nodes.map(n => n.y)) - 65;
    const width = Math.max(...nodes.map(n => n.x + n.width)) - x + 55;
    const height = Math.max(...nodes.map(n => n.y + n.height)) - y + 100;
    const r = this.svg.getBoundingClientRect();
    const scale = Math.max(this.options.initialMinScale ?? 0.75, Math.min(1, r.width / width, r.height / height));
    this.restoreViewport({ x: x + width / 2, y: y + height / 2, scale });
  }

  destroy(): void {
    this.resizeObserver.disconnect();
    cancelAnimationFrame(this.anim);
  }

  get scale(): number {
    const r = this.svg.getBoundingClientRect();
    return r.width ? r.width / this.cam.w : 1;
  }

  render(layout: DiagramLayout, nodes: Map<string, ArchNode>, options: { draft?: boolean } = {}): void {
    this.layout = layout;
    this.nodeEls.clear();
    this.edgeEls.clear();
    this.svg.replaceChildren();
    this.svg.classList.toggle("draft", Boolean(options.draft));
    const gb = el("g", { class: "boundaries" });
    for (const b of layout.boundaries) {
      gb.append(
        el(
          "g",
          { class: "boundary" },
          el("rect", { class: "frame", x: b.x, y: b.y, width: b.width, height: b.height, rx: 14 }),
          el("g", { class: "btitle" }, el("rect", { x: b.titleRect.x, y: b.titleRect.y, width: b.titleRect.width, height: b.titleRect.height, rx: 4 }), el("text", { x: b.titleRect.x + 6, y: b.titleRect.y + 13 }, b.title)),
        ),
      );
    }
    const gl = el("g", { class: "lifelines" });
    for (const l of layout.lifelines ?? []) gl.append(el("line", { class: "lifeline", x1: l.x, y1: l.y1, x2: l.x, y2: l.y2 }));
    const ge = el("g", { class: "edges" });
    for (const e of layout.edges) ge.append(this.edge(e, nodes));
    const gn = el("g", { class: "nodes" });
    // DOM order = reading order (row, then x): the keyboard tab order follows the diagram.
    for (const n of [...layout.nodes].sort((a, b) => a.layer - b.layer || a.x - b.x)) gn.append(this.node(n, nodes.get(n.id)));
    this.svg.append(gb, gl, ge, gn);
    this.fitText();
    this.fit(false, this.options.initialMinScale ?? 0);
  }

  private edge(e: LayoutEdge, nodes: Map<string, ArchNode>): SVGGElement {
    const d = roundedPath(e.points, 7);
    const ext = nodes.get(e.target)?.type === "external-system";
    const w = 1.3 + Math.min(2.2, Math.log2(e.weight + 1) * 0.42);
    const g = el("g", { class: `edge t-${e.type} c-${e.confidence}${ext ? " ext" : ""}${e.status ? ` s-${e.status}` : ""}${e.drift ? ` d-${e.drift}` : ""}`, "data-id": e.id });
    const line = el("path", { class: "line", d, "stroke-width": w.toFixed(2) });
    const last = e.points[e.points.length - 1]!;
    const prev = e.points[e.points.length - 2]!;
    const head = el("path", { class: "head", d: arrowHead(prev, last) });
    const hit = el("path", { class: "hit", d });
    g.append(hit, line, head);
    // Feature 3.4: the standing against the reference is also in words (hover and assistive tech), never colour alone.
    if (e.drift) g.append(el("title", {}, `${nodes.get(e.source)?.name ?? e.source} → ${nodes.get(e.target)?.name ?? e.target}: ${e.drift === "violation" ? "violates the reference architecture" : e.drift === "review" ? "needs review" : "allowed by the reference"} (${e.weight})`));
    if (e.label && Number.isFinite(e.label.x)) {
      g.append(el("g", { class: "lbl" }, el("rect", { x: e.label.x, y: e.label.y, width: e.label.width, height: e.label.height, rx: 4 }), el("text", { x: e.label.x + e.label.width / 2, y: e.label.y + 12, "text-anchor": "middle", "data-maxw": e.label.width - 8 }, e.label.text)));
    }
    g.setAttribute("tabindex", "0");
    g.setAttribute("role", "button");
    g.setAttribute("aria-label", `${nodes.get(e.source)?.name ?? e.source} to ${nodes.get(e.target)?.name ?? e.target}: ${e.label?.text ?? e.type}, ${e.confidence}`);
    g.addEventListener("click", (ev) => {
      ev.stopPropagation();
      this.handlers.selectEdge(e.id);
    });
    g.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); ev.stopPropagation(); this.handlers.selectEdge(e.id); }
    });
    this.edgeEls.set(e.id, g);
    return g;
  }

  private node(n: LayoutNode, sem: ArchNode | undefined): SVGGElement {
    const conf = sem?.role.confidence ?? "unknown";
    const g = el("g", {
      class: `node t-${n.type}${n.context ? " context" : ""}${n.status ? ` s-${n.status}` : ""}`,
      transform: `translate(${n.x} ${n.y})`,
      tabindex: 0,
      role: "button",
      "data-id": n.id,
      "aria-label": `${sem?.name ?? n.lines.join(" ")}, ${n.tag}, ${conf} evidence${n.status && n.status !== "unchanged" ? `, ${n.status}` : ""}${n.expandable ? ", can be opened" : ""}${n.context ? ", outside this component" : ""}`,
    });
    const cap = n.shape === "cylinder" ? 9 : 0;
    if (n.expandable) g.append(el("rect", { class: "shape stack", x: 4, y: 4, width: n.width, height: n.height, rx: 10 }));
    if (n.shape === "cylinder") {
      const rx = n.width / 2;
      g.append(el("path", { class: "shape", d: `M0 ${cap}A${rx} ${cap} 0 0 1 ${n.width} ${cap}V${n.height - cap}A${rx} ${cap} 0 0 1 0 ${n.height - cap}Z` }), el("path", { class: "shape rim", d: `M0 ${cap}A${rx} ${cap} 0 0 0 ${n.width} ${cap}`, fill: "none" }));
    } else if (n.shape === "hexagon") {
      const k = Math.min(16, n.height / 2);
      g.append(el("path", { class: "shape", d: `M${k} 0H${n.width - k}L${n.width} ${n.height / 2}L${n.width - k} ${n.height}H${k}L0 ${n.height / 2}Z` }));
    } else g.append(el("rect", { class: "shape", width: n.width, height: n.height, rx: n.shape === "pill" ? n.height / 2 : n.shape === "rounded" ? 18 : 10 }));
    if (n.shape === "box") g.append(el("rect", { class: "band", x: 12, y: 0, width: n.width - 24, height: 2.5, rx: 1 }));
    const cx = n.width / 2;
    const maxw = n.width - 2 * (PAD_X[n.shape] ?? 14);
    let y = 10 + cap + 10;
    g.append(el("text", { class: "tag", x: cx, y, "text-anchor": "middle", "data-maxw": maxw }, n.tag));
    y += 3 + 13;
    const title = el("text", { class: "title", x: cx, y, "text-anchor": "middle" });
    n.lines.forEach((line, i) => title.append(el("tspan", { x: cx, dy: i ? 17 : 0, "data-maxw": maxw }, line)));
    g.append(title);
    y += (n.lines.length - 1) * 17;
    if (n.subtitle) g.append(el("text", { class: "sub", x: cx, y: y + 15, "text-anchor": "middle", "data-maxw": maxw }, n.subtitle));
    g.append(el("circle", { class: `conf ${conf}`, cx: n.width - 11, cy: 11 + cap, r: 3.5 }, el("title", {}, `${conf} evidence`)));
    g.append(el("title", {}, `${sem?.name ?? n.lines.join(" ")}${sem?.description ? `\n${sem.description}` : ""}`));
    g.addEventListener("click", (ev) => {
      ev.stopPropagation();
      this.handlers.selectNode(n.id, ev.shiftKey);
    });
    g.addEventListener("dblclick", (ev) => {
      ev.stopPropagation();
      if (n.expandable) this.handlers.open(n.id);
    });
    g.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter" || ev.key === " ") {
        ev.preventDefault();
        if (ev.shiftKey && n.expandable) this.handlers.open(n.id);
        else this.handlers.selectNode(n.id, false);
      } else if (ev.key.startsWith("Arrow")) {
        ev.preventDefault();
        this.moveFocus(n, ev.key);
      }
    });
    this.nodeEls.set(n.id, g);
    return g;
  }

  /** Spatial keyboard navigation: the nearest node in the arrow's direction. */
  private moveFocus(from: LayoutNode, key: string): void {
    if (!this.layout) return;
    const c = (n: LayoutNode): Point => ({ x: n.x + n.width / 2, y: n.y + n.height / 2 });
    const o = c(from);
    const dir = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] }[key] as [number, number] | undefined;
    if (!dir) return;
    let best: LayoutNode | undefined;
    let bestScore = Infinity;
    for (const n of this.layout.nodes) {
      if (n === from) continue;
      const p = c(n);
      const along = (p.x - o.x) * dir[0] + (p.y - o.y) * dir[1];
      if (along <= 1) continue;
      const across = Math.abs((p.x - o.x) * dir[1] - (p.y - o.y) * dir[0]);
      const score = along + across * 2;
      if (score < bestScore) (bestScore = score), (best = n);
    }
    if (best) {
      this.nodeEls.get(best.id)?.focus();
      this.ensureVisible(best);
    }
  }

  /** Compress any text the browser renders wider than the server measured. */
  private fitText(): void {
    for (const t of this.svg.querySelectorAll<SVGTextContentElement>("[data-maxw]")) {
      const max = Number(t.getAttribute("data-maxw"));
      try {
        if (t.getComputedTextLength() > max) {
          t.setAttribute("textLength", String(max));
          t.setAttribute("lengthAdjust", "spacingAndGlyphs");
        }
      } catch {
        // not rendered (hidden frame); the server measurement already has a safety margin
      }
    }
  }

  // ─── selection / highlighting ─────────────────────────────────────

  mark(selected: { kind: "node" | "edge"; id: string } | null, visible: { nodes: Set<string>; edges: Set<string> } | null): void {
    for (const [id, g] of this.nodeEls) {
      g.classList.toggle("sel", selected?.kind === "node" && selected.id === id);
      g.classList.toggle("dim", Boolean(visible && !visible.nodes.has(id)));
      g.classList.toggle("hl", Boolean(visible && visible.nodes.has(id) && !(selected?.kind === "node" && selected.id === id)));
    }
    for (const [id, g] of this.edgeEls) {
      g.classList.toggle("sel", selected?.kind === "edge" && selected.id === id);
      g.classList.toggle("dim", Boolean(visible && !visible.edges.has(id)));
      g.classList.toggle("hl", Boolean(visible && visible.edges.has(id)));
    }
  }

  focusNode(id: string): void {
    this.nodeEls.get(id)?.focus({ preventScroll: true });
  }

  has(id: string): boolean {
    return this.nodeEls.has(id);
  }

  // ─── camera ───────────────────────────────────────────────────────

  private applyCamera(): void {
    const r = this.svg.getBoundingClientRect();
    if (!r.width || !r.height) return;
    // Keep the aspect of the element: the camera width decides the scale.
    this.cam.h = this.cam.w * (r.height / r.width);
    this.svg.setAttribute("viewBox", `${this.cam.x} ${this.cam.y} ${this.cam.w} ${this.cam.h}`);
    const s = r.width / this.cam.w;
    this.svg.classList.toggle("z-low", s < 0.55);
    this.svg.classList.toggle("z-min", s < 0.32);
    this.handlers.zoomed(s);
  }

  private animateTo(target: Camera, animate: boolean): void {
    cancelAnimationFrame(this.anim);
    if (!animate || reducedMotion()) {
      this.cam = { ...target };
      this.applyCamera();
      return;
    }
    const from = { ...this.cam };
    const start = performance.now();
    const step = (t: number): void => {
      const k = Math.min(1, (t - start) / 260);
      const e = 1 - (1 - k) ** 3;
      this.cam = { x: from.x + (target.x - from.x) * e, y: from.y + (target.y - from.y) * e, w: from.w + (target.w - from.w) * e, h: from.h + (target.h - from.h) * e };
      this.applyCamera();
      if (k < 1) this.anim = requestAnimationFrame(step);
    };
    this.anim = requestAnimationFrame(step);
  }

  /** Fit all geometry (the validated viewBox) plus padding; never enlarge past 1:1 for small diagrams. */
  fit(animate = true, minimumScale = 0): void {
    if (!this.layout) return;
    const r = this.svg.getBoundingClientRect();
    const vb = this.layout.viewBox;
    const aspect = r.width && r.height ? r.height / r.width : 0.75;
    let w = Math.max(vb.width, vb.height / aspect);
    const minW = r.width || vb.width;
    if (w < minW) w = minW;
    const cropped = minimumScale > 0 && r.width > 0 && r.width / w < minimumScale;
    if (cropped) w = r.width / minimumScale;
    const h = w * aspect;
    this.fitFloor = minimumScale;
    this.fitted = true;
    this.animateTo({ x: cropped ? vb.x : vb.x + vb.width / 2 - w / 2, y: cropped ? vb.y : vb.y + vb.height / 2 - h / 2, w, h }, animate);
  }

  /** 1:1, anchored at the diagram's top-left. */
  reset(): void {
    if (!this.layout) return;
    this.fitted = false;
    const r = this.svg.getBoundingClientRect();
    const vb = this.layout.viewBox;
    const w = r.width || vb.width;
    this.animateTo({ x: vb.width < w ? vb.x + vb.width / 2 - w / 2 : vb.x, y: vb.y, w, h: w * (r.height / (r.width || 1)) }, true);
  }

  zoomBy(factor: number, at?: Point): void {
    this.fitted = false;
    const p = at ?? { x: this.cam.x + this.cam.w / 2, y: this.cam.y + this.cam.h / 2 };
    const r = this.svg.getBoundingClientRect();
    const minW = (r.width || 1000) / 3;
    const maxW = Math.max((r.width || 1000) * 12, (this.layout?.viewBox.width ?? 0) * 1.6);
    const w = Math.min(maxW, Math.max(minW, this.cam.w / factor));
    const k = w / this.cam.w;
    this.cam = { x: p.x - (p.x - this.cam.x) * k, y: p.y - (p.y - this.cam.y) * k, w, h: this.cam.h * k };
    this.applyCamera();
  }

  /** Center a node, zooming in to at least readable size. */
  center(id: string): void {
    const n = this.layout?.nodes.find((x) => x.id === id);
    if (!n) return;
    this.fitted = false;
    const r = this.svg.getBoundingClientRect();
    const readable = (r.width || 1000) / 0.9;
    const w = Math.min(this.cam.w, readable);
    const h = w * (r.height / (r.width || 1));
    this.animateTo({ x: n.x + n.width / 2 - w / 2, y: n.y + n.height / 2 - h / 2, w, h }, true);
  }

  private ensureVisible(n: Rect): void {
    const inside = n.x >= this.cam.x && n.y >= this.cam.y && n.x + n.width <= this.cam.x + this.cam.w && n.y + n.height <= this.cam.y + this.cam.h;
    if (!inside) this.animateTo({ ...this.cam, x: n.x + n.width / 2 - this.cam.w / 2, y: n.y + n.height / 2 - this.cam.h / 2 }, true);
  }

  private toDiagram(clientX: number, clientY: number): Point {
    const r = this.svg.getBoundingClientRect();
    return { x: this.cam.x + ((clientX - r.left) / r.width) * this.cam.w, y: this.cam.y + ((clientY - r.top) / r.height) * this.cam.h };
  }

  private bindPointer(): void {
    let drag: { x: number; y: number; cam: Camera; moved: boolean; id: number } | null = null;
    this.svg.addEventListener("pointerdown", (ev) => {
      if (ev.button !== 0 || (ev.target as Element).closest(".node, .edge")) return;
      drag = { x: ev.clientX, y: ev.clientY, cam: { ...this.cam }, moved: false, id: ev.pointerId };
      this.svg.setPointerCapture(ev.pointerId);
    });
    this.svg.addEventListener("pointermove", (ev) => {
      if (!drag || ev.pointerId !== drag.id) return;
      const dx = ev.clientX - drag.x;
      const dy = ev.clientY - drag.y;
      if (!drag.moved && Math.abs(dx) + Math.abs(dy) < 4) return;
      drag.moved = true;
      this.fitted = false;
      this.svg.classList.add("panning");
      const r = this.svg.getBoundingClientRect();
      this.cam = { ...drag.cam, x: drag.cam.x - (dx / r.width) * drag.cam.w, y: drag.cam.y - (dy / r.height) * drag.cam.h };
      this.applyCamera();
    });
    const end = (ev: PointerEvent): void => {
      if (!drag || ev.pointerId !== drag.id) return;
      if (!drag.moved) this.handlers.clear();
      drag = null;
      this.svg.classList.remove("panning");
    };
    this.svg.addEventListener("pointerup", end);
    this.svg.addEventListener("pointercancel", end);
    this.svg.addEventListener(
      "wheel",
      (ev) => {
        if (this.options.wheel === "modifier" && !ev.ctrlKey && !ev.metaKey) return;
        ev.preventDefault();
        const factor = Math.exp(-ev.deltaY * (ev.ctrlKey ? 0.01 : 0.0022));
        this.zoomBy(factor, this.toDiagram(ev.clientX, ev.clientY));
      },
      { passive: false },
    );
  }
}

/** Orthogonal polyline with rounded corners (radius limited by segment lengths). */
function roundedPath(pts: Point[], radius: number): string {
  if (pts.length < 2) return "";
  let d = `M${pts[0]!.x} ${pts[0]!.y}`;
  for (let i = 1; i < pts.length - 1; i += 1) {
    const p = pts[i - 1]!;
    const c = pts[i]!;
    const n = pts[i + 1]!;
    const lin = Math.hypot(c.x - p.x, c.y - p.y);
    const lout = Math.hypot(n.x - c.x, n.y - c.y);
    const r = Math.min(radius, lin / 2, lout / 2);
    const a = { x: c.x - ((c.x - p.x) / lin) * r, y: c.y - ((c.y - p.y) / lin) * r };
    const b = { x: c.x + ((n.x - c.x) / lout) * r, y: c.y + ((n.y - c.y) / lout) * r };
    d += `L${a.x} ${a.y}Q${c.x} ${c.y} ${b.x} ${b.y}`;
  }
  const last = pts[pts.length - 1]!;
  const prev = pts[pts.length - 2]!;
  // Stop the line under the arrowhead.
  const len = Math.hypot(last.x - prev.x, last.y - prev.y) || 1;
  const cut = Math.min(6, len / 2);
  d += `L${last.x - ((last.x - prev.x) / len) * cut} ${last.y - ((last.y - prev.y) / len) * cut}`;
  return d;
}

function arrowHead(prev: Point, tip: Point): string {
  const len = Math.hypot(tip.x - prev.x, tip.y - prev.y) || 1;
  const ux = (tip.x - prev.x) / len;
  const uy = (tip.y - prev.y) / len;
  const L = 8;
  const W = 4.2;
  const bx = tip.x - ux * L;
  const by = tip.y - uy * L;
  return `M${tip.x} ${tip.y}L${bx - uy * W} ${by + ux * W}L${bx + uy * W} ${by - ux * W}Z`;
}
