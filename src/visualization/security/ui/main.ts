import type { ReviewStatus, Severity } from "../../../findings/model.js";
import type { SourceExcerpt } from "../../../health/types.js";
import type { ControlState, Posture, SecurityFinding, SecurityPagePayload, SurfaceRoute, Trace } from "../../../security/types.js";
import { $, fmt, h } from "../../graph/ui/dom.js";

/**
 * Feature 3.6 page: security posture, attack surface, data flows and
 * controls, all from one `/api/security` payload. No score: counts,
 * evidence, and what could not be established.
 */

type Child = Node | string | null | undefined | false;

const state: { p: SecurityPagePayload | null; scope: "all" | "changed"; q: string; sev: Severity | "all"; domain: string; show: "open" | "all" | "reviewed"; onlyNew: boolean; routeFilter: "all" | "unauth" | "changing" | "sensitive"; fw: string } = { p: null, scope: "all", q: "", sev: "all", domain: "all", show: "open", onlyNew: false, routeFilter: "all", fw: "owasp-top10-2021" };

const POSTURE: Record<Posture, string> = { "critical-attention": "Critical attention", "attention-required": "Attention required", review: "Review", "no-high-severity-findings": "No high-severity findings", unknown: "Unknown" };
const SEVERITIES: Severity[] = ["critical", "high", "medium", "low", "info"];
const DOMAIN: Record<string, string> = { application: "Application", "data-flow": "Data flow", secrets: "Secrets", dependencies: "Dependencies", auth: "Authentication", api: "API", cicd: "CI/CD", containers: "Containers", kubernetes: "Kubernetes", infrastructure: "Infrastructure", llm: "LLM", agents: "Agents", mcp: "MCP" };
const REVIEW_LABEL: Record<ReviewStatus, string> = { reviewed: "Reviewed", "false-positive": "False positive", "accepted-risk": "Accepted risk", suppressed: "Suppressed" };
const CTRL_ICON = { present: "✓", partial: "◐", missing: "✗", "not-applicable": "·", unknown: "?" } as const;
const C_ICON: Record<ControlState, string> = { detected: "✓", "not-detected": "✗", unknown: "?", "not-applicable": "—" };

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
const isOpen = (f: SecurityFinding): boolean => !f.review || f.review.status === "reviewed";
const tag = (text: string, cls = ""): HTMLElement => h("span", { class: `tag ${cls}` }, text);
const td = (x: Child, cls = ""): HTMLElement => h("td", cls ? { class: cls } : {}, x);
function table(head: string[], rows: Node[][]): HTMLElement {
  return h("div", { class: "tscroll" }, h("table", { class: "t" }, h("thead", {}, h("tr", {}, ...head.map((x) => h("th", {}, x)))), h("tbody", {}, ...rows.map((r) => h("tr", {}, ...r)))));
}
function section(id: string, title: string, question: string, ...body: Child[]): HTMLElement {
  return h("section", { class: "card sec", id }, h("header", {}, h("h2", {}, title), h("span", { class: "q" }, question)), ...body);
}
function meter(parts: [number, string][], total: number): HTMLElement {
  return h("div", { class: "meter" }, ...parts.filter(([v]) => v > 0).map(([v, cls]) => h("i", { class: cls, style: `width:${total ? (v / total) * 100 : 0}%` })));
}
const sevCounts = (list: SecurityFinding[]): HTMLElement => h("span", { class: "cnt" }, ...SEVERITIES.filter((s) => list.some((f) => f.severity === s)).map((s) => h("span", { class: `sv ${s}` }, `${list.filter((f) => f.severity === s).length} ${s}`)));

// ─── load and render ────────────────────────────────────────────────

async function load(path = `/api/security${state.scope === "changed" ? "?scope=changed" : ""}`, init?: RequestInit): Promise<void> {
  setStatus("busy", "Reviewing…");
  try {
    state.p = await json<SecurityPagePayload>(path, init);
    render();
    $("overlay").hidden = true;
    const f = state.p.freshness;
    if (!f.fresh) $("refresh").dataset.stale = "";
    else delete $("refresh").dataset.stale;
    setStatus(f.fresh ? "ready" : "stale", f.fresh ? `${state.p.durationMs} ms` : `${f.added + f.modified + f.deleted} files changed, run the scan again`);
    openFromHash();
  } catch (e) {
    setStatus("error", "Failed");
    $("overlay").hidden = false;
    $("overlay-title").textContent = "Could not review security";
    $("overlay-text").textContent = (e as Error).message;
    const retry = $("overlay-action");
    retry.hidden = false;
    retry.onclick = () => void load();
  }
}

const SECTIONS = [
  ["overview", "Posture", []],
  ["surface", "Attack surface", ["auth", "api"]],
  ["dataflow", "Data flow", ["data-flow"]],
  ["application", "Application", ["application"]],
  ["secrets", "Secrets", ["secrets"]],
  ["dependencies", "Dependencies", ["dependencies"]],
  ["cicd", "CI/CD", ["cicd"]],
  ["containers", "Containers & Kubernetes", ["containers", "kubernetes"]],
  ["infrastructure", "Infrastructure", ["infrastructure"]],
  ["ai", "LLM, agents & MCP", ["llm", "agents", "mcp"]],
  ["controls", "Security controls", []],
  ["frameworks", "OWASP & CWE", []],
  ["findings", "Findings", []],
  ["trends", "Trends", []],
  ["analysis", "Analysis", []],
] as const;

