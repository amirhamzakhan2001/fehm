import type {
  Block,
  BriefingAskResponse,
  BriefingFlowResponse,
  BriefingFreshness,
  BriefingItem,
  BriefingSection,
  Claim,
  CodebaseBriefing,
  FlowStepView,
  FlowTreeNode,
} from "../../../codebase-briefing/types.js";
import type { GraphNodeDetail } from "../../graph/model.js";
import { REPORT_STAGES, REPORT_TITLES } from "./report.js";
import { historySection } from "./report-history.js";
import { technologyStack } from "./technology.js";
import { architectureWorkspace } from "./workspace.js";
import { basisLabel, itemsIn, meetingQuestions, readingOrder, QUALITY_TOPICS } from "./onboarding.js";
import { $, h } from "../../graph/ui/dom.js";

/**
 * Feature 3.2 page. Renders the briefing JSON; every claim can open its
 * evidence, every entity links to the 3.1 graph, and entry points expand
 * their call flow on demand through the Feature 1 engine.
 */

let briefing: CodebaseBriefing | null = null;
let workspace: ReturnType<typeof architectureWorkspace> | undefined;
let flowWorkspace: ReturnType<typeof architectureWorkspace> | undefined;
let reportObserver: IntersectionObserver | undefined;
let flowObserver: IntersectionObserver | undefined;
let claims = new Map<string, Claim>();
const LIST_CAP = 6;

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init);
  if (!res.ok) {
    let detail = "";
    try {
      detail = ((await res.json()) as { error?: string }).error ?? "";
    } catch {
      // non-JSON body
    }
    throw new Error(`${path} → HTTP ${res.status}${detail ? `: ${detail}` : ""}`);
  }
  return (await res.json()) as T;
}

function status(state: "ready" | "busy" | "stale" | "error", text: string): void {
  const el = $("status");
  el.dataset.state = state;
  el.lastElementChild!.textContent = text;
}

// ─── per-viewer conveniences (never required for correctness) ───

function storeKey(): string {
  return `fehm.explain.${briefing?.repository.root ?? ""}`;
}
function loadOpen(): Record<string, boolean> {
  try {
    return JSON.parse(sessionStorage.getItem(storeKey()) ?? "{}") as Record<string, boolean>;
  } catch {
    return {};
  }
}
function saveOpen(id: string, open: boolean): void {
  try {
    const cur = loadOpen();
    cur[id] = open;
    sessionStorage.setItem(storeKey(), JSON.stringify(cur));
  } catch {
    // storage unavailable
  }
}

// ─── helpers ─────────────────────────────────────────────────────

const pct = (v: number): string => `${Math.round(v * 100)}%`;

function ago(iso: string): string {
  const s = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
  return s < 60 ? "just now" : s < 3600 ? `${Math.round(s / 60)}m ago` : `${Math.round(s / 3600)}h ago`;
}

function sourceHref(path: string, line?: number): string | undefined {
  if (!briefing || path === "." || !path) return undefined;
  const abs = `${briefing.repository.root.replace(/\\/g, "/")}/${path}`;
  return `vscode://file/${abs.startsWith("/") ? abs.slice(1) : abs}${line ? `:${line}` : ""}`;
}

function graphHref(nodeId: string): string {
  return `/graph#node=${encodeURIComponent(nodeId)}`;
}

