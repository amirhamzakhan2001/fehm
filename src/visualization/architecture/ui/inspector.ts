import type { ArchEvidence, ArchitectureSummary, ArchNodeType, Confidence, NodeDetail, RelationshipDetail, SourceExcerpt } from "../../../architecture/types.js";
import { h } from "../../graph/ui/dom.js";

/**
 * Inspector panel: everything the canvas deliberately does not show. Every
 * claim carries its evidence; every evidence row can open the source excerpt
 * served from Feature 1's index, and every code entity links to the 3.1 graph.
 */

export interface InspectorActions {
  select(id: string): void;
  open(id: string): void;
  highlight(mode: "up" | "down" | "both"): void;
  close(): void;
  root(): string;
}

export const TYPE_LABEL: Record<ArchNodeType, string> = {
  actor: "Actor",
  api: "HTTP API",
  cli: "Command line",
  frontend: "User interface",
  worker: "Background worker",
  service: "Service logic",
  "data-access": "Data access",
  shared: "Shared foundation",
  component: "Component",
  module: "Module",
  file: "Source file",
  database: "Database",
  filesystem: "File system",
  "external-system": "External system",
  function: "Function",
  step: "Step",
  decision: "Decision",
  loop: "Loop",
  start: "Start",
  end: "End",
  failure: "Failure",
  state: "State",
  container: "Container / workload",
  gateway: "Gateway / ingress",
  platform: "Platform",
  auth: "Authentication",
  sink: "Security-sensitive sink",
  secret: "Secrets",
};

const CONF_LABEL: Record<Confidence, string> = { verified: "Verified", strong: "Strongly inferred", inferred: "Inferred", unknown: "Unknown" };
const CONF_HELP: Record<Confidence, string> = {
  verified: "Observed by the compiler/AST or filesystem, or declared in a manifest.",
  strong: "Pattern-extracted from specific source lines, or several independent signals.",
  inferred: "A reading of names or structure; not explicit in code.",
  unknown: "No evidence in code; nothing is claimed.",
};

const plural = (n: number, w: string): string => `${n} ${n === 1 ? w : `${w}s`}`;
const graphHref = (id: string): string => `/graph#node=${encodeURIComponent(id)}`;

async function getJSON<T>(path: string): Promise<T> {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`${path} → HTTP ${res.status}`);
  return (await res.json()) as T;
}

function badge(c: Confidence): HTMLElement {
  return h("span", { class: `badge ${c}`, title: CONF_HELP[c] }, CONF_LABEL[c]);
}

function head(eyebrow: string, title: string, actions: InspectorActions): HTMLElement {
  return h("div", { class: "head" }, h("div", {}, h("div", { class: "eyebrow" }, eyebrow), h("h2", {}, title)), h("button", { class: "x", "aria-label": "Close inspector", title: "Close (Esc)", onclick: () => actions.close() }, "×"));
}

function vscodeHref(root: string, path: string, line?: number): string {
  const abs = `${root.replace(/\\/g, "/")}/${path}`;
  return `vscode://file/${abs.startsWith("/") ? abs.slice(1) : abs}${line ? `:${line}` : ""}`;
}

/** One evidence row: location, detail, and on demand the source excerpt. */
function evidenceRow(ev: ArchEvidence, actions: InspectorActions): HTMLElement {
  const box = h("div", { class: "ev" });
  const loc = `${ev.path}${ev.line ? `:${ev.line}` : ""}`;
  const toggle = h("button", { class: "act", "aria-expanded": "false", title: "Show the source lines" }, "source");
  toggle.addEventListener("click", async () => {
    const open = box.querySelector("pre");
    if (open) {
      open.remove();
      toggle.setAttribute("aria-expanded", "false");
      return;
    }
    toggle.setAttribute("aria-expanded", "true");
    const pre = h("pre", { class: "code" }, "Loading…");
    box.append(pre);
    try {
      const ex = await getJSON<SourceExcerpt>(`/api/architecture/source?path=${encodeURIComponent(ev.path)}&line=${ev.line ?? 1}`);
      pre.replaceChildren(...ex.lines.map((l, i) => h("span", { class: ex.start + i === ex.focus && ev.line ? "f" : "" }, h("i", {}, String(ex.start + i)), l)));
    } catch (e) {
      pre.textContent = (e as Error).message;
    }
  });
  box.append(
    h(
      "div",
      { class: "row" },
      h("span", { class: "p" }, loc),
      h("span", { class: "pill", title: "How this fact was established" }, ev.provenance),
      toggle,
      ev.nodeId ? h("a", { class: "act", href: graphHref(ev.nodeId), title: "Open in the codebase graph" }, "graph") : null,
      h("a", { class: "act", href: vscodeHref(actions.root(), ev.path, ev.line), title: "Open in VS Code" }, "editor"),
      ev.detail ? h("span", { class: "d" }, ev.detail) : null,
    ),
  );
  return box;
}

