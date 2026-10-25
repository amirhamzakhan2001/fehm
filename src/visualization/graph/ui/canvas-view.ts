import { Camera } from "./camera.js";
import type { Bounds, GraphModel } from "./graph-model.js";
import { LabelLayer } from "./labels.js";
import { GraphRenderer } from "./renderer.js";
import { SpatialIndex } from "./spatial.js";
import type { GraphStore, StateKey } from "./store.js";
import { computeVisibility, computeVisualState, PRIMARY, type Visibility, type VisualState } from "./visual-state.js";

export interface CanvasCallbacks {
  /** Pointer moved over a node (or off one, i = -1). Screen coords relative to the stage. */
  hover(i: number, sx: number, sy: number): void;
  /** The visible-node count or zoom changed (for the HUD). */
  view(info: { visible: number; visibleEdges: number; zoom: number; fitZoom: number }): void;
}

const PULSE_MS = 420;
/** Closest zoom used when framing a single entity. */
const FOCUS_MAX_ZOOM = 9;

/**
 * Owns the render loop. Store changes recompute visual state (filters →
 * visibility, selection/hover/search → focus) and upload it; camera motion
 * only redraws. Frames are drawn on demand, not continuously.
 */
export class GraphCanvas {
  readonly camera = new Camera();
  private readonly renderer: GraphRenderer;
  private readonly labels: LabelLayer;
  private model: GraphModel | undefined;
  private index: SpatialIndex | undefined;
  private visibility: Visibility | undefined;
  private visual: VisualState | undefined;
  private frame = 0;
  private pulseStart = -Infinity;
  private lastHud = "";
  private drag: { id: number; x: number; y: number; moved: boolean } | null = null;
  private pendingHover: { x: number; y: number } | null = null;

  constructor(
    private readonly stage: HTMLElement,
    private readonly glCanvas: HTMLCanvasElement,
    labelCanvas: HTMLCanvasElement,
    private readonly store: GraphStore,
    private readonly callbacks: CanvasCallbacks,
  ) {
    this.renderer = new GraphRenderer(glCanvas);
    this.labels = new LabelLayer(labelCanvas);
    new ResizeObserver(() => this.resize()).observe(stage);
    this.resize();
    store.subscribe((changed) => this.onState(changed));
    this.bindPointer();
  }

  setModel(model: GraphModel): void {
    this.model = model;
    this.index = new SpatialIndex(model);
    const fit = this.camera.fitZoom(model.bounds, 48);
    this.renderer.setModel(model, fit);
    // Generous limits: whole project at the far end, individual symbols at the near end.
    this.camera.minZoom = fit * 0.25;
    this.camera.maxZoom = 60;
    this.recomputeVisibility();
  }

  get currentVisibility(): Visibility | undefined {
    return this.visibility;
  }

  get currentVisual(): VisualState | undefined {
    return this.visual;
  }

  fitAll(animate = true): void {
    const model = this.model;
    if (!model) return;
    const vis = this.visibility;
    const primary: number[] = [];
    if (vis) for (let i = 0; i < model.n; i += 1) if (vis.node[i] === PRIMARY) primary.push(i);
    this.fitBounds((primary.length ? model.boundsOf(primary) : undefined) ?? model.bounds, animate);
  }

  /** Frame a node with its direct relationships (and contents, for containers). */
  fitNode(i: number, animate = true): void {
    const model = this.model;
    if (!model || i < 0) return;
    const set = new Set<number>([i]);
    for (const d of model.descendants(i).slice(0, 20_000)) set.add(d);
    const related = this.store.state.selected === i && this.visual ? this.visual.related : [];
    // Include relationships only when they don't blow the frame up to the whole project.
    const local = model.boundsOf(set)!;
    const withRelated = model.boundsOf([...set, ...related.slice(0, 400)])!;
    const span = (b: Bounds): number => Math.max(b.maxX - b.minX, b.maxY - b.minY);
    const total = span(model.bounds);
    const chosen = span(withRelated) < total * 0.6 ? withRelated : local;
    this.fitBounds(chosen, animate, FOCUS_MAX_ZOOM);
  }

  /** Select, centre and frame a node. */
  focusNode(i: number): void {
    this.store.set({ selected: i });
    // Visual state (and thus `related`) is recomputed on the next microtask.
    queueMicrotask(() => this.fitNode(i));
  }

  zoomBy(factor: number): void {
    this.camera.zoomAt(this.camera.width / 2, this.camera.height / 2, factor);
    this.request();
  }

  setCamera(cx: number, cy: number, zoom: number): void {
    this.camera.set(cx, cy, zoom);
    this.request();
  }

  request(): void {
    if (!this.frame) this.frame = requestAnimationFrame((t) => this.draw(t));
  }

  private fitBounds(bounds: Bounds, animate: boolean, maxZoom?: number): void {
    this.camera.fit(bounds, performance.now(), { animate, paddingPx: 56, ...(maxZoom ? { maxZoom } : {}) });
    this.request();
  }

  private onState(changed: ReadonlySet<StateKey>): void {
    if (!this.model) return;
    if (changed.has("activeNodeKinds") || changed.has("activeEdgeKinds")) this.recomputeVisibility();
    else if (changed.has("selected") || changed.has("hovered") || changed.has("searchMatches")) this.recomputeVisual();
    if (changed.has("selected") && this.store.state.selected >= 0) this.pulseStart = performance.now();
    this.request();
  }