function render(): void {
  const p = state.p!;
  $("project").textContent = p.repository.name;
  document.title = `Security Review · ${p.repository.name} · fehm`;
  const open = p.findings.filter(isOpen);
  $("toc").replaceChildren(
    h("h3", {}, "Security review"),
    h(
      "ol",
      {},
      ...SECTIONS.map(([id, label, domains]) => {
        const n = id === "findings" ? open.length : (domains as readonly string[]).length ? open.filter((f) => (domains as readonly string[]).includes(f.domain)).length : 0;
        const worst = SEVERITIES.find((s) => open.some((f) => (domains as readonly string[]).includes(f.domain) && f.severity === s));
        return h("li", {}, h("a", { href: `#${id}`, "data-sec": id }, label, n ? h("span", { class: `n ${worst === "critical" || worst === "high" ? "sv-bad" : ""}`, style: worst === "critical" || worst === "high" ? "color:var(--err)" : "" }, String(n)) : null));
      }),
    ),
  );
  $("content").replaceChildren(
    overview(p),
    surfaceSection(p),
    dataflowSection(p),
    domainSection("application", "Application code", "Which risky patterns appear in the code itself: weak crypto, disabled TLS, unsafe deserializers, JWT and cookie misuse?", ["application"], p),
    secretsSection(p),
    dependencySection(p),
    domainSection("cicd", "CI/CD", "Can the pipeline be abused: untrusted code with privileges, script injection, unpinned actions, broad tokens?", ["cicd"], p),
    domainSection("containers", "Containers & Kubernetes", "Do containers and pods run with more privilege than they need?", ["containers", "kubernetes"], p),
    domainSection("infrastructure", "Infrastructure as code", "Does the infrastructure expose storage, databases or networks to the internet?", ["infrastructure"], p),
    aiSection(p),
    controlsSection(p),
    frameworksSection(p),
    findingsSection(p),
    trendsSection(p),
    analysisSection(p),
    h("p", { class: "foot" }, `${p.repository.root} · digest ${p.provenance.digest.slice(0, 16)} · generated ${new Date(p.generatedAt).toLocaleString()} · deterministic, no model calls`),
  );
  renderFindingList();
  spy();
}

// ─── posture ────────────────────────────────────────────────────────

function overview(p: SecurityPagePayload): HTMLElement {
  const critical = p.findings.filter((f) => isOpen(f) && (f.severity === "critical" || f.severity === "high")).slice(0, 6);
  const base = p.baseline;
  const t = p.surface.totals;
  return h(
    "section",
    { class: "card", id: "overview" },
    h(
      "div",
      { id: "hero" },
      h("span", { class: "eyebrow" }, "Security Review"),
      h("h1", {}, "Security review"),
      h("p", { class: "tagline" }, "What security risks exist, how untrusted data moves through the code, which controls exist and which are missing, and what evidence supports each finding?"),
      h("div", { class: "verdict" }, h("span", { class: `pill p-${p.posture}` }, h("i"), POSTURE[p.posture]), h("div", { class: "meta" }, p.provenance.commit ? h("code", {}, `${p.provenance.commit.slice(0, 8)}${p.provenance.dirty ? " + changes" : ""}`) : null, h("span", {}, `reviewed ${ago(p.generatedAt)}`), p.scope === "changed" ? tag("changed files only", "warn") : null)),
      h("ul", { class: "reasons" }, ...p.postureReasons.map((r) => h("li", {}, r))),
      h("p", { class: "note" }, "Posture comes from the most severe open finding. There is no security score, and no finding is proof of an exploitable vulnerability."),
      h("div", { class: "sevs" }, ...SEVERITIES.map((s) => h("button", { class: `sev ${s}`, onclick: () => filterAndGo(s) }, s[0]!.toUpperCase() + s.slice(1), h("b", {}, String(p.summary.bySeverity[s]))))),
      h("div", { class: "kv", style: "margin-top:14px" }, ...[[t.routes, "routes"], [t.unauthenticated, "without detected authentication"], [t.unauthenticatedStateChanging, "state-changing, no auth"], [t.sensitive, "sensitive"], [p.findings.filter((f) => f.trace && isOpen(f)).length, "data flows to sinks"], [p.ai.sites.length, "LLM calls"], [p.ai.tools.length, "agent tools"]].map(([n, l], i) => h("div", { class: i === 2 && n ? "bad" : "" }, h("b", {}, fmt.format(n as number)), h("span", {}, l as string)))),
      h("div", { class: "meta", style: "margin-top:12px" }, base ? h("span", {}, `Baseline ${ago(base.createdAt)}: `, h("b", {}, `${base.added} new`), `, ${base.fixed.length} fixed`) : h("span", {}, "No baseline."), h("button", { disabled: !p.writable, onclick: () => void baseline(false) }, base ? "Move baseline here" : "Set baseline"), base ? h("button", { disabled: !p.writable, onclick: () => void baseline(true) }, "Clear baseline") : null),
    ),
    h(
      "div",
      { style: "padding:0 22px 20px" },
      h("h3", {}, "Critical attention"),
      critical.length ? h("div", { class: "flist" }, ...critical.map(findingRow)) : h("div", { class: "emptyline" }, "No critical or high findings."),
      h("h3", {}, "Security domains"),
      h(
        "div",
        { class: "domains" },
        ...p.domains.map((d) => {
          const list = p.findings.filter((f) => f.domain === d.domain && isOpen(f));
          return h("div", { class: `domain${d.applicable ? "" : " na"}`, title: d.note }, h("span", { class: "nm" }, d.title), d.applicable ? meter([[d.analysed, list.some((f) => f.severity === "critical" || f.severity === "high") ? "bar-err" : list.length ? "bar-warn" : "bar-ok"], [d.relevant - d.analysed, "bar-none"]], d.relevant) : h("span", { class: "note" }, "not present"), list.length ? sevCounts(list) : h("span", { class: "cnt note" }, d.applicable ? (d.analysed < d.relevant ? `${d.analysed}/${d.relevant} analysed` : "no findings") : ""));
        }),
      ),
      h("p", { class: "note" }, "Bars show how much of each domain Fehm could analyse (hover for what that means), coloured by the worst open finding. A full bar with no findings means nothing was detected, not that the domain is secure."),
    ),
  );
}