/** Render only inline code; repository text is never interpreted as HTML. */
function prose(text: string): (string | HTMLElement)[] {
  return text.split(/(`[^`\n]+`)/g).map((part) => part.startsWith("`") && part.endsWith("`") ? h("code", {}, part.slice(1, -1)) : part);
}

function disclosure(label: string, ...children: HTMLElement[]): HTMLDetailsElement {
  return h("details", { class: "supporting" }, h("summary", {}, label), ...children);
}

/** Toggle an inline panel after `anchor`; one panel per anchor/kind. */
function toggle(anchor: HTMLElement, button: HTMLButtonElement, kind: string, build: () => HTMLElement | Promise<HTMLElement>): void {
  const host = anchor.closest("li, .risk, .rrow, dd, .flowbox, p.lead") ?? anchor;
  const existing = host.querySelector<HTMLElement>(`:scope > .panel[data-kind="${kind}"]`) ?? (host.nextElementSibling?.matches?.(`.panel[data-kind="${kind}"]`) ? (host.nextElementSibling as HTMLElement) : null);
  if (existing) {
    existing.remove();
    button.setAttribute("aria-expanded", "false");
    return;
  }
  button.setAttribute("aria-expanded", "true");
  const placeholder = h("div", { class: "panel", "data-kind": kind }, "Loading…");
  if (host.tagName === "DD") host.after(placeholder);
  else if (host.tagName === "LI" || host.classList.contains("rrow") || host.classList.contains("risk") || host.classList.contains("flowbox")) host.append(placeholder);
  else host.after(placeholder);
  Promise.resolve(build())
    .then((el) => {
      el.classList.add("panel");
      el.dataset.kind = kind;
      placeholder.replaceWith(el);
    })
    .catch((e: Error) => (placeholder.textContent = e.message));
  if (host.tagName === "DD") placeholder.style.gridColumn = "1 / -1";
}

// ─── evidence / explain / flow panels ────────────────────────────

function evidencePanel(claim: Claim): HTMLElement {
  const rows = claim.evidence.map((e) => {
    const href = sourceHref(e.path, e.line);
    const where = `${e.path}${e.line ? `:${e.line}` : ""}`;
    return h(
      "tr",
      {},
      h("td", { class: "p" }, href ? h("a", { href, title: "Open source" }, where) : where, e.stale ? h("span", { class: "stale-tag" }, "  changed since index") : null),
      h("td", {}, [e.source, e.provenance].filter(Boolean).join(" · ") + (e.detail ? ` — ${e.detail}` : "")),
      h("td", {}, e.nodeId ? h("a", { href: graphHref(e.nodeId) }, "graph") : ""),
    );
  });
  return h(
    "div",
    {},
    h("p", { class: "ctext" }, ...prose(claim.text)),
    h("div", { class: "row" }, h("span", { class: `state ${claim.state}` }, basisLabel(claim)), `basis: ${claim.basis}`, `· confidence ${pct(claim.confidence)}`, claim.evidence.some((e) => e.stale) ? h("span", { class: "stale-tag" }, "· includes stale evidence") : null),
    rows.length ? h("table", {}, h("tbody", {}, ...rows)) : h("div", { class: "muted" }, "No direct source reference is available. Check the stated basis and limitations."),
    claim.note ? h("p", { class: "note" }, claim.note) : null,
  );
}

async function explainPanel(nodeId: string): Promise<HTMLElement> {
  const d = await json<GraphNodeDetail>(`/api/graph/node?id=${encodeURIComponent(nodeId)}`);
  const count = (rel: string, dir: "in" | "out"): GraphNodeDetail["related"] => d.related.filter((r) => r.relation === rel && r.direction === dir);
  const groups: [string, GraphNodeDetail["related"]][] = [
    ["Uses", [...count("calls", "out"), ...count("imports", "out"), ...count("uses", "out")]],
    ["Used by", [...count("calls", "in"), ...count("imports", "in"), ...count("references", "in"), ...count("uses", "in")]],
  ];
  const tests = d.related.filter((r) => r.direction === "in" && /(^|\/)(test|tests|__tests__)\/|\.(test|spec)\./.test(r.path ?? ""));
  const href = d.path ? sourceHref(d.path, d.line) : undefined;
  return h(
    "div",
    {},
    h("div", { class: "row" }, h("b", {}, d.name), `${d.kind} · ${d.provenance}`, href ? h("a", { href }, "open source") : null, h("a", { href: graphHref(d.id) }, "explore in graph")),
    h("p", { class: "ctext" }, d.semanticSummary?.text ?? d.summary),
    d.signature ? h("pre", { class: "diagram" }, d.signature) : null,
    ...groups.filter(([, list]) => list.length).map(([title, list]) => h("div", { class: "row" }, h("b", {}, `${title} (${list.length}):`), list.slice(0, 8).map((r) => r.name).join(", ") + (list.length > 8 ? " …" : ""))),
    tests.length ? h("div", { class: "row" }, h("b", {}, "Related tests:"), [...new Set(tests.map((t) => t.path))].join(", ")) : null,
    d.unresolved.length ? h("div", { class: "row" }, h("b", {}, "Unresolved:"), d.unresolved.slice(0, 4).map((u) => u.text).join(", ")) : null,
  );
}

async function flowPanel(nodeId: string): Promise<HTMLElement> {
  const r = await json<BriefingFlowResponse>(`/api/briefing/flow?id=${encodeURIComponent(nodeId)}&depth=3`);
  if (!r.root) return h("div", { class: "muted" }, r.error ?? "No flow.");
  const render = (n: FlowTreeNode): HTMLElement =>
    h(
      "li",
      {},
      h("a", { class: "nm", href: graphHref(n.id) }, n.name),
      n.path ? h("span", { class: "p" }, n.path) : null,
      n.provenance === "heuristic" ? h("span", { class: "p" }, "heuristic") : null,
      n.repeated ? h("span", { class: "rep" }, " ↺") : null,
      n.children.length ? h("ul", { class: "tree" }, ...n.children.map(render)) : null,
    );
  return h("div", {}, h("div", { class: "row" }, "Static call tree (depth 3) from Context Engine — dynamic dispatch is not shown."), h("ul", { class: "tree" }, render(r.root)));
}

function actions(opts: { claim?: string | undefined; nodeId?: string | undefined; flowFrom?: string | undefined; path?: string | undefined; line?: number | undefined }, anchor: () => HTMLElement): HTMLElement | null {
  const btns: HTMLElement[] = [];
  const claim = opts.claim ? claims.get(opts.claim) : undefined;
  if (claim) {
    const b = h("button", { class: "act", type: "button", "aria-expanded": "false", title: `${basisLabel(claim)} · ${claim.evidence.length} source references` }, claim.evidence[0] ? `${claim.evidence[0].path.split("/").pop()}${claim.evidence[0].line ? `:${claim.evidence[0].line}` : ""}${claim.evidence.some((e) => e.stale) ? " ⚠" : ""}` : basisLabel(claim)) as HTMLButtonElement;
    b.addEventListener("click", () => toggle(anchor(), b, "evidence", () => evidencePanel(claim)));
    btns.push(b);
  }
  if (opts.flowFrom) {
    const b = h("button", { class: "act", type: "button", "aria-expanded": "false", title: "Expand the call flow" }, "flow") as HTMLButtonElement;
    const id = opts.flowFrom;
    b.addEventListener("click", () => toggle(anchor(), b, "flow", () => flowPanel(id)));
    btns.push(b);
  }
  if (opts.nodeId && !opts.nodeId.startsWith("directory:")) {
    const b = h("button", { class: "act", type: "button", "aria-expanded": "false", title: "What it does, who uses it, what it uses" }, "explain") as HTMLButtonElement;
    const id = opts.nodeId;
    b.addEventListener("click", () => toggle(anchor(), b, "explain", () => explainPanel(id)));
    btns.push(b);
  }
  if (opts.path) {
    const href = sourceHref(opts.path, opts.line);
    if (href) btns.push(h("a", { class: "act", href, title: opts.path }, "source"));
  }
  if (opts.nodeId) btns.push(h("a", { class: "act", href: graphHref(opts.nodeId), title: "Explore in graph" }, "graph"));
  return btns.length ? h("span", { class: "acts" }, ...btns) : null;
}

// ─── blocks ──────────────────────────────────────────────────────

function itemEl(i: BriefingItem): HTMLElement {
  const li = h("li", {});
  const isPath = /[/.]/.test(i.title) && !/\s/.test(i.title);
  const badge = i.badge ? h("span", { class: `pill ${i.badge.toLowerCase()}` }, i.badge) : null;
  li.append(
    h("div", { class: "main" }, h("div", { class: `title${isPath ? " path" : ""}` }, ...prose(i.title)), i.detail ? h("div", { class: "detail" }, ...prose(i.detail)) : null),
    ...(badge ? [badge] : []),
    ...[actions(i, () => li)].filter((x): x is HTMLElement => Boolean(x)),
  );
  return li;
}

function cappedList(items: BriefingItem[], ordered = false): HTMLElement {
  const list = h(ordered ? "ol" : "ul", { class: "items" });
  const first = items.slice(0, LIST_CAP);
  list.append(...first.map(itemEl));
  if (items.length > LIST_CAP) {
    const more = h("button", { class: "more", type: "button" }, `Show next ${Math.min(LIST_CAP, items.length - LIST_CAP)} of ${items.length - LIST_CAP} remaining`);
    more.addEventListener("click", () => {
      const shown = list.children.length;
      list.append(...items.slice(shown, shown + LIST_CAP).map(itemEl));
      const remaining = items.length - list.children.length;
      if (!remaining) more.remove();
      else more.textContent = `Show next ${Math.min(LIST_CAP, remaining)} of ${remaining} remaining`;
    });
    return h("div", {}, list, more);
  }
  return list;
}

function flowSteps(steps: FlowStepView[]): HTMLElement {
  const box = h("div", { class: "flow" });
  steps.forEach((s, i) => {
    if (i) box.append(h("span", { class: "arrow", "aria-hidden": "true" }, "→"));
    const cls = `step${i === 0 && s.layer === "entry" ? " entry" : ""}${s.layer === "data" ? " data" : ""}${s.provenance === "heuristic" ? " heuristic" : ""}`;
    const inner = [h("span", { class: "nm", title: s.path ? `${s.path}${s.line ? `:${s.line}` : ""}` : s.name }, s.name), s.layer && s.layer !== "entry" ? h("span", { class: "ly" }, s.layer) : null];
    box.append(s.nodeId ? h("a", { class: cls, href: graphHref(s.nodeId) }, ...inner) : h("span", { class: cls }, ...inner));
  });
  return box;
}

function blockEl(b: Block): HTMLElement | null {
  switch (b.type) {
    case "text": {
      const p = h("p", { class: "lead" }, ...prose(b.text));
      const a = actions({ claim: b.claim }, () => p);
      if (a) p.append(" ", a);
      return p;
    }
    case "facts": {
      const dl = h("dl", { class: "facts" });
      for (const r of b.rows) {
        const dd = h("dd", {}, h("span", {}, ...prose(r.value)));
        const a = actions({ claim: r.claim }, () => dd);
        if (a) dd.append(a);
        dl.append(h("dt", {}, r.label), dd);
      }
      return dl;
    }
    case "list":
      return h("div", {}, b.title ? h("h4", {}, b.title) : null, b.items.length ? cappedList(b.items, b.ordered) : h("div", { class: "muted" }, b.empty ?? "None."));
    case "groups": {
      if (!b.groups.length) return h("div", { class: "muted" }, b.empty ?? "None.");
      return h("div", {}, b.title ? h("h4", {}, b.title) : null, ...b.groups.map((g) => h("div", { class: "group" }, h("h4", {}, g.title, g.note ? h("span", { class: "note" }, g.note) : null), cappedList(g.items))));
    }
    case "flow": {
      const box = h("div", { class: "flowbox" });
      const title = h("h5", {}, h("span", {}, b.title));
      const a = actions({ claim: b.claim }, () => box);
      if (a) title.append(a);
      box.append(title, h("p", { class: "flow-note" }, "This sequence follows static relationships in the index; it does not establish runtime order. Dotted steps are inferred."), flowSteps(b.steps));
      const steps = b.steps.map((step, index) => h("li", {}, h("div", { class: "main" }, h("code", {}, step.name), h("p", { class: "detail" }, `${index === 0 ? "The indexed path starts here" : "The next recorded relationship leads here"}${step.layer ? ` (${step.layer})` : ""}.`, step.path ? h("code", {}, ` ${step.path}${step.line ? `:${step.line}` : ""}`) : null))));
      box.append(disclosure("Trace step by step", h("ol", { class: "items" }, ...steps)));
      return box;
    }
    case "diagram": {
      const wrap = h("div", {}, b.title ? h("h4", {}, b.title) : null, h("pre", { class: "diagram" }, b.lines.join("\n")));
      const a = actions({ claim: b.claim }, () => wrap);
      if (a && b.title) wrap.firstElementChild!.append(a);
      return wrap;
    }
    case "ranking": {
      const max = Math.max(0.001, ...b.rows.map((r) => r.score));
      return h(
        "div",
        {},
        b.title ? h("h4", {}, b.title) : null,
        h(
          "div",
          { class: "rank" },
          ...b.rows.map((r, n) => {
            const row = h("div", { class: "rrow" });
            const bar = h("span", { class: "bar", title: `score ${r.score}` }, h("i", { style: `width:${Math.round((r.score / max) * 100)}%` }));
            row.append(
              h("span", { class: "no" }, String(n + 1)),
              h("span", { class: "nm" }, r.name),
              h("span", { style: "display:flex;gap:8px;align-items:center" }, bar, actions({ claim: r.claim, nodeId: r.nodeId, path: r.path }, () => row) ?? ""),
              h("ul", {}, ...r.why.map((w) => h("li", {}, w))),
              h("div", { class: "ms" }, ...Object.entries(r.metrics).map(([k, v]) => h("span", { class: "pill" }, `${k} ${v}`))),
            );
            return row;
          }),
        ),
      );
    }
    case "risks": {
      if (!b.items.length) return h("div", { class: "muted" }, b.empty ?? "None.");
      return h(
        "div",
        {},
        ...b.items.map((r) => {
          const row = h("div", { class: `risk ${r.severity}` });
          row.append(h("span", { class: "sev" }, r.severity), h("span", {}, r.title), actions({ claim: r.claim }, () => row) ?? h("span", {}), h("span", { class: "why" }, r.why));
          return row;
        }),
      );
    }
  }
}

// ─── page ────────────────────────────────────────────────────────

function sectionEl(s: BriefingSection, open: Record<string, boolean>): HTMLElement {
  const section = h("section", { class: `sec${s.id === "overview" ? " executive" : ""}`, id: `sec-${s.id}` });
  section.append(h("header", { class: "section-heading" },
    h("div", {}, h("div", { class: "q" }, s.question), h("h2", {}, REPORT_TITLES[s.id] ?? s.title)),
    h("span", { class: `state ${s.stale ? "stale" : s.state}`, title: `Section confidence: ${pct(s.confidence)}. Individual statements may have different evidence.` }, s.stale ? "Stale evidence" : s.state === "likely" ? "Inferred" : s.state === "confirmed" ? "Evidence available" : "Limited evidence")));
  const body = h("div", { class: "body" });
  const firstText = s.blocks.find((b) => b.type === "text");
  if (s.id !== "features" && (!firstText || firstText.text !== s.summary)) body.append(h("p", { class: "lead" }, ...prose(s.summary === "—" ? "There is not enough indexed evidence to explain this area yet." : s.summary)));
  for (const block of s.blocks) {
    if (block.type === "text") body.append(blockEl(block)!);
  }
  // Reuse existing claim language and provenance instead of inventing a second analysis.
  const narrativeClaims = s.id === "features" ? [] : s.id === "overview"
    ? s.blocks.flatMap((b) => b.type === "list" && b.title === "Primary users / consumers" ? b.items.flatMap((i) => i.claim ? [claims.get(i.claim)] : []) : []).filter((c): c is Claim => Boolean(c)).slice(0, 3)
    : !firstText ? s.claims.filter((c) => c.text.length > 45 && c.state !== "unknown").slice(0, 2) : [];
  for (const claim of narrativeClaims) {
    const paragraph = h("p", { class: "lead" }, claim.basis === "inferred" ? "Inferred from the index: " : claim.basis === "declared" ? "The project declares: " : "", ...prose(claim.text));
    const action = actions({ claim: claim.id }, () => paragraph);
    if (action) paragraph.append(" ", action);
    body.append(paragraph);
  }
  if (s.id === "overview") {
    const facts = s.blocks.find((block) => block.type === "facts");
    const languages = facts?.rows.find((row) => row.label === "Languages");
    if (languages && languages.value !== "none detected") {
      const paragraph = h("p", { class: "lead" }, `The indexed languages are ${languages.value}. Counts include source and test files.`);
      paragraph.append(actions({ claim: languages.claim }, () => paragraph) ?? "");
      body.append(paragraph);
    }
    const architecture = briefing?.sections.find((section) => section.id === "architecture");
    if (architecture) body.append(h("p", { class: "lead" }, "The structural analysis suggests: ", ...prose(architecture.summary), ". ", h("a", { href: "#sec-architecture" }, "Explore the architecture and its evidence →")));
  }
  if (s.id === "features") {
    body.append(h('p', { class: 'lead' }, 'These capabilities are inferred from implementation and code comments. They describe what appears to be built; documented user journeys and business rules still need confirmation.'));
    const capabilities = s.blocks.flatMap(block => block.type === 'list' ? block.items : []).slice(0, 4);
    body.append(h('ul', { class: 'capability-summary' }, ...capabilities.map(item => {
      const row = h('li', {}, h('strong', {}, item.title), ' — ', ...prose(item.detail?.split(' · ')[0] ?? 'Responsibility is not documented.'));
      row.append(actions({ claim: item.claim }, () => row) ?? ''); return row;
    })));
  }
  const supporting = h("div", { class: "supporting-body" });
  for (const b of s.blocks) {
    if (s.id === "api" && b.type === "groups") continue;
    const el = blockEl(b);
    if (!el) continue;
    if (b.type === "text") continue;
    else if (b.type === "diagram") supporting.append(disclosure(b.title === "Repository layout" ? "Browse repository layout" : "Text dependency reference", el));
    else supporting.append(el);
  }
  if (s.id === "api" && briefing) body.append(apiReference(briefing));
  // Keep the briefing readable; preserve every existing block behind an accessible disclosure.
  if (supporting.childElementCount) {
    const details = disclosure(s.id === "overview" ? "Project facts, users & capabilities" : "Explore details & source evidence", supporting);
    details.open = open[s.id] ?? false;
    details.addEventListener("toggle", () => saveOpen(s.id, details.open));
    body.append(details);
  }
  if (s.unknowns.length) body.append(disclosure(`What remains unknown (${s.unknowns.length})`, h("ul", { class: "unknowns" }, ...s.unknowns.map((u) => h("li", {}, ...prose(u))))));
  const related: Record<string, { label: string; href: string }[]> = {
    risks: [{ label: "Architecture drift", href: "/drift" }, { label: "Project health", href: "/health" }],
    security: [{ label: "Security review", href: "/security" }],
    engineerMustKnow: [{ label: "Git memory & logs", href: "/git-memory" }, { label: "Prompt intelligence", href: "/prompts" }],
    testing: [{ label: "Project health", href: "/health" }],
  };
  const links = [...(s.links ?? []), ...(related[s.id] ?? [])];
  if (links.length) body.append(h("div", { class: "links" }, ...links.map((l) => h("a", { href: l.href }, `${l.label} →`))));
  section.append(body);
  return section;
}

function hero(b: CodebaseBriefing): HTMLElement {
  const meta = disclosure("Analysis details", h("p", {}, `${b.metrics.files} files · ${b.metrics.symbols} symbols · ${b.metrics.relationships} relationships. ${pct(b.metrics.confirmedShare)} of claims are supported by source or declarations; ${b.metrics.unknowns} unknowns. Static analysis, not runtime verification.`));
  const header = h("header", { id: "hero", class: "compact-hero" }, h("div", {}, h("div", { class: "eyebrow" }, "Explain Codebase"), h("h1", {}, b.headline.name)),
    h("div", { class: "analysis-time" }, h("time", { datetime: b.generatedAt, title: new Date(b.generatedAt).toLocaleString() }, `Analyzed ${ago(b.generatedAt)}`), ` · ${b.freshness.fresh ? "Current index" : "Stale evidence"} · ${pct(b.metrics.confirmedShare)} source / declaration coverage`), meta);
  if (!b.freshness.fresh) header.append(staleBanner(b.freshness));
  return header;
}

function staleBanner(f: BriefingFreshness): HTMLElement {
  const files = [...f.changed.modified.map((p) => `~ ${p}`), ...f.changed.added.map((p) => `+ ${p}`), ...f.changed.deleted.map((p) => `− ${p}`)];
  const btn = h("button", { type: "button" }, "Refresh briefing");
  btn.addEventListener("click", () => void refresh());
  return h(
    "div",
    { id: "stale", role: "alert" },
    h("span", {}, h("b", {}, "⚠ Briefing contains stale evidence. "), `${files.length} file${files.length === 1 ? "" : "s"} changed since indexing; affected sections: ${f.affectedSections.map((id) => briefing?.sections.find((s) => s.id === id)?.title ?? id).join(", ") || "none"}.`),
    btn,
    h("span", { class: "files" }, files.slice(0, 8).join("   ") + (files.length > 8 ? `   … ${files.length - 8} more` : "")),
  );
}

function askCard(): HTMLElement {
  const input = h("input", { type: "search", id: "ask-q", placeholder: "Ask about this codebase — e.g. where does data enter the system?", "aria-label": "Ask about this codebase", autocomplete: "off" }) as HTMLInputElement;
  const answers = h("div", { id: "answers" });
  const form = h("form", {}, input, h("button", { type: "submit" }, "Ask"));
  let ctrl: AbortController | undefined;
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const q = input.value.trim();
    if (!q) return;
    ctrl?.abort();
    ctrl = new AbortController();
    answers.replaceChildren(h("div", { class: "muted" }, "Searching the index…"));
    json<BriefingAskResponse>(`/api/briefing/ask?q=${encodeURIComponent(q)}`, { signal: ctrl.signal })
      .then((r) => {
        if (!r.hits.length) return answers.replaceChildren(h("div", { class: "muted" }, "No matching code in the index."));
        answers.replaceChildren(
          ...r.hits.map((hit) => {
            const box = h("div", { class: "answer" });
            box.append(h("div", { class: "t" }, h("span", { class: "k" }, hit.kind), h("b", {}, hit.name), hit.path ? h("span", { class: "mono muted" }, `${hit.path}${hit.line ? `:${hit.line}` : ""}`) : null, actions({ nodeId: hit.nodeId, flowFrom: hit.kind === "function" || hit.kind === "method" ? hit.nodeId : undefined }, () => box) ?? ""), h("p", {}, hit.summary));
            return box;
          }),
        );
      })
      .catch((err: Error) => {
        if (err.name !== "AbortError") answers.replaceChildren(h("div", { class: "muted" }, err.message));
      });
  });
  return h("section", { class: "card", id: "ask" }, form, h("p", { class: "hint" }, "Search indexed code and inspect its evidence. Press / to focus."), answers);
}

function requirements(b: CodebaseBriefing): HTMLElement {
  const functional = itemsIn(b, "features");
  const section = h("section", { class: "sec" }, h("h2", {}, "Requirements & product behavior"), h("p", { class: "lead" }, "Capabilities found in source are evidence of implementation, not automatically agreed product requirements. Confirm architectural intent and acceptance criteria with the linked documentation and tests."), h("h3", {}, "Functional behavior"));
  section.append(functional.length ? cappedList(functional) : h("p", {}, "No functional capabilities could be identified. Product requirements and user roles need documentation."));
  section.append(h("h3", {}, "Non-functional requirements"), h("p", {}, "These are implementation signals and gaps, not performance guarantees or service-level objectives."));
  for (const topic of QUALITY_TOPICS) {
    const candidates = b.sections.find((s) => s.id === topic.section)?.claims.filter((c) => c.state !== "unknown" && topic.match.test(c.text)).slice(0, 2) ?? [];
    const area = h("div", { class: "requirement-topic" }, h("h4", {}, topic.name));
    for (const claim of candidates) {
      const paragraph = h("p", {}, h("span", { class: "basis-label" }, `${basisLabel(claim)} · `), ...prose(claim.text));
      paragraph.append(actions({ claim: claim.id }, () => paragraph) ?? ""); area.append(paragraph);
    }
    area.append(h("p", { class: "muted" }, candidates.length ? topic.limitation : `Undocumented in the available analysis. ${topic.limitation}`), h("a", { href: `#sec-${topic.section}` }, "Inspect supporting analysis →")); section.append(area);
  }
  return section;
}

