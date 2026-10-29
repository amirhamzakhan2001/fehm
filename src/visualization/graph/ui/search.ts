import type { GraphSearchHit } from "../model.js";
import { nodeStyle } from "../model.js";
import { api } from "./api.js";
import { $, h } from "./dom.js";
import type { GraphModel } from "./graph-model.js";
import type { GraphStore } from "./store.js";
import { PRIMARY, type Visibility } from "./visual-state.js";

interface Row {
  i: number;
  hit: GraphSearchHit;
  outside: boolean;
}

/**
 * Search goes through the Feature 1 index (never a source scan). Results
 * inside the active filters come first; matches hidden by filters are listed
 * separately so nothing is silently missing. Picking a result selects it on
 * the full graph — the rest of the codebase stays in view.
 */
export class Search {
  private readonly input = $("search") as HTMLInputElement;
  private readonly list = $("results");
  private model: GraphModel | undefined;
  private rows: Row[] = [];
  private active = -1;
  private timer = 0;
  private controller: AbortController | undefined;

  constructor(
    private readonly store: GraphStore,
    private readonly visibility: () => Visibility | undefined,
    private readonly choose: (i: number) => void,
  ) {
    this.input.addEventListener("input", () => {
      clearTimeout(this.timer);
      this.timer = window.setTimeout(() => void this.run(), 140);
    });
    this.input.addEventListener("keydown", (e) => this.key(e));
    this.input.addEventListener("focus", () => {
      if (this.rows.length || this.input.value.trim()) this.list.hidden = false;
    });
    document.addEventListener("pointerdown", (e) => {
      if (!(e.target instanceof Node) || !$("side").contains(e.target)) this.list.hidden = true;
    });
  }

  setModel(model: GraphModel): void {
    this.model = model;
    if (this.input.value.trim()) void this.run();
  }

  focus(): void {
    this.input.focus();
    this.input.select();
  }

  clear(): void {
    this.input.value = "";
    this.rows = [];
    this.list.hidden = true;
    this.store.set({ searchQuery: "", searchMatches: null });
  }

  private async run(): Promise<void> {
    const q = this.input.value.trim();
    this.controller?.abort();
    if (!q || !this.model) {
      this.rows = [];
      this.list.hidden = true;
      this.store.set({ searchQuery: "", searchMatches: null });
      return;
    }
    const controller = (this.controller = new AbortController());
    let hits: GraphSearchHit[];
    try {
      hits = await api.search(q, controller.signal);
    } catch (error) {
      if (controller.signal.aborted) return;
      this.list.replaceChildren(h("div", { class: "results-note" }, `Search failed: ${(error as Error).message}`));
      this.list.hidden = false;
      return;
    }
    if (controller.signal.aborted) return;
    const model = this.model;
    const vis = this.visibility();
    const rows: Row[] = [];
    for (const hit of hits) {
      const i = model.indexById.get(hit.id);
      if (i === undefined) continue;
      rows.push({ i, hit, outside: vis ? vis.node[i] !== PRIMARY : false });
    }
    this.rows = [...rows.filter((r) => !r.outside), ...rows.filter((r) => r.outside)];
    this.active = this.rows.length && !this.rows[0]!.outside ? 0 : -1;
    const matches = new Set(this.rows.filter((r) => !r.outside).map((r) => r.i));
    this.store.set({ searchQuery: q, searchMatches: matches.size ? matches : null });
    this.render(q);
  }

  private render(q: string): void {
    const inside = this.rows.filter((r) => !r.outside);
    const outside = this.rows.filter((r) => r.outside);
    const items: HTMLElement[] = [];
    if (!this.rows.length) items.push(h("div", { class: "results-note" }, `No matching entities found for “${q}”.`));
    else if (!inside.length) items.push(h("div", { class: "results-note" }, "No matches within the current filters."));
    const row = (r: Row, k: number): HTMLElement => {
      const style = nodeStyle(r.hit.kind);
      const el = h(
        "div",
        { class: `result${r.outside ? " outside" : ""}`, role: "option", "aria-selected": String(k === this.active), id: `result-${k}` },
        h("span", { class: "sw node", style: `--c:${style.color}`, title: style.label }),
        h("span", {}, r.hit.name),
        h("span", { class: "p" }, `${style.label}${r.hit.path ? ` · ${r.hit.path}${r.hit.line ? `:${r.hit.line}` : ""}` : ""}`),
      );
      el.addEventListener("pointerdown", (e) => e.preventDefault());
      el.addEventListener("click", () => this.pick(k));
      return el;
    };
    inside.forEach((r, k) => items.push(row(r, k)));
    if (outside.length) {
      items.push(h("div", { class: "results-note" }, `${outside.length} more outside the current filters`));
      outside.forEach((r, k) => items.push(row(r, inside.length + k)));
    }
    this.list.replaceChildren(...items);
    this.list.hidden = false;
    if (this.active >= 0) this.input.setAttribute("aria-activedescendant", `result-${this.active}`);
  }

  private key(e: KeyboardEvent): void {
    if (e.key === "Escape") {
      e.preventDefault();
      if (this.input.value) this.clear();
      else this.input.blur();
      return;
    }
    if (!this.rows.length) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const n = this.rows.length;
      this.active = (this.active + (e.key === "ArrowDown" ? 1 : n - 1) + n) % n;
      this.render(this.input.value.trim());
      document.getElementById(`result-${this.active}`)?.scrollIntoView({ block: "nearest" });
    } else if (e.key === "Enter") {
      e.preventDefault();
      this.pick(Math.max(0, this.active));
    }
  }

  private pick(k: number): void {
    const r = this.rows[k];
    if (!r) return;
    this.list.hidden = true;
    // A result hidden by filters brings its kind back into view rather than failing silently.
    if (r.outside) {
      const kinds = new Set(this.store.state.activeNodeKinds);
      kinds.add(r.hit.kind);
      this.store.set({ activeNodeKinds: kinds });
    }
    this.store.set({ searchMatches: null });
    this.choose(r.i);
  }
}
