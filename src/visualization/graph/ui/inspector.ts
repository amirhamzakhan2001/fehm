import { edgeStyle, NODE_FLAG_EXPORTED, NODE_FLAG_TEST, nodeStyle, type GraphNodeDetail } from "../model.js";
import { api } from "./api.js";
import { $, fmt, h, nodes } from "./dom.js";
import type { GraphModel } from "./graph-model.js";
import type { GraphStore } from "./store.js";

interface Group {
  label: string;
  nodes: { i: number; confidence: number }[];
}

const LIST_LIMIT = 200;

/**
 * Compact detail panel for the selection. Relationship groups come straight
 * from the loaded graph (instant); the summary, signature and doc come from
 * the engine's `explain`. The panel complements the canvas, never replaces it.
 */
export class Inspector {
  private readonly el = $("inspector");
  private model: GraphModel | undefined;
  private token = 0;

  constructor(
    private readonly store: GraphStore,
    private readonly actions: { focus(i: number): void; frame(i: number): void },
  ) {
    store.subscribe((changed) => {
      if (changed.has("selected")) this.render();
    });
  }

  setModel(model: GraphModel): void {
    this.model = model;
    this.render();
  }

  private render(): void {
    const model = this.model;
    const i = this.store.state.selected;
    const token = ++this.token;
    if (!model || i < 0) {
      this.el.hidden = true;
      return;
    }
    const kind = model.kindOf(i);
    const style = nodeStyle(kind);
    const path = model.path(i);
    const line = model.line[i]!;
    const flags = model.flags[i]!;
    const parent = model.parent[i]!;

    const close = h(
      "button",
      { class: "x", type: "button", title: "Clear selection (Esc)", "aria-label": "Clear selection", onclick: () => this.store.set({ selected: -1 }) },
      "×",
    );
    const actions = h("div", { class: "actions" }, h("button", { type: "button", onclick: () => this.actions.frame(i) }, "Frame"));
    if (path) actions.append(h("a", { href: `/git-memory?path=${encodeURIComponent(path)}`, target: "_blank", rel: "noopener" }, "History"));
    if (path) actions.append(h("a", { href: `/concepts?path=${encodeURIComponent(path)}`, target: "_blank", rel: "noopener" }, "Concepts"));
    const body = h("div", {}, h("p", { class: "meta" }, "Loading summary…"));
    this.el.replaceChildren(
      ...nodes(
        h("div", { class: "hd" }, h("h2", {}, kind === "repository" ? model.payload.project : model.names[i]!), close),
        h(
          "div",
          { class: "badge" },
          h("span", { class: "sw node", style: `--c:${style.color}` }),
          style.label,
          flags & NODE_FLAG_EXPORTED ? " · exported" : "",
          flags & NODE_FLAG_TEST ? " · test" : "",
        ),
        path ? h("div", { class: "loc" }, `${path}${line ? `:${line}` : ""}`) : null,
        parent >= 0 ? h("div", { class: "meta" }, "in ", this.link(parent)) : null,
        actions,
        h("h4", {}, "Relationships"),
        this.relationships(i),
        body,
      ),
    );
    this.el.hidden = false;
    this.el.scrollTop = 0;

    void api.node(model.ids[i]!).then(
      (detail) => {
        if (token !== this.token) return;
        this.addSourceActions(actions, detail);
        body.replaceChildren(...this.detail(detail));
      },
      (error: Error) => {
        if (token === this.token) body.replaceChildren(h("p", { class: "meta" }, `Details unavailable: ${error.message}`));
      },
    );
  }

  private addSourceActions(actions: HTMLElement, d: GraphNodeDetail): void {
    if (!d.absolutePath) return;
    const target = `${d.absolutePath}${d.line ? `:${d.line}` : ""}`;
    // Opens in the local editor through its URL handler; nothing leaves the machine.
    actions.append(h("a", { href: `vscode://file${encodeURI(target.startsWith("/") ? target : `/${target}`)}`, title: target }, "Open source"));
    actions.append(
      h(
        "button",
        {
          type: "button",
          onclick: (e: Event) => {
            void navigator.clipboard?.writeText(target).then(() => {
              (e.target as HTMLElement).textContent = "Copied";
            });
          },
        },
        "Copy path",
      ),
    );
  }