  private recomputeVisibility(): void {
    const model = this.model!;
    const s = this.store.state;
    this.visibility = computeVisibility(model, { nodeKinds: s.activeNodeKinds, edgeKinds: s.activeEdgeKinds });
    this.recomputeVisual();
  }

  private recomputeVisual(): void {
    const s = this.store.state;
    this.visual = computeVisualState(this.model!, this.visibility!, { selected: s.selected, hovered: s.hovered, matches: s.searchMatches });
    this.renderer.setVisualState(this.visual);
  }

  private resize(): void {
    const rect = this.stage.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const [cx, cy] = [this.camera.cx, this.camera.cy];
    this.camera.resize(rect.width, rect.height);
    this.camera.cx = cx;
    this.camera.cy = cy;
    this.renderer.resize(rect.width, rect.height, dpr);
    this.labels.resize(rect.width, rect.height, dpr);
    this.request();
  }

  private draw(now: number): void {
    this.frame = 0;
    const moving = this.camera.step(now);
    const t = (now - this.pulseStart) / PULSE_MS;
    const pulse = t >= 0 && t < 1 ? 1 - t * t : 0;
    this.renderer.render(this.camera, pulse);
    const model = this.model;
    if (model && this.visual && this.index) {
      const s = this.store.state;
      this.labels.draw(model, this.camera, this.index, this.visual, s.selected, s.hovered, s.labels);
      const hud = `${this.visibility!.primaryCount}|${this.visibility!.edgeCount}|${this.camera.zoom.toPrecision(3)}`;
      if (hud !== this.lastHud) {
        this.lastHud = hud;
        this.callbacks.view({
          visible: this.visibility!.primaryCount,
          visibleEdges: this.visibility!.edgeCount,
          zoom: this.camera.zoom,
          fitZoom: this.camera.fitZoom(model.bounds, 48),
        });
      }
    }
    if (moving || pulse > 0 || this.camera.animating) this.request();
  }

  private pick(sx: number, sy: number): number {
    if (!this.index || !this.visibility) return -1;
    const [wx, wy] = this.camera.toWorld(sx, sy);
    const vis = this.visibility.node;
    return this.index.pick(wx, wy, this.camera.zoom, (i) => vis[i] === PRIMARY);
  }

  private bindPointer(): void {
    const c = this.glCanvas;
    const local = (e: MouseEvent): [number, number] => {
      const r = c.getBoundingClientRect();
      return [e.clientX - r.left, e.clientY - r.top];
    };
    c.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      c.setPointerCapture(e.pointerId);
      const [x, y] = local(e);
      this.drag = { id: e.pointerId, x, y, moved: false };
    });
    c.addEventListener("pointermove", (e) => {
      const [x, y] = local(e);
      const d = this.drag;
      if (d && d.id === e.pointerId) {
        if (!d.moved && Math.hypot(x - d.x, y - d.y) < 4) return;
        if (!d.moved) {
          d.moved = true;
          c.classList.add("dragging");
          this.setHover(-1, x, y);
        }
        this.camera.panBy(x - d.x, y - d.y);
        d.x = x;
        d.y = y;
        this.request();
        return;
      }
      // Hover picking at most once per frame.
      if (!this.pendingHover) {
        requestAnimationFrame(() => {
          const p = this.pendingHover;
          this.pendingHover = null;
          if (p && !this.drag) this.setHover(this.pick(p.x, p.y), p.x, p.y);
        });
      }
      this.pendingHover = { x, y };
    });
    const end = (e: PointerEvent): void => {
      const d = this.drag;
      if (!d || d.id !== e.pointerId) return;
      this.drag = null;
      c.classList.remove("dragging");
      if (!d.moved && e.type === "pointerup") {
        const [x, y] = local(e);
        const hit = this.pick(x, y);
        // Clicking empty canvas clears the selection; the graph itself is untouched.
        this.store.set({ selected: hit, searchMatches: null });
      }
    };
    c.addEventListener("pointerup", end);
    c.addEventListener("pointercancel", end);
    c.addEventListener("pointerleave", () => {
      if (!this.drag) this.setHover(-1, 0, 0);
    });
    c.addEventListener("dblclick", (e) => {
      const [x, y] = local(e);
      const hit = this.pick(x, y);
      if (hit >= 0) this.focusNode(hit);
      else this.camera.zoomAt(x, y, 2.2);
      this.request();
    });
    c.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        const [x, y] = local(e);
        const scale = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
        // Two-finger trackpad swipes pan; wheels and pinches (ctrlKey) zoom around the cursor.
        if (!e.ctrlKey && e.deltaMode === 0 && Math.abs(e.deltaX) > Math.abs(e.deltaY) * 0.5 && Math.abs(e.deltaX) > 0.5) {
          this.camera.panBy(-e.deltaX, -e.deltaY);
        } else {
          const k = e.ctrlKey ? 0.01 : 0.0022;
          this.camera.zoomAt(x, y, Math.exp(-e.deltaY * scale * k));
        }
        this.request();
      },
      { passive: false },
    );
  }

  private setHover(i: number, sx: number, sy: number): void {
    this.glCanvas.classList.toggle("pointing", i >= 0);
    if (this.store.state.hovered !== i) this.store.set({ hovered: i });
    this.callbacks.hover(i, sx, sy);
  }
}
