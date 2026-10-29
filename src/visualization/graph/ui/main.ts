import { GRAPH_VIEW_SCHEMA, HIERARCHY_EDGE_KINDS, nodeStyle, edgeStyle, type GraphViewPayload } from "../model.js";
import { api } from "./api.js";
import { GraphCanvas } from "./canvas-view.js";
import { $, fmt, h, nodes } from "./dom.js";
import { GraphModel } from "./graph-model.js";
import { Inspector } from "./inspector.js";
import { Search } from "./search.js";
import { Sidebar } from "./sidebar.js";
import { GraphStore, loadView, saveView } from "./store.js";

/** Kinds that existed before saved views recorded `known*Kinds` (graph view schema 1). */
const LEGACY_NODE_KINDS = ["repository", "directory", "file", "package", "class", "interface", "function", "method", "variable", "type"];
const LEGACY_EDGE_KINDS = ["contains", "defines", "imports", "calls", "references", "uses", "extends", "implements"];

type Status = "busy" | "ready" | "stale" | "error";

const store = new GraphStore({
  activeNodeKinds: new Set(),
  activeEdgeKinds: new Set(),
  selected: -1,
  hovered: -1,
  searchQuery: "",
  searchMatches: null,
  labels: true,
  fullscreen: false,
  sidebarOpen: window.innerWidth > 760,
});

let model: GraphModel | undefined;
let canvas: GraphCanvas | undefined;
let root = "";
let lastFreshCheck = 0;

function setStatus(state: Status, text: string): void {
  const el = $("status");
  el.dataset.state = state;
  el.lastElementChild!.textContent = text;
  const refresh = $("refresh");
  if (state === "stale") refresh.setAttribute("data-stale", "");
  else refresh.removeAttribute("data-stale");
}

function overlay(title: string | null, text = "", action?: { label: string; run: () => void }, details?: string): void {
  const el = $("overlay");
  if (title === null) {
    el.hidden = true;
    return;
  }
  el.hidden = false;
  $("overlay-title").textContent = title;
  $("overlay-text").textContent = text;
  const button = $("overlay-action") as HTMLButtonElement;
  button.hidden = !action;
  button.onclick = action ? () => action.run() : null;
  if (action) button.textContent = action.label;
  const d = $("overlay-details");
  d.hidden = !details;
  d.querySelector("pre")!.textContent = details ?? "";
}

let noticeTimer = 0;
function notice(text: string | null, ms = 0): void {
  const el = $("notice");
  clearTimeout(noticeTimer);
  el.hidden = !text;
  el.textContent = text ?? "";
  if (text && ms) noticeTimer = window.setTimeout(() => (el.hidden = true), ms);
}

// ——— UI wiring ————————————————————————————————————————————————————————————————

const focusNode = (i: number): void => canvas?.focusNode(i);
const sidebar = new Sidebar(store, { focus: focusNode, relayout: () => void reload("relayout") });
const inspector = new Inspector(store, { focus: focusNode, frame: (i) => canvas?.fitNode(i) });
const search = new Search(store, () => canvas?.currentVisibility, focusNode);

function tooltip(i: number, sx: number, sy: number): void {
  const el = $("tooltip");
  if (i < 0 || !model) {
    el.hidden = true;
    return;
  }
  const kind = model.kindOf(i);
  const counts = new Map<string, number>();
  for (const e of model.outEdges(i)) {
    const k = model.edgeKindOf(e);
    if (!HIERARCHY_EDGE_KINDS.has(k)) counts.set(edgeStyle(k).label, (counts.get(edgeStyle(k).label) ?? 0) + 1);
  }
  for (const e of model.inEdges(i)) {
    const k = model.edgeKindOf(e);
    if (!HIERARCHY_EDGE_KINDS.has(k)) counts.set(edgeStyle(k).inverse, (counts.get(edgeStyle(k).inverse) ?? 0) + 1);
  }
  const children = model.children(i).length;
  const summary = [...counts].slice(0, 5).map(([k, n]) => `${k.toLowerCase()} ${n}`);
  if (children) summary.push(`${children} inside`);
  const path = model.path(i);
  el.replaceChildren(
    ...nodes(
      h("div", { class: "k" }, nodeStyle(kind).label),
      h("div", {}, kind === "repository" ? model.payload.project : model.names[i]!),
      path ? h("div", { class: "p" }, `${path}${model.line[i] ? `:${model.line[i]}` : ""}`) : null,
      summary.length ? h("div", { class: "c" }, summary.join(" · ")) : null,
    ),
  );
  el.hidden = false;
  const stage = $("stage").getBoundingClientRect();
  const w = el.offsetWidth;
  const hgt = el.offsetHeight;
  el.style.left = `${Math.min(sx + 14, stage.width - w - 8)}px`;
  el.style.top = `${sy + 16 + hgt > stage.height ? sy - hgt - 10 : sy + 16}px`;
}