function apiReference(b: CodebaseBriefing): HTMLElement {
  const endpoints = itemsIn(b, "api");
  const input = h("input", { type: "search", "aria-label": "Search endpoints", placeholder: "Search path, handler, source or resource…" });
  const method = h("select", { "aria-label": "HTTP method" }, h("option", { value: "" }, "All methods"), ...[...new Set(endpoints.map((e) => e.title.split(" ")[0]!))].sort().map((m) => h("option", { value: m }, m)));
  const results = h("div", { class: "endpoint-results" });
  const detail = h("div", { class: "endpoint-detail", "aria-live": "polite" });
  const count = h("p", { role: "status", class: "muted" });
  let limit = 20;
  let selection = 0;
  const choose = async (item: BriefingItem): Promise<void> => {
    const token = ++selection;
    const content = h("div", {}, h("h3", {}, item.title), h("p", {}, item.detail ?? "Handler not resolved."), h("p", { class: "muted" }, "Pattern-extracted route registration; reachability has not been executed. Request and response schemas, status codes, per-route authentication enforcement and error contracts are not extracted."));
    content.append(actions(item, () => content) ?? "");
    const sequence = h("button", { type: "button", onclick: () => { ensureFlow().open("runtime", `http:${item.title}`); jumpTo("operation-map"); } }, "Inspect request lifecycle");
    content.append(sequence); detail.replaceChildren(content);
    if (item.nodeId) {
      try {
        const explanation = await explainPanel(item.nodeId);
        if (token === selection) content.append(explanation);
      } catch (error) { if (token === selection) content.append(h("p", {}, (error as Error).message)); }
    }
  };
  const update = (): void => {
    const query = input.value.trim().toLowerCase();
    const found = endpoints.filter((e) => (!method.value || e.title.startsWith(`${method.value} `)) && `${e.title} ${e.detail ?? ""} ${e.path ?? ""}`.toLowerCase().includes(query));
    count.textContent = `${found.length} matching routes. Showing ${Math.min(limit, found.length)}.`;
    const table = h("table", { class: "endpoint-table" }, h("thead", {}, h("tr", {}, h("th", {}, "Method / path"), h("th", {}, "Handler / registration source"))), h("tbody", {}, ...found.slice(0, limit).map((item) => h("tr", {}, h("td", {}, h("button", { type: "button", onclick: () => void choose(item) }, item.title)), h("td", {}, ...prose(item.detail ?? "Not resolved"))))));
    results.replaceChildren(found.length ? table : h("p", {}, "No matching indexed endpoints."));
    if (found.length > limit) results.append(h("button", { type: "button", onclick: () => { limit += 20; update(); } }, "Show next 20 endpoints"));
  };
  input.addEventListener("input", () => { limit = 20; update(); }); method.addEventListener("change", () => { limit = 20; update(); }); update();
  return h("div", { class: "api-reference" }, h("h3", {}, "Endpoint reference"), h("div", { class: "reference-controls" }, input, method), count, results, detail);
}

