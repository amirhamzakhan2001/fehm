import type { ArchitectureSummary, ArchNode, DiagramLayout, NodeDetail, PublishedView, RelationshipDetail, SearchHit, ViewType } from "../../../architecture/types.js";
import { $, h, nodes as present } from "../../graph/ui/dom.js";
import { galleryEntries, FAMILIES, CATEGORY_GAPS } from "./catalog.js";
import { exportDiagram } from "./export.js";
import { focusNeighborhood } from "./exploration.js";
import { DiagramCanvas, type ViewportState } from "./canvas.js";
import { emptyPanel, nodePanel, relationshipPanel, TYPE_LABEL, type InspectorActions } from "./inspector.js";

/**
 * Feature 3.3 page. Evidence-backed discovery and focused diagram exploration. Only layouts that passed showcase validation are drawn; a
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
}, { initialMinScale: 0.75 });

const actions: InspectorActions = {
  select: (id) => void goTo(id),
  open: (id) => void openNode(id),
  highlight: (mode) => setMode(state.mode === mode ? null : mode),
  close: () => { clearSelection(); toggleInspector(false); $("inspector-toggle").focus(); },
  root: () => state.summary?.repository.root ?? "",
};

// ─── URL state (deep links; the dashboard shell forwards the fragment) ──

function readHash(): { view: ViewType; focus?: string; sel?: string } {
  const p = new URLSearchParams(location.hash.slice(1));
  const view = (["system", "components", "runtime", "dataflow", "workflow", "lifecycle", "deployment", "security", "dependencies", "delta"] as const).find((v) => v === p.get("view")) ?? "system";
  const out: { view: ViewType; focus?: string; sel?: string } = { view };
  if (!p.has("view")) out.focus = "context";
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

let viewRequest = 0;
let category = FAMILIES.system.family;
let inspectorOpen = false;
let focusHops: 0 | 1 | 2 = 0;
let visibleElements: { nodes: Set<string>; edges: Set<string> } | null = null;
let noticeTimer = 0;
const remembered = new Map<string, { camera: ViewportState; selected: Selection; filter: string; hops: 0 | 1 | 2; inspector: boolean }>();
const viewKey = (view: ViewType, focus?: string): string => `${state.summary?.fingerprint}:${view}:${focus ?? ""}`;
function rememberView(): void {
  if (!state.published?.layout) return;
  remembered.set(viewKey(state.view, state.focus), { camera: canvas.viewport(), selected: state.selected, filter: ($("diagram-filter") as HTMLSelectElement).value, hops: focusHops, inspector: inspectorOpen });
  if (remembered.size > 40) remembered.delete(remembered.keys().next().value!);
}
function announce(message: string): void {
  clearTimeout(noticeTimer);
  $("announcement").textContent = message; $("announcement").hidden = false;
  noticeTimer = window.setTimeout(() => $("announcement").hidden = true, 3200);
}

async function loadView(view: ViewType, focus?: string, select?: string): Promise<void> {
  rememberView();
  clearTimeout(noticeTimer); $("announcement").hidden = true;
  const request = ++viewRequest;
  $("loading").hidden = false;
  $("main").setAttribute("aria-busy", "true");
  ($("export-svg") as HTMLButtonElement).disabled = true;
  ($("export-menu") as HTMLButtonElement).disabled = true;
  status("busy", view === "delta" ? "Reading the other revision…" : "Laying out…");
  try {
    const q = new URLSearchParams({ type: view, ...(focus ? { focus } : {}) });
    const pub = await json<PublishedView | { error: string }>(`/api/architecture/view?${q}`);
    if (request !== viewRequest) return;
    focusHops = 0; visibleElements = null;
    if ("error" in pub) {
      state.nodes.clear(); state.selected = null; state.mode = null; state.trace = null;
      // Nothing to draw for this choice (no changes, no evidence): an answer, shown as one.
      category = FAMILIES[view].family;
      state.view = view;
      if (focus) state.focus = focus;
      else delete state.focus;
      state.published = null;
      $("canvas-toolbar").hidden = true;
      $("selection-actions").hidden = true;
      renderViewControls();
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
    category = FAMILIES[view].family;
    state.view = view;
    if (pub.focus) state.focus = pub.focus;
    else delete state.focus;
    state.published = pub;
    state.nodes = new Map(pub.nodes.map((n) => [n.id, n]));
    state.selected = null;
    state.mode = null;
    state.trace = null;
    renderViewControls();
    renderOption();
    renderCrumbs();
    draw(pub.layout);
    refreshMarks();
    renderFoot();
    const saved = remembered.get(viewKey(state.view, state.focus));
    if (saved && pub.layout) {
      const filter = $("diagram-filter") as HTMLSelectElement;
      if ([...filter.options].some(o => o.value === saved.filter)) filter.value = saved.filter;
      const selection = select ? { kind: "node" as const, id: select } : saved.selected;
      if (selection?.kind === "node" && canvas.has(selection.id)) { void selectNode(selection.id); focusHops = saved.hops; }
      else if (selection?.kind === "edge" && pub.relationships.some(r => r.id === selection.id)) void selectEdge(selection.id);
      else { focusHops = 0; renderInspector(); }
      applyVisibility();
      toggleInspector(saved.inspector);
      canvas.restoreViewport(saved.camera);
    } else if (select && canvas.has(select)) void selectNode(select, true);
    else { renderInspector(); toggleInspector(false); }
    writeHash();
    readyStatus();
  } catch (e) {
    if (request !== viewRequest) return;
    status("error", (e as Error).message);
    showMessage(null, h("div", { class: "box" }, h("h2", {}, "Could not load this diagram"), h("p", {}, (e as Error).message), h("button", { onclick: () => void loadView(view, focus, select) }, "Try again")));
  } finally {
    if (request === viewRequest) { $("loading").hidden = true; $("main").setAttribute("aria-busy", "false"); }
  }
}

function draw(layout: DiagramLayout | null, draft = false): void {
  const pub = state.published!;
  $("canvas-toolbar").hidden = !layout;
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

/** Update the selected diagram and its contextual controls. */
function renderViewControls(): void {
  renderCategoryNavigation();
  const pub = state.published;
  const entries = galleryEntries(state.summary?.views ?? []);
  const entry = entries.find(e => e.descriptor.type === state.view && e.focus === state.focus)
    ?? entries.find(e => e.descriptor.type === state.view);
  $("diagram-title").textContent = pub?.title ?? "Architecture unavailable";
  $("evidence-details").hidden = !pub;
  $("diagram-purpose").textContent = state.focus === "context" ? "The repository boundary, its callers, and detected data or external integrations." : entry?.descriptor.question ?? "No source-backed diagram is available for this selection.";
  $("diagram-evidence").textContent = `${FAMILIES[state.view].evidence}${pub ? ` Select for evidence; double-click to explore. Pan for detail or Fit for the full extent.` : ""}`;
  $("diagram-summary").textContent = state.focus === "context" && pub
    ? `${state.summary?.repository.name ?? "This repository"} contains ${state.summary?.counts.components ?? 0} source subsystems. Detected outside elements: ${pub.nodes.filter(n => n.id !== "context:system").map(n => n.name).join(", ") || "none"}. Select the system and choose Explore inside to inspect its components. Source grouping alone does not establish an architectural style.`
    : `${FAMILIES[state.view].scope}. ${pub?.notes.join(" ") || "Select an element to inspect its source evidence, confidence and relationships."}`;
  $("filter-status").textContent = "";
  const filter = $("diagram-filter") as HTMLSelectElement;
  filter.disabled = !pub?.layout;
  if (!pub) $("diagram-purpose").textContent = "No diagram can be generated from the available source evidence.";
  filter.replaceChildren(h("option", { value: "" }, "All elements"),
    h("optgroup", { label: "Relationship types" }, ...[...new Set(pub?.relationships.map(r => r.type) ?? [])].sort().map(t => h("option", { value: `edge:${t}` }, t))),
    h("optgroup", { label: "Node types" }, ...[...new Set(pub?.nodes.map(n => n.type) ?? [])].sort().map(t => h("option", { value: `node:${t}` }, t))));
  ($("export-svg") as HTMLButtonElement).disabled = !pub?.layout;
  ($("export-menu") as HTMLButtonElement).disabled = !pub?.layout;
}