const LOD_TIERS: [number, string][] = [
  [0.25, "project"],
  [0.9, "folders"],
  [2.2, "files"],
  [6, "symbols"],
  [Infinity, "details"],
];

let lastCounts = "";
function hud(info: { visible: number; visibleEdges: number; zoom: number; fitZoom: number }): void {
  const relative = info.zoom / info.fitZoom;
  const tier = LOD_TIERS.find(([limit]) => relative < limit)![1];
  const sel = store.state.selected;
  $("hud").textContent =
    `${fmt.format(info.visible)} visible · ${fmt.format(info.visibleEdges)} links · ${Math.round(relative * 100)}% · ${tier}${sel >= 0 ? " · 1 selected" : ""}`;
  const counts = `${info.visible}|${info.visibleEdges}`;
  if (counts !== lastCounts) {
    lastCounts = counts;
    sidebar.renderStats(info.visible, info.visibleEdges);
  }
  // Filters that leave nothing to draw should say so instead of looking broken.
  if (info.visible === 0) notice("No graph entities match the current filters.");
  else if ($("notice").textContent === "No graph entities match the current filters.") notice(null);
}

// ——— Loading ————————————————————————————————————————————————————————————————

function install(payload: GraphViewPayload, keepView: boolean): void {
  if (payload.schema !== GRAPH_VIEW_SCHEMA)
    throw new Error(`graph payload schema ${payload.schema} does not match this page (${GRAPH_VIEW_SCHEMA}); reload the page.`);
  const previous = model;
  const selectedId = previous && store.state.selected >= 0 ? previous.ids[store.state.selected] : undefined;
  model = new GraphModel(payload);
  root = payload.root;
  $("project").textContent = payload.project;
  $("project").title = payload.root;
  document.title = `${payload.project} · Codebase Graph · fehm`;

  const saved = keepView ? undefined : loadView(root);
  const allNodes = [...model.nodeKindCounts.keys()];
  const allEdges = [...model.edgeKindCounts.keys()];
  const s = store.state;
  // On refresh keep the user's filters. Kinds new since the filters were set
  // start with their default (visible, except high-volume kinds like fields).
  const initially = (kind: string, known: readonly string[] | undefined, active: (k: string) => boolean, dflt: (k: string) => boolean): boolean =>
    known && known.includes(kind) ? active(kind) : dflt(kind);
  const nodeDefault = (k: string): boolean => !nodeStyle(k).defaultHidden;
  const nodeKinds =
    keepView && previous
      ? allNodes.filter((k) => initially(k, [...previous.nodeKindCounts.keys()], (x) => s.activeNodeKinds.has(x), nodeDefault))
      : saved?.nodeKinds
        ? allNodes.filter((k) => initially(k, saved.knownNodeKinds ?? LEGACY_NODE_KINDS, (x) => saved.nodeKinds!.includes(x), nodeDefault))
        : allNodes.filter(nodeDefault);
  const edgeKinds =
    keepView && previous
      ? allEdges.filter((k) => initially(k, [...previous.edgeKindCounts.keys()], (x) => s.activeEdgeKinds.has(x), () => true))
      : saved?.edgeKinds
        ? allEdges.filter((k) => initially(k, saved.knownEdgeKinds ?? LEGACY_EDGE_KINDS, (x) => saved.edgeKinds!.includes(x), () => true))
        : allEdges;
  const deepLink = new URLSearchParams(location.hash.slice(1)).get("node");
  const wantId = keepView ? selectedId : (deepLink ?? saved?.selectedId);
  const selected = wantId !== undefined ? (model.indexById.get(wantId) ?? -1) : -1;
  store.state.activeNodeKinds = new Set(nodeKinds);
  store.state.activeEdgeKinds = new Set(edgeKinds);
  store.state.selected = selected;
  store.state.hovered = -1;
  store.state.searchMatches = null;
  if (saved?.labels === false) store.state.labels = false;
  $("labels-toggle").setAttribute("aria-pressed", String(store.state.labels));

  canvas!.setModel(model);
  sidebar.setModel(model);
  inspector.setModel(model);
  search.setModel(model);
  if (!keepView) {
    if (deepLink && selected >= 0) canvas!.fitNode(selected, false);
    else if (saved?.camera) canvas!.setCamera(...saved.camera);
    else canvas!.fitAll(false);
  }
  canvas!.request();
  if (model.n > 0 && model.semanticEdges === 0) notice("Nodes are available, but no relationships were detected yet. The hierarchy is still shown.");
  applyConceptOverlay();
  if (deepLink && selected < 0) notice(`No entity “${deepLink}” in this graph.`, 5000);
}

