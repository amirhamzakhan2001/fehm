import type { ArchitectureSummary, ArchNode, DiagramLayout, NodeDetail, PublishedView, RelationshipDetail, SearchHit, ViewType } from "../../../architecture/types.js";
import { $, h, nodes as present } from "../../graph/ui/dom.js";
import { DiagramCanvas } from "./canvas.js";
import { emptyPanel, nodePanel, relationshipPanel, TYPE_LABEL, type InspectorActions } from "./inspector.js";

/**
 * Feature 3.3 page. One semantic model, three lenses (system, components,
 * dependencies). Only layouts that passed showcase validation are drawn; a
 * failed draft is shown only on explicit request, clearly marked.
 */

type Selection = { kind: "node" | "edge"; id: string } | null;
type Mode = "up" | "down" | "both" | null;

const state: {
  summary: ArchitectureSummary | null;
  view: ViewType;
  focus?: string;
  published: PublishedView | null;
  nodes: Map<string, ArchNode>;
  selected: Selection;
  mode: Mode;
  trace: string[] | null;
} = { summary: null, view: "system", published: null, nodes: new Map(), selected: null, mode: null, trace: null };

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init);
  if (!res.ok) {
    let detail = "";
    try {
      detail = ((await res.json()) as { error?: string }).error ?? "";
    } catch {
      // non-JSON body
    }
    throw new Error(`${detail || `HTTP ${res.status}`}`);
  }
  return (await res.json()) as T;
}

function status(s: "ready" | "busy" | "stale" | "error", text: string): void {
  const el = $("status");
  el.dataset.state = s;
  el.lastElementChild!.textContent = text;
}

const canvas = new DiagramCanvas($("canvas") as unknown as SVGSVGElement, {
  selectNode: (id, additive) => (additive && state.selected?.kind === "node" && state.selected.id !== id ? trace(state.selected.id, id) : selectNode(id)),
  selectEdge: (id) => selectEdge(id),
  open: (id) => void openNode(id),
  clear: () => clearSelection(),
  zoomed: (s) => ($("zoom").textContent = `${Math.round(s * 100)}%`),
});

const actions: InspectorActions = {
  select: (id) => void goTo(id),
  open: (id) => void openNode(id),
  highlight: (mode) => setMode(state.mode === mode ? null : mode),
  close: () => clearSelection(),
  root: () => state.summary?.repository.root ?? "",
};

// ─── URL state (deep links; the dashboard shell forwards the fragment) ──

function readHash(): { view: ViewType; focus?: string; sel?: string } {
  const p = new URLSearchParams(location.hash.slice(1));
  const view = (["system", "components", "runtime", "dataflow", "workflow", "lifecycle", "deployment", "security", "dependencies", "delta"] as const).find((v) => v === p.get("view")) ?? "system";
  const out: { view: ViewType; focus?: string; sel?: string } = { view };
  if (p.get("focus")) out.focus = p.get("focus")!;
  if (p.get("sel")) out.sel = p.get("sel")!;
  return out;
}

function writeHash(): void {
  const p = new URLSearchParams();
  p.set("view", state.view);
  if (state.focus) p.set("focus", state.focus);
  if (state.selected?.kind === "node") p.set("sel", state.selected.id);
  const next = `#${p.toString()}`;
  if (location.hash !== next) history.replaceState(null, "", next);
}

// ─── view loading ───────────────────────────────────────────────────

async function loadView(view: ViewType, focus?: string, select?: string): Promise<void> {
  status("busy", view === "delta" ? "Reading the other revision…" : "Laying out…");
  try {
    const q = new URLSearchParams({ type: view, ...(focus ? { focus } : {}) });
    const pub = await json<PublishedView | { error: string }>(`/api/architecture/view?${q}`);
    if ("error" in pub) {
      // Nothing to draw for this choice (no changes, no evidence): an answer, shown as one.
      state.view = view;
      if (focus) state.focus = focus;
      else delete state.focus;
      state.published = null;
      renderTabs();
      renderOption();
      $("crumbs").replaceChildren();
      $("canvas").replaceChildren();
      $("foot").replaceChildren();
      showMessage(VIEW_TITLE(view), pub.error);
      renderInspector();
      writeHash();
      readyStatus();
      return;
    }
    state.view = view;
    if (pub.focus) state.focus = pub.focus;
    else delete state.focus;
    state.published = pub;
    state.nodes = new Map(pub.nodes.map((n) => [n.id, n]));
    state.selected = null;
    state.mode = null;
    state.trace = null;
    renderTabs();
    renderOption();
    renderCrumbs();
    draw(pub.layout);
    renderFoot();
    if (select && canvas.has(select)) selectNode(select, true);
    else renderInspector();
    writeHash();
    readyStatus();
  } catch (e) {
    status("error", (e as Error).message);
    showMessage("Could not build this view", (e as Error).message);
  }
}