function evidenceList(items: ArchEvidence[], actions: InspectorActions, cap = 6): HTMLElement {
  const wrap = h("div", {});
  const render = (n: number): void => {
    wrap.replaceChildren(...items.slice(0, n).map((e) => evidenceRow(e, actions)));
    if (items.length > n) wrap.append(h("button", { class: "act", onclick: () => render(items.length) }, `Show ${items.length - n} more`));
  };
  render(cap);
  return wrap;
}

export function nodePanel(d: NodeDetail, actions: InspectorActions, canOpen: boolean): HTMLElement {
  const n = d.node;
  const roleEvidence = n.evidence.filter((e) => e.provenance !== "filesystem");
  const files = n.files;
  const relList = (items: NodeDetail["dependsOn"]): HTMLElement =>
    items.length
      ? h("ul", { class: "rel" }, ...items.slice(0, 14).map((r) => h("li", {}, h("button", { class: "name", title: `Select ${r.name}`, onclick: () => actions.select(r.id) }, r.name), h("span", { class: "t" }, r.relType), h("span", { class: "pill", title: "Underlying code relationships" }, String(r.weight)))), items.length > 14 ? h("li", { class: "muted small" }, `+ ${items.length - 14} more`) : null)
      : h("p", { class: "muted small" }, "None in the index.");
  return h(
    "div",
    { class: "insp" },
    head(TYPE_LABEL[n.type], n.name, actions),
    h("div", {}, h("div", { class: "actions" }, badge(n.role.confidence), n.status && n.status !== "unchanged" ? h("span", { class: `badge ${n.status === "added" ? "verified" : n.status === "removed" ? "unknown" : "inferred"}` }, n.status) : null), h("ul", { class: "reasons" }, ...n.role.reasons.map((r) => h("li", {}, r)))),
    n.description ? h("p", {}, n.description) : null,
    n.files.length ? h("div", { class: "stats" }, h("span", {}, h("b", {}, String(files.length)), files.length === 1 ? " file" : " files"), h("span", {}, h("b", {}, String(n.symbols)), " symbols"), d.children.length && n.level < 4 ? h("span", {}, h("b", {}, String(d.children.length)), ` ${d.children[0]?.type === "file" ? "files" : "parts"} inside`) : null) : null,
    h(
      "div",
      { class: "actions" },
      canOpen ? h("button", { onclick: () => actions.open(n.id), title: "Show what is inside (Shift+Enter)" }, "Open ⤵") : null,
      h("button", { onclick: () => actions.highlight("up"), title: "Highlight what leads here" }, "Upstream"),
      h("button", { onclick: () => actions.highlight("down"), title: "Highlight what this leads to" }, "Downstream"),
      n.graphNodeId ? h("a", { href: graphHref(n.graphNodeId), title: "Open in the Codebase Graph codebase graph" }, "Open in graph") : null,
    ),
    h("section", {}, h("h3", {}, "Depends on", h("span", {}, String(d.dependsOn.length))), relList(d.dependsOn)),
    h("section", {}, h("h3", {}, "Used by", h("span", {}, String(d.usedBy.length))), relList(d.usedBy)),
    n.technologies.length ? h("section", {}, h("h3", {}, "Technologies"), h("div", { class: "actions" }, ...n.technologies.map((t) => h("span", { class: "pill" }, t)))) : null,
    d.keySymbols.length
      ? h("section", {}, h("h3", {}, "Most used symbols"), h("ul", { class: "rel" }, ...d.keySymbols.map((s) => h("li", {}, h("a", { class: "name", href: graphHref(s.id), title: `${s.path}${s.line ? `:${s.line}` : ""}` }, s.name), h("span", { class: "t" }, s.kind), h("span", { class: "pill", title: "References from other files" }, String(s.inbound))))))
      : null,
    d.children.length && n.level < 4 ? h("section", {}, h("h3", {}, "Inside", h("span", {}, String(d.children.length))), h("ul", { class: "rel" }, ...d.children.slice(0, 20).map((c) => h("li", {}, h("span", { class: "name" }, c.name), h("span", { class: "t" }, TYPE_LABEL[c.type]), c.files > 1 ? h("span", { class: "pill" }, plural(c.files, "file")) : null)))) : null,
    roleEvidence.length ? h("section", {}, h("h3", {}, "Why this role"), evidenceList(roleEvidence, actions, 4)) : null,
    files.length ? h("section", {}, h("h3", {}, "Files", h("span", {}, String(files.length))), evidenceList(files.map((f) => ({ path: f, nodeId: `file:${f}`, provenance: "filesystem" as const })), actions, 5)) : null,
  );
}