function renderCategoryNavigation(): void {
  const views = state.summary?.views ?? [];
  const entries = galleryEntries(views);
  const families = [...new Set(entries.map(e => e.family))];
  if (!families.includes(category)) category = families[0] ?? "";
  const query = ($("diagram-query") as HTMLInputElement).value.trim().toLowerCase();
  $("category-nav").replaceChildren(...families.map(family => h("button", {
    "aria-pressed": String(category === family && !query),
    onclick: () => { category = family; ($("diagram-query") as HTMLInputElement).value = ""; renderCategoryNavigation(); },
  }, family.replace(" and behavior", "").replace("Infrastructure and deployment", "Deployment").replace("Security and reliability", "Security").replace("Architecture evolution", "Evolution"))));
  const choices = entries.filter(e => query ? `${e.title} ${e.descriptor.question} ${e.scope}`.toLowerCase().includes(query) : e.family === category);
  $("diagram-choices").replaceChildren(...choices.map(e => h("button", {
    "aria-current": String(e.descriptor.type === state.view && (e.descriptor.type !== "system" || e.focus === state.focus)),
    title: `${e.descriptor.question}\n${e.scope}\n${e.evidence}`,
    onclick: () => void loadView(e.descriptor.type, e.focus),
  }, e.title)));
  if (!choices.length) $("diagram-choices").append(h("span", { class: "empty-category" }, query ? "No matching diagrams. Try context, sequence or dependencies." : "No source-backed diagrams are available. Index source files and refresh."));
  $("category-summary").textContent = "Coverage";
  $("category-description").textContent = "Only available, source-backed views appear in navigation. Availability does not imply complete extraction.";
  $("category-gaps").textContent = Object.values(CATEGORY_GAPS).join(" ");
  $("category-unavailable").replaceChildren(...views.filter(v => !v.available).map(v => h("p", {}, `${v.title}: ${v.reason ?? "No supporting evidence."}`)));
}