function applyConceptOverlay(): void {
  const conceptId = new URLSearchParams(location.hash.slice(1)).get("concept");
  const currentModel = model;
  if (!conceptId || !currentModel) return;
  void fetch(`/api/concepts/graph?id=${encodeURIComponent(conceptId)}`).then(async response => {
    if (!response.ok) throw new Error("Concept overlay unavailable");
    const overlay = await response.json() as { highlightIds: string[]; concept: { name: string } };
    if (model !== currentModel || new URLSearchParams(location.hash.slice(1)).get("concept") !== conceptId) return;
    const matches = new Set(overlay.highlightIds.flatMap(id => { const i = currentModel.indexById.get(id); return i === undefined ? [] : [i]; }));
    store.set({ selected: -1, searchMatches: matches });
    notice(`${overlay.concept.name}: ${matches.size} evidence-linked entities (scope/status in Concept Intelligence)`, 8000);
  }).catch(error => notice(String(error), 5000));
}

async function start(): Promise<void> {
  overlay("Loading graph…");
  setStatus("busy", "Loading…");
  try {
    if (!canvas) {
      try {
        canvas = new GraphCanvas($("stage"), $("gl") as HTMLCanvasElement, $("labels") as HTMLCanvasElement, store, { hover: tooltip, view: hud });
      } catch (error) {
        setStatus("error", "Unsupported");
        overlay("Graph could not be rendered.", "This page needs WebGL2, which this browser or GPU does not provide.", undefined, (error as Error).message);
        return;
      }
    }
    const status = await api.status();
    $("project").textContent = status.project;
    if (status.state === "empty") {
      setStatus("ready", "Empty");
      overlay("This project has not been indexed yet.", "Fehm found no indexable source files. Add files, then index again.", {
        label: "Start indexing",
        run: () => void reload("refresh"),
      });
      return;
    }
    setStatus("busy", status.layoutCached ? "Loading graph…" : "Computing layout…");
    overlay(
      status.layoutCached ? "Loading graph…" : "Computing layout…",
      `${fmt.format(status.stats.nodes)} entities · ${fmt.format(status.stats.edges)} relationships`,
    );
    const payload = await api.graph();
    setStatus("busy", "Rendering…");
    install(payload, false);
    overlay(null);
    setStatus("ready", "Ready");
    lastFreshCheck = Date.now();
  } catch (error) {
    console.error("[fehm graph] load failed", error);
    setStatus("error", "Error");
    overlay(
      "Graph could not be loaded.",
      "The Fehm server did not return a usable graph.",
      { label: "Retry", run: () => void start() },
      (error as Error).stack ?? String(error),
    );
  }
}

async function reload(kind: "refresh" | "relayout"): Promise<void> {
  if (!canvas) return;
  setStatus("busy", kind === "refresh" ? "Updating…" : "Computing layout…");
  const before = model ? new Set(model.ids) : new Set<string>();
  try {
    const payload = kind === "refresh" ? await api.refresh() : await api.relayout();
    const wasEmpty = !model || model.n === 0;
    install(payload, !wasEmpty && kind === "refresh");
    if (wasEmpty || kind === "relayout") canvas.fitAll(true);
    overlay(payload.stats.files === 0 ? "This project has not been indexed yet." : null, "Fehm found no indexable source files.");
    const after = new Set(payload.nodes.id);
    let added = 0;
    let removed = 0;
    for (const id of after) if (!before.has(id)) added += 1;
    for (const id of before) if (!after.has(id)) removed += 1;
    setStatus("ready", "Ready");
    lastFreshCheck = Date.now();
    if (kind === "refresh")
      notice(added || removed ? `Graph updated · +${fmt.format(added)} / −${fmt.format(removed)} entities` : "Graph is up to date.", 3500);
  } catch (error) {
    console.error("[fehm graph] refresh failed", error);
    setStatus("error", "Update failed");
    notice(`Update failed: ${(error as Error).message}`, 6000);
  }
}

async function checkFreshness(): Promise<void> {
  if (!model || document.hidden || Date.now() - lastFreshCheck < 15_000 || $("status").dataset.state === "busy") return;
  lastFreshCheck = Date.now();
  try {
    const f = await api.freshness();
    if (!f.fresh) setStatus("stale", `Stale · ${fmt.format(f.added + f.modified + f.deleted)} changed`);
    else if ($("status").dataset.state === "stale") setStatus("ready", "Ready");
  } catch {
    // A failed freshness probe is not an error state for the graph itself.
  }
}

