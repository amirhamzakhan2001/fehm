import type { Finding, ReviewStatus, Severity } from "../../../findings/model.js";
import type { BuildCheck, DeadCodeItem, DeadCodeState, HealthDimension, HealthPagePayload, HealthStatus, Protection, RunResult, SourceExcerpt, TestCategory } from "../../../health/types.js";
import { $, fmt, h } from "../../graph/ui/dom.js";

/**
 * Feature 3.5 page: project health as explainable dimensions, never one
 * invented score. Everything comes from one `/api/health` payload; source
 * excerpts, check runs and advisory lookups are fetched on demand.
 */

type Child = Node | string | null | undefined | false;

const state: { p: HealthPagePayload | null; scope: "all" | "changed"; q: string; sev: Severity | "all"; cat: string; show: "open" | "all" | "reviewed"; onlyNew: boolean } = { p: null, scope: "all", q: "", sev: "all", cat: "all", show: "open", onlyNew: false };

const STATUS_LABEL: Record<HealthStatus, string> = { healthy: "Healthy", attention: "Attention", degraded: "Degraded", critical: "Critical", unknown: "Unknown" };
const SEVERITIES: Severity[] = ["critical", "high", "medium", "low", "info"];
const CATEGORY_LABEL: Record<string, string> = { build: "Build", test: "Tests", coverage: "Coverage", quality: "Quality", "dead-code": "Dead code", dependency: "Dependencies", reliability: "Reliability", "ai-code": "AI-code indicators", debt: "Technical debt", ci: "CI" };
const DIM_SECTION: Record<string, string> = { build: "build", tests: "tests", coverage: "coverage", quality: "quality", maintainability: "quality", "dead-code": "dead-code", dependencies: "dependencies", reliability: "reliability", debt: "debt", "ai-code": "ai-code", ci: "build" };
const REVIEW_LABEL: Record<ReviewStatus, string> = { reviewed: "Reviewed", "false-positive": "False positive", "accepted-risk": "Accepted risk", suppressed: "Suppressed" };
const DEAD_LABEL: Record<DeadCodeState, [string, string]> = {
  "definitely-unused": ["Definitely unused", "Not exported, no references, no mentions anywhere, fully parsed."],
  "likely-unused": ["Likely unused", "No references or mentions, but exported or parsed heuristically."],
  "possibly-unused": ["Possibly unused", "No graph reference, but the name occurs elsewhere in code."],
  "external-api": ["External API", "Exported through a package entry or barrel: may be used outside."],
  "framework-entrypoint": ["Framework entry point", "Handler, decorator, lifecycle or convention name: called by a framework."],
  "dynamic-reference": ["Dynamic reference", "Named in a string or configuration: may be looked up at runtime."],
};

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
const post = <T>(path: string): Promise<T> => json<T>(path, { method: "POST", headers: { "x-fehm": "1" } });

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
  toastTimer = window.setTimeout(() => (t.hidden = true), 3600);
}

const plural = (n: number, w: string, ws = `${w}s`): string => `${fmt.format(n)} ${n === 1 ? w : ws}`;
const graphHref = (id: string): string => `/graph#node=${encodeURIComponent(id)}`;
function editorHref(path: string, line?: number): string {
  const root = (state.p?.repository.root ?? "").replace(/\\/g, "/");
  const abs = `${root}/${path}`;
  return `vscode://file/${abs.startsWith("/") ? abs.slice(1) : abs}${line ? `:${line}` : ""}`;
}
const ago = (iso: string): string => {
  const s = (Date.now() - Date.parse(iso)) / 1000;
  return s < 90 ? "just now" : s < 5400 ? `${Math.round(s / 60)} min ago` : s < 129600 ? `${Math.round(s / 3600)} h ago` : `${Math.round(s / 86400)} d ago`;
};
const isOpen = (f: Finding): boolean => !f.review || f.review.status === "reviewed";

function section(id: string, title: string, question: string, ...body: Child[]): HTMLElement {
  return h("section", { class: "card sec", id }, h("header", {}, h("h2", {}, title), h("span", { class: "q" }, question)), ...body);
}

function table(head: string[], rows: Node[][], cls = ""): HTMLElement {
  return h("div", { class: `tscroll ${cls}` }, h("table", { class: "t" }, h("thead", {}, h("tr", {}, ...head.map((x) => h("th", {}, x)))), h("tbody", {}, ...rows.map((r) => h("tr", {}, ...r)))));
}
const td = (x: Child, cls = ""): HTMLElement => h("td", cls ? { class: cls } : {}, x);
const tag = (text: string, cls = ""): HTMLElement => h("span", { class: `tag ${cls}` }, text);
const pathLink = (path: string, line?: number, nodeId?: string): HTMLElement => h("a", { href: nodeId ? graphHref(nodeId) : graphHref(`file:${path}`), title: "Show in the 3.1 graph" }, `${path}${line ? `:${line}` : ""}`);

function meter(parts: [number, string][], total: number): HTMLElement {
  return h("div", { class: "meter", role: "img", "aria-label": parts.map(([v]) => String(v)).join(" / ") }, ...parts.filter(([v]) => v > 0).map(([v, cls]) => h("i", { class: cls, style: `width:${total ? (v / total) * 100 : 0}%` })));
}

function svgEl<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>, ...children: (SVGElement | string)[]): SVGElementTagNameMap[K] {
  const el = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  for (const c of children) el.append(c);
  return el;
}

// ─── load ───────────────────────────────────────────────────────────

async function load(path = `/api/health${state.scope === "changed" ? "?scope=changed" : ""}`, init?: RequestInit): Promise<void> {
  setStatus("busy", "Analysing…");
  try {
    state.p = await json<HealthPagePayload>(path, init);
    render();
    $("overlay").hidden = true;
    const f = state.p.freshness;
    const refresh = $("refresh");
    if (!f.fresh) refresh.dataset.stale = "";
    else delete refresh.dataset.stale;
    setStatus(f.fresh ? "ready" : "stale", f.fresh ? `${state.p.durationMs} ms` : `${f.added + f.modified + f.deleted} files changed, analyse again`);
    openFromHash();
  } catch (e) {
    setStatus("error", "Failed");
    $("overlay").hidden = false;
    $("overlay-title").textContent = "Could not analyse project health";
    $("overlay-text").textContent = (e as Error).message;
    const retry = $("overlay-action");
    retry.hidden = false;
    retry.onclick = () => void load();
  }
}

const SECTIONS = [
  ["overview", "Overview"],
  ["attention", "Attention required"],
  ["tests", "Tests"],
  ["coverage", "Coverage"],
  ["quality", "Quality"],
  ["dead-code", "Dead code"],
  ["dependencies", "Dependencies"],
  ["reliability", "Reliability"],
  ["ai-code", "AI-code indicators"],
  ["debt", "Technical debt"],
  ["build", "Build & CI"],
  ["trends", "Trends"],
  ["findings", "Findings"],
  ["analysis", "Analysis"],
] as const;

