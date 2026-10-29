import { EDGE_STYLES, edgeStyle, NODE_STYLES, nodeStyle } from "../model.js";
import { $, fmt, h, nodes } from "./dom.js";
import type { GraphModel } from "./graph-model.js";
import type { GraphStore } from "./store.js";

/** Short counts keep two filters per row readable ("1.1K"); the exact count is in the tooltip. */
const compact = new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 });

export interface SidebarActions {
  focus(i: number): void;
  relayout(): void;
}

/** Canonical order: known kinds first (hierarchy order), then any new kinds alphabetically. */
function ordered(present: Iterable<string>, known: readonly string[]): string[] {
  const set = new Set(present);
  return [...known.filter((k) => set.has(k)), ...[...set].filter((k) => !known.includes(k)).sort()];
}

export class Sidebar {
  private model: GraphModel | undefined;
  private readonly rows = new Map<number, HTMLElement>();
  private readonly expanded = new Set<number>();

  constructor(
    private readonly store: GraphStore,
    private readonly actions: SidebarActions,
  ) {
    $("nodes-all").addEventListener("click", () => this.toggleAll("activeNodeKinds"));
    $("edges-all").addEventListener("click", () => this.toggleAll("activeEdgeKinds"));
    store.subscribe((changed) => {
      if (changed.has("activeNodeKinds") || changed.has("activeEdgeKinds")) this.renderFilters();
      if (changed.has("selected")) this.revealSelection();
    });
  }

  setModel(model: GraphModel): void {
    this.model = model;
    this.rows.clear();
    this.renderFilters();
    this.renderTree();
    this.renderStats();
    this.revealSelection();
  }

  renderStats(visible?: number, visibleEdges?: number): void {
    const model = this.model;
    if (!model) return;
    const p = model.payload;
    const layout = p.layout.mode === "cached" ? "cached" : `${p.layout.mode}, ${fmt.format(p.layout.placed)} placed`;
    const relayout = h(
      "button",
      { type: "button", title: "Discard the saved layout and compute a fresh one", onclick: () => this.actions.relayout() },
      "Re-layout",
    );
    $("side-stats").replaceChildren(
      ...nodes(
        h("span", {}, h("b", {}, fmt.format(p.stats.nodes)), " nodes"),
        h("span", {}, h("b", {}, fmt.format(p.stats.edges)), " edges"),
        h("span", {}, h("b", {}, fmt.format(p.stats.directories)), " folders"),
        h("span", {}, h("b", {}, fmt.format(p.stats.files)), " files"),
        visible === undefined ? null : h("span", {}, h("b", {}, fmt.format(visible)), " visible"),
        visibleEdges === undefined ? null : h("span", {}, h("b", {}, fmt.format(visibleEdges)), " links shown"),
        h("span", { class: "full" }, `index ${p.sync.mode} · layout ${layout}`),
        h("span", { class: "full" }, relayout),
      ),
    );
  }

  private toggleAll(key: "activeNodeKinds" | "activeEdgeKinds"): void {
    const model = this.model;
    if (!model) return;
    const all = key === "activeNodeKinds" ? [...model.nodeKindCounts.keys()] : [...model.edgeKindCounts.keys()];
    const active = this.store.state[key];
    const everyOn = all.every((k) => active.has(k));
    this.store.set({ [key]: new Set(everyOn ? [] : all) });
  }

  private renderFilters(): void {
    const model = this.model;
    if (!model) return;
    const s = this.store.state;
    const nodeKinds = ordered(model.nodeKindCounts.keys(), Object.keys(NODE_STYLES));
    $("node-filters").replaceChildren(
      ...nodeKinds.map((kind) => {
        const style = nodeStyle(kind);
        const on = s.activeNodeKinds.has(kind);
        const sw = h("span", { class: "sw node", style: `--c:${style.color}` });
        return this.filterRow(on, sw, style.label, model.nodeKindCounts.get(kind) ?? 0, () => {
          const next = new Set(s.activeNodeKinds);
          if (on) next.delete(kind);
          else next.add(kind);
          this.store.set({ activeNodeKinds: next });
        });
      }),
    );
    const edgeKinds = ordered(model.edgeKindCounts.keys(), Object.keys(EDGE_STYLES));
    $("edge-filters").replaceChildren(
      ...edgeKinds.map((kind) => {
        const style = edgeStyle(kind);
        const on = s.activeEdgeKinds.has(kind);
        const sw = h("span", { class: "sw edge", style: `background:${style.color}` });
        return this.filterRow(on, sw, style.label, model.edgeKindCounts.get(kind) ?? 0, () => {
          const next = new Set(s.activeEdgeKinds);
          if (on) next.delete(kind);
          else next.add(kind);
          this.store.set({ activeEdgeKinds: next });
        });
      }),
    );
  }