  private detail(d: GraphNodeDetail): HTMLElement[] {
    const out: HTMLElement[] = [h("h4", {}, "Summary"), h("p", { class: "summary" }, d.summary)];
    if (d.semanticSummary)
      out.push(h("p", { class: "summary" }, d.semanticSummary.text), h("p", { class: "meta" }, `semantic summary · ${d.semanticSummary.model}`));
    if (d.doc && !d.summary.includes(d.doc)) out.push(h("p", { class: "summary" }, d.doc));
    if (d.signature) out.push(h("h4", {}, "Signature"), h("pre", { class: "sig" }, d.signature));
    const facts = [`${d.provenance} · confidence ${d.confidence.toFixed(2)}`];
    if (d.endLine && d.line) facts.push(`lines ${d.line}–${d.endLine}`);
    out.push(h("h4", {}, "Evidence"), h("p", { class: "meta" }, facts.join(" · ")));
    if (d.unresolved.length) {
      out.push(
        h("h4", {}, `Unresolved (${d.unresolved.length})`),
        h("ul", { class: "meta" }, ...d.unresolved.slice(0, 20).map((u) => h("li", {}, `L${u.line} ${u.text} — ${u.reason}`))),
      );
    }
    return out;
  }

  private relationships(i: number): HTMLElement {
    const model = this.model!;
    const groups = new Map<string, Group>();
    const add = (key: string, label: string, other: number, confidence: number): void => {
      let g = groups.get(key);
      if (!g) groups.set(key, (g = { label, nodes: [] }));
      g.nodes.push({ i: other, confidence });
    };
    for (const e of model.outEdges(i)) {
      const kind = model.edgeKindOf(e);
      add(`out:${kind}`, edgeStyle(kind).label, model.target[e]!, model.confidence[e]!);
    }
    for (const e of model.inEdges(i)) {
      const kind = model.edgeKindOf(e);
      add(`in:${kind}`, edgeStyle(kind).inverse, model.source[e]!, model.confidence[e]!);
    }
    if (!groups.size) return h("p", { class: "meta" }, "No relationships recorded for this entity.");
    // Semantic relationships first; containment last.
    const sorted = [...groups.entries()].sort(([a], [b]) => weight(a) - weight(b) || (a < b ? -1 : 1));
    return h(
      "div",
      {},
      ...sorted.map(([key, g]) => {
        const details = h("details", { class: "rel" }, h("summary", {}, h("span", {}, g.label), h("span", { class: "n" }, fmt.format(g.nodes.length))));
        if (!weight(key)) details.open = g.nodes.length <= 12;
        const ul = h("ul", {});
        details.addEventListener("toggle", () => {
          if (!details.open || ul.childElementCount) return;
          const items = g.nodes.slice(0, LIST_LIMIT).map(({ i: o, confidence }) => {
            const li = h(
              "li",
              { title: `${model.ids[o]} · confidence ${(confidence / 100).toFixed(2)}`, tabindex: "0" },
              h("span", {}, model.kindOf(o) === "repository" ? model.payload.project : model.names[o]!),
              h("span", { class: "p" }, model.path(o) ?? nodeStyle(model.kindOf(o)).label),
            );
            li.addEventListener("click", () => this.actions.focus(o));
            li.addEventListener("keydown", (e) => {
              if (e.key === "Enter") this.actions.focus(o);
            });
            return li;
          });
          ul.append(...items);
          if (g.nodes.length > LIST_LIMIT) ul.append(h("li", { class: "meta" }, `…and ${fmt.format(g.nodes.length - LIST_LIMIT)} more`));
        });
        details.append(ul);
        if (details.open) details.dispatchEvent(new Event("toggle"));
        return details;
      }),
    );
  }

  private link(i: number): HTMLElement {
    const model = this.model!;
    const a = h("a", { href: "#", title: model.ids[i]! }, model.kindOf(i) === "repository" ? model.payload.project : model.names[i]!);
    a.addEventListener("click", (e) => {
      e.preventDefault();
      this.actions.focus(i);
    });
    return a;
  }
}

function weight(key: string): number {
  return /:(contains|defines)$/.test(key) ? 1 : 0;
}