async function baseline(clear: boolean): Promise<void> {
  try {
    await post(`/api/security/baseline${clear ? "?clear=1" : ""}`);
    toast(clear ? "Baseline cleared." : "Baseline set.");
    await load();
  } catch (e) {
    toast((e as Error).message);
  }
}

// ─── attack surface ─────────────────────────────────────────────────

function cChip(state: ControlState, title: string, ev?: { path: string; line: number; text: string }): HTMLElement {
  return h("span", { class: `c ${state}`, title: `${title}: ${state.replace("-", " ")}${ev ? `\n${ev.path}:${ev.line}\n${ev.text}` : ""}` }, C_ICON[state]);
}

function surfaceSection(p: SecurityPagePayload): HTMLElement {
  const body = h("tbody");
  const fill = (): void => {
    const rows = p.surface.routes.filter((r) => state.routeFilter === "all" || (state.routeFilter === "unauth" && r.authentication.state !== "detected") || (state.routeFilter === "changing" && r.stateChanging) || (state.routeFilter === "sensitive" && r.sensitive.length));
    body.replaceChildren(...rows.slice(0, 300).map(routeRow));
    for (const b of document.querySelectorAll<HTMLButtonElement>("[data-rf]")) b.setAttribute("aria-pressed", String(b.dataset.rf === state.routeFilter));
  };
  const chips = h("span", { class: "chips", role: "group", "aria-label": "Route filter" }, ...([["all", "All"], ["unauth", "No auth detected"], ["changing", "State-changing"], ["sensitive", "Sensitive"]] as const).map(([k, l]) => h("button", { "data-rf": k, "aria-pressed": String(state.routeFilter === k), onclick: () => ((state.routeFilter = k), fill()) }, l)));
  queueMicrotask(fill);
  const g = p.surface.globalControls;
  return section(
    "surface",
    "Attack surface",
    "Which entry points exist, and which controls stand in front of each?",
    p.surface.routes.length ? h("div", { class: "filters" }, chips, h("span", { class: "note" }, "✓ detected · ✗ not detected · ? unknown (handler not resolved) · — not applicable")) : h("div", { class: "emptyline" }, "No HTTP routes were found."),
    p.surface.routes.length ? h("div", { class: "tscroll" }, h("table", { class: "t" }, h("thead", {}, h("tr", {}, ...["Method", "Route", "Handler", "AuthN", "AuthZ", "Input", "Rate", "Sensitive", "Reaches", "Findings"].map((x) => h("th", {}, x)))), body)) : null,
    g.length ? h("h3", {}, "Application-wide controls") : null,
    g.length ? h("ul", { class: "plain" }, ...g.map((x) => h("li", {}, h("b", {}, x.name), " ", h("code", {}, `${x.evidence.path}:${x.evidence.line}`), " ", h("span", { class: "note" }, x.evidence.text)))) : null,
    h("p", { class: "note" }, "Controls are detected from code: middleware at the registration, decorators, earlier app.use(...) in the same file, or checks in the handler. A gateway, proxy or mounting router in another file can enforce them where Fehm cannot see; findings say \"not detected\", not \"missing\"."),
    findingsOf(p, (f) => f.domain === "auth" || f.domain === "api"),
  );
}

function routeRow(r: SurfaceRoute): HTMLElement {
  const reach = h("span", { class: "reach" }, ...([["database", "DB"], ["filesystem", "FS"], ["network", "NET"], ["process", "PROC"], ["llm", "LLM"]] as const).map(([k, l]) => h("span", { class: r.reaches[k] ? "on" : "", title: `${k}: ${r.reaches[k] ? "reached through calls" : "not reached"}` }, l)));
  return h(
    "tr",
    {},
    td(h("span", {}, r.method, r.kind !== "http" ? tag(r.kind, "warn") : null)),
    td(h("a", { href: editorHref(r.path, r.line), title: `${r.path}:${r.line}` }, r.route), "p"),
    td(r.handler ? h("a", { href: graphHref(r.handler.nodeId) }, r.handler.name) : h("span", { class: "note" }, "unresolved")),
    td(cChip(r.authentication.state, "Authentication", r.authentication.evidence)),
    td(cChip(r.authorization.state, "Authorization", r.authorization.evidence)),
    td(cChip(r.validation.state, "Input validation", r.validation.evidence)),
    td(cChip(r.rateLimit.state, "Rate limiting", r.rateLimit.evidence)),
    td(r.sensitive.length ? h("span", {}, ...r.sensitive.map((s) => tag(s, "warn"))) : ""),
    td(reach),
    td(r.findings ? h("b", { style: "color:var(--err)" }, String(r.findings)) : "", "num"),
  );
}