function toggleInspector(open: boolean): void {
  inspectorOpen = open;
  $("inspector").hidden = !open;
  $("main").classList.toggle("inspector-collapsed", !open);
  $("inspector-toggle").textContent = open ? "›" : "‹";
  $("inspector-toggle").setAttribute("aria-expanded", String(open));
  $("inspector-toggle").setAttribute("aria-label", open ? "Collapse inspector" : "Expand inspector");
  $("inspector-toggle").title = open ? "Collapse inspector" : "Expand inspector";
}

/** The picker for views about one thing at a time (entry point, process, entity, revision, component). */
function renderOption(): void {
  const d = state.summary?.views.find((v) => v.type === state.view);
  const wrap = $("option-wrap");
  const select = $("option") as HTMLSelectElement;
  if (!d?.options?.length || state.view === "system") {
    wrap.hidden = true;
    return;
  }
  wrap.hidden = false;
  $("option-label").textContent = d.optionLabel ?? "Show";
  select.replaceChildren(...d.options.map((o) => h("option", { value: o.id, title: o.detail ?? o.label, ...(o.id === state.focus ? { selected: true } : {}) }, o.label)));
  if (state.focus && !d.options.some((o) => o.id === state.focus)) select.prepend(h("option", { value: state.focus, selected: true }, state.published?.title ?? state.focus));
  const search = $("scope-search") as HTMLInputElement;
  search.value = "";
  search.hidden = d.options.length < 8;
  search.oninput = () => {
    const query = search.value.trim().toLowerCase();
    const matches = d.options!.filter(o => `${o.label} ${o.detail ?? ""}`.toLowerCase().includes(query));
    select.replaceChildren(...matches.map(o => h("option", { value: o.id, ...(o.id === state.focus ? {selected: true} : {}) }, o.label)));
    select.disabled = matches.length === 0;
    if (!matches.length) select.append(h("option", {}, "No matching scopes"));
  };
  select.disabled = false;
  select.onchange = () => void loadView(state.view, select.value);
}

