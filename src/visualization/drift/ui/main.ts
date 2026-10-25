import type { ArchNode } from "../../../architecture/types.js";
import type {
  Attention,
  BaselineSource,
  CommitDetail,
  DecisionKind,
  DriftCategory,
  DriftFinding,
  DriftGroup,
  DriftPagePayload,
  Evidence,
  FindingStatus,
  HistoryPoint,
  MapView,
  ProjectPattern,
  SourceExcerpt,
} from "../../../drift/types.js";
import { DiagramCanvas } from "../../architecture/ui/canvas.js";
import { $, fmt, h, nodes } from "../../graph/ui/dom.js";

/**
 * Feature 3.4 page. One `/api/drift` payload drives every tab; source
 * excerpts, commits, history points and the LLM context are fetched on
 * demand. Wording is always "observed vs common / established".
 *
 * Interaction path (spec §63): overview → category → finding → the map
 * focuses → evidence drawer → source / git.
 */

type Tab = "overview" | "map" | "findings" | "patterns" | "history";
type StatusFilter = "all" | FindingStatus | "decided";

const state: {
  p: DriftPagePayload | null;
  tab: Tab;
  group: "all" | DriftGroup;
  status: StatusFilter;
  confidence: "all" | "high" | "medium" | "low";
  attention: "all" | Attention;
  source: "all" | BaselineSource;
  component: string | null;
  pattern: string | null;
  q: string;
  view: "cards" | "table";
  level: MapView["level"];
  selected: string | null;
  scanning: boolean;
  stop: boolean;
  scanDone: number;
} = { p: null, tab: "overview", group: "all", status: "all", confidence: "all", attention: "all", source: "all", component: null, pattern: null, q: "", view: "cards", level: "components", selected: null, scanning: false, stop: false, scanDone: 0 };

const GROUP_LABEL: Record<DriftGroup, string> = { structure: "Structure", dependencies: "Dependency boundaries", responsibilities: "Responsibilities", patterns: "Patterns", runtime: "Runtime boundaries", engineering: "Engineering organisation", historical: "Historical", ai: "AI-associated signals" };
const CATEGORY_LABEL: Record<DriftCategory, string> = {
  "file-placement": "File placement",
  responsibility: "Responsibility",
  dependency: "Dependency direction",
  layer: "Layer boundary",
  cycle: "Circular dependency",
  pattern: "Project pattern",
  naming: "Naming",
  granularity: "File granularity",
  "module-boundary": "Module boundary",
  configuration: "Configuration",
  testing: "Testing organisation",
  api: "API boundary",
  database: "Database access",
  "external-service": "External service boundary",
  abstraction: "Abstraction",
  "dependency-injection": "Dependency injection",
  "error-handling": "Error handling",
  observability: "Logging / observability",
  "security-boundary": "Security boundary",
  framework: "Framework convention",
  monorepo: "Monorepo boundary",
  historical: "Historical",
  "ai-associated": "AI-associated signal",
};
const BASIS_LABEL: Record<string, string> = { "explicit-rule": "Project rule", "approved-pattern": "Approved pattern", "project-pattern": "Project convention", framework: "Framework convention", industry: "Industry practice", heuristic: "Heuristic" };
const STATUS_LABEL: Record<FindingStatus, string> = { new: "New", existing: "Existing", resolved: "Resolved", undated: "Not dated" };
const ATTENTION: Attention[] = ["critical", "high", "moderate", "low", "informational"];
const TABS: [Tab, string][] = [["overview", "Overview"], ["map", "Drift map"], ["findings", "Findings"], ["patterns", "Patterns"], ["history", "History"]];