function render(): void {
  const p = state.p!;
  $("project").textContent = p.repository.name;
  document.title = `Project Health · ${p.repository.name} · fehm`;
  const dimOf = (sec: string): HealthDimension | undefined => p.dimensions.find((d) => DIM_SECTION[d.id] === sec);
  $("toc").replaceChildren(
    h("h3", {}, "Project health"),
    h(
      "ol",
      {},
      ...SECTIONS.map(([id, label]) => {
        const d = dimOf(id);
        return h("li", {}, h("a", { href: `#${id}`, "data-sec": id }, d ? h("i", { class: `dot s-${d.status}`, style: "background:currentColor", title: STATUS_LABEL[d.status] }) : null, label, id === "findings" ? h("span", { class: "n" }, String(p.summary.open)) : null));
      }),
    ),
  );
  $("content").replaceChildren(
    overview(p),
    attention(p),
    testsSection(p),
    coverageSection(p),
    qualitySection(p),
    deadCodeSection(p),
    dependencySection(p),
    categorySection("reliability", "Reliability", "Where can the code fail badly: swallowed errors, calls without timeouts, promises nobody awaits?", "reliability", p),
    aiSection(p),
    debtSection(p),
    buildSection(p),
    trendsSection(p),
    findingsSection(p),
    analysisSection(p),
    h("p", { class: "foot" }, `${p.repository.root} · digest ${p.provenance.digest.slice(0, 16)} · generated ${new Date(p.generatedAt).toLocaleString()} · deterministic, no model calls`),
  );
  renderFindingList();
  spy();
}

// ─── overview ───────────────────────────────────────────────────────

function overview(p: HealthPagePayload): HTMLElement {
  const dims = p.dimensions.map((d) =>
    h(
      "button",
      { class: `dim s-${d.status}`, title: d.metric?.definition ?? d.reasons[0] ?? "", onclick: () => go(DIM_SECTION[d.id] ?? "findings") },
      h("span", { class: "t" }, h("i", { class: `s-${d.status}` }), d.title, h("span", { class: `s-${d.status}`, style: "margin-left:auto;font-size:10.5px;letter-spacing:.08em;text-transform:uppercase" }, STATUS_LABEL[d.status])),
      d.metric ? h("b", {}, d.metric.unit === "%" ? `${d.metric.value}%` : fmt.format(d.metric.value)) : h("b", { class: "none" }, d.status === "unknown" ? "unknown" : "—"),
      h("span", { class: "l" }, d.metric?.label ?? (d.status === "unknown" ? "not measured" : "no metric; status from findings")),
      h("span", { class: "r" }, d.reasons[0] ?? ""),
    ),
  );
  const sevs = SEVERITIES.map((s) => h("button", { class: `sev ${s}`, onclick: () => filterAndGo(s) }, s[0]!.toUpperCase() + s.slice(1), h("b", {}, String(p.summary.bySeverity[s]))));
  const base = p.baseline;
  return h(
    "section",
    { class: "card", id: "overview" },
    h(
      "div",
      { id: "hero" },
      h("span", { class: "eyebrow" }, "Feature 3.5"),
      h("h1", {}, "Project health"),
      h("p", { class: "tagline" }, "How healthy is this codebase, where are its weak points, and how much confidence do we have that important behaviour is actually protected?"),
      h(
        "div",
        { class: "verdict" },
        h("span", { class: `pill s-${p.status}` }, h("i"), STATUS_LABEL[p.status]),
        h("div", { class: "meta" }, p.git.commit ? h("code", {}, `${p.git.commit.slice(0, 8)}${p.git.dirty ? " + changes" : ""}`) : null, h("span", {}, `analysed ${ago(p.generatedAt)}`), p.scope === "changed" ? tag(`changed files only (${p.git.changed.length})`, "warn") : null),
      ),
      h("ul", { class: "reasons" }, ...p.statusReasons.map((r) => h("li", {}, r))),
      h("p", { class: "note" }, "The overall status is the worst status among the dimensions that could be measured. There is no overall score: each dimension below shows what it measures."),
      h("div", { class: "dims" }, ...dims),
      h("div", { class: "sevs", "aria-label": "Open findings by severity" }, ...sevs),
      h(
        "div",
        { class: "meta", style: "margin-top:12px" },
        base ? h("span", {}, `Baseline ${ago(base.createdAt)}: `, h("b", {}, `${base.added} new`), `, ${base.fixed.length} fixed, ${base.unchanged} unchanged`) : h("span", {}, "No baseline: every finding counts as current."),
        h("button", { disabled: !p.writable, onclick: setBaseline, title: "Accept the current findings; later runs show what is new and what was fixed" }, base ? "Move baseline here" : "Set baseline"),
        base ? h("button", { disabled: !p.writable, onclick: clearBaseline }, "Clear baseline") : null,
        base && base.fixed.length ? h("details", {}, h("summary", { class: "note" }, `Fixed since the baseline (${base.fixed.length})`), h("ul", { class: "plain" }, ...base.fixed.slice(0, 40).map((f) => h("li", {}, h("span", { class: `sv ${f.severity}` }, f.severity), " ", f.title)))) : null,
      ),
      p.config.issues.length ? h("div", { class: "banner warn", style: "margin-top:12px" }, h("b", {}, `${p.config.file} could not be used. `), p.config.issues.join(" ")) : null,
    ),
  );
}

async function setBaseline(): Promise<void> {
  try {
    const r = await post<{ findings: number }>("/api/health/baseline");
    toast(`Baseline set with ${r.findings} findings.`);
    await load();
  } catch (e) {
    toast(`Could not set the baseline: ${(e as Error).message}`);
  }
}
async function clearBaseline(): Promise<void> {
  try {
    await post("/api/health/baseline?clear=1");
    toast("Baseline cleared.");
    await load();
  } catch (e) {
    toast(`Could not clear the baseline: ${(e as Error).message}`);
  }
}

function attention(p: HealthPagePayload): HTMLElement {
  const top = p.findings.filter((f) => isOpen(f) && (f.severity === "critical" || f.severity === "high")).slice(0, 8);
  const list = top.length ? h("div", { class: "flist" }, ...top.map((f) => findingRow(f))) : h("div", { class: "emptyline" }, "No critical or high findings.");
  const hot = p.debt.hotspots.slice(0, 5);
  return section(
    "attention",
    "Attention required",
    "What needs attention first: the most severe open findings and the files where problems converge.",
    list,
    hot.length ? h("h3", {}, "Top hotspots") : null,
    hot.length ? table(["Level", "File", "Priority", "Why"], hot.map((x) => [td(tag(x.level, x.level === "high" ? "bad" : x.level === "medium" ? "warn" : "muted")), td(pathLink(x.path), "p"), td(String(x.priority), "num"), td(x.reasons.slice(0, 3).join(" · "))])) : null,
  );
}

// ─── tests & coverage ───────────────────────────────────────────────

const PROT_LABEL: Record<Protection, string> = { runtime: "executed (runtime coverage)", direct: "called by a test", transitive: "reached through calls from a test", none: "no test protection" };

