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
import { $, h } from "../../graph/ui/dom.js";

/**
 * Feature 3.2 page. Renders the briefing JSON; every claim can open its
 * evidence, every entity links to the 3.1 graph, and entry points expand
 * their call flow on demand through the Feature 1 engine.
 */

let briefing: CodebaseBriefing | null = null;
let claims = new Map<string, Claim>();
const LIST_CAP = 12;
const STATE_LABEL = { confirmed: "CONFIRMED", likely: "LIKELY", unknown: "UNKNOWN" } as const;

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
    h("p", { class: "ctext" }, claim.text),
    h("div", { class: "row" }, h("span", { class: `state ${claim.state}` }, STATE_LABEL[claim.state]), `basis: ${claim.basis}`, `· confidence ${pct(claim.confidence)}`, claim.evidence.some((e) => e.stale) ? h("span", { class: "stale-tag" }, "· includes stale evidence") : null),
    rows.length ? h("table", {}, h("tbody", {}, ...rows)) : h("div", { class: "muted" }, "No evidence — this is stated as unknown."),
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
  return h("div", {}, h("div", { class: "row" }, "Static call tree (depth 3) from Feature 1 — dynamic dispatch is not shown."), h("ul", { class: "tree" }, render(r.root)));
}

function actions(opts: { claim?: string | undefined; nodeId?: string | undefined; flowFrom?: string | undefined; path?: string | undefined; line?: number | undefined }, anchor: () => HTMLElement): HTMLElement | null {
  const btns: HTMLElement[] = [];
  const claim = opts.claim ? claims.get(opts.claim) : undefined;
  if (claim) {
    const b = h("button", { class: "act", type: "button", "aria-expanded": "false", title: "Show evidence" }, claim.evidence.some((e) => e.stale) ? "evidence ⚠" : "evidence") as HTMLButtonElement;
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
  if (opts.nodeId) btns.push(h("a", { class: "act", href: graphHref(opts.nodeId), title: "Explore in graph (3.1)" }, "graph"));
  return btns.length ? h("span", { class: "acts" }, ...btns) : null;
}

// ─── blocks ──────────────────────────────────────────────────────

function itemEl(i: BriefingItem): HTMLElement {
  const li = h("li", {});
  const isPath = /[/.]/.test(i.title) && !/\s/.test(i.title);
  const badge = i.badge ? h("span", { class: `pill ${i.badge.toLowerCase()}` }, i.badge) : null;
  li.append(
    h("div", { class: "main" }, h("div", { class: `title${isPath ? " path" : ""}` }, i.title), i.detail ? h("div", { class: "detail" }, i.detail) : null),
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
    const more = h("button", { class: "more", type: "button" }, `Show ${items.length - LIST_CAP} more`);
    more.addEventListener("click", () => {
      list.append(...items.slice(LIST_CAP).map(itemEl));
      more.remove();
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
      const p = h("p", { class: "lead" }, b.text);
      const a = actions({ claim: b.claim }, () => p);
      if (a) p.append(" ", a);
      return p;
    }
    case "facts": {
      const dl = h("dl", { class: "facts" });
      for (const r of b.rows) {
        const dd = h("dd", {}, h("span", {}, r.value));
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
      box.append(title, flowSteps(b.steps));
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
  const details = h("details", {});
  details.open = open[s.id] ?? s.expanded;
  details.addEventListener("toggle", () => saveOpen(s.id, details.open));
  const summary = h(
    "summary",
    {},
    h("div", {}, h("div", { class: "q" }, s.question), h("h2", {}, h("span", { class: "chev", "aria-hidden": "true" }, "▸"), s.title)),
    h("div", { class: "meta" }, s.stale ? h("span", { class: "state stale", title: "Evidence changed since indexing" }, "STALE") : null, h("span", { class: "conf", title: "Mean claim confidence" }, s.state === "unknown" ? "" : pct(s.confidence)), h("span", { class: `state ${s.state}` }, STATE_LABEL[s.state])),
    s.blocks[0]?.type === "text" && s.blocks[0].text === s.summary ? null : h("div", { class: "sum" }, s.summary),
  );
  const body = h("div", { class: "body" });
  for (const b of s.blocks) {
    const el = blockEl(b);
    if (el) body.append(el);
  }
  if (s.unknowns.length) body.append(h("div", {}, h("h4", {}, "Could not determine"), h("ul", { class: "unknowns" }, ...s.unknowns.map((u) => h("li", {}, u)))));
  if (s.links?.length) body.append(h("div", { class: "links" }, ...s.links.map((l) => h("a", { href: l.href }, `${l.label} →`))));
  details.append(summary, body);
  return h("section", { class: `sec card`, id: `sec-${s.id}`, ...(s.id === "cheatSheet" ? { "data-cheat": "true" } : {}) }, details);
}

function hero(b: CodebaseBriefing): HTMLElement {
  const m = b.metrics;
  const stale = !b.freshness.fresh;
  const confirmed = h("span", { class: "badge ok", title: "Share of claims backed by compiler/AST/filesystem facts or declarations" }, "Confirmed ", h("b", {}, pct(m.confirmedShare)), h("span", { class: "meter" }, h("i", { style: `width:${pct(m.confirmedShare)}` })));
  const unknownLink = h("a", { class: "badge", href: "#unknown-all" }, h("b", {}, String(m.unknowns)), " unknowns");
  const card = h(
    "section",
    { class: "card", id: "hero" },
    h("div", { class: "eyebrow" }, `Explain codebase · ${stale ? "stale" : "fresh"} · built ${ago(b.generatedAt)}`),
    h("h1", {}, b.headline.name),
    h("p", { class: "tagline" }, b.headline.tagline),
    h("div", { class: "chips" }, ...b.headline.tags.map((t) => h("span", { class: "chip" }, t))),
    h(
      "div",
      { class: "badges" },
      confirmed,
      unknownLink,
      h("span", { class: "badge", title: "Files · entities · non-structural relationships in the Feature 1 index" }, h("b", {}, String(m.files)), " files · ", h("b", {}, String(m.symbols)), " symbols · ", h("b", {}, String(m.relationships)), " relationships"),
      m.heuristicShare > 0.15 ? h("span", { class: "badge warn" }, `${pct(m.heuristicShare)} heuristic relationships`) : null,
      h("span", { class: "badge", title: `Rebuilt: ${b.cache.rebuilt.join(", ") || "none"}` }, `${b.cache.reused.length}/${b.sections.length} sections cached · ${b.cache.durationMs} ms · no LLM`),
    ),
  );
  if (stale) card.append(staleBanner(b.freshness));
  return card;
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
    fetch(`/api/briefing/ask?q=${encodeURIComponent(q)}`, { signal: ctrl.signal })
      .then((r) => r.json() as Promise<BriefingAskResponse>)
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
  return h("section", { class: "card", id: "ask" }, form, h("p", { class: "hint" }, "Answers come from Feature 1 retrieval over the index — ranked code with evidence, not generated prose. Press / to focus."), answers);
}

function toc(b: CodebaseBriefing): HTMLElement {
  const ol = h("ol", {});
  for (const s of b.sections) {
    ol.append(h("li", {}, h("a", { href: `#sec-${s.id}`, "data-sec": s.id }, h("span", { class: `dot ${s.state}${s.stale ? " stale" : ""}`, title: `${STATE_LABEL[s.state]}${s.stale ? " · stale" : ""}` }), s.title, h("span", { class: "n" }, s.state === "unknown" ? "?" : pct(s.confidence)))));
  }
  ol.append(h("li", {}, h("a", { href: "#unknown-all" }, h("span", { class: "dot unknown" }), "What Fehm could not determine", h("span", { class: "n" }, String(b.unknowns.length)))));
  const expand = h("button", { type: "button" }, "Expand all");
  const collapse = h("button", { type: "button" }, "Collapse all");
  expand.addEventListener("click", () => document.querySelectorAll<HTMLDetailsElement>("section.sec > details").forEach((d) => (d.open = true)));
  collapse.addEventListener("click", () => document.querySelectorAll<HTMLDetailsElement>("section.sec > details").forEach((d) => (d.open = false)));
  return h("div", {}, h("h3", {}, "Briefing"), ol, h("div", { class: "tools" }, expand, collapse), h("p", { class: "muted", style: "font-size:11.5px;margin-top:14px" }, `Tuned for a ${b.archetype.primary.toUpperCase()} repository: ${b.archetype.signals.slice(0, 3).join("; ")}.`));
}

function render(b: CodebaseBriefing): void {
  briefing = b;
  claims = new Map(b.sections.flatMap((s) => s.claims.map((c) => [c.id, c] as const)));
  document.title = `Explain · ${b.headline.name} · fehm`;
  $("project").textContent = b.repository.root;
  const open = loadOpen();
  const content = $("content");
  const unknowns = h("section", { class: "card", id: "unknown-all" }, h("h2", {}, "What Fehm could not determine"), h("p", { class: "muted", style: "margin:0 0 10px;font-size:12.5px" }, "Stated explicitly so nothing above reads as more certain than the evidence allows."), h("ul", { class: "unknowns" }, ...b.unknowns.map((u) => h("li", {}, u.text, h("span", { class: "muted" }, `  — ${b.sections.find((s) => s.id === u.section)?.title ?? u.section}`)))));
  content.replaceChildren(
    hero(b),
    askCard(),
    ...b.sections.map((s) => sectionEl(s, open)),
    unknowns,
    h("p", { class: "foot" }, `Deterministic briefing built from the Feature 1 index · schema ${b.schemaVersion} · ${b.metrics.claims} claims · generated ${new Date(b.generatedAt).toLocaleString()}`),
  );
  $("toc").replaceChildren(toc(b));
  const stale = !b.freshness.fresh;
  $("refresh").toggleAttribute("data-stale", stale);
  status(stale ? "stale" : "ready", stale ? "Stale" : "Fresh");
  observeToc();
  if (location.hash) document.getElementById(location.hash.slice(1))?.scrollIntoView();
}

let observer: IntersectionObserver | undefined;
function observeToc(): void {
  observer?.disconnect();
  observer = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        const id = e.target.id.replace(/^sec-/, "");
        document.querySelectorAll("#toc a[data-sec]").forEach((a) => a.setAttribute("aria-current", String((a as HTMLElement).dataset.sec === id)));
      }
    },
    { rootMargin: "-50px 0px -70% 0px" },
  );
  document.querySelectorAll("section.sec").forEach((s) => observer!.observe(s));
}

async function load(): Promise<void> {
  const overlay = $("overlay");
  try {
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

async function refresh(): Promise<void> {
  status("busy", "Updating…");
  try {
    render(await json<CodebaseBriefing>("/api/briefing/refresh", { method: "POST" }));
  } catch (e) {
    status("error", (e as Error).message);
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
