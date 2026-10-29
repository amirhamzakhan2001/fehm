import type { EngineStatus } from "../../../engine.js";
import { $, fmt, h } from "../../graph/ui/dom.js";

/**
 * Dashboard shell. The address is `/#/<view>` (optionally `?<fragment>`,
 * forwarded to the feature page as its own `#fragment`). Feature pages are
 * framed on first visit and then kept alive, so switching back is instant
 * and keeps their state (camera, selection, scroll). The view list is read
 * from the server-rendered sidebar, which is generated from FEATURES.
 */

interface View {
  id: string;
  title: string;
  /** Page route; absent for the home view. */
  path?: string;
  link: HTMLAnchorElement;
}

interface Frame {
  box: HTMLElement;
  iframe: HTMLIFrameElement;
  loading: HTMLElement;
  loaded: boolean;
  /** Fragment to apply once the page has loaded. */
  pending: string;
  /** The index changed underneath this page; reload it when next shown. */
  stale: boolean;
}

interface Freshness {
  fresh: boolean;
  added: number;
  modified: number;
  deleted: number;
}

const HOME = "home";
const views = new Map<string, View>();
for (const link of document.querySelectorAll<HTMLAnchorElement>("nav .item")) {
  const id = link.dataset.view!;
  views.set(id, { id, title: link.dataset.title ?? id, ...(link.dataset.path ? { path: link.dataset.path } : {}), link });
}
const frames = new Map<string, Frame>();
let active = "";

// ——— Routing ———————————————————————————————————————————————————————————————

function parseHash(): { id: string; inner: string } {
  const raw = location.hash.replace(/^#\/?/, "");
  const q = raw.indexOf("?");
  const requested = decodeURIComponent(q < 0 ? raw : raw.slice(0, q));
  const id = requested === 'ontology' ? 'concepts' : requested;
  return { id: views.has(id) ? id : HOME, inner: q < 0 ? "" : raw.slice(q + 1) };
}

/** Which view serves a same-origin path: `/` is home, otherwise a feature's page route. */
function viewForPath(pathname: string): string | undefined {
  if (pathname === '/ontology' || pathname === '/ontology/') return 'concepts';
  if (pathname === "/") return HOME;
  for (const v of views.values()) if (v.path && (pathname === v.path || pathname === `${v.path}/`)) return v.id;
  return undefined;
}

function frameFor(view: View): Frame {
  const existing = frames.get(view.id);
  if (existing) return existing;
  const iframe = h("iframe", { title: view.title, src: `${view.path}?embedded` });
  const loading = h("div", { class: "loading", role: "status" }, `Loading ${view.title}…`);
  const box = h("section", { class: "view frame", "data-view": view.id, "aria-label": view.title }, iframe, loading);
  const frame: Frame = { box, iframe, loading, loaded: false, pending: "", stale: false };
  iframe.addEventListener("load", () => {
    frame.loaded = true;
    loading.hidden = true;
    if (frame.pending) applyFragment(frame, frame.pending);
    frame.pending = "";
    followLinks(iframe, view.id);
  });
  $("views").append(box);
  frames.set(view.id, frame);
  return frame;
}

function applyFragment(frame: Frame, fragment: string): void {
  const win = frame.iframe.contentWindow;
  if (win && win.location.hash.slice(1) !== fragment) win.location.hash = fragment;
}

/**
 * Links inside a feature page that point at another feature (or the
 * dashboard) switch the dashboard instead of navigating the frame, so a
 * page never ends up nested inside another. Modified clicks keep their
 * default (new tab/window).
 */
function followLinks(iframe: HTMLIFrameElement, ownId: string): void {
  const doc = iframe.contentDocument;
  if (!doc) return;
  doc.addEventListener("click", (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
    if (!a || a.hasAttribute("download") || (a.target && a.target !== "_self")) return;
    const url = new URL(a.href, doc.baseURI);
    if (url.origin !== location.origin) return;
    const target = viewForPath(url.pathname);
    if (!target || target === ownId) return;
    e.preventDefault();
    location.hash = `#/${target}${url.hash.length > 1 ? `?${url.hash.slice(1)}` : ""}`;
  });
}

function show(id: string, inner: string): void {
  const view = views.get(id)!;
  for (const v of views.values()) {
    if (v.id === id) v.link.setAttribute("aria-current", "page");
    else v.link.removeAttribute("aria-current");
  }
  $("view-home").hidden = id !== HOME;
  const frame = view.path ? frameFor(view) : undefined;
  for (const f of frames.values()) f.box.hidden = f !== frame;
  if (frame) {
    if (frame.stale && frame.loaded) {
      frame.stale = false;
      frame.loaded = false;
      frame.loading.hidden = false;
      frame.pending = inner;
      frame.iframe.contentWindow?.location.reload();
    } else if (inner) {
      if (frame.loaded) applyFragment(frame, inner);
      else frame.pending = inner;
    }
  }
  document.title = id === HOME ? "Dashboard · fehm" : `${view.title} · fehm`;
  active = id;
}

function route(): void {
  const { id, inner } = parseHash();
  if (id !== active || inner) show(id, inner);
}

window.addEventListener("hashchange", route);

// ——— Index status ——————————————————————————————————————————————————————————

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init);
  if (!res.ok) throw new Error(`${path} → HTTP ${res.status}`);
  return (await res.json()) as T;
}