function testsSection(p: HealthPagePayload): HTMLElement {
  const t = p.tests;
  const k = (n: number, label: string, cls = ""): HTMLElement => h("div", { class: cls }, h("b", {}, fmt.format(n)), h("span", {}, label));
  const cats = (Object.entries(t.categories) as [TestCategory, number][]).sort((a, b) => b[1] - a[1]);
  const inferred = t.files.filter((f) => f.categoryBasis !== "path").length;
  const s = p.coverage.structural;
  return section(
    "tests",
    "Tests",
    "What tests exist, how good are they, and which important code has none?",
    h("div", { class: "kv" }, k(t.totals.files, "test files"), k(t.totals.cases, "test cases"), k(t.totals.assertions, "assertions"), k(t.totals.skipped, "skipped", t.totals.skipped ? "warn" : ""), k(t.totals.focused, "focused (.only)", t.totals.focused ? "bad" : ""), k(t.totals.empty, "empty", t.totals.empty ? "warn" : ""), k(t.totals.assertionless, "no assertion", t.totals.assertionless ? "warn" : ""), k(t.totals.mocks, "mocks")),
    h("h3", {}, "Test inventory"),
    cats.length ? h("div", { class: "sevs" }, ...cats.map(([c, n]) => h("span", { class: "sev" }, c, h("b", {}, String(n))))) : h("div", { class: "emptyline" }, "No test cases recognised."),
    inferred ? h("p", { class: "note" }, `${inferred} of ${t.files.length} files are classified from their imports or by default (unit), not from a folder or file name: the category is inferred.`) : null,
    h("h3", {}, "Test protection of production code"),
    meter([[s.direct, "bar-ok"], [s.transitive, "bar-strong"], [s.none, "bar-none"]], s.symbols),
    h("div", { class: "legend" }, h("span", {}, h("i", { class: "bar-ok" }), `${fmt.format(s.direct)} ${p.coverage.runtime ? "executed or " : ""}called by a test`), h("span", {}, h("i", { class: "bar-strong" }), `${fmt.format(s.transitive)} reached through calls`), h("span", {}, h("i", { class: "bar-none" }), `${fmt.format(s.none)} no test relationship`)),
    h("p", { class: "note" }, p.coverage.runtime ? "Symbols in files covered by the runtime artifact use its line data; the rest use code-graph relationships." : "No runtime coverage artifact: these are code-graph relationships (a test calls or references the symbol), not measured execution."),
    h("h3", {}, `Critical test gaps (${t.gaps.length})`),
    t.gaps.length
      ? table(
          ["Risk", "Symbol", "Where", "Why it matters"],
          t.gaps.slice(0, 60).map((g) => [td(String(g.risk), "num"), td(h("a", { href: graphHref(g.nodeId) }, g.name)), td(pathLink(g.path, g.line), "p"), td(g.reasons.join(" · "))]),
        )
      : h("div", { class: "emptyline" }, "No risky symbol lacks test protection."),
    h("p", { class: "note" }, "Risk adds up: fan-in from other files (up to 10), route or CLI handler (+4), security-sensitive name (+4), contains a dangerous call (+3), reachable from an entry point (+2), complexity (+2/+3), changed in the last 30 days (+2), exported (+1). Listed at 6 or more."),
    h("h3", {}, `Entry paths (${t.paths.length})`),
    t.paths.length ? h("div", { class: "flist" }, ...t.paths.slice(0, 20).map(pathRow)) : h("div", { class: "emptyline" }, "No route or CLI handler with a resolved call path."),
    h("h3", {}, "Test files"),
    t.files.length
      ? table(
          ["File", "Kind", "Cases", "Assertions", "Mocks", "Links to code", "Flags"],
          t.files.map((f) => [td(pathLink(f.path), "p"), td(h("span", {}, f.category, f.categoryBasis !== "path" ? tag("inferred", "dashed muted") : null, f.framework ? h("span", { class: "note" }, ` ${f.framework}`) : null)), td(String(f.cases), "num"), td(String(f.assertions), "num"), td(String(f.mocks), "num"), td(String(f.productionFiles), "num"), td(h("span", {}, f.focused ? tag(`${f.focused} focused`, "bad") : null, f.skipped ? tag(`${f.skipped} skipped`, "warn") : null, f.empty ? tag(`${f.empty} empty`, "warn") : null, f.assertionless ? tag(`${f.assertionless} no assert`, "warn") : null, !f.hooks ? null : tag("setup hooks", "muted")))]),
        )
      : null,
    findingsOf(p, (f) => f.category === "test" && f.ruleId !== "test/critical-gap"),
  );
}

function pathRow(x: HealthPagePayload["tests"]["paths"][number]): HTMLElement {
  const chain = h("div", { class: "chain" });
  x.steps.forEach((s, i) => {
    if (i) chain.append(h("span", { class: "arr" }, s.depth > x.steps[i - 1]!.depth ? "→" : "·"));
    chain.append(h("a", { class: `n ${s.protection}`, href: graphHref(s.nodeId), title: `${s.name}: ${PROT_LABEL[s.protection]}` }, `${s.protection === "none" ? "✗ " : "✓ "}${s.name.split(".").pop()}`));
  });
  return h("details", { class: `f ${x.unprotected ? "medium" : "info"}` }, h("summary", {}, h("span", { class: "tag" }, x.kind), h("span", { class: "tt" }, x.label), h("span", { class: "fm" }, x.unprotected ? `${x.unprotected} of ${x.steps.length} untested` : "all steps protected")), h("div", { class: "fbody" }, h("p", { class: "note" }, `Handler registered at ${x.path}:${x.line}. Steps follow calls up to 3 deep.`), chain));
}

function coverageSection(p: HealthPagePayload): HTMLElement {
  const rt = p.coverage.runtime;
  const detected = p.coverage.detected.length ? h("div", {}, h("h3", {}, "Other coverage files"), h("ul", { class: "plain" }, ...p.coverage.detected.map((d) => h("li", {}, h("code", {}, d.path), ` (${d.format}): ${d.problem}`)))) : null;
  if (!rt) {
    return section(
      "coverage",
      "Coverage",
      "How much of the code do the tests actually execute?",
      h("div", { class: "unknown-card" }, h("b", {}, "UNKNOWN"), h("span", {}, "No supported runtime coverage artifact was found, so line, branch and function coverage are not reported."), h("span", { class: "note" }, "Fehm reads coverage/lcov.info, coverage/coverage-final.json or coverage-summary.json (Istanbul, c8, Jest, Vitest), coverage.xml (coverage.py, Cobertura), coverage.json (coverage.py), jacoco.xml, and Go's coverage.out. Run your tests with coverage, then analyse again. Fehm never runs the tests itself to produce coverage.")),
      h("p", { class: "note" }, "Test relationships through the code graph are shown under Tests. They are not coverage."),
      detected,
    );
  }
  const a = rt.artifacts[0]!;
  const row = (label: string, r?: { covered: number; total: number; pct: number }): HTMLElement =>
    h("div", { class: "box" }, h("span", { class: "note" }, label), r ? h("b", { style: "font:600 22px var(--mono);display:block" }, `${r.pct}%`) : h("b", { class: "note", style: "display:block" }, "not in artifact"), r ? meter([[r.covered, r.pct >= 80 ? "bar-ok" : r.pct >= 60 ? "bar-warn" : "bar-err"], [r.total - r.covered, "bar-none"]], r.total) : null, r ? h("span", { class: "note" }, `${fmt.format(r.covered)} of ${fmt.format(r.total)}`) : null);
  const low = [...rt.files].filter((f) => f.lines && f.lines.total >= 5).sort((x, y) => x.lines!.pct - y.lines!.pct).slice(0, 40);
  return section(
    "coverage",
    "Coverage",
    "How much of the code do the tests actually execute?",
    h("p", { class: "meta" }, "From ", h("code", {}, a.path), ` (${a.format}), written ${new Date(a.modifiedAt).toLocaleString()}, ${plural(a.files, "file")}${rt.unmatchedRecords ? `; ${rt.unmatchedRecords} records match no indexed file` : ""}.`),
    a.staleFiles.length ? h("div", { class: "banner warn" }, `${plural(a.staleFiles.length, "file")} changed after this artifact was written; their numbers may be out of date: `, a.staleFiles.slice(0, 6).join(", "), a.staleFiles.length > 6 ? " …" : "") : null,
    h("div", { class: "grid3", style: "grid-template-columns:repeat(4,minmax(0,1fr))" }, row("Lines", rt.totals.lines), row("Statements", rt.totals.statements), row("Functions", rt.totals.functions), row("Branches", rt.totals.branches)),
    h("h3", {}, "Least-covered files"),
    table(["File", "Lines", "Branches", "Functions"], low.map((f) => [td(pathLink(f.path), "p"), td(f.lines ? `${f.lines.pct}% of ${f.lines.total}` : "—", "num"), td(f.branches ? `${f.branches.pct}%` : "—", "num"), td(f.functions ? `${f.functions.pct}%` : "—", "num")])),
    detected,
  );
}