// ─── data flow ──────────────────────────────────────────────────────

function traceView(t: Trace): HTMLElement {
  const out = h("div", { class: "trace" });
  t.steps.forEach((s, i) => {
    if (i) out.append(h("div", { class: "ar" }, "↓"));
    out.append(h("div", { class: `st ${s.role}` }, h("span", { class: "r" }, s.role), h("span", { class: "l" }, s.label), h("a", { class: "w", href: editorHref(s.path, s.line) }, `${s.path}:${s.line}`)));
  });
  const note = t.sanitizers.length ? h("div", { class: "trace-note" }, `Seen on the path: ${t.sanitizers.join(", ")}. None of them neutralises a ${t.sink.kind} sink.`) : h("div", { class: "trace-note bad" }, "✗ No recognised sanitizer on the path.");
  return h("div", {}, out, note, t.interprocedural ? h("p", { class: "note" }, "The flow crosses a function call.") : null);
}

function dataflowSection(p: SecurityPagePayload): HTMLElement {
  const flows = p.findings.filter((f) => f.trace && isOpen(f));
  const kinds = new Map<string, number>();
  for (const f of flows) kinds.set(f.trace!.sink.kind, (kinds.get(f.trace!.sink.kind) ?? 0) + 1);
  return section(
    "dataflow",
    "Data flow",
    "Where does untrusted data (requests, model output, tool arguments) reach a dangerous sink without a sanitizer that neutralises it?",
    flows.length ? h("div", { class: "sevs" }, ...[...kinds].map(([k, n]) => h("span", { class: "sev" }, k, h("b", {}, String(n))))) : null,
    flows.length ? h("div", { class: "flist" }, ...flows.slice(0, 40).map(findingRow)) : h("div", { class: "emptyline" }, "No source-to-sink flow without a neutralising sanitizer was found."),
    h("p", { class: "note" }, "TypeScript and JavaScript flows are traced on the syntax tree, through assignments, calls and one level into other functions (also across files). Python flows are traced line by line inside a function (heuristic). Parameterized queries, numeric conversion, escaping, basename and allowlist guards are recognised per sink."),
  );
}

function domainSection(id: string, title: string, question: string, domains: string[], p: SecurityPagePayload): HTMLElement {
  return section(id, title, question, findingsOf(p, (f) => domains.includes(f.domain), "No findings in this area."), ...coverageNote(p, domains));
}

function coverageNote(p: SecurityPagePayload, domains: string[]): HTMLElement[] {
  return p.domains.filter((d) => domains.includes(d.domain) && !d.applicable).map((d) => h("p", { class: "note" }, `${d.title}: nothing to analyse (${d.note.toLowerCase()})`));
}

function secretsSection(p: SecurityPagePayload): HTMLElement {
  return section(
    "secrets",
    "Secrets",
    "Are credentials committed to the repository?",
    h("p", { class: "meta" }, `${plural(p.secrets.scannedFiles, "file")} scanned · ${plural(p.secrets.found, "finding")}${p.secrets.testFixtures ? ` (${p.secrets.testFixtures} in test files, at low severity)` : ""}.`),
    h("div", { class: "disclaimer" }, h("b", {}, "Values are never shown. "), "Findings carry the kind, length and a SHA-256 fingerprint; source excerpts on this page mask detected secrets. Rotate a real credential before removing it: it stays in git history."),
    findingsOf(p, (f) => f.domain === "secrets", "No secrets detected."),
  );
}

function dependencySection(p: SecurityPagePayload): HTMLElement {
  const d = p.dependencies;
  return section(
    "dependencies",
    "Dependencies",
    "Which known-vulnerable packages are installed, and can the application actually reach them?",
    d.advisories === "not-checked" || d.advisories === "error"
      ? h("div", { class: "unknown-card" }, h("b", {}, "NOT CHECKED"), h("span", {}, `${plural(d.components, "component")} installed. Known vulnerabilities need the opt-in OSV.dev lookup, which sends package names and versions over the network.`), h("a", { href: "/#/health?dependencies", target: "_top" }, "Run it from Project health → Dependencies"))
      : h("p", { class: "meta" }, `${d.advisories === "stale" ? "Stale: " : ""}checked ${d.checkedAt ? ago(d.checkedAt) : ""} against OSV.dev · ${plural(d.vulnerable.length, "vulnerable package")}.`),
    d.vulnerable.length ? table(["Package", "Advisories", "Severity", "Direct", "Reachable", "Path"], d.vulnerable.map((v) => [td(`${v.name}@${v.version}`, "p"), td(v.ids.slice(0, 3).join(", "), "p"), td(h("span", { class: `sv ${v.severity === "unknown" ? "info" : v.severity}` }, v.severity)), td(v.direct ? "yes" : "no"), td(tag(v.reachable, v.reachable === "yes" ? "bad" : v.reachable === "no" ? "ok" : "muted")), td(v.path ? v.path.join(" → ") : "", "p")])) : null,
    h("p", { class: "note" }, "Reachable means a route handler or entry point reaches, through imports and calls, a file that imports the package. Whether the vulnerable function itself is called is not established."),
    findingsOf(p, (f) => f.domain === "dependencies"),
  );
}