export function relationshipPanel(d: RelationshipDetail, actions: InspectorActions): HTMLElement {
  const r = d.relationship;
  const counts = Object.entries(r.counts).filter(([, v]) => v);
  return h(
    "div",
    { class: "insp" },
    head("Relationship", `${d.source.name} → ${d.target.name}`, actions),
    h("div", { class: "actions" }, h("span", { class: "pill" }, r.label ?? r.type), badge(r.confidence), r.status && r.status !== "unchanged" ? h("span", { class: "pill" }, r.status) : null),
    h("p", { class: "small muted" }, CONF_HELP[r.confidence]),
    h("div", { class: "actions" }, h("button", { onclick: () => actions.select(d.source.id) }, `← ${d.source.name}`), h("button", { onclick: () => actions.select(d.target.id) }, `${d.target.name} →`)),
    h("section", {}, h("h3", {}, "Made of", h("span", {}, plural(r.weight, "link"))), h("div", { class: "actions" }, ...counts.map(([k, v]) => h("span", { class: "pill", title: k === "signal" ? "Source-line signals (routes, SQL, file writes, imports of a service SDK)" : `Context Engine '${k}' edges` }, `${k === "signal" ? "signals" : k} ${v}`)))),
    h("section", {}, h("h3", {}, "Evidence", h("span", {}, `${r.evidence.length} shown`)), evidenceList(r.evidence, actions, 6)),
  );
}