function ensureFlow(): ReturnType<typeof architectureWorkspace> {
  if (!flowWorkspace) {
    flowWorkspace = architectureWorkspace("runtime");
    document.getElementById("operation-map")?.replaceChildren(flowWorkspace.element);
  }
  return flowWorkspace;
}

function jumpTo(id: string, updateHash = true): void {
  const target = document.getElementById(id);
  if (!target) return;
  for (let parent = target.parentElement; parent; parent = parent.parentElement) if (parent instanceof HTMLDetailsElement) parent.open = true;
  const stage = target.closest<HTMLElement>('[data-stage]');
  if (stage) document.querySelectorAll<HTMLElement>('[data-stage-link]').forEach(link => { if (link.dataset.stageLink === stage.dataset.stage) link.setAttribute('aria-current', 'location'); else link.removeAttribute('aria-current'); });
  if (updateHash && location.hash !== `#${id}`) history.pushState(null, "", `#${id}`);
  target.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'start' });
  target.setAttribute('tabindex', '-1'); target.focus({ preventScroll: true });
}

function followHash(): void {
  let id: string;
  try { id = decodeURIComponent(location.hash.slice(1)); } catch { return; }
  // Preserve links saved before the continuous report replaced switching panels.
  const legacy: Record<string, string> = { overview: 'stage-understand', requirements: 'sec-features', architecture: 'sec-architecture', runtime: 'stage-trace', apis: 'sec-api', data: 'sec-database', quality: 'sec-testing', assessment: 'sec-risks', meeting: 'sec-cheatSheet', evidence: 'unknown-all' };
  if (id.startsWith('report-')) id = legacy[id.slice(7)] ?? id;
  if (id) jumpTo(id, false);
}
window.addEventListener("hashchange", followHash);
window.addEventListener("popstate", followHash);