// ─── AI ─────────────────────────────────────────────────────────────

function aiSection(p: SecurityPagePayload): HTMLElement {
  const a = p.ai;
  const none = !a.sites.length && !a.tools.length && !a.mcpServers.length && !a.mcpConfigs.length && !a.providers.length;
  if (none) return section("ai", "LLM, agents & MCP", "Which model integrations, agent tools and MCP servers exist, and what guards them?", h("div", { class: "emptyline" }, "No LLM provider, agent framework, tool or MCP server was found."));
  const yes = (b: boolean | undefined): HTMLElement => tag(b ? "yes" : "no", b ? "ok" : "muted");
  return section(
    "ai",
    "LLM, agents & MCP",
    "Which model integrations, agent tools and MCP servers exist, and what guards them?",
    h("div", { class: "kv" }, ...[...a.providers.map((x) => [x.files, x.name]), ...a.frameworks.map((x) => [x.files, x.name]), [a.sites.length, "LLM call sites"], [a.tools.length, "agent tools"], [a.mcpServers.length + a.mcpConfigs.length, "MCP servers / configs"]].map(([n, l]) => h("div", {}, h("b", {}, String(n)), h("span", {}, String(l))))),
    h("h3", {}, "Controls around AI"),
    h("div", { class: "bars" }, ...a.controls.filter((c) => c.applicable).map((c) => h("div", { class: "bar" }, h("span", {}, c.label), meter([[c.detected, c.detected === c.applicable ? "bar-ok" : c.detected ? "bar-warn" : "bar-err"], [c.applicable - c.detected, "bar-none"]], c.applicable), h("span", { class: "v" }, `${Math.round((c.detected / c.applicable) * 100)}%`)))),
    h("p", { class: "note" }, "Each percentage is the share of call sites or tools where evidence of that control was detected. It is not a measure of how secure the integration is."),
    a.sites.length ? h("h3", {}, "LLM call sites") : null,
    a.sites.length ? table(["Where", "Provider", "Call", "Model", "Pinned", "Output limit", "Untrusted input", "Output reaches"], a.sites.map((s) => [td(h("a", { href: editorHref(s.path, s.line) }, `${s.path}:${s.line}`), "p"), td(s.provider), td(s.call, "p"), td(s.model ?? "—", "p"), td(s.model ? yes(s.modelPinned) : ""), td(yes(s.maxTokens)), td(s.untrustedInput ? tag("request data", "bad") : ""), td(s.outputToSink ? tag(s.outputToSink, "bad") : "")])) : null,
    a.tools.length ? h("h3", {}, "Agent and MCP tools") : null,
    a.tools.length ? table(["Tool", "Framework", "Capabilities", "Schema", "Approval / allowlist", "Where"], a.tools.map((t) => [td(h("b", {}, t.name)), td(t.framework), td(h("span", {}, ...t.capabilities.map((c) => tag(c, c === "shell" || c === "code-eval" || c === "filesystem-write" ? "bad" : "warn")))), td(yes(t.schema)), td(yes(t.approval)), td(`${t.path}:${t.line}`, "p")])) : null,
    a.mcpServers.length || a.mcpConfigs.length ? h("h3", {}, "MCP servers and client configurations") : null,
    a.mcpServers.length ? table(["Server", "Transport", "Auth detected"], a.mcpServers.map((s) => [td(`${s.path}:${s.line}`, "p"), td(s.transport), td(s.transport === "stdio" ? tag("local (stdio)", "muted") : yes(s.auth))])) : null,
    a.mcpConfigs.length ? table(["Config", "Server", "Command", "Pinned"], a.mcpConfigs.map((c) => [td(`${c.path}:${c.line}`, "p"), td(c.name), td(c.command ?? c.transport, "p"), td(c.unpinnedPackage ? tag(`no (${c.unpinnedPackage})`, "warn") : tag("yes", "ok"))])) : null,
    findingsOf(p, (f) => f.domain === "llm" || f.domain === "agents" || f.domain === "mcp"),
  );
}

// ─── controls and frameworks ────────────────────────────────────────

function controlsSection(p: SecurityPagePayload): HTMLElement {
  return section(
    "controls",
    "Security controls",
    "Which defences does the code show evidence of?",
    h("div", { class: "ctl" }, ...p.controls.map((c) => h("div", { class: `box ${c.status}` }, h("div", { class: "hd" }, h("span", { class: "ic" }, CTRL_ICON[c.status]), c.title, h("span", { class: "tag muted", style: "margin-left:auto" }, c.status.replace("-", " "))), h("span", { class: "note" }, c.summary), c.evidence.length ? h("details", {}, h("summary", { class: "note" }, `Evidence (${c.evidence.length})`), h("ul", { class: "plain" }, ...c.evidence.map((e) => h("li", {}, h("a", { href: editorHref(e.path, e.line) }, `${e.path}${e.line ? `:${e.line}` : ""}`), " ", h("span", { class: "note" }, e.text))))) : null))),
    h("p", { class: "note" }, "Present means evidence was found in code, not that the control is complete or correct. Unknown means Fehm cannot tell from the repository (for example, TLS terminated by a proxy)."),
  );
}