export function emptyPanel(s: ArchitectureSummary | null, notes: string[]): HTMLElement {
  const swatch = (draw: string): SVGSVGElement => {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("width", "34");
    svg.setAttribute("height", "20");
    svg.setAttribute("viewBox", "0 0 34 20");
    svg.innerHTML = draw; // static, author-controlled markup
    return svg;
  };
  const li = (draw: string, text: string): HTMLElement => h("div", { class: "li" }, swatch(draw), h("span", {}, text));
  const cov = s?.coverage;
  const total = cov ? cov.verified + cov.strong + cov.inferred + cov.unknown : 0;
  const pct = (v: number): string => (total ? `${Math.round((v / total) * 100)}%` : "—");
  return h(
    "div",
    { class: "insp" },
    h("div", {}, h("div", { class: "eyebrow" }, "No selection"), h("p", { class: "small muted" }, "Select a component to see its role, evidence and dependencies. Double-click (or Shift+Enter) opens what is inside it.")),
    s
      ? h(
          "section",
          {},
          h("h3", {}, "This architecture"),
          h("div", { class: "stats" }, h("span", {}, h("b", {}, String(s.counts.components)), " components"), h("span", {}, h("b", {}, String(s.counts.modules)), " modules"), h("span", {}, h("b", {}, String(s.counts.files)), " files"), h("span", {}, h("b", {}, String(s.counts.externals)), " outside")),
        )
      : null,
    cov
      ? h(
          "section",
          {},
          h("h3", {}, "Evidence coverage", h("span", {}, "claims")),
          h("div", { class: "stats" }, h("span", { title: CONF_HELP.verified }, "Verified ", h("b", {}, pct(cov.verified))), h("span", { title: CONF_HELP.strong }, "Strong ", h("b", {}, pct(cov.strong))), h("span", { title: CONF_HELP.inferred }, "Inferred ", h("b", {}, pct(cov.inferred))), h("span", { title: CONF_HELP.unknown }, "Unknown ", h("b", {}, pct(cov.unknown)))),
          h("p", { class: "small muted" }, "Shares of component roles and relationships by evidence strength — not a quality score."),
        )
      : null,
    h(
      "section",
      {},
      h("h3", {}, "Legend"),
      h(
        "div",
        { class: "legend" },
        li(`<rect x="2" y="3" width="30" height="14" rx="4" fill="#11151f" stroke="#7aa2f7"/><rect x="6" y="3" width="22" height="2" fill="#7aa2f7"/>`, "Interface: HTTP API, CLI or UI (accent bar)"),
        li(`<rect x="2" y="3" width="30" height="14" rx="4" fill="#11151f" stroke="#33405a"/>`, "Component or module"),
        li(`<rect x="6" y="7" width="26" height="12" rx="4" fill="#0c0f16" stroke="#33405a"/><rect x="2" y="3" width="26" height="12" rx="4" fill="#11151f" stroke="#33405a"/>`, "Stacked: can be opened"),
        li(`<rect x="2" y="3" width="30" height="14" rx="7" fill="#1a2233" stroke="#7aa2f7"/>`, "Actor outside the code"),
        li(`<path d="M3 5A14 3 0 0 1 31 5V15A14 3 0 0 1 3 15Z" fill="#1c1a2b" stroke="#bb9af7"/>`, "Data store"),
        li(`<rect x="2" y="3" width="30" height="14" rx="4" fill="#1b1810" stroke="#e0af68" stroke-dasharray="4 3"/>`, "External system"),
        li(`<rect x="2" y="3" width="30" height="14" rx="4" fill="#0c0f16" stroke="#33405a" stroke-dasharray="3 2"/>`, "Context (outside the opened component)"),
        li(`<path d="M2 10H30" stroke="#56627c" stroke-width="1.6"/>`, "Verified relationship"),
        li(`<path d="M2 10H30" stroke="#56627c" stroke-width="1.6" stroke-dasharray="6 4"/>`, "Inferred relationship"),
        li(`<circle cx="9" cy="10" r="3.5" fill="#5fd4c0"/><circle cx="21" cy="10" r="3.5" fill="#090c12" stroke="#e0af68"/>`, "Role evidence: verified · inferred"),
        li(`<path d="M8 3H26L32 10L26 17H8L2 10Z" fill="#141a28" stroke="#a9c1ff"/>`, "Decision, loop or gateway"),
        li(`<rect x="2" y="3" width="30" height="14" rx="7" fill="#12231f" stroke="#5fd4c0"/>`, "Start / end"),
        li(`<rect x="2" y="3" width="30" height="14" rx="7" fill="#26131a" stroke="#f7768e"/>`, "Failure, error path or security sink"),
        li(`<path d="M17 1V19" stroke="#33405a" stroke-dasharray="3 3"/>`, "Lifeline (runtime sequence)"),
        li(`<path d="M2 7H30" stroke="#5fd4c0" stroke-width="2"/><path d="M2 13H30" stroke="#f7768e" stroke-dasharray="5 3"/>`, "Delta: added · removed"),
      ),
    ),
    notes.length ? h("section", {}, h("h3", {}, "Notes"), h("ul", { class: "reasons" }, ...notes.map((n) => h("li", {}, n)))) : null,
    s?.unknowns.length ? h("section", {}, h("h3", {}, "Not determined"), h("ul", { class: "reasons" }, ...s.unknowns.map((u) => h("li", {}, u)))) : null,
    h("p", { class: "small muted" }, "Keys: / search · F fit · 0 actual size · + − zoom · arrows move between nodes · Esc clear"),
  );
}