function draw(layout: DiagramLayout | null, draft = false): void {
  const pub = state.published!;
  $("draftbar").hidden = !draft;
  if (!layout) {
    $("canvas").replaceChildren();
    const v = pub.validation;
    const box = h(
      "div",
      { class: "box" },
      h("h2", {}, "No verified layout for this view"),
      h("p", {}, `The layout failed ${v.profile} validation after ${v.attempts} attempts and there is no earlier verified layout to fall back to. Nothing unverified is drawn by default.`),
      h("ul", {}, ...v.diagnostics.filter((d) => d.severity === "error").slice(0, 8).map((d) => h("li", {}, h("code", {}, d.code), ` ${d.message}${d.measured !== undefined ? ` (measured ${d.measured}, required ${d.required})` : ""}`))),
      v.draft ? h("button", { onclick: () => showDraft() }, "Show the unverified draft anyway") : null,
    );
    showMessage(null, box);
    return;
  }
  $("message").hidden = true;
  canvas.render(layout, state.nodes, { draft });
}

function showDraft(): void {
  const d = state.published?.validation.draft;
  if (!d) return;
  $("draftbar").textContent = `Unverified draft: this layout failed validation (${state.published!.validation.diagnostics.filter((x) => x.severity === "error").length} errors). Overlaps or ambiguous routes may be present.`;
  draw(d, true);
}

function showMessage(title: string | null, body: string | HTMLElement): void {
  const m = $("message");
  m.hidden = false;
  m.replaceChildren(typeof body === "string" ? h("div", { class: "box" }, title ? h("h2", {}, title) : null, h("p", {}, body)) : body);
}

const VIEW_TITLE = (v: ViewType): string => state.summary?.views.find((x) => x.type === v)?.title ?? v;

/** All ten views, grouped core | behaviour | operations; views without evidence stay visible, disabled, with the reason. */
function renderTabs(): void {
  const tabs = $("tabs");
  const views = state.summary?.views ?? [];
  const out: HTMLElement[] = [];
  views.forEach((v, i) => {
    if (i && views[i - 1]!.group !== v.group) out.push(h("span", { class: "gsep", "aria-hidden": "true" }));
    out.push(
      h(
        "button",
        {
          role: "tab",
          "aria-selected": String(v.type === state.view),
          disabled: !v.available,
          title: v.available ? v.question : `Not available: ${v.reason ?? "no evidence"}`,
          onclick: () => void switchView(v.type),
        },
        v.title,
      ),
    );
  });
  tabs.replaceChildren(...out);
}

/** The picker for views about one thing at a time (entry point, process, entity, revision, component). */
function renderOption(): void {
  const d = state.summary?.views.find((v) => v.type === state.view);
  const wrap = $("option-wrap");
  const select = $("option") as HTMLSelectElement;
  if (!d?.options?.length || state.view === "system" || state.view === "dependencies") {
    wrap.hidden = true;
    return;
  }
  wrap.hidden = false;
  $("option-label").textContent = d.optionLabel ?? "Show";
  select.replaceChildren(...d.options.map((o) => h("option", { value: o.id, title: o.detail ?? o.label, ...(o.id === state.focus ? { selected: true } : {}) }, o.label)));
  if (state.focus && !d.options.some((o) => o.id === state.focus)) select.prepend(h("option", { value: state.focus, selected: true }, state.published?.title ?? state.focus));
  select.onchange = () => void loadView(state.view, select.value);
}

async function switchView(view: ViewType): Promise<void> {
  if (view === "components") {
    // Open the selected component (or its parent), else the first one.
    const sel = state.selected?.kind === "node" ? state.nodes.get(state.selected.id) : undefined;
    const target = sel && sel.tier === 1 && sel.children.length && sel.type !== "file" ? sel.id : (sel?.parent ?? state.focus);
    await loadView("components", target);
    return;
  }
  // Views with choices open on the server's default choice (first entry point, entity, revision…).
  await loadView(view);
}