function toc(b: CodebaseBriefing): HTMLElement {
  const topics = h('select', { 'aria-label': 'Jump to report topic' }, h('option', { value: '' }, 'Jump to topic…'),
    ...REPORT_STAGES.map(stage => h('optgroup', { label: stage.title }, ...stage.sections.filter(id => b.sections.some(section => section.id === id)).map(id => h('option', { value: `sec-${id}` }, REPORT_TITLES[id] ?? id)))),
    h('option', { value: 'report-history' }, 'Git history & evolution'), h('option', { value: 'report-decisions' }, 'Design decisions & constraints'), h('option', { value: 'unknown-all' }, 'Unresolved questions'));
  topics.addEventListener('change', () => { if (topics.value) jumpTo(topics.value); topics.value = ''; });
  return h('div', { class: 'report-navigation' }, h('div', { class: 'stage-links' }, ...REPORT_STAGES.map((stage, i) => h('a', { href: `#stage-${stage.id}`, 'data-stage-link': stage.id, onclick: event => { event.preventDefault(); jumpTo(`stage-${stage.id}`); } }, h('span', { 'aria-hidden': 'true' }, `0${i + 1}`), stage.title))), topics);
}

function projectIntroduction(b: CodebaseBriefing): HTMLElement {
  const overview = b.sections.find(section => section.id === 'overview');
  const purpose = overview?.blocks.find(block => block.type === 'text');
  const users = overview?.blocks.find(block => block.type === 'list' && block.title === 'Primary users / consumers');
  return h('section', { id: 'sec-overview', class: 'project-introduction' }, h('div', { class: 'eyebrow' }, 'Project introduction'), h('h1', {}, b.headline.name),
    purpose ? blockEl(purpose) : h('p', { class: 'lead' }, 'The indexed repository does not document the project’s purpose yet.'),
    users?.type === 'list' && users.items.length ? h('p', { class: 'lead' }, 'The repository exposes interfaces for ', users.items.map(item => item.title.toLowerCase()).join(', '), '. These are detected consumers, not a verified description of customer roles.') : null,
    h('p', { class: 'muted' }, b.archetype.primary ? `Project type inferred from repository signals: ${b.archetype.primary}.` : 'Project type is not established.'),
    overview ? disclosure('Project facts, capabilities & evidence', h('div', {}, ...overview.blocks.filter(block => block !== purpose).map(block => blockEl(block)))) : null);
}