// ─── quality ────────────────────────────────────────────────────────

function heatColor(max: number): string {
  return max <= 5 ? "#1f3b3a" : max <= 10 ? "#2c5a52" : max <= 15 ? "#7a6a35" : max <= 25 ? "#a0592f" : "#b33a4d";
}

function qualitySection(p: HealthPagePayload): HTMLElement {
  const q = p.quality;
  const d = q.distribution;
  const total = q.functions;
  const files = q.files.slice(0, 400);
  const maxLines = Math.max(1, ...files.map((f) => f.lines));
  const heat = h("div", { class: "heat", role: "list", "aria-label": "Files by complexity" }, ...files.map((f) => h("button", { role: "listitem", style: `width:${Math.round(10 + 50 * Math.sqrt(f.lines / maxLines))}px;background:${heatColor(f.maxCyclomatic)}`, title: `${f.path}\nmost complex function: ${f.maxCyclomatic}\n${f.functions} functions, total complexity ${f.totalCyclomatic}`, onclick: () => (location.href = graphHref(`file:${f.path}`)) })));
  return section(
    "quality",
    "Code quality & maintainability",
    "Where is the code hard to understand, test or change?",
    total ? h("p", { class: "meta" }, h("b", {}, `${Math.round((q.withinLimits / total) * 1000) / 10}%`), ` of ${plural(total, "function")} are within every limit (complexity, nesting, length, parameters). ${plural(q.classes, "class", "classes")} measured.`) : h("div", { class: "emptyline" }, "No functions in a language with metric support."),
    total ? meter([[d.low, "bar-ok"], [d.medium, "bar-strong"], [d.high, "bar-warn"], [d.critical, "bar-err"]], total) : null,
    total ? h("div", { class: "legend" }, h("span", {}, h("i", { class: "bar-ok" }), `${d.low} low (≤ 5)`), h("span", {}, h("i", { class: "bar-strong" }), `${d.medium} moderate`), h("span", {}, h("i", { class: "bar-warn" }), `${d.high} high`), h("span", {}, h("i", { class: "bar-err" }), `${d.critical} very high (> 2× limit)`), h("span", {}, "cyclomatic complexity per function")) : null,
    files.length ? h("h3", {}, "Complexity heatmap") : null,
    files.length ? heat : null,
    files.length ? h("p", { class: "note" }, "One tile per file: width grows with the lines in its functions, colour with its most complex function. Select a tile to open the file in the 3.1 graph.") : null,
    q.top.length ? h("h3", {}, "Most complex functions") : null,
    q.top.length
      ? table(
          ["Function", "Where", "Cyclomatic", "Cognitive", "Nesting", "Lines", "Params", ""],
          q.top.slice(0, 25).map((f) => [td(f.nodeId ? h("a", { href: graphHref(f.nodeId) }, f.name) : f.name), td(`${f.path}:${f.line}`, "p"), td(String(f.cyclomatic), "num"), td(f.cognitive !== undefined ? String(f.cognitive) : "—", "num"), td(String(f.nesting), "num"), td(String(f.lines), "num"), td(String(f.params), "num"), td(f.resolution === "heuristic" ? tag("estimated", "dashed muted") : null)]),
        )
      : null,
    findingsOf(p, (f) => f.category === "quality" && !/^quality\/(?:cyclomatic|cognitive|deep-nesting|long-function|too-many-params)/.test(f.ruleId)),
    h("p", { class: "note" }, "Per-function complexity findings are in the Findings list (category Quality)."),
  );
}

// ─── dead code ──────────────────────────────────────────────────────

function deadItem(it: DeadCodeItem): HTMLElement {
  return h(
    "details",
    { class: `f ${it.state === "definitely-unused" ? "medium" : it.state === "likely-unused" ? "low" : "info"}` },
    h("summary", {}, tag(it.kind), h("span", { class: "tt" }, it.name), h("span", { class: "fm" }, h("span", { class: `cf ${it.state === "definitely-unused" ? "strong" : it.state === "likely-unused" ? "inferred" : "unknown"}` }, DEAD_LABEL[it.state][0])), h("span", { class: "sub" }, `${it.path}${it.line ? `:${it.line}` : ""}`)),
    h("div", { class: "fbody" }, h("ul", { class: "checklist" }, ...it.evidence.map((e) => h("li", { class: e.passed ? "pass" : "fail" }, e.check))), h("div", { class: "reviews" }, it.nodeId ? h("a", { class: "act", href: graphHref(it.nodeId) }, "Show in graph") : null, h("a", { class: "act", href: editorHref(it.path, it.line) }, "Open in editor"))),
  );
}

function deadCodeSection(p: HealthPagePayload): HTMLElement {
  const d = p.deadCode;
  const states = (Object.keys(DEAD_LABEL) as DeadCodeState[]).map((s) => h("div", { class: s.endsWith("-unused") ? (d.counts[s] ? "warn" : "") : "" }, h("b", {}, String(d.counts[s])), h("span", {}, DEAD_LABEL[s][0]), h("span", { class: "note", style: "display:block;font-size:11px" }, DEAD_LABEL[s][1])));
  return section(
    "dead-code",
    "Dead code",
    "What is defined but used by nothing, and how sure is that?",
    h("p", { class: "note" }, "Every symbol with no reference in the code graph goes through the checks Skylos uses to keep code alive: framework conventions and decorators, package exports, string and configuration references, unresolved textual mentions. Only what fails all of them is a candidate."),
    h("div", { class: "kv" }, ...states),
    h("h3", {}, `Candidates (${d.items.length})`),
    d.items.length ? h("div", { class: "flist" }, ...d.items.slice(0, 80).map(deadItem)) : h("div", { class: "emptyline" }, "No unused-symbol candidates."),
    d.unusedFiles.length ? h("h3", {}, `Files used by nothing (${d.unusedFiles.length})`) : null,
    d.unusedFiles.length ? h("div", { class: "flist" }, ...d.unusedFiles.map(deadItem)) : null,
    d.kept.length ? h("details", {}, h("summary", { class: "note" }, `Why ${plural(d.kept.length, "unreferenced symbol was", "unreferenced symbols were")} kept (sample)`), h("div", { class: "flist", style: "margin-top:8px" }, ...d.kept.map(deadItem))) : null,
    h("p", { class: "meta" }, `${plural(d.unusedImports, "unused import")} · ${plural(d.unreachable, "unreachable statement")} (see Findings).`),
  );
}

// ─── dependencies ───────────────────────────────────────────────────