function renderCrumbs(): void {
  const path = state.published?.path ?? [];
  const out: (HTMLElement | string)[] = [];
  path.forEach((p, i) => {
    if (i) out.push(h("span", { class: "div" }, "›"));
    const last = i === path.length - 1;
    if (last) out.push(h("span", { class: "cur", "aria-current": "page" }, state.view === "dependencies" ? "Module dependencies" : i === 0 ? `${p.name} · ${VIEW_TITLE(state.view)}` : p.name));
    else if (p.id === "system") out.push(h("button", { onclick: () => void loadView("system") }, p.name));
    else if (p.id.startsWith("component:") || p.id.startsWith("module:")) out.push(h("button", { onclick: () => void loadView("components", p.id) }, p.name));
    else out.push(h("span", {}, p.name));
  });
  $("crumbs").replaceChildren(...out);
}

function renderFoot(): void {
  const pub = state.published;
  const s = state.summary;
  if (!pub) return;
  const v = pub.validation;
  const src = v.source === "fresh" ? (v.attempts === 0 ? "verified layout (cached)" : `verified layout · ${v.attempts === 1 ? "first attempt" : `${v.attempts} attempts`}`) : v.source === "last-known-good" ? "last verified layout (latest failed validation)" : "no verified layout";
  const layout = pub.layout;
  $("foot").replaceChildren(
    ...present(
    h("span", {}, h("b", {}, v.source === "fresh" ? "✓ " : "! "), src),
    h("span", {}, h("b", {}, String(pub.nodes.length)), " nodes · ", h("b", {}, String(pub.relationships.length)), " relationships"),
    layout ? h("span", { title: "Edge crossings in this layout" }, `${layout.metrics.crossings} crossings`) : null,
    s ? h("span", { class: "mono", title: "Model fingerprint (indexed file contents + model/layout versions)" }, s.fingerprint.slice(0, 8)) : null,
    state.trace ? h("span", { class: "note" }, `Trace: ${state.trace.map((id) => state.nodes.get(id)?.name ?? id).join(" → ")}`) : null,
    ...pub.notes.map((n) => h("span", { class: "note" }, n)),
    ),
  );
}

function readyStatus(): void {
  const f = state.summary?.freshness;
  if (f && !f.fresh) {
    const n = f.added + f.modified + f.deleted;
    status("stale", `${n} changed ${n === 1 ? "file" : "files"} · refresh`);
    $("refresh").setAttribute("data-stale", "");
  } else {
    status("ready", "Up to date");
    $("refresh").removeAttribute("data-stale");
  }
}

// ─── selection, highlight, trace ────────────────────────────────────

function neighbourhood(id: string, mode: Exclude<Mode, null>): { nodes: Set<string>; edges: Set<string> } {
  const layout = state.published?.layout;
  const nodes = new Set([id]);
  const edges = new Set<string>();
  if (!layout) return { nodes, edges };
  const walk = (dir: "up" | "down"): void => {
    const stack = [id];
    const seen = new Set([id]);
    while (stack.length) {
      const cur = stack.pop()!;
      for (const e of layout.edges) {
        const [from, to] = dir === "down" ? [e.source, e.target] : [e.target, e.source];
        if (from !== cur) continue;
        edges.add(e.id);
        nodes.add(to);
        if (!seen.has(to)) (seen.add(to), stack.push(to));
      }
    }
  };
  if (mode !== "down") walk("up");
  if (mode !== "up") walk("down");
  return { nodes, edges };
}

function direct(id: string): { nodes: Set<string>; edges: Set<string> } {
  const nodes = new Set([id]);
  const edges = new Set<string>();
  for (const e of state.published?.layout?.edges ?? []) {
    if (e.source === id || e.target === id) {
      edges.add(e.id);
      nodes.add(e.source === id ? e.target : e.source);
    }
  }
  return { nodes, edges };
}

function refreshMarks(): void {
  const sel = state.selected;
  let visible: { nodes: Set<string>; edges: Set<string> } | null = null;
  if (state.trace) {
    const nodes = new Set(state.trace);
    const edges = new Set<string>();
    for (let i = 1; i < state.trace.length; i += 1) {
      const e = state.published?.layout?.edges.find((x) => (x.source === state.trace![i - 1] && x.target === state.trace![i]) || (x.target === state.trace![i - 1] && x.source === state.trace![i]));
      if (e) edges.add(e.id);
    }
    visible = { nodes, edges };
  } else if (sel?.kind === "node") visible = state.mode ? neighbourhood(sel.id, state.mode) : direct(sel.id);
  else if (sel?.kind === "edge") {
    const e = state.published?.layout?.edges.find((x) => x.id === sel.id);
    if (e) visible = { nodes: new Set([e.source, e.target]), edges: new Set([e.id]) };
  }
  canvas.mark(sel, visible);
  const fm = $("focusmode");
  fm.hidden = sel?.kind !== "node";
  for (const b of fm.querySelectorAll<HTMLButtonElement>("button")) b.setAttribute("aria-pressed", String(b.dataset.mode === state.mode));
}