function renderCrumbs(): void {
  const path = state.published?.path ?? [];
  const out: (HTMLElement | string)[] = [];
  path.forEach((p, i) => {
    if (i) out.push(h("span", { class: "div" }, "›"));
    const last = i === path.length - 1;
    if (i === 0 && state.focus !== "context") out.push(h("button", { onclick: () => void loadView("system", "context") }, "Context"), h("span", { class: "div" }, "›"));
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
  const src = v.source === "fresh" ? "Verified layout" : v.source === "last-known-good" ? "last verified layout (latest failed validation)" : "no verified layout";
  const layout = pub.layout;
  $("foot").replaceChildren(
    ...present(
    h("span", {}, h("b", {}, v.source === "fresh" ? "✓ " : "! "), src),
    h("span", {}, h("b", {}, String(pub.nodes.length)), " nodes · ", h("b", {}, String(pub.relationships.length)), " relationships"),

    state.trace ? h("span", { class: "note" }, `Trace: ${state.trace.map((id) => state.nodes.get(id)?.name ?? id).join(" → ")}`) : null,
    h("details", {}, h("summary", {}, "Scope notes"), h("div", {}, ...pub.notes.map(n => h("p", {}, n)), h("p", {}, `${layout?.metrics.crossings ?? 0} crossings · model ${s?.fingerprint.slice(0, 8) ?? "unknown"}`))),
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
  $("selection-actions").hidden = !sel;
  const node = sel?.kind === "node" ? state.nodes.get(sel.id) : undefined;
  $("selection-name").textContent = node?.name ?? "Relationship";
  $("expand-selection").hidden = !node?.children.length || node.type === "file" || node.tier !== 1;
  $("focus-one").hidden = !node || state.published?.layout?.kind === "sequence";
  $("focus-two").hidden = $("focus-one").hidden;
  applyVisibility();
  const fm = $("focusmode");
  fm.hidden = sel?.kind !== "node";
  for (const b of fm.querySelectorAll<HTMLButtonElement>("button")) b.setAttribute("aria-pressed", String(b.dataset.mode === state.mode));
}

function applyVisibility(): void {
  const pub = state.published;
  if (!pub?.layout) return;
  const value = ($("diagram-filter") as HTMLSelectElement).value;
  const neighborhood = focusHops && state.selected?.kind === "node" ? focusNeighborhood(pub.layout, state.selected.id, focusHops) : null;
  let nodes = new Set(pub.nodes.map(n => n.id));
  let edges = pub.relationships;
  if (value) {
    const selectedNodes = new Set(pub.nodes.filter(n => value === `node:${n.type}`).map(n => n.id));
    edges = edges.filter(r => value.startsWith("node:") ? selectedNodes.has(r.source) || selectedNodes.has(r.target) : value === `edge:${r.type}`);
    nodes = new Set([...selectedNodes, ...edges.flatMap(r => [r.source, r.target])]);
  }
  if (neighborhood) {
    nodes = new Set([...nodes].filter(id => neighborhood.nodes.has(id)));
    edges = edges.filter(e => neighborhood.edges.has(e.id) && nodes.has(e.source) && nodes.has(e.target));
  }
  visibleElements = value || neighborhood ? { nodes, edges: new Set(edges.map(r => r.id)) } : null;
  canvas.filter(visibleElements);
  $("filter-status").textContent = visibleElements ? `${nodes.size}/${pub.nodes.length} elements · ${edges.length}/${pub.relationships.length} relationships shown${focusHops ? ` · ${focusHops}-hop neighborhood` : ""}. Clear filters to restore full detail.` : "";
  $("focus-one").setAttribute("aria-pressed", String(focusHops === 1));
  $("focus-two").setAttribute("aria-pressed", String(focusHops === 2));
  $("clear-focus").hidden = !visibleElements;
}

function focusSelection(hops: 1 | 2): void {
  if (state.selected?.kind !== "node" || !state.published?.layout) return;
  focusHops = focusHops === hops ? 0 : hops;
  applyVisibility();
  if (visibleElements?.nodes.size) { canvas.fitNodes(visibleElements.nodes); canvas.center(state.selected.id); }
}

function setMode(mode: Mode): void {
  state.mode = mode;
  state.trace = null;
  refreshMarks();
  renderFoot();
}

async function selectNode(id: string, center = false): Promise<void> {
  if (state.selected?.id !== id) focusHops = 0;
  state.selected = { kind: "node", id };
  toggleInspector(true);
  state.trace = null;
  refreshMarks();
  renderFoot();
  writeHash();
  if (center) canvas.center(id);
  canvas.focusNode(id);
  const panel = $("inspector");
  panel.classList.add("open");
  $("inspector-toggle").classList.add("has-selection");
  panel.replaceChildren(h("div", { class: "insp muted" }, "Loading…"));
  try {
    const d = await json<NodeDetail>(`/api/architecture/node?id=${encodeURIComponent(id)}`);
    if (state.selected?.id !== id) return;
    const canOpen = d.node.tier === 1 && d.node.children.length > 0 && d.node.type !== "file" && !(state.view === "components" && state.focus === id);
    panel.replaceChildren(nodePanel(d, actions, canOpen));
  } catch (e) {
    if (state.selected?.id !== id) return;
    panel.replaceChildren(h("div", { class: "insp" }, (e as Error).message));
  }
}

async function selectEdge(id: string): Promise<void> {
  focusHops = 0;
  state.selected = { kind: "edge", id };
  toggleInspector(true);
  state.trace = null;
  refreshMarks();
  writeHash();
  const panel = $("inspector");
  panel.classList.add("open");
  $("inspector-toggle").classList.add("has-selection");
  panel.replaceChildren(h("div", { class: "insp muted" }, "Loading…"));
  try {
    const d = await json<RelationshipDetail>(`/api/architecture/relationship?id=${encodeURIComponent(id)}`);
    if (state.selected?.id !== id) return;
    panel.replaceChildren(relationshipPanel(d, actions));
  } catch (e) {
    if (state.selected?.id !== id) return;
    panel.replaceChildren(h("div", { class: "insp" }, (e as Error).message));
  }
}

function clearSelection(): void {
  focusHops = 0;
  state.selected = null;
  state.mode = null;
  state.trace = null;
  refreshMarks();
  renderFoot();
  renderInspector();
  writeHash();
}

function renderInspector(): void {
  $("inspector-toggle").classList.remove("has-selection");
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
  if (id === "context:system") { await loadView("system"); return; }
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
    remembered.clear(); state.published = null;
    await loadView(state.view, state.focus);
    announce("Architecture refreshed from the current source index");
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
  document.addEventListener("pointerdown", (event) => {
    for (const menu of document.querySelectorAll<HTMLDetailsElement>("details.menu")) if (!menu.contains(event.target as Node)) menu.open = false;
  });

  document.addEventListener("keydown", (ev) => {
    const typing = (ev.target as HTMLElement).closest("input, textarea, select, [contenteditable=true]");
    if (typing) return;
    if (ev.key === "/") {
      ev.preventDefault();
      ($("search") as HTMLInputElement).focus();
    } else if (ev.key === "f" || ev.key === "F") { if (visibleElements) canvas.fitNodes(visibleElements.nodes); else canvas.fit(); }
    else if (ev.key === "0") canvas.reset();
    else if (ev.key === "+" || ev.key === "=") canvas.zoomBy(1.25);
    else if (ev.key === "-") canvas.zoomBy(0.8);
    else if (ev.key === "Escape") { for (const menu of document.querySelectorAll<HTMLDetailsElement>("details.menu")) menu.open = false; clearSelection(); toggleInspector(false); }
  });
  $("toggle-navigation").addEventListener("click", () => { const collapsed = !$("diagram-navigation").hidden; $("diagram-navigation").hidden = collapsed; document.body.classList.toggle("navigation-collapsed", collapsed); $("toggle-navigation").setAttribute("aria-expanded", String(!collapsed)); });
  $("diagram-query").addEventListener("input", renderCategoryNavigation);
  $("inspect-selection").addEventListener("click", () => toggleInspector(true));
  $("expand-selection").addEventListener("click", () => { if (state.selected?.kind === "node") void openNode(state.selected.id); });
  $("focus-one").addEventListener("click", () => focusSelection(1));
  $("focus-two").addEventListener("click", () => focusSelection(2));
  $("clear-focus").addEventListener("click", () => { focusHops = 0; ($("diagram-filter") as HTMLSelectElement).value = ""; applyVisibility(); });
  $("legend").addEventListener("click", () => { clearSelection(); toggleInspector(true); $("inspector").querySelector(".legend")?.scrollIntoView({ block: "nearest" }); });
  $("coverage").addEventListener("click", () => { ($("view-options") as HTMLDetailsElement).open = false; toggleInspector(true); $("inspector").replaceChildren(h("div", { class: "insp" }, h("h2", {}, "Diagram coverage"), h("p", {}, $("category-description").textContent ?? ""), ...Object.values(CATEGORY_GAPS).map(text => h("p", {}, text)), ...state.summary?.views.filter(v => !v.available).map(v => h("p", {}, `${v.title}: ${v.reason ?? "No evidence"}`)) ?? [])); });
  $("export-menu").addEventListener("click", () => { ($("view-options") as HTMLDetailsElement).open = false; $("export-svg").click(); });
  $("inspector-toggle").addEventListener("click", () => toggleInspector(!inspectorOpen));
  $("documentation").addEventListener("click", () => {
    ($("view-options") as HTMLDetailsElement).open = false;
    const active = document.body.classList.toggle("documentation");
    $("documentation").setAttribute("aria-pressed", String(active));
    $("documentation").textContent = active ? "Exit documentation mode" : "Documentation mode";
  });
  $("fullscreen").addEventListener("click", async () => {
    ($("view-options") as HTMLDetailsElement).open = false;
    try { if (document.fullscreenElement) await document.exitFullscreen(); else await document.documentElement.requestFullscreen(); }
    catch { status("error", "Full screen is unavailable in this browser."); }
  });
  $("export-svg").addEventListener("click", () => { if (state.published?.layout) { exportDiagram($("canvas") as unknown as SVGSVGElement, state.published); announce("SVG download prepared · complete verified diagram"); } });
  $("diagram-filter").addEventListener("change", applyVisibility);
  $("fit").addEventListener("click", () => visibleElements ? canvas.fitNodes(visibleElements.nodes) : canvas.fit());
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