// ─── plumbing ───────────────────────────────────────────────────────

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init);
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    body = undefined;
  }
  if (!res.ok) throw new Error((body as { error?: string } | undefined)?.error ?? `HTTP ${res.status}`);
  return body as T;
}
const post = <T>(path: string, body?: unknown): Promise<T> => json<T>(path, { method: "POST", headers: { "x-fehm": "1", "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });

function setStatus(s: "ready" | "busy" | "stale" | "error", text: string): void {
  const el = $("status");
  el.dataset.state = s;
  el.lastElementChild!.textContent = text;
}

let toastTimer = 0;
function toast(text: string): void {
  const t = $("toast");
  t.textContent = text;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (t.hidden = true), 3400);
}

const plural = (n: number, w: string, ws = `${w}s`): string => `${fmt.format(n)} ${n === 1 ? w : ws}`;
const pct = (x: number): string => `${Math.round(x * 100)}%`;
const graphHref = (id: string): string => `/graph#node=${encodeURIComponent(id)}`;
function editorHref(path: string, line?: number): string {
  const root = (state.p?.repository.root ?? "").replace(/\\/g, "/");
  const abs = `${root}/${path}`;
  return `vscode://file/${abs.startsWith("/") ? abs.slice(1) : abs}${line ? `:${line}` : ""}`;
}
const att = (a: Attention): HTMLElement => h("span", { class: `att ${a}`, title: `Attention: ${a} (potential impact, not a quality score)` }, a === "informational" ? "info" : a);
const statusPill = (s: FindingStatus): HTMLElement => h("span", { class: `pill ${s}`, title: s === "undated" ? "Set a baseline or analyse history to date findings" : `Status: ${STATUS_LABEL[s]}` }, STATUS_LABEL[s]);
const confPill = (c: string): HTMLElement => h("span", { class: `pill conf-${c}`, title: "Confidence: how strongly the evidence supports the baseline" }, `${c} confidence`);
const all = (): DriftFinding[] => [...(state.p?.findings ?? []), ...(state.p?.decided ?? [])];
const findingById = (id: string): DriftFinding | undefined => all().find((f) => f.id === id);

// ─── load ───────────────────────────────────────────────────────────

async function load(path = "/api/drift", init?: RequestInit): Promise<void> {
  setStatus("busy", "Analysing…");
  try {
    state.p = await json<DriftPagePayload>(path, init);
    render();
    $("overlay").hidden = true;
    const f = state.p.freshness;
    const refresh = $("refresh");
    if (!f.fresh) refresh.dataset.stale = "";
    else delete refresh.dataset.stale;
    setStatus(f.fresh ? "ready" : "stale", f.fresh ? `${state.p.durationMs} ms` : `${f.added + f.modified + f.deleted} files changed — refresh`);
    fromHash();
    const hist = state.p.history;
    if (hist.git && hist.analysed < hist.commits.length && !state.scanning && !state.stop) void scan();
  } catch (e) {
    setStatus("error", "Failed");
    $("overlay").hidden = false;
    $("overlay-title").textContent = "Could not analyse architecture drift";
    $("overlay-text").textContent = (e as Error).message;
    const retry = $("overlay-action");
    retry.hidden = false;
    retry.onclick = () => void load();
  }
}

// ─── render ─────────────────────────────────────────────────────────

function render(): void {
  const p = state.p!;
  $("project").textContent = p.repository.name;
  document.title = `Architecture Drift · ${p.repository.name} · fehm`;
  renderContext();
  renderTabs();
  renderFilters();
  $("tab-overview").replaceChildren(...overview());
  $("tab-findings").replaceChildren(...findingsTab());
  $("tab-patterns").replaceChildren(...patternsTab());
  $("tab-history").replaceChildren(...historyTab());
  renderMap();
  if (state.selected && findingById(state.selected)) openDrawer(state.selected, false);
}

function renderContext(): void {
  const p = state.p!;
  const c = p.context;
  const b = p.baseline;
  const context = [c.languages[0]?.name, ...c.frameworks.map((f) => f.label), c.projectTypes[0]?.label, c.architectureSignals[0]?.label].filter(Boolean).join(" · ");
  const chk = (on: boolean, label: string, title: string): HTMLElement => h("button", { class: `chk${on ? "" : " off"}`, title, onclick: () => go("patterns") }, h("i", {}, on ? "✓" : "–"), label);
  $("ctx").replaceChildren(
    h("span", {}, h("span", { class: "muted" }, "Context: "), h("b", {}, context || "not determined")),
    h(
      "span",
      { class: "bl" },
      h("span", { class: "muted" }, "Baseline:"),
      b.explicit.rules ? chk(true, `Project rules (${b.explicit.rules})`, `Explicit rules from ${b.explicit.file}`) : null,
      chk(b.project.established > 0, `Project conventions (${b.project.established})`, `${b.project.established} of ${b.project.patterns} mined patterns are established${b.project.approved ? `; ${b.project.approved} approved` : ""}`),
      chk(b.framework.conventions > 0, `Framework conventions${b.framework.frameworks.length ? ` (${b.framework.frameworks.join(", ")})` : ""}`, `${b.framework.conventions} conventions for the detected frameworks`),
      chk(b.industry.practices > 0, `Industry practices (${b.industry.practices})`, `Practices that apply to a ${b.industry.projectType.replace(/-/g, " ")}`),
    ),
  );
}

function renderTabs(): void {
  const p = state.p!;
  const counts: Partial<Record<Tab, number>> = { findings: p.findings.length, patterns: p.baseline.project.established };
  $("tabs").replaceChildren(...TABS.map(([id, label]) => h("button", { role: "tab", "aria-selected": String(state.tab === id), "aria-controls": `tab-${id}`, onclick: () => go(id) }, label, counts[id] !== undefined ? h("i", {}, String(counts[id])) : null)));
  for (const [id] of TABS) $(`tab-${id}`).hidden = state.tab !== id;
  $("filters").hidden = state.tab !== "findings" && state.tab !== "map";
}

function go(tab: Tab): void {
  state.tab = tab;
  renderTabs();
  if (tab === "map")
    requestAnimationFrame(() => {
      mapCanvas?.fit(false);
      markMap();
    });
  window.scrollTo({ top: 0 });
}

function renderFilters(): void {
  const p = state.p!;
  const sel = <T extends string>(label: string, value: T, options: [T, string][], set: (v: T) => void): HTMLElement => {
    const s = h("select", { "aria-label": label }, ...options.map(([v, l]) => h("option", { value: v, ...(v === value ? { selected: true } : {}) }, l))) as HTMLSelectElement;
    s.addEventListener("change", () => {
      set(s.value as T);
      refreshLists();
    });
    return h("label", {}, label, s);
  };
  const groups = (Object.keys(GROUP_LABEL) as DriftGroup[]).filter((g) => p.summary.byGroup[g]);
  $("filters").replaceChildren(
    ...nodes(sel("Category", state.group, [["all", "All"], ...groups.map((g): ["all" | DriftGroup, string] => [g, `${GROUP_LABEL[g]} (${p.summary.byGroup[g]})`])], (v) => (state.group = v)),
    sel("Status", state.status, [["all", "All open"], ["new", "New"], ["existing", "Existing"], ["undated", "Not dated"], ["decided", `Decided (${p.decided.length})`]], (v) => (state.status = v)),
    sel("Confidence", state.confidence, [["all", "All"], ["high", "High"], ["medium", "Medium"], ["low", "Low"]], (v) => (state.confidence = v)),
    sel("Attention", state.attention, [["all", "All"], ...ATTENTION.map((a): ["all" | Attention, string] => [a, a.charAt(0).toUpperCase() + a.slice(1)])], (v) => (state.attention = v)),
    sel("Source", state.source, [["all", "All"], ["project", "Project convention"], ["framework", "Framework convention"], ["industry", "Industry practice"], ["historical", "Historical"], ["heuristic", "Heuristic"]], (v) => (state.source = v)),
    state.component || state.pattern || state.q
      ? h("button", { class: "act", onclick: () => ((state.component = null), (state.pattern = null), (state.q = ""), (($("search") as HTMLInputElement).value = ""), renderFilters(), refreshLists()) }, `× ${state.component ? `component ${compName(state.component)}` : state.pattern ? `pattern ${state.pattern}` : `"${state.q}"`}`)
      : null,
  ));
}

const compName = (id: string): string => state.p?.map.components.nodes.find((n) => n.id === id)?.name ?? id.replace(/^component:/, "");

function visible(): DriftFinding[] {
  const p = state.p!;
  const base = state.status === "decided" ? p.decided : p.findings;
  return base.filter(
    (f) =>
      (state.group === "all" || f.group === state.group) &&
      (state.status === "all" || state.status === "decided" || f.status === state.status) &&
      (state.confidence === "all" || f.confidence === state.confidence) &&
      (state.attention === "all" || f.attention === state.attention) &&
      (state.source === "all" || f.source === state.source) &&
      (!state.component || f.unit?.component === state.component || f.map.nodes.includes(state.component)) &&
      (!state.pattern || f.pattern === state.pattern) &&
      (!state.q || [f.title, f.observed, f.baseline, f.id, f.unit?.path ?? "", ...f.evidence.map((e) => e.path)].join(" ").toLowerCase().includes(state.q)),
  );
}

function refreshLists(): void {
  $("tab-findings").replaceChildren(...findingsTab());
  renderMapSide();
  markMap();
}

// ─── overview ───────────────────────────────────────────────────────

function overview(): Node[] {
  const p = state.p!;
  const s = p.summary;
  const hist = p.history;
  const dated = Boolean(hist.comparison);
  const stat = (cls: string, n: number | string, label: string, onclick: () => void, title: string): HTMLElement => h("button", { class: `stat ${cls}`, title, onclick }, h("b", {}, String(n)), h("span", {}, label));
  const hero = h(
    "div",
    { class: "card sec" },
    h("span", { class: "eyebrow" }, "Feature 3.4"),
    h("h1", {}, "Architecture drift"),
    h("p", { class: "lead" }, "Where the implementation differs from patterns established in this project, its frameworks and common practice. Observed deviations with evidence — not verdicts. You decide what is intentional."),
    h(
      "div",
      { class: "stats" },
      stat("", s.findings, "Findings", () => ((state.status = "all"), renderFilters(), go("findings"), refreshLists()), "Open deviations (decided ones are kept apart)"),
      stat("new", dated ? s.new : "—", dated ? "New" : state.scanning ? "New (analysing history…)" : "New (not dated yet)", () => ((state.status = "new"), renderFilters(), go("findings"), refreshLists()), dated ? `Compared with ${hist.comparison!.label}` : "Set a baseline or let the git window be analysed"),
      stat("hi", s.highAttention, "High attention", () => ((state.attention = "high"), renderFilters(), go("findings"), refreshLists()), "Attention describes potential impact, not badness"),
      stat("", s.patterns, "Patterns detected", () => go("patterns"), "Established project conventions"),
      stat("", s.categories, "Categories affected", () => go("findings"), "Distinct drift categories with findings"),
    ),
  );
  const c = p.context;
  const baseline = h(
    "div",
    { class: "card sec" },
    h("header", {}, h("h2", {}, "Reference baseline"), h("span", { class: "q" }, "Context first: which practices apply depends on what this project is.")),
    h(
      "dl",
      { class: "kv" },
      h("dt", {}, "Project"),
      h("dd", {}, p.repository.name),
      h("dt", {}, "Languages"),
      h("dd", {}, c.languages.slice(0, 4).map((l) => `${l.name} ${pct(l.share)}`).join(" · ") || "—"),
      h("dt", {}, "Frameworks"),
      h("dd", {}, c.frameworks.length ? details(c.frameworks.map((f) => f.label).join(", "), c.frameworks.flatMap((f) => f.evidence.map((e) => `${f.label}: ${e}`))) : "none detected"),
      h("dt", {}, "Project type"),
      h("dd", {}, c.projectTypes.length ? details(c.projectTypes.map((t) => t.label).join(" · "), c.projectTypes.flatMap((t) => t.evidence.map((e) => `${t.label}: ${e}`))) : "not determined"),
      h("dt", {}, "Architecture signals"),
      h("dd", {}, details(c.architectureSignals.map((a) => a.label).join(" · "), c.architectureSignals.flatMap((a) => a.evidence.map((e) => `${a.label}: ${e}`)))),
      h("dt", {}, "Scale"),
      h("dd", {}, `${c.scale.label} — ${plural(c.scale.sourceFiles, "source file")}, ${fmt.format(c.scale.lines)} lines`),
      ...(c.workspaces.length ? [h("dt", {}, "Workspaces"), h("dd", {}, c.workspaces.map((w) => `${w.path} (${w.kind})`).join(", "))] : []),
      h("dt", {}, "Baselines"),
      h("dd", {}, [p.baseline.explicit.rules ? `✓ ${p.baseline.explicit.rules} project rules` : "", `${p.baseline.project.established ? "✓" : "–"} ${p.baseline.project.established} project conventions`, `${p.baseline.framework.conventions ? "✓" : "–"} ${p.baseline.framework.conventions} framework conventions`, `${p.baseline.industry.practices ? "✓" : "–"} ${p.baseline.industry.practices} industry practices`].filter(Boolean).join(" · ")),
    ),
    p.baseline.explicit.rejected ? h("p", { class: "note", style: "color:var(--likely);margin-top:8px" }, `${p.baseline.explicit.rejected.file} could not be used: ${p.baseline.explicit.rejected.issues.map((i) => `${i.path} ${i.message}`).join("; ")}`) : null,
  );
  const clusters = h(
    "div",
    { class: "card sec" },
    h("header", {}, h("h2", {}, "Drift clusters"), h("span", { class: "q" }, "Click to filter")),
    h("div", { class: "clusters" }, ...p.clusters.filter((x) => x.kind === "group").map((x) => clusterButton(x.label, x.findings.length, x.categories, () => ((state.group = x.id.slice(6) as DriftGroup), renderFilters(), go("findings"), refreshLists())))),
    p.clusters.some((x) => x.kind === "module") ? h("h3", { class: "eyebrow", style: "margin:12px 0 6px" }, "By component") : null,
    h("div", { class: "clusters" }, ...p.clusters.filter((x) => x.kind === "module").map((x) => clusterButton(x.label, x.findings.length, x.categories, () => ((state.component = x.id), renderFilters(), go("findings"), refreshLists())))),
    p.clusters.length ? null : h("div", { class: "emptyline" }, "No deviations from the established baseline were found."),
  );
  const top = p.findings.filter((f) => f.group !== "ai").slice(0, 6);
  return [
    hero,
    h(
      "div",
      { class: "cols-2", style: "margin-top:14px" },
      h("div", { class: "grid" }, baseline, h("div", { class: "card sec" }, h("header", {}, h("h2", {}, "Highest attention"), h("span", { class: "q" }, "Attention = potential impact, not a quality score")), top.length ? h("div", { class: "flist" }, ...top.map((f) => card(f))) : h("div", { class: "emptyline" }, "Nothing here."))),
      h("div", { class: "grid" }, clusters, aiPanel(), h("div", { class: "card sec" }, h("header", {}, h("h2", {}, "Not determined")), h("ul", { class: "unknowns" }, ...p.unknowns.map((u) => h("li", {}, u))))),
    ),
  ];
}

function details(summary: string, items: string[]): Node {
  if (!items.length) return document.createTextNode(summary);
  return h("details", {}, h("summary", {}, summary), h("ul", {}, ...items.slice(0, 12).map((i) => h("li", {}, i))));
}

function clusterButton(label: string, n: number, categories: DriftCategory[], onclick: () => void): HTMLElement {
  return h("button", { class: "cl", onclick }, h("span", {}, label), h("b", {}, String(n)), categories.length ? h("span", { class: "c" }, categories.map((c) => CATEGORY_LABEL[c]).join(" · ")) : null);
}

function aiPanel(): HTMLElement {
  const p = state.p!;
  const ai = p.findings.filter((f) => f.category === "ai-associated");
  const inconsistent = p.findings.filter((f) => (f.group === "dependencies" || f.group === "runtime") && f.source === "project").length;
  const naming = p.findings.filter((f) => f.category === "naming").length;
  const changes = p.history.changes;
  const sudden = (changes ?? []).filter((c, i, arr) => i > 0 && c.files - arr[i - 1]!.files >= Math.max(20, arr[i - 1]!.files * 0.3));
  const row = (label: string, n: number | null, onclick?: () => void, title?: string): HTMLElement =>
    h("tr", { class: onclick && n ? "clickable" : "", ...(onclick && n ? { onclick } : {}), ...(title ? { title } : {}) }, h("td", {}, label), h("td", {}, n === null ? h("span", { class: "muted" }, "needs history") : n ? h("span", { class: "pill" }, `Review · ${n}`) : h("span", { class: "no" }, "not found")));
  return h(
    "div",
    { class: "card sec" },
    h("header", {}, h("h2", {}, "AI-associated structural signals")),
    h("div", { class: "disclaimer" }, h("b", {}, "These signals do not establish authorship."), " Each also comes from ordinary engineering (prototyping, generated code, deadlines). Published detectors for AI-written code do not generalise reliably; Fehm makes no claim about who or what wrote any code."),
    h(
      "div",
      { class: "tscroll", style: "margin-top:8px" },
      h(
        "table",
        { class: "t" },
        h(
          "tbody",
          {},
          row("Architecture inconsistency", inconsistent, () => ((state.group = "dependencies"), renderFilters(), go("findings"), refreshLists())),
          ...ai.map((f) => row(f.title.replace(/^\d+\s+/, "").replace(/^./, (x) => x.toUpperCase()), f.evidence.length + f.more, () => openDrawer(f.id))),
          row("Unusual naming", naming, () => ((state.group = "structure"), renderFilters(), go("findings"), refreshLists())),
          row("Sudden structural change", changes ? sudden.length : null, () => go("history"), "A commit that grew the source by 30% or 20+ files"),
        ),
      ),
    ),
  );
}

// ─── finding cards and table ────────────────────────────────────────

function card(f: DriftFinding): HTMLElement {
  return h(
    "div",
    { class: `fc ${f.attention}${state.selected === f.id ? " sel" : ""}`, "data-id": f.id },
    h(
      "button",
      { class: "head", onclick: () => openDrawer(f.id), "aria-label": `${f.title}. Open evidence` },
      h("span", { class: "t" }, f.title),
      h("span", { class: "meta" }, att(f.attention), confPill(f.confidence), statusPill(f.status), f.decision ? h("span", { class: "pill" }, f.decision.kind) : null),
      h("span", { class: "line" }, h("span", {}, "Observed: "), f.observed),
      h("span", { class: "line" }, h("span", {}, `${BASIS_LABEL[f.basis]}: `), f.baseline),
      f.related.length ? h("span", { class: "line" }, h("span", {}, "Related signals: "), f.related.map((r) => CATEGORY_LABEL[r.category]).join(", ")) : null,
    ),
  );
}

function findingsTab(): Node[] {
  const list = visible();
  const toggle = h(
    "span",
    { class: "maplevel", style: "position:static" },
    h("button", { "aria-pressed": String(state.view === "cards"), onclick: () => ((state.view = "cards"), refreshLists()) }, "Cards"),
    h("button", { "aria-pressed": String(state.view === "table"), onclick: () => ((state.view = "table"), refreshLists()) }, "Table"),
  );
  const header = h("header", {}, h("h2", {}, "Findings"), h("span", { class: "q" }, `${plural(list.length, "finding")} shown · grouped by architectural dimension · sorted by attention`), h("span", { style: "flex:1" }), toggle);
  if (!list.length) return [h("div", { class: "card sec" }, header, h("div", { class: "emptyline" }, state.status === "decided" ? "No decided findings." : "No findings match these filters."))];
  if (state.view === "table") {
    const rows = list.map((f) => h("tr", { class: "clickable", onclick: () => openDrawer(f.id) }, h("td", {}, CATEGORY_LABEL[f.category]), h("td", {}, f.observed), h("td", {}, f.baseline), h("td", {}, BASIS_LABEL[f.basis]), h("td", {}, f.confidence), h("td", {}, att(f.attention)), h("td", {}, STATUS_LABEL[f.status])));
    return [h("div", { class: "card sec" }, header, h("div", { class: "tscroll" }, h("table", { class: "t" }, h("thead", {}, h("tr", {}, ...["Category", "Observed", "Baseline", "Source", "Confidence", "Attention", "Status"].map((x) => h("th", {}, x)))), h("tbody", {}, ...rows))))];
  }
  const out: Node[] = [];
  for (const g of Object.keys(GROUP_LABEL) as DriftGroup[]) {
    const fs = list.filter((f) => f.group === g);
    if (fs.length) out.push(h("div", { class: "grp" }, GROUP_LABEL[g], h("i", {}, String(fs.length))), h("div", { class: "flist" }, ...fs.map(card)));
  }
  return [h("div", { class: "card sec" }, header, ...out)];
}

// ─── drift map ──────────────────────────────────────────────────────

let mapCanvas: DiagramCanvas | undefined;
let mapSelectedNode: string | null = null;

function renderMap(): void {
  const p = state.p!;
  const view = p.map[state.level];
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("role", "application");
  svg.setAttribute("aria-label", `Drift map, ${view.title}`);
  const stage = h(
    "div",
    { class: "mapstage" },
    h("div", { class: "maplevel", role: "group", "aria-label": "Level" }, ...(["components", "modules"] as const).map((l) => h("button", { "aria-pressed": String(state.level === l), onclick: () => ((state.level = l), renderMap()) }, l === "components" ? "Components" : "Modules"))),
    h("div", { class: "maptools" }, h("button", { onclick: () => mapCanvas?.fit(), title: "Fit" }, "Fit"), h("button", { onclick: () => clearMapSelection(), title: "Clear selection" }, "Clear")),
  );
  if (view.layout) stage.append(svg);
  else stage.append(h("div", { class: "empty" }, view.note ?? "No layout."));
  const key = (cls: string, label: string): HTMLElement => {
    const s = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    s.setAttribute("width", "26");
    s.setAttribute("height", "8");
    s.innerHTML = `<line x1="1" y1="4" x2="25" y2="4" class="${cls}"/>`;
    return h("span", { class: "key" }, s, label);
  };
  $("tab-map").replaceChildren(
    h(
      "div",
      { class: "maplayout" },
      h("div", { class: "clside side card sec", id: "map-clusters" }),
      h("div", {}, stage, h("div", { class: "maplegend" }, key("k-ok", "relationship"), key("k-mod", "carries a deviation"), key("k-hi", "carries a high-attention deviation"), h("span", {}, "Highlighted nodes hold findings (badge = count). Drag to pan · pinch or Ctrl/⌘+scroll to zoom.")), h("div", { id: "map-eo", style: "margin-top:12px" })),
      h("div", { class: "side", id: "map-side" }),
    ),
  );
  mapCanvas = undefined;
  if (view.layout) {
    const nodes = new Map<string, ArchNode>(view.nodes.map((n) => [n.id, { id: n.id, type: n.type, level: 1, name: n.name, role: { confidence: n.confidence, reasons: [] }, children: [], files: n.files, symbols: 0, technologies: [], evidence: [], tier: 1 }]));
    mapCanvas = new DiagramCanvas(svg, { selectNode: (id) => selectMapNode(id), selectEdge: (id) => selectMapEdge(id), open: (id) => selectMapNode(id), clear: () => clearMapSelection(), zoomed: () => undefined }, { wheel: "modifier" });
    mapCanvas.render(view.layout, nodes);
    decorateNodes(svg, view);
    markMap();
  }
  renderMapSide();
}

function decorateNodes(svg: SVGSVGElement, view: MapView): void {
  const NS = "http://www.w3.org/2000/svg";
  for (const [id, ids] of Object.entries(view.marks.nodes)) {
    const g = svg.querySelector<SVGGElement>(`g.node[data-id="${CSS.escape(id)}"]`);
    const n = view.layout?.nodes.find((x) => x.id === id);
    if (!g || !n) continue;
    const hot = ids.some((fid) => ["high", "critical"].includes(findingById(fid)?.attention ?? ""));
    g.classList.add("drifted");
    if (hot) g.classList.add("hot");
    const badge = document.createElementNS(NS, "g");
    badge.setAttribute("class", "badge");
    const c = document.createElementNS(NS, "circle");
    c.setAttribute("r", "9");
    const t = document.createElementNS(NS, "text");
    t.setAttribute("y", "3.5");
    t.setAttribute("text-anchor", "middle");
    t.textContent = String(ids.length);
    const title = document.createElementNS(NS, "title");
    title.textContent = `${n.lines.join(" ")}: ${plural(ids.length, "finding")}`;
    badge.append(c, t, title);
    g.append(badge);
  }
}

/** Emphasise the selected finding's anchors and dim the rest (the 3.1 interaction). */
function markMap(): void {
  if (!mapCanvas) return;
  const f = state.selected ? findingById(state.selected) : undefined;
  const view = state.p!.map[state.level];
  if (f) {
    const nodes = new Set((state.level === "components" ? f.map.nodes : f.map.modules).filter((n) => view.nodes.some((x) => x.id === n)));
    const edges = new Set((state.level === "components" ? f.map.edges : f.map.moduleEdges).filter((e) => view.layout?.edges.some((x) => x.id === e)));
    for (const e of view.layout?.edges ?? []) if (edges.has(e.id)) (nodes.add(e.source), nodes.add(e.target));
    if (!nodes.size) {
      mapCanvas.mark(null, null);
      return;
    }
    const first = [...edges][0];
    mapCanvas.mark(first ? { kind: "edge", id: first } : { kind: "node", id: [...nodes][0]! }, { nodes, edges });
    if (state.tab === "map") mapCanvas.center(first ? view.layout!.edges.find((e) => e.id === first)!.target : [...nodes][0]!);
  } else if (mapSelectedNode) mapCanvas.mark({ kind: "node", id: mapSelectedNode }, null);
  else mapCanvas.mark(null, null);
}

function selectMapNode(id: string): void {
  mapSelectedNode = id;
  state.selected = null;
  markMap();
  renderMapSide();
}

function selectMapEdge(id: string): void {
  const view = state.p!.map[state.level];
  const f = state.p!.findings.find((x) => (state.level === "components" ? x.map.edges : x.map.moduleEdges).includes(id));
  if (f) selectFinding(f.id);
  else {
    const e = view.layout?.edges.find((x) => x.id === id);
    toast(e ? `${nameOf(view, e.source)} → ${nameOf(view, e.target)}: no deviation recorded on this relationship` : "No deviation recorded on this relationship");
  }
}

const nameOf = (view: MapView, id: string): string => view.nodes.find((n) => n.id === id)?.name ?? id;

function clearMapSelection(): void {
  mapSelectedNode = null;
  state.selected = null;
  markMap();
  renderMapSide();
}

function selectFinding(id: string): void {
  state.selected = id;
  mapSelectedNode = null;
  markMap();
  renderMapSide();
}

function renderMapSide(): void {
  const side = document.getElementById("map-side");
  const clusters = document.getElementById("map-clusters");
  const eo = document.getElementById("map-eo");
  if (!side || !clusters || !eo) return;
  const p = state.p!;
  const view = p.map[state.level];
  const shown = visible();
  clusters.replaceChildren(
    h("h3", { class: "eyebrow", style: "margin:0 0 6px" }, "Drift clusters"),
    h(
      "div",
      { class: "clusters" },
      clusterButton("All", p.findings.length, [], () => ((state.group = "all"), renderFilters(), refreshLists())),
      ...p.clusters.filter((c) => c.kind === "group").map((c) => {
        const b = clusterButton(c.label, c.findings.length, [], () => ((state.group = c.id.slice(6) as DriftGroup), renderFilters(), refreshLists()));
        b.setAttribute("aria-pressed", String(state.group === c.id.slice(6)));
        return b;
      }),
    ),
  );
  const f = state.selected ? findingById(state.selected) : undefined;
  if (f) {
    side.replaceChildren(h("div", { class: "card sec" }, h("span", { class: "eyebrow" }, CATEGORY_LABEL[f.category]), h("h3", { style: "margin:4px 0 8px;font-size:14px" }, f.title), h("div", { class: "dacts", style: "margin-bottom:8px" }, att(f.attention), confPill(f.confidence), statusPill(f.status)), h("p", { class: "note" }, h("b", {}, "Observed: "), f.observed), h("p", { class: "note" }, h("b", {}, "Established: "), f.baseline), (state.level === "components" ? f.map.nodes : f.map.modules).length ? null : h("p", { class: "note" }, "This finding has no place on this map level."), h("div", { class: "dacts", style: "margin-top:8px" }, h("button", { class: "primary", onclick: () => openDrawer(f.id) }, "Evidence"), h("button", { onclick: () => clearMapSelection() }, "Clear"))));
    eo.replaceChildren(expectedObserved(f));
    return;
  }
  eo.replaceChildren();
  if (mapSelectedNode) {
    const ids = view.marks.nodes[mapSelectedNode] ?? [];
    const fs = ids.map(findingById).filter((x): x is DriftFinding => Boolean(x));
    const byCat = new Map<DriftCategory, number>();
    for (const x of fs) byCat.set(x.category, (byCat.get(x.category) ?? 0) + 1);
    side.replaceChildren(h("div", { class: "card sec" }, h("span", { class: "eyebrow" }, "Selected"), h("h3", { style: "margin:4px 0 8px;font-size:14px" }, nameOf(view, mapSelectedNode)), fs.length ? h("p", { class: "note" }, [...byCat].map(([c, n]) => `${n} ${CATEGORY_LABEL[c].toLowerCase()}`).join(" · ")) : h("p", { class: "note" }, "No drift involves this node."), h("div", { class: "clusters", style: "margin-top:8px" }, ...fs.slice(0, 20).map((x) => h("button", { class: "cl", onclick: () => selectFinding(x.id) }, h("span", {}, x.title), att(x.attention))))));
    return;
  }
  const onLevel = shown.filter((x) => (state.level === "components" ? x.map.nodes : x.map.modules).length);
  side.replaceChildren(h("div", { class: "card sec" }, h("span", { class: "eyebrow" }, `Findings on this map (${onLevel.length})`), h("div", { class: "clusters", style: "margin-top:8px" }, ...onLevel.slice(0, 40).map((x) => h("button", { class: "cl", onclick: () => selectFinding(x.id) }, h("span", {}, x.title), att(x.attention)))), onLevel.length ? null : h("p", { class: "note" }, "No findings with a place on this map match the filters.")));
}

/** "Observed vs common practice" side by side (spec §44). */
function expectedObserved(f: DriftFinding): HTMLElement {
  const chain = (items: string[] | undefined, deviating: boolean): HTMLElement => {
    const box = h("div", { class: "chain" });
    (items ?? []).forEach((x, i) => {
      if (i) box.append(h("span", { class: "arr" }, "↓"));
      box.append(h("span", { class: `n${deviating && i === (items ?? []).length - 1 ? " dev" : ""}` }, x));
    });
    return box;
  };
  return h(
    "div",
    { class: "card sec" },
    h("header", {}, h("h2", {}, "Observed vs common practice"), h("span", { class: "q" }, BASIS_LABEL[f.basis])),
    h("div", { class: "eo" }, h("div", { class: "c" }, h("h4", {}, "Common / established"), f.commonChain ? chain(f.commonChain, false) : null, h("p", { class: "txt" }, f.baseline)), h("div", { class: "o" }, h("h4", {}, "Observed"), f.observedChain ? chain(f.observedChain, true) : null, h("p", { class: "txt" }, f.observed))),
  );
}

// ─── patterns ───────────────────────────────────────────────────────

function patternsTab(): Node[] {
  const p = state.p!;
  const sorted = [...p.patterns].sort((a, b) => Number(b.established) - Number(a.established) || b.comparable - a.comparable);
  const cmp = p.comparison.map((r) =>
    h(
      "tr",
      {},
      h("td", {}, r.practice),
      h("td", {}, r.industry ? h("span", { class: "ok" }, "✓") : h("span", { class: "no" }, "–")),
      h("td", {}, r.framework ? h("span", { class: "ok" }, `✓ ${r.framework}`) : h("span", { class: "no" }, "–")),
      h("td", {}, r.project ? `${pct(r.project.share)} of ${r.project.comparable}` : h("span", { class: "no" }, "no project evidence")),
      h("td", {}, r.deviations ? h("span", { class: "pill" }, `${r.deviations} deviating`) : h("span", { class: "ok" }, "✓")),
    ),
  );
  const out: (HTMLElement | null)[] = [
    h("div", { class: "card sec" }, h("header", {}, h("h2", {}, "Industry vs project vs observed"), h("span", { class: "q" }, "Why something became a finding: which baselines agree, and how strongly the project itself follows them.")), cmp.length ? h("div", { class: "tscroll" }, h("table", { class: "t" }, h("thead", {}, h("tr", {}, ...["Practice", "Industry", "Framework", "Project", "Observed"].map((x) => h("th", {}, x)))), h("tbody", {}, ...cmp))) : h("div", { class: "emptyline" }, "No framework or industry practices apply to this project type.")),
    p.rules.length ? h("div", { class: "card sec", style: "margin-top:14px" }, h("header", {}, h("h2", {}, "Explicit project rules"), h("span", { class: "q" }, p.baseline.explicit.file ?? "")), h("div", { class: "tscroll" }, h("table", { class: "t" }, h("thead", {}, h("tr", {}, h("th", {}, "Rule"), h("th", {}, "States"), h("th", {}, "Result"))), h("tbody", {}, ...p.rules.map((r) => h("tr", {}, h("td", {}, h("code", {}, r.id)), h("td", {}, r.text), h("td", {}, r.status === "deviation" ? h("span", { class: "pill" }, `${r.deviations} deviating`) : r.status === "met" ? h("span", { class: "ok" }, "no deviation") : h("span", { class: "muted" }, "not exercised")))))))) : null,
    h("div", { class: "card sec", style: "margin-top:14px" }, h("header", {}, h("h2", {}, "Project patterns"), h("span", { class: "q" }, "What Fehm learned from this codebase. Established patterns produce findings; approve, reject or ignore them to shape the baseline.")), sorted.length ? h("div", { class: "pgrid" }, ...sorted.map(patternCard)) : h("div", { class: "emptyline" }, "Too few comparable units to mine conventions.")),
  ];
  return out.filter((x): x is HTMLElement => Boolean(x));
}

function patternCard(x: ProjectPattern): HTMLElement {
  const p = state.p!;
  const decide = async (d: "approved" | "rejected" | "ignored" | "clear"): Promise<void> => {
    try {
      await post("/api/drift/pattern", { id: x.id, decision: d });
      toast(d === "clear" ? "Decision cleared." : `Pattern ${d}. Saved in .fehm/drift-decisions.json.`);
      await load();
    } catch (e) {
      toast(`Could not save: ${(e as Error).message}`);
    }
  };
  const deviating = p.findings.filter((f) => f.pattern === x.id).length;
  return h(
    "div",
    { class: `pc${x.established ? "" : " weak"}` },
    h("h3", {}, h("span", {}, x.name), h("span", { class: "pill" }, x.decision ? x.decision : x.established ? `established · ${x.confidence}` : "candidate")),
    h("div", { class: "st" }, `${x.statement} — ${x.matching} of ${x.comparable} ${x.unitLabel} (${pct(x.frequency)})`),
    h("div", { class: "bars", role: "img", "aria-label": x.distribution.map((d) => `${d.label} ${pct(d.share)}`).join(", ") }, ...x.distribution.slice(0, 6).map((d) => h("div", { class: "r" }, h("span", { class: "l", title: d.label }, d.label), h("span", { class: "track" }, h("i", { style: `width:${Math.max(2, Math.round(d.share * 100))}%` })), h("span", { class: "v" }, `${d.count} · ${pct(d.share)}`)))),
    x.examples.length ? h("div", { class: "note" }, "e.g. ", x.examples.slice(0, 2).map((e) => e.path).join(", ")) : null,
    h(
      "div",
      { class: "acts" },
      deviating ? h("button", { onclick: () => ((state.pattern = x.id), renderFilters(), go("findings"), refreshLists()) }, `${deviating} deviating`) : null,
      ...(["approved", "rejected", "ignored"] as const).map((d) => h("button", { "aria-pressed": String(x.decision === d), disabled: !p.writable, onclick: () => void decide(d) }, d === "approved" ? "Approve" : d === "rejected" ? "Reject" : "Ignore")),
      x.decision ? h("button", { disabled: !p.writable, onclick: () => void decide("clear") }, "Clear") : null,
    ),
  );
}

// ─── history ────────────────────────────────────────────────────────

async function scan(): Promise<void> {
  const p = state.p;
  if (!p?.history.git) return;
  state.scanning = true;
  state.stop = false;
  state.scanDone = 0;
  $("tab-history").replaceChildren(...historyTab());
  for (const c of p.history.commits) {
    if (state.stop) break;
    try {
      const pt = await json<HistoryPoint>(`/api/drift/history/point?ref=${encodeURIComponent(c.ref)}`);
      if (pt.error) toast(pt.error);
    } catch (e) {
      toast(`History stopped: ${(e as Error).message}`);
      state.stop = true;
      break;
    }
    state.scanDone += 1;
    if (state.tab === "history") $("tab-history").replaceChildren(...historyTab());
    setStatus("busy", `History ${state.scanDone}/${p.history.commits.length}`);
  }
  state.scanning = false;
  if (!state.stop) await load();
  else if (state.p) $("tab-history").replaceChildren(...historyTab());
}

function historyTab(): Node[] {
  const p = state.p!;
  const hist = p.history;
  const setBaseline = async (clear = false): Promise<void> => {
    try {
      await post(`/api/drift/baseline${clear ? "?clear=1" : ""}`);
      toast(clear ? "Baseline cleared." : "Baseline set: today's findings count as existing; later ones as new.");
      await load();
    } catch (e) {
      toast(`Could not update the baseline: ${(e as Error).message}`);
    }
  };
  const complete = hist.analysed === hist.commits.length;
  const controls = h(
    "div",
    { class: "card sec" },
    h("header", {}, h("h2", {}, "History"), h("span", { class: "q" }, "Number of detected deviations over time — not an architecture quality score.")),
    h("p", { class: "note" }, hist.comparison ? `"New" is measured against ${hist.comparison.label}. ${plural(p.summary.new, "finding")} new; ${plural(hist.resolved.length, "finding")} resolved since.` : hist.git ? "Findings are dated once the recent commits are analysed: each commit's code is measured against today's rules and decisions." : hist.reason ?? ""),
    hist.git
      ? h(
          "div",
          { style: "margin-top:8px" },
          h("div", { class: "dacts" }, h("button", { disabled: state.scanning || complete, onclick: () => void scan() }, state.scanning ? `Analysing… ${state.scanDone}/${hist.commits.length}` : complete ? `${hist.commits.length} commits analysed` : `Analyse ${hist.commits.length} commits`), state.scanning ? h("button", { onclick: () => ((state.stop = true), toast("Stopping after the current commit.")) }, "Stop") : null),
          state.scanning ? h("div", { class: "progress" }, h("i", { style: `width:${Math.round((state.scanDone / Math.max(1, hist.commits.length)) * 100)}%` })) : null,
        )
      : null,
    h("div", { class: "dacts", style: "margin-top:10px;align-items:center" }, hist.baseline ? h("span", { class: "note" }, `Baseline set ${new Date(hist.baseline.createdAt).toLocaleString()}${hist.baseline.commit ? ` at ${hist.baseline.commit.slice(0, 7)}` : ""} (${plural(hist.baseline.findings, "finding")}).`) : null, h("button", { disabled: !p.writable, onclick: () => void setBaseline() }, hist.baseline ? "Move baseline to now" : "Set baseline now"), hist.baseline ? h("button", { disabled: !p.writable, onclick: () => void setBaseline(true) }, "Clear baseline") : null),
  );
  const changes = hist.changes ?? [];
  const timeline = changes.length
    ? h(
        "div",
        { class: "timeline" },
        ...[...changes].reverse().map((c, ri, arr) => {
          const prev = arr[ri + 1];
          const sudden = prev && c.files - prev.files >= Math.max(20, prev.files * 0.3);
          const item = (x: { id: string; title: string }, cls: string): HTMLElement => h("button", { class: cls, onclick: () => (findingById(x.id) ? openDrawer(x.id) : toast("No longer present in the current state.")) }, x.title);
          return h(
            "div",
            { class: "tl", id: `tl-${c.short.replace(/\W/g, "")}` },
            h("span", { class: "c" }, c.short),
            h("span", {}, c.subject || "—", c.date ? h("span", { class: "muted small" }, ` · ${new Date(c.date).toLocaleDateString()}`) : null),
            h("span", { class: "c" }, plural(c.total, "finding")),
            h("div", { class: "ch" }, ...c.added.slice(0, 12).map((x) => item(x, "add")), ...c.resolved.slice(0, 12).map((x) => item(x, "res")), c.added.length + c.resolved.length > 24 ? h("span", { class: "muted" }, "…") : null, !prev ? h("span", { class: "muted" }, "Oldest analysed state: the comparison point of the window.") : !c.added.length && !c.resolved.length ? h("span", { class: "muted" }, "No change in findings.") : null, sudden ? h("span", { class: "flag" }, `Sudden structural change: ${prev.files} → ${c.files} source files (AI-associated signal; not an authorship claim).`) : null),
          );
        }),
      )
    : null;
  const resolved = hist.resolved.length ? h("div", { class: "card sec", style: "margin-top:14px" }, h("header", {}, h("h2", {}, `Resolved (${hist.resolved.length})`), h("span", { class: "q" }, `Present at ${hist.comparison?.label ?? "the comparison point"}, gone now`)), h("ul", { class: "unknowns" }, ...hist.resolved.map((r) => h("li", {}, r.title)))) : null;
  const out: (HTMLElement | null)[] = [
    controls,
    changes.length ? h("div", { class: "card sec", style: "margin-top:14px" }, h("header", {}, h("h2", {}, "Drift trend"), h("span", { class: "q" }, "Findings per analysed commit, oldest to newest; the last bar is the working tree. Hover or focus a bar for details.")), trendChart(changes)) : null,
    timeline ? h("div", { class: "card sec", style: "margin-top:14px" }, h("header", {}, h("h2", {}, "Introduced and resolved")), timeline) : null,
    resolved,
  ];
  return out.filter((x): x is HTMLElement => Boolean(x));
}

function trendChart(changes: NonNullable<DriftPagePayload["history"]["changes"]>): HTMLElement {
  const NS = "http://www.w3.org/2000/svg";
  const W = Math.max(360, changes.length * 56);
  const H = 190;
  const pad = { l: 34, r: 10, t: 12, b: 34 };
  const max = Math.max(1, ...changes.map((c) => c.total));
  const slot = (W - pad.l - pad.r) / changes.length;
  const bw = Math.min(34, slot - 6);
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", `Findings per commit: ${changes.map((c) => `${c.short} ${c.total}`).join(", ")}`);
  const mk = (tag: string, attrs: Record<string, string | number>): SVGElement => {
    const e = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
    return e;
  };
  const y = (v: number): number => pad.t + (H - pad.t - pad.b) * (1 - v / max);
  svg.append(mk("line", { class: "axis", x1: pad.l, x2: W - pad.r, y1: y(0), y2: y(0) }));
  for (const t of [...new Set([0, Math.round(max / 2), max])]) {
    const lbl = mk("text", { x: pad.l - 6, y: y(t) + 3.5, "text-anchor": "end" });
    lbl.textContent = String(t);
    svg.append(lbl);
  }
  const tip = $("tip");
  changes.forEach((c, i) => {
    const x = pad.l + i * slot + (slot - bw) / 2;
    const g = mk("g", { class: "col", tabindex: 0 }) as SVGGElement;
    const top = y(c.total);
    const hgt = Math.max(0, y(0) - top);
    // A 4px rounded data end, square to the baseline.
    const r = Math.min(4, hgt, bw / 2);
    if (hgt > 0) g.append(mk("path", { class: `bar${c.ref === "working-tree" ? " cur" : ""}`, d: `M${x} ${y(0)}V${top + r}Q${x} ${top} ${x + r} ${top}H${x + bw - r}Q${x + bw} ${top} ${x + bw} ${top + r}V${y(0)}Z` }));
    g.append(mk("rect", { class: "hit", x: pad.l + i * slot, y: pad.t, width: slot, height: H - pad.t - pad.b }));
    const lbl = mk("text", { x: x + bw / 2, y: H - pad.b + 14, "text-anchor": "middle" });
    lbl.textContent = c.ref === "working-tree" ? "now" : c.short;
    g.append(lbl);
    const text = `${c.ref === "working-tree" ? "Working tree" : `${c.short} ${c.subject}`}\n${plural(c.total, "finding")} · +${c.added.length} / −${c.resolved.length} · ${c.files} source files`;
    const show = (ev: { clientX: number; clientY: number }): void => {
      tip.textContent = text;
      tip.style.whiteSpace = "pre-line";
      tip.hidden = false;
      tip.style.left = `${Math.min(ev.clientX + 12, innerWidth - 330)}px`;
      tip.style.top = `${ev.clientY + 12}px`;
    };
    g.addEventListener("mousemove", show);
    g.addEventListener("mouseleave", () => (tip.hidden = true));
    g.addEventListener("focus", () => {
      const b = g.getBoundingClientRect();
      show({ clientX: b.left, clientY: b.bottom });
    });
    g.addEventListener("blur", () => (tip.hidden = true));
    g.addEventListener("click", () => document.getElementById(`tl-${c.short.replace(/\W/g, "")}`)?.scrollIntoView({ block: "center" }));
    svg.append(g);
  });
  return h("div", { class: "chart", style: "overflow-x:auto" }, svg);
}

// ─── evidence drawer ────────────────────────────────────────────────

function closeDrawer(): void {
  $("drawer").classList.remove("open");
  state.selected = null;
  history.replaceState(null, "", location.pathname + location.search);
  document.querySelectorAll(".fc.sel").forEach((e) => e.classList.remove("sel"));
  markMap();
  renderMapSide();
}

function openDrawer(id: string, focus = true): void {
  const f = findingById(id);
  if (!f) {
    toast("That finding is not present in the current state.");
    return;
  }
  state.selected = id;
  history.replaceState(null, "", `#finding=${encodeURIComponent(id)}`);
  document.querySelectorAll(".fc").forEach((e) => e.classList.toggle("sel", (e as HTMLElement).dataset.id === id));
  const p = state.p!;
  const x = h("button", { class: "x", "aria-label": "Close", onclick: () => closeDrawer() }, "×");
  $("dhead").replaceChildren(h("h2", {}, f.title), x, h("div", { class: "chips" }, h("span", { class: "pill" }, CATEGORY_LABEL[f.category]), att(f.attention), confPill(f.confidence), statusPill(f.status), h("span", { class: "pill" }, BASIS_LABEL[f.basis]), f.decision ? h("span", { class: "pill" }, `decided: ${f.decision.kind}`) : null));
  const pattern = p.patterns.find((y) => y.id === f.pattern);
  const body: (Node | null)[] = [
    expectedObserved(f),
    h("section", {}, h("h4", {}, "Why detected"), h("ul", { class: "bases" }, ...f.bases.map((b) => h("li", {}, h("span", { class: "src" }, BASIS_LABEL[b.basis]), h("span", {}, b.text))))),
    f.stats ? h("section", {}, h("h4", {}, "Project pattern"), h("p", {}, `${f.stats.matching} of ${f.stats.comparable} comparable ${f.stats.unitLabel} (${pct(f.stats.frequency)}) follow it.`), pattern?.examples.length ? h("p", { class: "note" }, "Examples: ", pattern.examples.slice(0, 3).map((e) => e.path).join(", ")) : null) : null,
    h("section", {}, h("h4", {}, `Evidence${f.more ? ` (${f.evidence.length} shown, ${f.more} more)` : ""}`), ...f.evidence.map(evidenceRow)),
    h("section", {}, h("h4", {}, "Possible impact"), h("p", {}, f.impact)),
    f.suggestion ? h("section", { class: "suggest" }, h("div", { class: "lbl" }, "Suggested restructuring — not a required fix"), h("p", { style: "margin-top:4px" }, f.suggestion.text), f.suggestion.chain ? h("p", { class: "note", style: "margin-top:4px" }, f.suggestion.chain.join(" → ")) : null) : null,
    f.introduced
      ? h(
          "section",
          {},
          h("h4", {}, "Drift introduced"),
          h("p", {}, `${f.introduced.short} — ${f.introduced.subject}${f.introduced.date ? ` (${new Date(f.introduced.date).toLocaleDateString()})` : ""}`),
          f.introduced.before && f.introduced.after ? beforeAfter(f.introduced.before, f.introduced.after) : null,
          h("div", { class: "dacts", style: "margin-top:6px" }, h("button", { onclick: (e: Event) => void viewCommit(f.introduced!.commit, f.unit?.path, e.currentTarget as HTMLElement) }, "View commit")),
        )
      : h("section", {}, h("h4", {}, "History"), h("p", { class: "note" }, f.status === "existing" ? `Already present at ${p.history.comparison?.label ?? "the comparison point"}.` : "Not dated yet: set a baseline or analyse history.")),
    f.related.length ? h("section", {}, h("h4", {}, "Related signals (same deviation)"), h("ul", { class: "bases" }, ...f.related.map((r) => h("li", {}, h("span", { class: "src" }, BASIS_LABEL[r.basis]), h("span", {}, `${CATEGORY_LABEL[r.category]}: ${r.title}`))))) : null,
    decisionBox(f),
    h(
      "div",
      { class: "dacts" },
      f.evidence[0]?.path ? h("a", { class: "act", href: editorHref(f.evidence[0].path, f.evidence[0].line) }, "Open source") : null,
      h("button", { class: "act", onclick: () => ((state.selected = f.id), go("map"), renderMapSide()) }, "Show on map"),
      f.evidence.find((e) => e.nodeId) ? h("a", { class: "act", href: graphHref(f.evidence.find((e) => e.nodeId)!.nodeId!) }, "Show in graph") : null,
      h("button", { class: "act", title: "Copy a compact context about this finding for an LLM (no repository dump)", onclick: () => void copyContext(f.id) }, "Copy LLM context"),
    ),
  ];
  $("dbody").replaceChildren(...body.filter((n): n is Node => Boolean(n)));
  $("drawer").classList.add("open");
  if (focus) x.focus();
  markMap();
  renderMapSide();
}

function beforeAfter(before: string[], after: string[]): HTMLElement {
  const added = after.filter((d) => !before.includes(d));
  const removed = before.filter((d) => !after.includes(d));
  const short = (d: string): string => d.split("/").slice(-2).join("/");
  return h(
    "div",
    { class: "eo", style: "margin-top:6px" },
    h("div", { class: "c" }, h("h4", {}, "Before"), h("div", { class: "chain" }, ...(before.length ? before.slice(0, 8).map((d) => h("span", { class: "n" }, short(d))) : [h("span", { class: "note" }, "no dependencies (or the unit did not exist)")]))),
    h("div", { class: "o" }, h("h4", {}, "After"), h("div", { class: "chain" }, ...after.slice(0, 8).map((d) => h("span", { class: `n${added.includes(d) ? " dev" : ""}` }, `${added.includes(d) ? "+ " : ""}${short(d)}`))), removed.length ? h("p", { class: "txt" }, `removed: ${removed.map(short).join(", ")}`) : null),
  );
}

async function viewCommit(ref: string, path: string | undefined, anchor: HTMLElement): Promise<void> {
  try {
    const c = await json<CommitDetail>(`/api/drift/commit?ref=${encodeURIComponent(ref)}${path ? `&path=${encodeURIComponent(path)}` : ""}`);
    const box = h(
      "div",
      { class: "ev", style: "margin-top:6px" },
      h("div", { class: "row" }, h("span", { class: "p" }, `${c.short} · ${c.author} · ${new Date(c.date).toLocaleString()}`), h("span", { class: "d" }, `${c.files.length} files: ${c.files.slice(0, 6).map((f) => `${f.path} +${f.added}/−${f.removed}`).join(", ")}${c.files.length > 6 ? " …" : ""}`)),
      c.diff?.length ? h("pre", { class: "code" }, ...c.diff.map((l) => h("span", { class: l.startsWith("+") && !l.startsWith("+++") ? "plus" : l.startsWith("-") && !l.startsWith("---") ? "minus" : "" }, l))) : null,
    );
    anchor.parentElement?.after(box);
    anchor.setAttribute("disabled", "");
  } catch (e) {
    toast(`Could not load the commit: ${(e as Error).message}`);
  }
}

async function copyContext(id: string): Promise<void> {
  try {
    const res = await fetch(`/api/drift/finding/context?id=${encodeURIComponent(id)}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    await navigator.clipboard.writeText(await res.text());
    toast("Copied: the finding, its baseline and the exact lines — not the repository.");
  } catch (e) {
    toast(`Copy failed: ${(e as Error).message}`);
  }
}

function decisionBox(f: DriftFinding): HTMLElement {
  const p = state.p!;
  if (f.decision) {
    return h("section", { class: "decide" }, h("h4", {}, "Developer decision"), h("p", {}, `${f.decision.kind} by ${f.decision.by || "unknown"} on ${new Date(f.decision.at).toLocaleDateString()}: ${f.decision.reason}`), h("div", { class: "row" }, h("button", { disabled: !p.writable, onclick: () => void decide(f.id, "clear", "") }, "Undo decision")));
  }
  const reason = h("textarea", { placeholder: "Reason (required), e.g. legacy integration boundary", "aria-label": "Reason" }) as HTMLTextAreaElement;
  const btn = (kind: DecisionKind, label: string, title: string): HTMLElement => h("button", { disabled: !p.writable, title, onclick: () => void decide(f.id, kind, reason.value) }, label);
  return h(
    "section",
    { class: "decide" },
    h("h4", {}, "Developer decision"),
    h("p", { class: "note" }, "Stored in .fehm/drift-decisions.json (commit it to share with the team). Decided findings are not reported again."),
    reason,
    h("div", { class: "row" }, btn("intentional", "Mark intentional", "This deviation is by design"), btn("accepted", "Accept deviation", "Known; accepted for now"), btn("dismissed", "Dismiss", "Not a real deviation (false positive)")),
    p.writable ? null : h("p", { class: "note" }, "Read-only (dry run)."),
  );
}

async function decide(id: string, kind: DecisionKind | "clear", reason: string): Promise<void> {
  if (kind !== "clear" && !reason.trim()) {
    toast("Add a reason, so the team knows why.");
    return;
  }
  try {
    await post("/api/drift/decision", { id, kind, reason });
    toast(kind === "clear" ? "Decision removed." : `Marked ${kind}.`);
    await load();
  } catch (e) {
    toast(`Could not save: ${(e as Error).message}`);
  }
}

function evidenceRow(e: Evidence): HTMLElement {
  const row = h("div", { class: "ev" });
  const toggle = h("button", { class: "act", "aria-expanded": "false" }, "source") as HTMLButtonElement;
  toggle.addEventListener("click", async () => {
    const open = row.querySelector("pre.code");
    if (open) {
      open.remove();
      toggle.setAttribute("aria-expanded", "false");
      return;
    }
    toggle.setAttribute("aria-expanded", "true");
    try {
      const x = await json<SourceExcerpt>(`/api/drift/source?path=${encodeURIComponent(e.path)}&line=${e.line ?? 1}`);
      row.append(h("pre", { class: "code" }, ...x.lines.map((l, i) => h("span", { class: x.start + i === x.focus && e.line ? "f" : "" }, h("i", {}, String(x.start + i)), l))));
    } catch (err) {
      row.append(h("pre", { class: "code" }, h("span", {}, `Could not read the source: ${(err as Error).message}`)));
    }
  });
  row.append(h("div", { class: "row" }, h("span", { class: "p" }, `${e.path}${e.line ? `:${e.line}` : ""}`), e.path ? toggle : null, e.nodeId ? h("a", { class: "act", href: graphHref(e.nodeId) }, "graph") : null, e.path ? h("a", { class: "act", href: editorHref(e.path, e.line) }, "editor") : null, e.detail ? h("span", { class: "d" }, e.detail) : null));
  return row;
}

/** A file's drift summary (search result): role, patterns, deviations, history (spec §56). */
function openUnit(path: string): void {
  const p = state.p!;
  const fs = all().filter((f) => f.unit?.path === path || f.evidence.some((e) => e.path === path));
  const pats = p.patterns.filter((x) => x.outliers.includes(path) || x.examples.some((e) => e.path === path));
  const unit = fs.find((f) => f.unit?.path === path)?.unit;
  state.selected = null;
  $("dhead").replaceChildren(h("h2", {}, path), h("button", { class: "x", "aria-label": "Close", onclick: () => closeDrawer() }, "×"), h("div", { class: "chips" }, unit ? h("span", { class: "pill" }, `role: ${unit.role}`) : null, unit ? h("span", { class: "pill" }, unit.module) : null));
  $("dbody").replaceChildren(
    h("section", {}, h("h4", {}, `Deviations (${fs.length})`), fs.length ? h("div", { class: "flist" }, ...fs.map(card)) : h("p", { class: "note" }, "No drift findings involve this file.")),
    h("section", {}, h("h4", {}, "Patterns"), pats.length ? h("ul", { class: "bases" }, ...pats.map((x) => h("li", {}, h("span", { class: "src" }, x.outliers.includes(path) ? "deviates" : "follows"), h("span", {}, `${x.statement} (${x.matching}/${x.comparable})`)))) : h("p", { class: "note" }, "Not listed as an example or outlier of a mined pattern.")),
    h("section", {}, h("h4", {}, "History"), h("p", {}, fs.filter((f) => f.introduced).map((f) => `${CATEGORY_LABEL[f.category]}: introduced in ${f.introduced!.short}`).join(" · ") || "No dated introduction.")),
    h("div", { class: "dacts" }, h("a", { class: "act", href: editorHref(path) }, "Open source"), h("a", { class: "act", href: graphHref(`file:${path}`) }, "Show in graph")),
  );
  $("drawer").classList.add("open");
}

// ─── search ─────────────────────────────────────────────────────────

function search(q: string): void {
  const box = $("results");
  const s = q.trim().toLowerCase();
  if (!s || !state.p) {
    box.hidden = true;
    return;
  }
  const p = state.p;
  const findings = all().filter((f) => [f.title, f.observed, f.id].join(" ").toLowerCase().includes(s)).slice(0, 6);
  const files = [...new Set(all().flatMap((f) => [f.unit?.path, ...f.evidence.map((e) => e.path)]).filter((x): x is string => Boolean(x) && x!.toLowerCase().includes(s)))].slice(0, 6);
  const patterns = p.patterns.filter((x) => [x.name, x.statement].join(" ").toLowerCase().includes(s)).slice(0, 4);
  const commits = p.history.commits.filter((c) => [c.subject, c.short, c.ref].join(" ").toLowerCase().includes(s)).slice(0, 4);
  const item = (label: string, sub: string, onclick: () => void): HTMLElement => h("button", { role: "option", onclick: () => ((box.hidden = true), onclick()) }, h("span", {}, label), h("span", { class: "p" }, sub));
  const groups: Node[] = [];
  if (files.length) groups.push(h("h6", {}, "Files"), ...files.map((f) => item(f.split("/").pop()!, f, () => openUnit(f))));
  if (findings.length) groups.push(h("h6", {}, "Findings"), ...findings.map((f) => item(f.title, `${CATEGORY_LABEL[f.category]} · ${f.attention}`, () => openDrawer(f.id))));
  if (patterns.length) groups.push(h("h6", {}, "Patterns"), ...patterns.map((x) => item(x.name, x.statement, () => ((state.pattern = x.id), renderFilters(), go("findings"), refreshLists()))));
  if (commits.length) groups.push(h("h6", {}, "Commits"), ...commits.map((c) => item(c.subject, c.short, () => go("history"))));
  groups.push(item(`Filter findings by "${q.trim()}"`, "all fields", () => ((state.q = s), renderFilters(), go("findings"), refreshLists())));
  box.replaceChildren(...groups);
  box.hidden = false;
}

function fromHash(): void {
  const m = /finding=([^&]+)/.exec(location.hash);
  if (m && findingById(decodeURIComponent(m[1]!))) openDrawer(decodeURIComponent(m[1]!), false);
}

// ─── boot ───────────────────────────────────────────────────────────

// A running `fehm serve` keeps the HTML it started with but serves this script fresh from disk.
// After an update the two can differ: say so instead of failing silently behind the loading overlay.
const REQUIRED = ["ctx", "tabs", "filters", "tab-overview", "tab-map", "tab-findings", "tab-patterns", "tab-history", "drawer", "dhead", "dbody", "tip", "search", "results"];
const missing = REQUIRED.filter((id) => !document.getElementById(id));
if (missing.length) {
  const title = document.getElementById("overlay-title");
  const text = document.getElementById("overlay-text");
  if (title) title.textContent = "This page is out of date";
  if (text) text.textContent = "The server is still running an older version of Fehm than this script. Restart `fehm serve` (or rebuild with `npm run build` if you run the compiled CLI), then reload.";
  throw new Error(`drift page shell is stale (missing #${missing.join(", #")})`);
}

const input = $("search") as HTMLInputElement;
input.addEventListener("input", () => search(input.value));
input.addEventListener("keydown", (e) => {
  if (e.key === "Escape") ((input.value = ""), search(""));
  if (e.key === "Enter") ((state.q = input.value.trim().toLowerCase()), ($("results").hidden = true), renderFilters(), go("findings"), refreshLists());
});
document.addEventListener("click", (e) => {
  if (!(e.target as HTMLElement).closest("#search-wrap")) $("results").hidden = true;
});
document.addEventListener("keydown", (e) => {
  const t = e.target as HTMLElement;
  if (e.key === "/" && !/INPUT|TEXTAREA|SELECT/.test(t.tagName)) {
    e.preventDefault();
    input.focus();
  }
  if (e.key === "Escape" && $("drawer").classList.contains("open") && !/INPUT|TEXTAREA/.test(t.tagName)) closeDrawer();
});
$("refresh").addEventListener("click", () => void load("/api/drift/refresh", { method: "POST" }));
window.addEventListener("hashchange", fromHash);
void load();