function setMode(mode: Mode): void {
  state.mode = mode;
  state.trace = null;
  refreshMarks();
  renderFoot();
}

async function selectNode(id: string, center = false): Promise<void> {
  state.selected = { kind: "node", id };
  state.trace = null;
  refreshMarks();
  renderFoot();
  writeHash();
  if (center) canvas.center(id);
  canvas.focusNode(id);
  const panel = $("inspector");
  panel.classList.add("open");
  panel.replaceChildren(h("div", { class: "insp muted" }, "Loading…"));
  try {
    const d = await json<NodeDetail>(`/api/architecture/node?id=${encodeURIComponent(id)}`);
    if (state.selected?.id !== id) return;
    const canOpen = d.node.tier === 1 && d.node.children.length > 0 && d.node.type !== "file" && !(state.view === "components" && state.focus === id);
    panel.replaceChildren(nodePanel(d, actions, canOpen));
  } catch (e) {
    panel.replaceChildren(h("div", { class: "insp" }, (e as Error).message));
  }
}

async function selectEdge(id: string): Promise<void> {
  state.selected = { kind: "edge", id };
  state.trace = null;
  refreshMarks();
  writeHash();
  const panel = $("inspector");
  panel.classList.add("open");
  panel.replaceChildren(h("div", { class: "insp muted" }, "Loading…"));
  try {
    const d = await json<RelationshipDetail>(`/api/architecture/relationship?id=${encodeURIComponent(id)}`);
    if (state.selected?.id !== id) return;
    panel.replaceChildren(relationshipPanel(d, actions));
  } catch (e) {
    panel.replaceChildren(h("div", { class: "insp" }, (e as Error).message));
  }
}

function clearSelection(): void {
  state.selected = null;
  state.mode = null;
  state.trace = null;
  refreshMarks();
  renderFoot();
  renderInspector();
  writeHash();
}

function renderInspector(): void {
  $("inspector").classList.remove("open");
  $("inspector").replaceChildren(emptyPanel(state.summary, state.published?.notes ?? []));
}

/** Shift+click a second node: the shortest dependency path between the two (either direction). */
function trace(from: string, to: string): void {
  const edges = state.published?.layout?.edges ?? [];
  const bfs = (a: string, b: string): string[] | null => {
    const prev = new Map<string, string>([[a, a]]);
    const queue = [a];
    while (queue.length) {
      const cur = queue.shift()!;
      if (cur === b) break;
      for (const e of edges) if (e.source === cur && !prev.has(e.target)) (prev.set(e.target, cur), queue.push(e.target));
    }
    if (!prev.has(b)) return null;
    const path = [b];
    while (path[0] !== a) path.unshift(prev.get(path[0]!)!);
    return path;
  };
  const path = bfs(from, to) ?? bfs(to, from);
  if (!path) {
    status("ready", "No dependency path between those two");
    return;
  }
  state.trace = path;
  refreshMarks();
  renderFoot();
}

/** Select a node, switching to a view that contains it when needed. */
async function goTo(id: string): Promise<void> {
  if (canvas.has(id)) return selectNode(id, true);
  const d = await json<NodeDetail>(`/api/architecture/node?id=${encodeURIComponent(id)}`);
  const n = d.node;
  if (n.level === 1) return loadView("system", undefined, id);
  // Modules and files live inside their parent.
  if (n.parent) return loadView("components", n.parent, id);
  return loadView("system", undefined, id);
}

async function openNode(id: string): Promise<void> {
  await loadView("components", id);
}

// ─── search ─────────────────────────────────────────────────────────

let searchTimer = 0;
let hits: SearchHit[] = [];
let active = -1;