function render(b: CodebaseBriefing): void {
  briefing = b;
  claims = new Map(b.sections.flatMap(s => s.claims.map(c => [c.id, c] as const)));
  document.title = `Explain · ${b.headline.name} · fehm`;
  $("project").textContent = b.repository.name; $("project").title = b.repository.root;
  const open = loadOpen();
  workspace?.destroy(); flowWorkspace?.destroy(); flowWorkspace = undefined;
  reportObserver?.disconnect(); flowObserver?.disconnect();
  workspace = architectureWorkspace();
  const topic = (id: BriefingSection['id']): HTMLElement | null => {
    const section = b.sections.find(s => s.id === id);
    if (!section) return null;
    if (id === 'overview') return projectIntroduction(b);
    const area = sectionEl(section, open);
    if (id === 'features') area.append(disclosure('Functional requirements & quality expectations', requirements(b)));
    if (id === 'technology') area.querySelector('.body')?.prepend(technologyStack(b, technology => { void workspace?.highlightTechnology(technology); jumpTo('system-map'); }));
    if (id === 'architecture') area.querySelector('.body')?.append(h('div', { id: 'system-map' }, workspace!.element));
    if (id === 'dataFlows') area.querySelector('.body')?.append(h('div', { id: 'operation-map' }, h('p', { class: 'muted' }, 'The operation map loads as you reach this section.'), h('button', { type: 'button', onclick: () => { ensureFlow(); } }, 'Explore an operation')));
    if (id === 'entryPoints') {
      const scripts = section.blocks.flatMap(block => block.type === 'groups' ? block.groups.filter(group => group.title === 'Developer scripts') : []);
      if (scripts.length) area.querySelector('.body')?.append(disclosure('Local commands declared by the project', h('div', {}, ...scripts.map(group => blockEl({ type: 'groups', groups: [group] })) )));
    }
    if (id === 'engineerMustKnow') area.querySelector('.body')?.prepend(h('h3', {}, 'Start with these files'), h('ol', { class: 'reading-order' }, ...readingOrder(b).map(item => {
      const row = h('li', {}, h('a', { href: item.nodeId ? graphHref(item.nodeId) : sourceHref(item.path) ?? '#sec-components' }, item.path), h('p', {}, item.why));
      const id = item.nodeId ?? `file:${item.path}`;
      const inspect = h('button', { type: 'button', class: 'act', 'aria-expanded': 'false' }, 'Inspect dependencies & related tests');
      inspect.addEventListener('click', () => toggle(row, inspect, 'explain', () => explainPanel(id))); row.append(inspect); return row;
    })));
    return area;
  };
  const stages = REPORT_STAGES.map((stage, index) => {
    const area = h('section', { id: `stage-${stage.id}`, class: 'report-stage', 'data-stage': stage.id, 'aria-labelledby': `heading-${stage.id}` },
      h('header', { class: 'stage-heading' }, h('span', { class: 'stage-number' }, `STAGE 0${index + 1}`), h('h2', { id: `heading-${stage.id}` }, stage.title), h('p', {}, stage.introduction)), ...stage.sections.map(topic));
    if (stage.id === 'evaluate') area.append(historySection());
    if (stage.id === 'change') {
      area.append(h('section', { id: 'report-decisions', class: 'sec' }, h('h2', {}, 'Design decisions & constraints'), h('p', { class: 'lead' }, 'The structural explanation above describes what the code suggests. It does not establish the team’s reasons for choosing it.'),
        ...b.sections.filter(s => ['architecture', 'engineerMustKnow'].includes(s.id)).flatMap(s => s.claims.filter(c => c.evidence.some(e => e.source === 'documentation')).slice(0, 3).map(c => { const row = h('p', {}, ...prose(c.text)); row.append(actions({ claim: c.id }, () => row) ?? ''); return row; })),
        h('p', {}, 'Use the linked documentation and history to confirm intent, compatibility constraints and trade-offs before replacing an abstraction.'), h('a', { href: '#report-history' }, 'Review the project’s evolution →')));
      area.append(h('section', { class: 'sec', id: 'unknown-all' }, h('h2', {}, 'Handover questions'), h('p', { class: 'lead' }, 'These gaps need confirmation before treating the report as a complete specification.'), h('ul', {}, ...meetingQuestions(b).map(question => h('li', {}, question.text, ' ', h('a', { href: `#sec-${question.section}` }, 'Related evidence →')))), disclosure(`All recorded unknowns (${b.unknowns.length})`, h('ul', {}, ...b.unknowns.map(u => h('li', {}, u.text))))));
    }
    return area;
  });
  $("content").replaceChildren(...stages, disclosure('Analysis coverage & freshness', hero(b)), askCard(), h('p', { class: 'foot' }, 'This report describes indexed source and declared configuration. Static analysis does not establish production behavior or undocumented business intent.'));
  $("toc").replaceChildren(toc(b));
  const updateStage = (): void => {
    const line = ($('toc').getBoundingClientRect().bottom || 100) + 30;
    const active = stages.filter(stage => stage.getBoundingClientRect().top <= line).at(-1) ?? stages[0]!;
    document.querySelectorAll<HTMLElement>('[data-stage-link]').forEach(link => {
      if (link.dataset.stageLink === active.dataset.stage) link.setAttribute('aria-current', 'location'); else link.removeAttribute('aria-current');
    });
  };
  reportObserver = new IntersectionObserver(updateStage, { rootMargin: '-100px 0px -50% 0px', threshold: [0, .1] }); stages.forEach(stage => reportObserver!.observe(stage)); updateStage();
  flowObserver = new IntersectionObserver(entries => { if (entries.some(entry => entry.isIntersecting)) { ensureFlow(); flowObserver?.disconnect(); } }, { rootMargin: '250px' });
  const operation = document.getElementById('operation-map'); if (operation) flowObserver.observe(operation);
  const stale = !b.freshness.fresh; $("refresh").toggleAttribute('data-stale', stale); status(stale ? 'stale' : 'ready', stale ? 'Stale' : 'Fresh');
  if (location.hash) requestAnimationFrame(followHash);
}


