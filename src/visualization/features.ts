/**
 * The localhost dashboard's feature registry — the single list the dashboard
 * navigation, the home cards, every page's cross-feature links and the
 * server's completeness test are built from.
 *
 * Adding a feature page:
 *   1. add an entry here;
 *   2. serve `path` (and its assets/APIs) from a `ViewRoutes` module under
 *      `src/visualization/<feature>/`, with `pageHeaders()` and `renderPage()`;
 *   3. register that module in `src/server.ts`;
 *   4. put `${featureNav("<id>")}` in the page header and `${CHROME_CSS}` in its style.
 */
export interface FeatureEntry {
  /** URL-safe id; the dashboard address is `/#/<id>`. */
  readonly id: string;
  /** Internal specification reference; never displayed as a product label. */
  readonly code: string;
  readonly title: string;
  /** One sentence for the home card. */
  readonly summary: string;
  /** The page route, served standalone and framed by the dashboard. */
  readonly path: string;
  /** Key into the dashboard's icon set; unknown keys get a neutral icon. */
  readonly icon: string;
  /** `feature` pages are the product; `tool` pages are engine diagnostics. */
  readonly group: "feature" | "tool";
}

export const FEATURES: readonly FeatureEntry[] = [
  {
    id: "graph",
    code: "3.1",
    title: "Codebase graph",
    summary: "Every file, symbol and relationship as an explorable map, with search, filters and an inspector.",
    path: "/graph",
    icon: "graph",
    group: "feature",
  },
  {
    id: "explain",
    code: "3.2",
    title: "Explain codebase",
    summary: "An evidence-backed briefing: purpose, architecture, entry points, flows, risks and what is still unknown.",
    path: "/explain",
    icon: "explain",
    group: "feature",
  },
  {
    id: "architecture",
    code: "3.3",
    title: "Architecture",
    summary: "The codebase as a software system: components, interfaces, data stores and outside systems, drilled down to modules and files, every claim evidence-backed.",
    path: "/architecture",
    icon: "architecture",
    group: "feature",
  },
  {
    id: "drift",
    code: "3.4",
    title: "Architecture drift",
    summary: "Where the code deviates from its own conventions, its frameworks and common practice — with evidence, confidence, attention and history. Observed deviations, not verdicts.",
    path: "/drift",
    icon: "drift",
    group: "feature",
  },
  {
    id: "security",
    code: "3.6",
    title: "Security review",
    summary: "Data flows from untrusted input to dangerous sinks, secrets, the attack surface and its controls, pipelines, infrastructure and AI integrations, each finding with evidence.",
    path: "/security",
    icon: "security",
    group: "feature",
  },
  {
    id: "health",
    code: "3.5",
    title: "Project health",
    summary: "Build, tests, coverage, quality, dead code, dependencies, reliability and debt as explainable dimensions, each finding backed by evidence.",
    path: "/health",
    icon: "health",
    group: "feature",
  },
  {
    id: "prompts",
    code: "3.7",
    title: "Prompt intelligence",
    summary: "Discover AI workflows, evaluate code-aware prompt findings, compare evidence-backed revisions and validate behavior.",
    path: "/prompts",
    icon: "explain",
    group: "feature",
  },
  {
    id: "concepts", code: "3.9", title: "Engineering concepts",
    summary: "Engineering concepts mapped to repository evidence, with explicit scope, qualitative status and links into the code graph.",
    path: "/concepts", icon: "graph", group: "feature",
  },
  {
    id: "git-memory",
    code: "3.8",
    title: "Git memory",
    summary: "Search the codebase’s evolution: commits, semantic changes, lineage, historical measurements and compact engineering context.",
    path: "/git-memory",
    icon: "drift",
    group: "feature",
  },
  {
    id: "guardrails", code: "3.10", title: "Change Verification & Review",
    summary: "Working-tree impact, relevant checks, revision-specific evidence and unresolved risks.",
    path: "/guardrails", icon: "health", group: "feature",
  },
  {
    id: "debug", code: "3.11", title: "Failure investigation",
    summary: "Connect failures to code evidence, testable explanations and the next diagnostic action.",
    path: "/debug", icon: "health", group: "feature",
  },
  {
    id: "engine",
    code: "1",
    title: "Context engine",
    summary: "Index status and context-packet debugging for the context engine every page is built on.",
    path: "/engine",
    icon: "engine",
    group: "tool",
  },
];

/** The dashboard's own home view; not a feature and never framed. */
export const HOME_ID = "home";

export function featureById(id: string): FeatureEntry | undefined {
  return FEATURES.find((f) => f.id === id);
}

export function dashboardHref(id: string): string {
  return `/#/${id}`;
}

const escapeHtml = (s: string): string => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" })[c]!);

/**
 * Cross-feature links for a page header (standalone use). They open the
 * dashboard at the target feature; inside the dashboard they are hidden.
 */
export function featureNav(currentId: string): string {
  const links = [`<a class="nav" href="/" target="_top">Dashboard</a>`];
  for (const f of FEATURES) {
    if (f.id !== currentId) links.push(`<a class="nav" href="${dashboardHref(f.id)}" target="_top">${escapeHtml(f.title)}</a>`);
  }
  return `<nav class="fehm-nav" aria-label="Fehm features">${links.join("")}</nav>`;
}

/** Shared page-chrome rules: nav layout, and what the embedded variant hides. */
export const CHROME_CSS =
  ".assessment{margin:20px 0;padding:16px 0;border-block:1px solid var(--line);max-width:100%;line-height:1.65}.assessment h2{font-size:16px;margin:0 0 10px}.assessment p{max-width:90ch}details>summary:focus-visible,button:focus-visible,a:focus-visible{outline:2px solid var(--accent);outline-offset:3px}[aria-current=true]{border-left:3px solid var(--accent)}#detail{scroll-margin-top:60px}.lead{font-size:16px;line-height:1.7;max-width:90ch}" +
  ".fehm-nav{display:inline-flex;align-items:center;gap:12px}.fehm-nav .nav+.nav{margin-left:0}" +
  "html.embedded .brand,html.embedded .brand+.sep,html.embedded .fehm-nav{display:none}" +
  "@media (max-width:760px){.fehm-nav{display:none}}";