function renderResults(): void {
  const box = $("results");
  const wrap = $("search-wrap");
  if (!hits.length) {
    box.hidden = true;
    wrap.setAttribute("aria-expanded", "false");
    return;
  }
  box.hidden = false;
  wrap.setAttribute("aria-expanded", "true");
  box.replaceChildren(
    ...hits.map((hit, i) =>
      h(
        "button",
        { role: "option", "aria-selected": String(i === active), onclick: () => void choose(hit) },
        h("span", { class: "k" }, hit.via ? hit.via.kind : TYPE_LABEL[hit.type]),
        h("span", {}, hit.name),
        h("span", { class: "p" }, hit.via?.path ?? hit.id.replace(/^(component|module|file):/, "")),
      ),
    ),
  );
}

async function choose(hit: SearchHit): Promise<void> {
  hits = [];
  renderResults();
  ($("search") as HTMLInputElement).blur();
  await goTo(hit.target);
}

function bindSearch(): void {
  const input = $("search") as HTMLInputElement;
  input.addEventListener("input", () => {
    clearTimeout(searchTimer);
    const q = input.value.trim();
    if (!q) {
      hits = [];
      renderResults();
      return;
    }
    searchTimer = window.setTimeout(async () => {
      try {
        hits = await json<SearchHit[]>(`/api/architecture/search?q=${encodeURIComponent(q)}`);
        active = hits.length ? 0 : -1;
        renderResults();
      } catch {
        hits = [];
        renderResults();
      }
    }, 140);
  });
  input.addEventListener("keydown", (ev) => {
    if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
      ev.preventDefault();
      if (hits.length) active = (active + (ev.key === "ArrowDown" ? 1 : hits.length - 1)) % hits.length;
      renderResults();
    } else if (ev.key === "Enter" && hits[active]) {
      ev.preventDefault();
      void choose(hits[active]!);
    } else if (ev.key === "Escape") {
      hits = [];
      renderResults();
      input.blur();
    }
  });
  input.addEventListener("blur", () => setTimeout(() => ((hits = []), renderResults()), 150));
}

// ─── boot ───────────────────────────────────────────────────────────

async function refresh(): Promise<void> {
  status("busy", "Re-indexing…");
  try {
    state.summary = await json<ArchitectureSummary>("/api/architecture/refresh", { method: "POST" });
    await loadView(state.view, state.focus);
  } catch (e) {
    status("error", (e as Error).message);
  }
}

async function checkFreshness(): Promise<void> {
  try {
    const s = await json<ArchitectureSummary>("/api/architecture");
    if (state.summary) state.summary.freshness = s.freshness;
    readyStatus();
  } catch {
    // offline server; the next action reports it
  }
}

function bindKeys(): void {
  document.addEventListener("keydown", (ev) => {
    const typing = (ev.target as HTMLElement).closest("input, textarea");
    if (typing) return;
    if (ev.key === "/") {
      ev.preventDefault();
      ($("search") as HTMLInputElement).focus();
    } else if (ev.key === "f" || ev.key === "F") canvas.fit();
    else if (ev.key === "0") canvas.reset();
    else if (ev.key === "+" || ev.key === "=") canvas.zoomBy(1.25);
    else if (ev.key === "-") canvas.zoomBy(0.8);
    else if (ev.key === "Escape") clearSelection();
  });
  $("fit").addEventListener("click", () => canvas.fit());
  $("reset").addEventListener("click", () => canvas.reset());
  $("zoom-in").addEventListener("click", () => canvas.zoomBy(1.25));
  $("zoom-out").addEventListener("click", () => canvas.zoomBy(0.8));
  $("refresh").addEventListener("click", () => void refresh());
  for (const b of $("focusmode").querySelectorAll<HTMLButtonElement>("button")) b.addEventListener("click", () => setMode(state.mode === b.dataset.mode ? null : (b.dataset.mode as Mode)));
  window.addEventListener("focus", () => void checkFreshness());
  window.addEventListener("hashchange", () => {
    const want = readHash();
    if (want.view !== state.view || want.focus !== state.focus) void loadView(want.view, want.focus, want.sel);
    else if (want.sel && want.sel !== state.selected?.id && canvas.has(want.sel)) void selectNode(want.sel, true);
  });
}

async function boot(): Promise<void> {
  bindKeys();
  bindSearch();
  try {
    state.summary = await json<ArchitectureSummary>("/api/architecture");
  } catch (e) {
    status("error", (e as Error).message);
    showMessage("Could not load the architecture", (e as Error).message);
    return;
  }
  $("project").textContent = state.summary.repository.name;
  $("project").title = state.summary.repository.root;
  const want = readHash();
  await loadView(want.view, want.focus, want.sel);
}

void boot();