async function load(): Promise<void> {
  const overlay = $("overlay");
  try {
    $("overlay-title").textContent = "Building briefing…";
    $("overlay-text").textContent = "Preparing a briefing from the repository index. Large projects may take a moment.";
    $("overlay-action").hidden = true;
    status("busy", "Building…");
    render(await json<CodebaseBriefing>("/api/briefing"));
    overlay.hidden = true;
  } catch (e) {
    status("error", "Error");
    $("overlay-title").textContent = "Could not build the briefing";
    $("overlay-text").textContent = (e as Error).message;
    const retry = $("overlay-action");
    retry.hidden = false;
    retry.onclick = () => void load();
  }
}

let refreshing = false;
async function refresh(): Promise<void> {
  if (refreshing) return;
  refreshing = true;
  ($("refresh") as HTMLButtonElement).disabled = true;
  document.getElementById("refresh-error")?.remove();
  status("busy", "Updating…");
  try {
    render(await json<CodebaseBriefing>("/api/briefing/refresh", { method: "POST" }));
  } catch (e) {
    status("error", "Refresh failed");
    const retry = h("button", { type: "button" }, "Retry refresh");
    retry.addEventListener("click", () => void refresh());
    $("content").prepend(h("div", { id: "refresh-error", role: "alert", class: "refresh-error" }, h("p", {}, "Could not refresh the analysis. The previous briefing remains available.", h("span", { class: "detail" }, (e as Error).message)), retry));
  } finally {
    refreshing = false;
    ($("refresh") as HTMLButtonElement).disabled = false;
  }
}