function dependencySection(p: HealthPagePayload): HTMLElement {
  const d = p.dependencies;
  const policyTag = (pol: string): HTMLElement => tag(pol, pol === "denied" ? "bad" : pol === "review" ? "warn" : pol === "unknown" ? "muted dashed" : "ok");
  const filter = h("input", { type: "search", placeholder: "Filter components…", "aria-label": "Filter components" }) as HTMLInputElement;
  const body = h("tbody");
  const fill = (): void => {
    const q = filter.value.trim().toLowerCase();
    body.replaceChildren(...d.components.filter((c) => !q || c.name.toLowerCase().includes(q) || c.license.toLowerCase().includes(q)).slice(0, 300).map((c) => h("tr", {}, td(c.name, "p"), td(c.version || "—", "p"), td(h("span", {}, c.direct ? tag("direct") : tag("transitive", "muted"), c.dev ? tag("dev", "muted") : null)), td(c.depth !== undefined ? String(c.depth) : "—", "num"), td(h("span", {}, c.license, " ", c.licenseSource === "none" ? null : h("span", { class: "note" }, `(${c.licenseSource === "lockfile" ? "lockfile" : "installed"})`))), td(c.importers !== undefined ? String(c.importers) : "", "num"))));
  };
  filter.addEventListener("input", fill);
  fill();
  return section(
    "dependencies",
    "Dependencies",
    "What does the project depend on, is it reproducible, and what do the licenses and advisories say?",
    d.manifests.length ? null : h("div", { class: "emptyline" }, "No supported manifest found."),
    h("div", { class: "kv" }, ...[[d.counts.total, "components"], [d.counts.direct, "direct"], [d.counts.transitive, "transitive"], [d.counts.dev, "dev only"], [d.counts.duplicates, "duplicated"], [d.maxDepth ?? 0, "max depth"], [d.unused.length, "declared, unused"]].map(([n, l]) => h("div", {}, h("b", {}, fmt.format(n as number)), h("span", {}, l as string)))),
    d.manifests.length ? table(["Manifest", "Kind", "Runtime", "Dev", "Lockfile"], d.manifests.map((m) => [td(m.path, "p"), td(m.kind), td(String(m.direct), "num"), td(String(m.dev), "num"), td(m.lockfile ? h("code", {}, m.lockfile) : tag("none", "bad"))])) : null,
    h("div", { class: "grid2", style: "margin-top:12px" }, h("div", { class: "box" }, h("h3", {}, "Known vulnerabilities"), advisoriesBox(p)), h("div", { class: "box" }, h("h3", {}, "Software bill of materials"), h("p", { class: "note" }, `${plural(d.counts.total, "component")} from manifests and lockfiles. Licenses Fehm could not read are NOASSERTION, never guessed.`), h("div", { class: "reviews" }, h("a", { class: "act", href: "/api/health/sbom?format=cyclonedx", download: "sbom.cdx.json" }, "CycloneDX 1.5"), h("a", { class: "act", href: "/api/health/sbom?format=spdx", download: "sbom.spdx.json" }, "SPDX 2.3")))),
    h("h3", {}, "Licenses"),
    d.licenses.length ? table(["License", "Components", "Policy"], d.licenses.map((l) => [td(l.license, "p"), td(String(l.count), "num"), td(policyTag(l.policy))])) : null,
    h("p", { class: "note" }, "Policy is from .fehm/health.json (licenses.deny / licenses.review); by default strong copyleft and source-available licenses need review. This is not legal advice."),
    h("h3", {}, "Components"),
    h("div", { class: "filters" }, filter),
    h("div", { class: "tscroll" }, h("table", { class: "t" }, h("thead", {}, h("tr", {}, ...["Package", "Version", "Scope", "Depth", "License", "Importers"].map((x) => h("th", {}, x)))), body)),
    findingsOf(p, (f) => f.category === "dependency"),
  );
  function advisoriesBox(pp: HealthPagePayload): HTMLElement {
    const a = pp.dependencies.advisories;
    const btn = h("button", { disabled: !pp.writable, onclick: checkAdvisories, title: "Sends package names and versions to api.osv.dev" }, a.status === "not-checked" ? "Check advisories (OSV.dev)" : "Check again");
    if (a.status === "not-checked" || a.status === "error") return h("div", {}, h("div", { class: "unknown-card" }, h("b", {}, a.status === "error" ? "ERROR" : "NOT CHECKED"), h("span", {}, a.reason ?? "")), h("p", { class: "note" }, "The lookup sends package names and versions (nothing else) to api.osv.dev."), btn);
    const counts = SEVERITIES.map((s) => [s, a.items.filter((i) => i.severity === s).length] as const).filter(([, n]) => n);
    return h("div", {}, h("p", { class: "meta" }, `${a.status === "stale" ? "Stale: " : ""}checked ${a.checkedAt ? ago(a.checkedAt) : ""} against ${a.source}. `, a.items.length ? `${plural(a.items.length, "advisory", "advisories")}: ` : "No known vulnerabilities.", ...counts.map(([s, n]) => h("span", { class: `sv ${s}`, style: "margin-left:4px" }, `${n} ${s}`))), a.reason ? h("p", { class: "note" }, a.reason) : null, btn);
  }
}

async function checkAdvisories(): Promise<void> {
  if (!confirm("Send this project's package names and versions to api.osv.dev to look up known vulnerabilities?")) return;
  setStatus("busy", "Checking advisories…");
  try {
    await post("/api/health/advisories");
    toast("Advisories checked.");
    await load();
  } catch (e) {
    setStatus("error", "Advisory check failed");
    toast((e as Error).message);
  }
}

// ─── reliability, AI code ───────────────────────────────────────────

function categorySection(id: string, title: string, question: string, category: string, p: HealthPagePayload): HTMLElement {
  return section(id, title, question, findingsOf(p, (f) => f.category === category, "No findings in this category."));
}

function aiSection(p: HealthPagePayload): HTMLElement {
  const byRule = new Map<string, number>();
  for (const f of p.findings.filter((x) => x.category === "ai-code" && isOpen(x))) byRule.set(f.title.replace(/^\d+\s+/, ""), (byRule.get(f.title.replace(/^\d+\s+/, "")) ?? 0) + f.evidence.length + f.more);
  return section(
    "ai-code",
    "AI-code defect indicators",
    "Are there defects typical of generated code: imports of things that do not exist, placeholders, weakened tests, disabled safety checks?",
    h("div", { class: "disclaimer" }, h("b", {}, "These are defect patterns, not authorship. "), "They are common in AI-generated code and in rushed human code alike. Fehm does not and cannot tell who or what wrote the code, and never reports a percentage of AI-written code."),
    byRule.size ? h("div", { class: "sevs" }, ...[...byRule].map(([k, n]) => h("span", { class: "sev" }, k, h("b", {}, String(n))))) : null,
    findingsOf(p, (f) => f.category === "ai-code", "No AI-code defect indicators."),
  );
}

// ─── technical debt ─────────────────────────────────────────────────

function debtSection(p: HealthPagePayload): HTMLElement {
  const d = p.debt;
  return section(
    "debt",
    "Technical debt",
    "Where do complexity, frequent change, missing tests and findings converge?",
    d.hotspots.length
      ? table(
          ["Level", "File", "Priority", "Dimensions", "Changes", "Fixes", "Max complexity", "Tested"],
          d.hotspots.slice(0, 40).map((x) => [td(tag(x.level, x.level === "high" ? "bad" : x.level === "medium" ? "warn" : "muted")), td(pathLink(x.path), "p"), td(String(x.priority), "num"), td(Object.entries(x.dimensions).map(([k, v]) => `${k} ${Math.round(v)}`).join(" · ")), td(String(x.churn), "num"), td(String(x.fixes), "num"), td(String(x.complexity), "num"), td(x.coverage !== undefined ? `${x.coverage}%` : "—", "num")]),
        )
      : h("div", { class: "emptyline" }, "No debt signals."),
    h("h3", {}, "Change × complexity"),
    d.quadrant.length ? quadrant(p) : h("div", { class: "emptyline" }, p.git.reason ?? "No git history in the analysis window."),
    h("details", {}, h("summary", { class: "note" }, "How priority is computed"), h("ul", { class: "plain" }, ...d.formula.map((f) => h("li", {}, f)))),
  );
}