function frameworksSection(p: SecurityPagePayload): HTMLElement {
  const holder = h("div");
  const draw = (): void => {
    const fw = p.frameworks.find((f) => f.id === state.fw) ?? p.frameworks[0]!;
    holder.replaceChildren(h("div", { class: "fw" }, ...fw.categories.map((c) => h("div", { class: `cat ${c.status}`, title: c.rules.length ? `Rules: ${c.rules.join(", ")}` : "No Fehm rule maps to this category" }, h("span", { class: "id" }, c.id), h("span", {}, c.name), c.status === "not-covered" ? tag("not covered", "muted dashed") : c.findings ? h("b", { style: "color:var(--deg);font-family:var(--mono)" }, String(c.findings)) : tag("no findings", "ok")))));
    for (const b of document.querySelectorAll<HTMLButtonElement>("[data-fw]")) b.setAttribute("aria-pressed", String(b.dataset.fw === state.fw));
  };
  queueMicrotask(draw);
  return section(
    "frameworks",
    "OWASP & CWE",
    "Which framework categories do the findings relate to?",
    h("div", { class: "disclaimer" }, h("b", {}, "Evidence toward categories, not compliance. "), "A category shows findings from the rules mapped to it, \"no findings\" when those rules found nothing, or \"not covered\" when no Fehm rule addresses it. Fehm never states that a project complies with OWASP, CWE, NIST or ISO."),
    h("span", { class: "chips tabs", role: "group", "aria-label": "Framework" }, ...p.frameworks.map((f) => h("button", { "data-fw": f.id, "aria-pressed": String(state.fw === f.id), onclick: () => ((state.fw = f.id), draw()) }, f.name))),
    holder,
  );
}

// ─── findings ───────────────────────────────────────────────────────

function findingsOf(p: SecurityPagePayload, pick: (f: SecurityFinding) => boolean, empty?: string): HTMLElement | null {
  const list = p.findings.filter((f) => pick(f) && isOpen(f));
  if (!list.length) return empty ? h("div", { class: "emptyline" }, empty) : null;
  return h("div", {}, h("h3", {}, `Findings (${list.length})`), h("div", { class: "flist" }, ...list.slice(0, 30).map(findingRow)), list.length > 30 ? h("p", { class: "more" }, `${list.length - 30} more in Findings`) : null);
}

function findingsSection(p: SecurityPagePayload): HTMLElement {
  const input = h("input", { type: "search", placeholder: "Search findings, files, CWE, OWASP…", "aria-label": "Search findings" }) as HTMLInputElement;
  input.value = state.q;
  input.addEventListener("input", () => {
    state.q = input.value;
    renderFindingList();
  });
  const sev = h("span", { class: "chips", role: "group", "aria-label": "Severity" }, ...(["all", ...SEVERITIES] as const).map((s) => h("button", { "data-sev": s, "aria-pressed": String(state.sev === s), onclick: () => ((state.sev = s), renderFindingList()) }, s === "all" ? "All" : s, s === "all" ? null : h("i", {}, String(p.summary.bySeverity[s])))));
  const domains = [...new Set(p.findings.map((f) => f.domain))].sort();
  const dom = h("select", { "aria-label": "Domain", onchange: (e: Event) => ((state.domain = (e.target as HTMLSelectElement).value), renderFindingList()) }, h("option", { value: "all" }, "All domains"), ...domains.map((d) => h("option", { value: d, ...(state.domain === d ? { selected: true } : {}) }, DOMAIN[d] ?? d)));
  const show = h("select", { "aria-label": "Review state", onchange: (e: Event) => ((state.show = (e.target as HTMLSelectElement).value as typeof state.show), renderFindingList()) }, h("option", { value: "open" }, "Open"), h("option", { value: "reviewed" }, "Suppressed / accepted"), h("option", { value: "all" }, "All"));
  const onlyNew = p.baseline ? h("label", { class: "note" }, h("input", { type: "checkbox", onchange: (e: Event) => ((state.onlyNew = (e.target as HTMLInputElement).checked), renderFindingList()) }), " new since baseline") : null;
  return section("findings", "Findings", "Every finding: what was detected, where, the evidence, what is missing, and how to verify a fix.", h("div", { class: "filters" }, input, sev, dom, show, onlyNew), h("div", { id: "flist", class: "flist" }));
}

function renderFindingList(): void {
  const p = state.p!;
  const q = state.q.trim().toLowerCase();
  const list = p.findings.filter((f) => (state.sev === "all" || f.severity === state.sev) && (state.domain === "all" || f.domain === state.domain) && (state.show === "all" || (state.show === "open" ? isOpen(f) : !isOpen(f))) && (!state.onlyNew || f.baseline === "new") && (!q || `${f.title} ${f.message} ${f.file ?? ""} ${f.ruleId} ${f.cwe ?? ""} ${(f.owasp ?? []).join(" ")} ${f.evidence.map((e) => `${e.path ?? ""} ${e.detail}`).join(" ")}`.toLowerCase().includes(q)));
  for (const b of document.querySelectorAll<HTMLButtonElement>("[data-sev]")) b.setAttribute("aria-pressed", String(b.dataset.sev === state.sev));
  const el = document.getElementById("flist");
  if (!el) return;
  el.replaceChildren(...(list.length ? list.slice(0, 300).map(findingRow) : [h("div", { class: "emptyline" }, "No findings match.")]), ...(list.length > 300 ? [h("p", { class: "more" }, `${list.length - 300} more; narrow the filters.`)] : []));
}