let lastCheck = 0;
async function checkFreshness(): Promise<void> {
  if (!briefing || Date.now() - lastCheck < 15_000) return;
  lastCheck = Date.now();
  try {
    const f = await json<BriefingFreshness>("/api/briefing/freshness");
    if (!f.fresh && briefing.freshness.fresh) {
      // The working tree moved: reload with per-section stale flags.
      render(await json<CodebaseBriefing>("/api/briefing"));
    }
  } catch {
    // Freshness is advisory.
  }
}

function download(name: string, text: string, type: string): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = h("a", { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

$("refresh").addEventListener("click", () => void refresh());
document.querySelectorAll<HTMLButtonElement>("#export button").forEach((btn) =>
  btn.addEventListener("click", async () => {
    ($("export") as HTMLDetailsElement).open = false;
    const kind = btn.dataset.export!;
    const name = (briefing?.headline.name ?? "codebase").replace(/[^\w.-]+/g, "-");
    if (kind === "json") return download(`${name}-briefing.json`, JSON.stringify(briefing, null, 2), "application/json");
    const res = await fetch(`/api/briefing/markdown?depth=${kind}`);
    download(`${name}-briefing${kind === "standard" ? "" : `-${kind}`}.md`, await res.text(), "text/markdown");
  }),
);
window.addEventListener("focus", () => void checkFreshness());
setInterval(() => void checkFreshness(), 60_000);
document.addEventListener("keydown", (e) => {
  if (e.key === "/" && !(e.target instanceof HTMLInputElement)) {
    e.preventDefault();
    document.getElementById("ask-q")?.focus();
  }
});
void load();