function quadrant(p: HealthPagePayload): SVGSVGElement {
  const d = p.debt;
  const W = 720;
  const H = 360;
  const pad = 40;
  const maxX = Math.max(1, ...d.quadrant.map((q) => q.complexity));
  const maxY = Math.max(1, ...d.quadrant.map((q) => q.churn));
  const x = (v: number): number => pad + (Math.log1p(v) / Math.log1p(maxX)) * (W - 2 * pad);
  const y = (v: number): number => H - pad - (Math.log1p(v) / Math.log1p(maxY)) * (H - 2 * pad);
  const color: Record<string, string> = { hotspot: "#f7768e", maintain: "#e0af68", legacy: "#7aa2f7", stable: "#4b546a" };
  const svg = svgEl("svg", { class: "quad", viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": "Files by change frequency and complexity" });
  const mx = x(d.medians.complexity);
  const my = y(d.medians.churn);
  svg.append(
    svgEl("line", { class: "m", x1: mx, y1: pad / 2, x2: mx, y2: H - pad }),
    svgEl("line", { class: "m", x1: pad, y1: my, x2: W - pad / 2, y2: my }),
    svgEl("text", { class: "ql", x: pad + 6, y: pad }, "Maintain"),
    svgEl("text", { class: "ql", x: W - pad - 80, y: pad }, "Hotspots"),
    svgEl("text", { class: "ql", x: pad + 6, y: H - pad - 8 }, "Stable"),
    svgEl("text", { class: "ql", x: W - pad - 80, y: H - pad - 8 }, "Legacy"),
    svgEl("text", { x: W / 2 - 60, y: H - 10 }, "complexity (sum of decision points) →"),
    svgEl("text", { x: 8, y: 16 }, `↑ commits in ${p.git.windowDays} days`),
  );
  for (const q of d.quadrant) {
    const c = svgEl("circle", { cx: x(q.complexity), cy: y(q.churn), r: q.quadrant === "hotspot" ? 5 : 3.5, fill: color[q.quadrant]!, "fill-opacity": 0.85 }, svgEl("title", {}, `${q.path}\ncomplexity ${q.complexity}, ${q.churn} commits (${q.quadrant})`));
    c.addEventListener("click", () => (location.href = graphHref(`file:${q.path}`)));
    svg.append(c);
  }
  return svg;
}

// ─── build & CI ─────────────────────────────────────────────────────

function buildSection(p: HealthPagePayload): HTMLElement {
  const b = p.build;
  const statusTag = (c: BuildCheck): HTMLElement => (c.last ? tag(`${c.last.status === "passed" ? "✓ passed" : c.last.status === "failed" ? "✗ failed" : c.last.status}${c.last.stale ? " (stale)" : ""}`, c.last.status === "passed" ? (c.last.stale ? "warn" : "ok") : "bad") : tag("not run", "muted dashed"));
  const rows = b.checks.map((c) => {
    const out = c.last ? h("details", {}, h("summary", { class: "note" }, `output · ${ago(c.last.at)} · ${Math.round(c.last.durationMs / 100) / 10}s`), h("pre", { class: "out" }, c.last.output || "(no output)")) : null;
    return [td(c.kind), td(h("div", {}, h("code", {}, c.display), out)), td(`${c.source.path}${c.source.line ? `:${c.source.line}` : ""}`, "p"), td(statusTag(c)), td(h("button", { disabled: !p.writable, onclick: () => runCheck(c) }, "Run"))];
  });
  const ci = p.ci;
  return section(
    "build",
    "Build & CI",
    "Does it build and pass its checks, and does CI enforce that?",
    h("p", { class: "meta" }, b.systems.length ? `Build systems: ${b.systems.join(", ")}. ` : "", b.packageManagers.length ? `Package managers: ${b.packageManagers.join(", ")}.` : ""),
    b.checks.length ? table(["Kind", "Command", "Declared in", "Last result", ""], rows) : h("div", { class: "emptyline" }, "No build, test, lint or type-check command was detected."),
    h("p", { class: "note" }, "Fehm never runs these on its own. Run executes the command shown, from the project's own manifest, without a shell, with a 10-minute limit. A result becomes stale when files change."),
    b.typescript ? h("p", { class: "meta" }, "TypeScript: ", h("code", {}, b.typescript.path), b.typescript.strict === true ? tag("strict", "ok") : b.typescript.strict === false ? tag("not strict", "warn") : tag("strict inherited or unknown", "muted")) : null,
    h("h3", {}, "CI gates"),
    ci.files.length ? h("p", { class: "meta" }, `${ci.providers.join(", ")} · ${ci.files.join(", ")}${ci.triggers.length ? ` · runs on ${ci.triggers.join(", ")}` : ""}`) : h("div", { class: "emptyline" }, "No CI configuration found."),
    table(["Gate", "Detected", "Evidence"], ci.gates.map((g) => [td(g.label), td(g.present ? tag("✓", "ok") : tag("✗ not detected", "muted")), td(g.evidence ? h("span", {}, h("code", {}, `${g.evidence.path}:${g.evidence.line}`), " ", h("span", { class: "note" }, g.evidence.text)) : "")])),
    findingsOf(p, (f) => f.category === "build" || f.category === "ci"),
  );
}

async function runCheck(c: BuildCheck): Promise<void> {
  if (!confirm(`Run this command in ${c.cwd || "the repository root"}?\n\n${c.argv.join(" ")}\n\nIt runs with your permissions, without a shell, for at most 10 minutes.`)) return;
  setStatus("busy", `Running ${c.display}…`);
  toast(`Running ${c.display}…`);
  try {
    const r = await post<RunResult>(`/api/health/run?check=${encodeURIComponent(c.id)}`);
    toast(`${c.display}: ${r.status} in ${Math.round(r.durationMs / 100) / 10}s`);
    await load();
  } catch (e) {
    setStatus("error", "Run failed");
    toast((e as Error).message);
  }
}

// ─── trends ─────────────────────────────────────────────────────────

const TREND_LABEL: Record<string, [string, "up" | "down"]> = {
  findings: ["Open findings", "down"],
  critical: ["Critical findings", "down"],
  high: ["High findings", "down"],
  coverage: ["Line coverage %", "up"],
  testRelationship: ["Symbols with a test relationship %", "up"],
  testCases: ["Test cases", "up"],
  complexFunctions: ["Highly complex functions", "down"],
  deadCode: ["Dead-code candidates", "down"],
  hotspots: ["High-priority hotspots", "down"],
  dependencies: ["Dependencies", "down"],
  vulnerabilities: ["Known vulnerabilities", "down"],
};

function trendsSection(p: HealthPagePayload): HTMLElement {
  const pts = p.trend;
  if (pts.length < 2) return section("trends", "Trends", "Is health getting better or worse?", h("div", { class: "emptyline" }, "Trends build up as Fehm analyses new commits or working-tree states (one point per distinct analysis). Only one point so far."));
  const keys = Object.keys(TREND_LABEL).filter((k) => pts.some((x) => x.metrics[k] !== undefined));
  return section(
    "trends",
    "Trends",
    "Is health getting better or worse?",
    h(
      "div",
      { class: "spark" },
      ...keys.map((k) => {
        const series = pts.map((x) => x.metrics[k]).filter((v): v is number => v !== undefined);
        const max = Math.max(...series);
        const min = Math.min(...series);
        const X = (i: number): number => 4 + (i / Math.max(1, series.length - 1)) * 192;
        const Y = (v: number): number => 42 - (max === min ? 0.5 : (v - min) / (max - min)) * 38;
        const last = series.at(-1)!;
        const first = series[0]!;
        const delta = last - first;
        const good = delta === 0 ? "" : (delta < 0) === (TREND_LABEL[k]![1] === "down") ? "s-healthy" : "s-degraded";
        const svg = svgEl("svg", { viewBox: "0 0 200 46", preserveAspectRatio: "none", role: "img", "aria-label": `${TREND_LABEL[k]![0]} over ${series.length} analyses` }, svgEl("polyline", { points: series.map((v, i) => `${X(i)},${Y(v)}`).join(" ") }), svgEl("circle", { cx: X(series.length - 1), cy: Y(last), r: 2.5 }));
        return h("div", { class: "box" }, h("span", { class: "note" }, TREND_LABEL[k]![0]), h("span", { class: "v" }, fmt.format(last)), svg, h("span", { class: `d ${good}` }, delta === 0 ? `unchanged over ${series.length} analyses` : `${delta > 0 ? "+" : ""}${fmt.format(Math.round(delta * 10) / 10)} since ${new Date(pts[0]!.at).toLocaleDateString()}`));
      }),
    ),
  );
}

// ─── findings ───────────────────────────────────────────────────────

function findingsOf(p: HealthPagePayload, pick: (f: Finding) => boolean, empty?: string): HTMLElement | null {
  const list = p.findings.filter((f) => pick(f) && isOpen(f));
  if (!list.length) return empty ? h("div", { class: "emptyline" }, empty) : null;
  return h("div", {}, h("h3", {}, `Findings (${list.length})`), h("div", { class: "flist" }, ...list.slice(0, 30).map((f) => findingRow(f))), list.length > 30 ? h("p", { class: "more" }, `${list.length - 30} more in Findings`) : null);
}

function findingsSection(p: HealthPagePayload): HTMLElement {
  const input = h("input", { type: "search", placeholder: "Search findings, files, symbols…", value: state.q, "aria-label": "Search findings" }) as HTMLInputElement;
  input.addEventListener("input", () => {
    state.q = input.value;
    renderFindingList();
  });
  const sev = h("span", { class: "chips", role: "group", "aria-label": "Severity" }, ...(["all", ...SEVERITIES] as const).map((s) => h("button", { "data-sev": s, "aria-pressed": String(state.sev === s), onclick: () => ((state.sev = s), renderFindingList()) }, s === "all" ? "All" : s, s === "all" ? null : h("i", {}, String(p.summary.bySeverity[s])))));
  const cats = [...new Set(p.findings.map((f) => f.category))].sort();
  const cat = h("select", { "aria-label": "Category", onchange: (e: Event) => ((state.cat = (e.target as HTMLSelectElement).value), renderFindingList()) }, h("option", { value: "all" }, "All categories"), ...cats.map((c) => h("option", { value: c, ...(state.cat === c ? { selected: true } : {}) }, CATEGORY_LABEL[c] ?? c)));
  const show = h("select", { "aria-label": "Review state", onchange: (e: Event) => ((state.show = (e.target as HTMLSelectElement).value as typeof state.show), renderFindingList()) }, h("option", { value: "open" }, "Open"), h("option", { value: "reviewed" }, "Suppressed / accepted"), h("option", { value: "all" }, "All"));
  const onlyNew = p.baseline ? h("label", { class: "note" }, h("input", { type: "checkbox", ...(state.onlyNew ? { checked: true } : {}), onchange: (e: Event) => ((state.onlyNew = (e.target as HTMLInputElement).checked), renderFindingList()) }), " new since baseline") : null;
  return section("findings", "Findings", "Every finding, with its evidence, what is missing, and how to verify a fix.", h("div", { class: "filters" }, input, sev, cat, show, onlyNew), h("div", { id: "flist", class: "flist" }));
}

function renderFindingList(): void {
  const p = state.p!;
  const q = state.q.trim().toLowerCase();
  const list = p.findings.filter((f) => (state.sev === "all" || f.severity === state.sev) && (state.cat === "all" || f.category === state.cat) && (state.show === "all" || (state.show === "open" ? isOpen(f) : !isOpen(f))) && (!state.onlyNew || f.baseline === "new") && (!q || `${f.title} ${f.message} ${f.file ?? ""} ${f.symbol ?? ""} ${f.ruleId} ${f.evidence.map((e) => `${e.path ?? ""} ${e.detail}`).join(" ")}`.toLowerCase().includes(q)));
  for (const b of document.querySelectorAll<HTMLButtonElement>("[data-sev]")) b.setAttribute("aria-pressed", String(b.dataset.sev === state.sev));
  const el = document.getElementById("flist");
  if (!el) return;
  el.replaceChildren(...(list.length ? list.slice(0, 300).map((f) => findingRow(f)) : [h("div", { class: "emptyline" }, "No findings match.")]), ...(list.length > 300 ? [h("p", { class: "more" }, `${list.length - 300} more; narrow the filters.`)] : []));
}

function findingRow(f: Finding): HTMLElement {
  const where = f.file ? `${f.file}${f.line ? `:${f.line}` : ""}` : f.evidence[0]?.path ? `${f.evidence[0].path}${f.evidence.length > 1 ? ` +${f.evidence.length - 1 + f.more}` : ""}` : "";
  const det = h(
    "details",
    { class: `f ${f.severity}${isOpen(f) ? "" : " reviewed-out"}`, "data-id": f.id },
    h("summary", {}, h("span", { class: `sv ${f.severity}` }, f.severity), h("span", { class: "tt" }, f.title), h("span", { class: "fm" }, f.baseline === "new" ? tag("new", "warn") : null, f.review ? tag(REVIEW_LABEL[f.review.status], "muted") : null, h("span", { class: `cf ${f.confidence}`, title: "Confidence in the evidence" }, f.confidence)), where ? h("span", { class: "sub" }, where) : null),
  );
  det.addEventListener("toggle", () => {
    if (det.open && det.childElementCount === 1) det.append(findingBody(f));
  });
  return det;
}

function findingBody(f: Finding): HTMLElement {
  const evidence = h(
    "div",
    { class: "ev" },
    ...f.evidence.map((e) => {
      const row = h("div", { class: "row" }, h("span", { class: "p" }, e.path ? `${e.path}${e.line ? `:${e.line}` : ""}` : e.type), e.confidence ? h("span", { class: `cf ${e.confidence}` }, e.confidence) : null);
      if (e.path) {
        const btn = h("button", { class: "act", "aria-expanded": "false" }, "Source");
        btn.addEventListener("click", () => void toggleSource(btn, row, e.path!, e.line ?? 1));
        row.append(btn, h("a", { class: "act", href: e.nodeId ? graphHref(e.nodeId) : graphHref(`file:${e.path}`) }, "Graph"), h("a", { class: "act", href: editorHref(e.path, e.line) }, "Editor"));
      }
      row.append(h("span", { class: "d" }, e.detail));
      return row;
    }),
    f.more ? h("div", { class: "more" }, `… ${f.more} more`) : null,
  );
  const reviews = h("div", { class: "reviews" }, h("span", { class: "note" }, f.review ? `${REVIEW_LABEL[f.review.status]} ${ago(f.review.at)}${f.review.note ? `: ${f.review.note}` : ""}` : "Not reviewed."), ...(["reviewed", "false-positive", "accepted-risk", "suppressed"] as ReviewStatus[]).map((s) => h("button", { class: "act", disabled: !state.p!.writable || f.review?.status === s, onclick: () => void review(f, s) }, REVIEW_LABEL[s])), f.review ? h("button", { class: "act", disabled: !state.p!.writable, onclick: () => void review(f, "clear") }, "Clear") : null);
  return h(
    "div",
    { class: "fbody" },
    h("div", {}, h("h4", {}, "What was detected"), h("p", {}, f.message)),
    f.metric ? h("div", {}, h("h4", {}, "Measurement"), h("p", {}, `${f.metric.name}: ${f.metric.value} (limit ${f.metric.threshold})`)) : null,
    h("div", {}, h("h4", {}, "Evidence"), evidence),
    f.missing?.length ? h("div", {}, h("h4", {}, "Not established"), h("ul", { class: "plain" }, ...f.missing.map((m) => h("li", {}, m)))) : null,
    h("div", {}, h("h4", {}, "Why it matters"), h("p", {}, f.why)),
    h("div", {}, h("h4", {}, "What to do"), h("p", {}, f.action)),
    h("div", {}, h("h4", {}, "How to verify"), h("ul", { class: "plain" }, ...f.verification.map((v) => h("li", {}, v)))),
    h("div", {}, h("h4", {}, "Rule"), h("p", { class: "mono" }, f.ruleId, f.upstream ? h("span", { class: "note" }, ` · adapted from Skylos ${f.upstream}`) : null, h("span", { class: "note" }, ` · id ${f.id}`))),
    h("div", {}, h("h4", {}, "Review"), reviews),
  );
}

async function review(f: Finding, status: ReviewStatus | "clear"): Promise<void> {
  let note = "";
  if (status === "false-positive" || status === "accepted-risk" || status === "suppressed") note = prompt(`${REVIEW_LABEL[status]}: why? (optional, stored in the state directory)`) ?? "";
  try {
    await post(`/api/health/review?id=${encodeURIComponent(f.id)}&status=${status}${note ? `&note=${encodeURIComponent(note)}` : ""}`);
    toast(status === "clear" ? "Review cleared." : `Marked ${REVIEW_LABEL[status as ReviewStatus].toLowerCase()}.`);
    const y = scrollY;
    await load();
    scrollTo(0, y);
  } catch (e) {
    toast(`Could not save: ${(e as Error).message}`);
  }
}

async function toggleSource(btn: HTMLElement, row: HTMLElement, path: string, line: number): Promise<void> {
  const open = row.querySelector("pre.code");
  if (open) {
    open.remove();
    btn.setAttribute("aria-expanded", "false");
    return;
  }
  try {
    const x = await json<SourceExcerpt>(`/api/health/source?path=${encodeURIComponent(path)}&line=${line}`);
    row.append(h("pre", { class: "code" }, ...x.lines.map((l, i) => h("span", { class: x.start + i === x.focus ? "f" : "" }, h("i", {}, String(x.start + i)), l))));
    btn.setAttribute("aria-expanded", "true");
  } catch (e) {
    toast(`No excerpt: ${(e as Error).message}`);
  }
}

// ─── analysis ───────────────────────────────────────────────────────

function analysisSection(p: HealthPagePayload): HTMLElement {
  const checks = p.languages[0] ? Object.keys(p.languages[0].checks) : [];
  const chip = (s: string): HTMLElement => tag(s === "ast" ? "syntax tree" : s === "heuristic" ? "heuristic" : "—", s === "ast" ? "ok" : s === "heuristic" ? "warn dashed" : "muted");
  const a = p.provenance;
  return section(
    "analysis",
    "Analysis",
    "What ran, how deeply each language was analysed, and what was not determined.",
    table(["Analyzer", "Status", "Findings", "Time", "Notes"], p.analyzers.map((r) => [td(r.name), td(tag(r.status, r.status === "complete" ? "ok" : r.status === "error" ? "bad" : r.status === "partial" ? "warn" : "muted dashed")), td(String(r.findings), "num"), td(`${r.durationMs} ms`, "num"), td(r.reason ?? "")])),
    p.languages.length ? h("h3", {}, "Analysis coverage by language") : null,
    p.languages.length ? table(["Language", "Files", ...checks], p.languages.map((l) => [td(l.language), td(String(l.files), "num"), ...checks.map((c) => td(chip(l.checks[c]!)))])) : null,
    h("h3", {}, "Provenance"),
    h("div", { class: "box" }, h("p", { class: "meta" }, `Fehm ${a.fehmVersion} · health rules v${a.healthVersion}${a.commit ? ` · commit ${a.commit.slice(0, 12)}${a.dirty ? " + working-tree changes" : ""}` : ""}`), h("p", { class: "mono", style: "word-break:break-all;margin:4px 0" }, `SHA-256 ${a.digest}`), h("p", { class: "note" }, `Rules: ${a.rulesDerivedFrom}.`), h("h4", { class: "eyebrow", style: "margin:8px 0 4px" }, "Inputs"), h("ul", { class: "plain" }, ...a.inputs.map((i) => h("li", {}, i))), h("h4", { class: "eyebrow", style: "margin:8px 0 4px" }, "Excluded"), h("ul", { class: "plain" }, ...a.excluded.map((i) => h("li", {}, i)))),
    h("p", { class: "note" }, `The digest changes whenever any analysed input changes; the same inputs always give the same digest. ${p.config.file ? `Configuration: ${p.config.file}.` : "Configuration: defaults (add .fehm/health.json to change thresholds, ignores, coverage paths or license policy)."}`),
    h("h3", {}, "Not determined"),
    h("ul", { class: "unknowns" }, ...p.unknowns.map((u) => h("li", {}, u))),
  );
}

// ─── navigation ─────────────────────────────────────────────────────

function go(id: string): void {
  document.getElementById(id)?.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
}

function filterAndGo(sev: Severity): void {
  state.sev = sev;
  state.show = "open";
  renderFindingList();
  go("findings");
}

function openFromHash(): void {
  const m = /finding=([^&]+)/.exec(location.hash);
  if (!m) return;
  const id = decodeURIComponent(m[1]!);
  state.sev = "all";
  state.cat = "all";
  state.show = "all";
  state.q = "";
  renderFindingList();
  const el = [...document.querySelectorAll<HTMLDetailsElement>("details.f")].find((d) => d.dataset.id === id);
  if (!el) return;
  el.open = true;
  el.classList.add("flash");
  el.scrollIntoView({ block: "center" });
  setTimeout(() => el.classList.remove("flash"), 1600);
}

let observer: IntersectionObserver | undefined;
function spy(): void {
  observer?.disconnect();
  const links = new Map([...document.querySelectorAll<HTMLAnchorElement>("#toc a[data-sec]")].map((a) => [a.dataset.sec!, a]));
  observer = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        for (const a of links.values()) a.removeAttribute("aria-current");
        links.get(e.target.id)?.setAttribute("aria-current", "true");
      }
    },
    { rootMargin: "-60px 0px -70% 0px" },
  );
  for (const id of links.keys()) {
    const el = document.getElementById(id);
    if (el) observer.observe(el);
  }
}

function setScope(scope: "all" | "changed"): void {
  state.scope = scope;
  $("scope-all").setAttribute("aria-pressed", String(scope === "all"));
  $("scope-changed").setAttribute("aria-pressed", String(scope === "changed"));
  void load();
}

$("refresh").addEventListener("click", () => void load(`/api/health/refresh${state.scope === "changed" ? "?scope=changed" : ""}`, { method: "POST" }));
$("scope-all").addEventListener("click", () => setScope("all"));
$("scope-changed").addEventListener("click", () => setScope("changed"));
window.addEventListener("hashchange", openFromHash);
void load();