function findingRow(f: SecurityFinding): HTMLElement {
  const where = f.file ? `${f.file}${f.line ? `:${f.line}` : ""}` : f.evidence[0]?.path ? `${f.evidence[0].path}${f.evidence.length > 1 ? ` +${f.evidence.length - 1 + f.more}` : ""}` : "";
  const det = h("details", { class: `f ${f.severity}${isOpen(f) ? "" : " reviewed-out"}`, "data-id": f.id }, h("summary", {}, h("span", { class: `sv ${f.severity}` }, f.severity), h("span", { class: "tt" }, f.title), h("span", { class: "fm" }, f.baseline === "new" ? tag("new", "warn") : null, f.review ? tag(REVIEW_LABEL[f.review.status], "muted") : null, f.cwe ? tag(f.cwe, "muted") : null, h("span", { class: `cf ${f.confidence}`, title: "Confidence in the evidence" }, f.confidence)), where ? h("span", { class: "sub" }, `${DOMAIN[f.domain] ?? f.domain} · ${where}`) : null));
  det.addEventListener("toggle", () => {
    if (det.open && det.childElementCount === 1) det.append(findingBody(f));
  });
  return det;
}

function findingBody(f: SecurityFinding): HTMLElement {
  const evidence = f.trace
    ? traceView(f.trace)
    : h(
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
  const sink = f.trace?.steps.at(-1);
  const reviews = h("div", { class: "reviews" }, h("span", { class: "note" }, f.review ? `${REVIEW_LABEL[f.review.status]} ${ago(f.review.at)}${f.review.note ? `: ${f.review.note}` : ""}` : "Not reviewed."), ...(["reviewed", "false-positive", "accepted-risk", "suppressed"] as ReviewStatus[]).map((s) => h("button", { class: "act", disabled: !state.p!.writable || f.review?.status === s, onclick: () => void review(f, s) }, REVIEW_LABEL[s])), f.review ? h("button", { class: "act", disabled: !state.p!.writable, onclick: () => void review(f, "clear") }, "Clear") : null);
  return h(
    "div",
    { class: "fbody" },
    h("div", {}, h("h4", {}, "What was detected"), h("p", {}, f.message)),
    h("div", {}, h("h4", {}, f.trace ? "Flow" : "Evidence"), evidence, sink ? h("div", { class: "reviews", style: "margin-top:6px" }, h("a", { class: "act", href: graphHref(`file:${sink.path}`) }, "Show in graph"), h("a", { class: "act", href: editorHref(sink.path, sink.line) }, "Open sink in editor"), h("button", { class: "act", onclick: (ev: Event) => void toggleSource(ev.target as HTMLElement, (ev.target as HTMLElement).parentElement!, sink.path, sink.line) }, "Sink source")) : null),
    f.controlsDetected?.length || f.controlsMissing?.length ? h("div", {}, h("h4", {}, "Controls"), h("ul", { class: "checklist" }, ...(f.controlsDetected ?? []).map((c) => h("li", { class: "pass" }, `detected: ${c}`)), ...(f.controlsMissing ?? []).map((c) => h("li", { class: "fail" }, `not detected: ${c}`)))) : null,
    f.missing?.length ? h("div", {}, h("h4", {}, "Not established"), h("ul", { class: "plain" }, ...f.missing.map((m) => h("li", {}, m)))) : null,
    h("div", {}, h("h4", {}, "Why it matters"), h("p", {}, f.why)),
    h("div", {}, h("h4", {}, "Recommended action"), h("p", {}, f.action)),
    h("div", {}, h("h4", {}, "How to verify the fix"), h("ul", { class: "plain" }, ...f.verification.map((v) => h("li", {}, v)), ...(f.relatedTests?.length ? [h("li", {}, `Re-run the tests that exercise this file: ${f.relatedTests.join(", ")}`)] : []))),
    h("div", {}, h("h4", {}, "Rule"), h("p", { class: "mono" }, f.ruleId, f.cwe ? ` · ${f.cwe}` : "", f.owasp?.length ? ` · ${f.owasp.join(", ")}` : "", f.upstream ? h("span", { class: "note" }, ` · adapted from Skylos ${f.upstream}`) : null, h("span", { class: "note" }, ` · id ${f.id}`))),
    h("div", {}, h("h4", {}, "Review"), reviews),
  );
}

async function review(f: SecurityFinding, status: ReviewStatus | "clear"): Promise<void> {
  let note = "";
  if (status === "false-positive" || status === "accepted-risk" || status === "suppressed") note = prompt(`${REVIEW_LABEL[status]}: why? (optional, stored in the state directory)`) ?? "";
  try {
    await post(`/api/security/review?id=${encodeURIComponent(f.id)}&status=${status}${note ? `&note=${encodeURIComponent(note)}` : ""}`);
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
    const x = await json<SourceExcerpt>(`/api/security/source?path=${encodeURIComponent(path)}&line=${line}`);
    row.append(h("pre", { class: "code" }, ...x.lines.map((l, i) => h("span", { class: x.start + i === x.focus ? "f" : "" }, h("i", {}, String(x.start + i)), l))));
    btn.setAttribute("aria-expanded", "true");
  } catch (e) {
    toast(`No excerpt: ${(e as Error).message}`);
  }
}

// ─── trends and analysis ────────────────────────────────────────────

const TREND: Record<string, [string, "down" | "up"]> = { findings: ["Open findings", "down"], critical: ["Critical", "down"], high: ["High", "down"], dataFlows: ["Data flows to sinks", "down"], secrets: ["Secrets", "down"], unauthenticated: ["State-changing routes without auth", "down"], vulnerable: ["Vulnerable packages", "down"], llmGaps: ["LLM / agent findings", "down"], routes: ["Routes (attack surface)", "down"] };

function trendsSection(p: SecurityPagePayload): HTMLElement {
  const pts = p.trend;
  if (pts.length < 2) return section("trends", "Trends", "Is the security posture improving?", h("div", { class: "emptyline" }, "Trends build up as Fehm reviews new commits or working-tree states. Only one point so far."));
  const keys = Object.keys(TREND).filter((k) => pts.some((x) => x.metrics[k] !== undefined));
  const svgNS = "http://www.w3.org/2000/svg";
  return section(
    "trends",
    "Trends",
    "Is the security posture improving?",
    h(
      "div",
      { class: "spark" },
      ...keys.map((k) => {
        const series = pts.map((x) => x.metrics[k]).filter((v): v is number => v !== undefined);
        const max = Math.max(...series);
        const min = Math.min(...series);
        const X = (i: number): number => 4 + (i / Math.max(1, series.length - 1)) * 192;
        const Y = (v: number): number => 42 - (max === min ? 0.5 : (v - min) / (max - min)) * 38;
        const svg = document.createElementNS(svgNS, "svg");
        svg.setAttribute("viewBox", "0 0 200 46");
        svg.setAttribute("preserveAspectRatio", "none");
        const line = document.createElementNS(svgNS, "polyline");
        line.setAttribute("points", series.map((v, i) => `${X(i)},${Y(v)}`).join(" "));
        svg.append(line);
        const delta = series.at(-1)! - series[0]!;
        const good = delta === 0 ? "" : (delta < 0) === (TREND[k]![1] === "down") ? "s-healthy" : "s-degraded";
        return h("div", { class: "box" }, h("span", { class: "note" }, TREND[k]![0]), h("span", { class: "v" }, fmt.format(series.at(-1)!)), svg, h("span", { class: `d ${good}` }, delta === 0 ? `unchanged over ${series.length} reviews` : `${delta > 0 ? "+" : ""}${delta} since ${new Date(pts[0]!.at).toLocaleDateString()}`));
      }),
    ),
  );
}

function analysisSection(p: SecurityPagePayload): HTMLElement {
  const chip = (s: string): HTMLElement => tag(s === "ast" ? "syntax tree" : s === "heuristic" ? "heuristic" : "—", s === "ast" ? "ok" : s === "heuristic" ? "warn dashed" : "muted");
  const a = p.provenance;
  return section(
    "analysis",
    "Analysis",
    "What ran, how deeply each language was analysed, and what was not determined.",
    table(["Analyzer", "Status", "Findings", "Time", "Notes"], p.analyzers.map((r) => [td(r.name), td(tag(r.status, r.status === "complete" ? "ok" : r.status === "error" ? "bad" : r.status === "partial" ? "warn" : "muted dashed")), td(String(r.findings), "num"), td(`${r.durationMs} ms`, "num"), td(r.reason ?? "")])),
    p.languages.length ? h("h3", {}, "Coverage by language") : null,
    p.languages.length ? table(["Language", "Files", "Data flow", "Pattern rules"], p.languages.map((l) => [td(l.language), td(String(l.files), "num"), td(chip(l.taint)), td(chip(l.patterns))])) : null,
    h("h3", {}, "Provenance"),
    h("div", { class: "box" }, h("p", { class: "meta" }, `Fehm ${a.fehmVersion} · security rules v${a.securityVersion}${a.commit ? ` · commit ${a.commit.slice(0, 12)}${a.dirty ? " + working-tree changes" : ""}` : ""}`), h("p", { class: "mono", style: "word-break:break-all;margin:4px 0" }, `SHA-256 ${a.digest}`), h("p", { class: "note" }, `Rules: ${a.rulesDerivedFrom}.`), h("ul", { class: "plain" }, ...a.inputs.map((i) => h("li", {}, i)), ...a.excluded.map((i) => h("li", { class: "note" }, `excluded: ${i}`)))),
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
  state.domain = "all";
  state.show = "all";
  state.q = "";
  renderFindingList();
  const el = [...document.querySelectorAll<HTMLDetailsElement>("#flist details.f")].find((d) => d.dataset.id === id);
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

$("refresh").addEventListener("click", () => void load(`/api/security/refresh${state.scope === "changed" ? "?scope=changed" : ""}`, { method: "POST" }));
$("scope-all").addEventListener("click", () => setScope("all"));
$("scope-changed").addEventListener("click", () => setScope("changed"));
window.addEventListener("hashchange", openFromHash);
void load();