  private filterRow(on: boolean, swatch: HTMLElement, label: string, count: number, toggle: () => void): HTMLElement {
    const input = h("input", { type: "checkbox", onchange: toggle });
    input.checked = on;
    // The swatch doubles as the on/off indicator (hollow when off); the native
    // checkbox stays in the DOM for keyboard and screen-reader use.
    return h(
      "label",
      { class: `filter${on ? "" : " off"}`, title: `${label} · ${fmt.format(count)}${on ? "" : " (hidden)"}` },
      input,
      swatch,
      h("span", { class: "name" }, label),
      h("span", { class: "n" }, compact.format(count)),
    );
  }

  /** Folder/file tree; children render lazily on expand so huge projects stay cheap. */
  private renderTree(): void {
    const model = this.model!;
    const tree = $("tree");
    const roots: number[] = [];
    for (let i = 0; i < model.n; i += 1) if (model.parent[i] === -1) roots.push(i);
    tree.replaceChildren();
    for (const r of roots) {
      if (model.kindOf(r) === "repository") {
        this.expanded.add(r);
        tree.append(this.treeNode(r, 0));
      } else if (isTreeKind(model.kindOf(r))) tree.append(this.treeNode(r, 0));
    }
  }

  private treeNode(i: number, depth: number): HTMLElement {
    const model = this.model!;
    const kind = model.kindOf(i);
    const kids = this.treeChildren(i);
    const open = this.expanded.has(i);
    const twisty = h("span", { class: "tw" }, kids.length ? (open ? "▾" : "▸") : "");
    const row = h(
      "div",
      {
        class: `row ${kind === "file" ? "file" : "dir"}`,
        role: "treeitem",
        style: `padding-left:${4 + depth * 12}px`,
        title: model.path(i) ?? model.names[i]!,
      },
      twisty,
      h("span", { class: "nm" }, kind === "repository" ? model.payload.project : model.names[i]!),
    );
    if (kids.length) row.setAttribute("aria-expanded", String(open));
    const wrap = h("div", {}, row);
    const childBox = h("div", { role: "group" });
    if (open) for (const k of kids) childBox.append(this.treeNode(k, depth + 1));
    wrap.append(childBox);
    twisty.addEventListener("click", (e) => {
      e.stopPropagation();
      this.toggle(i, childBox, twisty, row, depth);
    });
    row.addEventListener("click", () => this.actions.focus(i));
    row.addEventListener("dblclick", () => this.toggle(i, childBox, twisty, row, depth));
    this.rows.set(i, row);
    return wrap;
  }

  private toggle(i: number, box: HTMLElement, twisty: HTMLElement, row: HTMLElement, depth: number): void {
    const kids = this.treeChildren(i);
    if (!kids.length) return;
    if (this.expanded.has(i)) {
      this.expanded.delete(i);
      box.replaceChildren();
    } else {
      this.expanded.add(i);
      box.replaceChildren(...kids.map((k) => this.treeNode(k, depth + 1)));
    }
    twisty.textContent = this.expanded.has(i) ? "▾" : "▸";
    row.setAttribute("aria-expanded", String(this.expanded.has(i)));
  }

  private treeChildren(i: number): number[] {
    const model = this.model!;
    return [...model.children(i)]
      .filter((c) => isTreeKind(model.kindOf(c)))
      .sort((a, b) => model.rank[a]! - model.rank[b]! || (model.names[a]! < model.names[b]! ? -1 : 1));
  }

  /** Highlight the selection's folder/file in the tree, expanding the path to it. */
  private revealSelection(): void {
    const model = this.model;
    if (!model) return;
    for (const row of this.rows.values()) row.removeAttribute("aria-selected");
    const sel = this.store.state.selected;
    if (sel < 0) return;
    let target = sel;
    while (target >= 0 && !isTreeKind(model.kindOf(target))) target = model.parent[target]!;
    if (target < 0) return;
    const chain = [target, ...model.ancestors(target)].reverse();
    for (const a of chain.slice(0, -1)) {
      if (this.expanded.has(a)) continue;
      const row = this.rows.get(a);
      const wrap = row?.parentElement;
      const box = wrap?.lastElementChild as HTMLElement | null | undefined;
      if (row && box) this.toggle(a, box, row.firstElementChild as HTMLElement, row, depthOf(row));
    }
    const row = this.rows.get(target);
    if (row) {
      row.setAttribute("aria-selected", "true");
      row.scrollIntoView({ block: "nearest" });
    }
  }
}

function isTreeKind(kind: string): boolean {
  return kind === "repository" || kind === "directory" || kind === "file";
}

function depthOf(row: HTMLElement): number {
  return Math.max(0, Math.round((parseFloat(row.style.paddingLeft) - 4) / 12));
}