type State = "ready" | "busy" | "stale" | "error";

function setState(state: State, text: string): void {
  for (const el of [$("index-status"), $("home-fresh")]) {
    el.dataset.state = state;
    el.querySelector("span")!.textContent = text;
  }
}

function plural(n: number, word: string): string {
  return `${fmt.format(n)} ${word}${n === 1 ? "" : "s"}`;
}

function renderStatus(s: EngineStatus, f: Freshness): void {
  const name = s.root.split(/[\\/]/).filter(Boolean).pop() ?? s.root;
  $("project-name").textContent = name;
  $("project-name").title = s.root;
  $("home-name").textContent = name;
  $("home-root").textContent = s.root;
  const cards: [string, number][] = [
    ["Files", s.stats.files],
    ["Nodes", s.stats.nodes],
    ["Relationships", s.stats.edges],
    ["Unresolved references", s.stats.unresolved],
    ["Fresh summaries", s.summaries.fresh],
  ];
  $("home-stats").replaceChildren(...cards.map(([k, v]) => h("div", { class: "stat" }, h("span", {}, k), h("b", {}, fmt.format(v)))));
  $("home-sync").textContent = `Last sync: ${s.sync.mode} · ${fmt.format(s.sync.durationMs)} ms`;
  const changed = f.added + f.modified + f.deleted;
  if (f.fresh) setState("ready", `Index up to date · ${plural(s.stats.files, "file")}`);
  else setState("stale", `${plural(changed, "file")} changed since indexing`);
}

let lastCheck = 0;

async function refreshStatus(): Promise<void> {
  lastCheck = Date.now();
  try {
    const [status, freshness] = await Promise.all([json<EngineStatus>("/api/status"), json<Freshness>("/api/freshness")]);
    renderStatus(status, freshness);
  } catch (error) {
    setState("error", (error as Error).message);
  }
}

$("rescan").addEventListener("click", async () => {
  const button = $("rescan") as HTMLButtonElement;
  button.disabled = true;
  setState("busy", "Re-indexing…");
  try {
    await json<EngineStatus>("/api/rescan", { method: "POST" });
    // Pages already open were built from the previous index.
    for (const [id, frame] of frames) {
      if (!frame.loaded) continue;
      frame.stale = true;
      if (id === active) show(id, "");
    }
  } catch (error) {
    setState("error", (error as Error).message);
  } finally {
    button.disabled = false;
  }
  await refreshStatus();
});

// The working tree can change while the dashboard is open; re-check cheaply on return.
window.addEventListener("focus", () => {
  if (Date.now() - lastCheck > 5000) void refreshStatus();
});

// ——— Sidebar ———————————————————————————————————————————————————————————————

const COLLAPSED_KEY = "fehm.dashboard.collapsed";

function setCollapsed(collapsed: boolean): void {
  document.body.classList.toggle("collapsed", collapsed);
  const button = $("collapse");
  button.setAttribute("aria-expanded", String(!collapsed));
  button.setAttribute("aria-label", collapsed ? "Expand sidebar" : "Collapse sidebar");
  button.title = collapsed ? "Expand sidebar" : "Collapse sidebar";
  try {
    localStorage.setItem(COLLAPSED_KEY, collapsed ? "1" : "0");
  } catch {
    // storage unavailable; the choice lasts for this visit only
  }
}

$("collapse").addEventListener("click", () => setCollapsed(!document.body.classList.contains("collapsed")));
try {
  if (localStorage.getItem(COLLAPSED_KEY) === "1") setCollapsed(true);
} catch {
  // storage unavailable
}

route();
void refreshStatus();