// ——— Persistence and deep links —————————————————————————————————————————————

let saveTimer = 0;
function persist(): void {
  clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    if (!model || !canvas) return;
    const s = store.state;
    const cam = canvas.camera;
    saveView(root, {
      nodeKinds: [...s.activeNodeKinds],
      edgeKinds: [...s.activeEdgeKinds],
      knownNodeKinds: [...model.nodeKindCounts.keys()],
      knownEdgeKinds: [...model.edgeKindCounts.keys()],
      ...(s.selected >= 0 ? { selectedId: model.ids[s.selected]! } : {}),
      camera: [cam.cx, cam.cy, cam.zoom],
      labels: s.labels,
    });
  }, 300);
}

store.subscribe((changed, s) => {
  if (changed.has("selected") && model) {
    const url = new URL(location.href);
    url.hash = s.selected >= 0 ? `node=${encodeURIComponent(model.ids[s.selected]!)}` : new URLSearchParams(url.hash.slice(1)).has("concept") ? url.hash : "";
    history.replaceState(null, "", url.hash ? url : url.pathname + url.search);
  }
  if (changed.has("fullscreen")) {
    document.body.classList.toggle("fullscreen", s.fullscreen);
    $("fullscreen").setAttribute("aria-pressed", String(s.fullscreen));
  }
  if (changed.has("sidebarOpen")) document.body.classList.toggle("side-closed", !s.sidebarOpen);
  if (changed.has("labels")) $("labels-toggle").setAttribute("aria-pressed", String(s.labels));
  if (changed.has("activeNodeKinds") && model && s.selected >= 0) {
    // Only clear a selection that the chosen view genuinely cannot show.
    const kind = model.kindOf(s.selected);
    if (!s.activeNodeKinds.has(kind) && !nodeStyle(kind).structural) store.set({ selected: -1 });
  }
  persist();
});
window.addEventListener("pointerup", persist);
window.addEventListener("wheel", persist, { passive: true });
window.addEventListener("hashchange", () => {
  applyConceptOverlay();
  const id = new URLSearchParams(location.hash.slice(1)).get("node");
  const i = id && model ? model.indexById.get(id) : undefined;
  if (i !== undefined && i !== store.state.selected) focusNode(i);
});

// ——— Controls and keyboard ——————————————————————————————————————————————————

$("zoom-in").addEventListener("click", () => canvas?.zoomBy(1.6));
$("zoom-out").addEventListener("click", () => canvas?.zoomBy(1 / 1.6));
$("fit").addEventListener("click", () => fit());
$("labels-toggle").addEventListener("click", () => store.set({ labels: !store.state.labels }));
$("fullscreen").addEventListener("click", () => store.set({ fullscreen: !store.state.fullscreen }));
$("toggle-side").addEventListener("click", () => store.set({ sidebarOpen: !store.state.sidebarOpen }));
$("refresh").addEventListener("click", () => void reload("refresh"));
document.body.classList.toggle("side-closed", !store.state.sidebarOpen);
window.addEventListener("focus", () => void checkFreshness());
document.addEventListener("visibilitychange", () => void checkFreshness());
setInterval(() => void checkFreshness(), 60_000);

function fit(): void {
  const sel = store.state.selected;
  if (sel >= 0) canvas?.fitNode(sel);
  else canvas?.fitAll(true);
}

document.addEventListener("keydown", (e) => {
  const target = e.target as HTMLElement;
  if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || e.metaKey || e.ctrlKey || e.altKey) return;
  switch (e.key) {
    case "/":
      e.preventDefault();
      if (!store.state.sidebarOpen || store.state.fullscreen) store.set({ sidebarOpen: true, fullscreen: false });
      queueMicrotask(() => search.focus());
      break;
    case "Escape":
      if (store.state.selected >= 0) store.set({ selected: -1 });
      else if (store.state.fullscreen) store.set({ fullscreen: false });
      else search.clear();
      break;
    case "f":
      fit();
      break;
    case "F":
      store.set({ fullscreen: !store.state.fullscreen });
      break;
    case "0":
      store.set({ selected: -1 });
      canvas?.fitAll(true);
      break;
    case "+":
    case "=":
      canvas?.zoomBy(1.6);
      break;
    case "-":
    case "_":
      canvas?.zoomBy(1 / 1.6);
      break;
    case "l":
    case "L":
      store.set({ labels: !store.state.labels });
      break;
    default:
      return;
  }
});

void start();
