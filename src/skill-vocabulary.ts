import type { SectionCategory, SkillCapabilities, SkillStyle, TaskIntent } from "./skill-model.js";
import { tokenize } from "./text.js";

/**
 * Deterministic vocabulary shared by skill indexing and task profiling, so a
 * task and a skill are described in the same terms. Matching is whole-token on
 * Feature 1's stemmed `tokenize` output ("test" never matches "latest").
 */

/**
 * Stemmed tokens with stop words kept, so phrases like "how does" survive.
 * Lowercased first: prose "GitHub" must stay one word for phrase matching
 * (camelCase splitting is for identifiers, which Feature 1's lexical index handles).
 */
export function words(text: string): string[] {
  return tokenize(text.toLowerCase(), { keepStopWords: true });
}

const phraseCache = new Map<string, string[]>();
function phraseTokens(phrase: string): string[] {
  let t = phraseCache.get(phrase);
  if (!t) phraseCache.set(phrase, (t = words(phrase)));
  return t;
}

/** Index of the first occurrence of `phrase` as a contiguous token run, or -1. */
export function findPhrase(tokens: readonly string[], phrase: string): number {
  const p = phraseTokens(phrase);
  if (!p.length) return -1;
  outer: for (let i = 0; i + p.length <= tokens.length; i += 1) {
    for (let j = 0; j < p.length; j += 1) if (tokens[i + j] !== p[j]) continue outer;
    return i;
  }
  return -1;
}

type Rule = [phrase: string, weight: number];

/** Activity intents. Weight 1 = decisive, 0.5 = supporting evidence only. */
export const INTENT_RULES: Record<TaskIntent, Rule[]> = {
  debug: [
    ["debug", 1], ["bug", 1], ["bugfix", 1], ["broken", 1], ["crash", 1], ["error", 1], ["exception", 1], ["failing", 1],
    ["flaky", 1], ["timeout", 1], ["regression", 1], ["diagnose", 1], ["root cause", 1], ["stack trace", 1], ["nil pointer", 1],
    ["null pointer", 1], ["not working", 1], ["troubleshoot", 1], ["500 error", 1], ["hang", 0.5], ["leak", 0.5], ["fix", 0.5],
    ["investigate", 0.5], ["incident", 0.5], ["fail", 0.5],
  ],
  implement: [
    ["implement", 1], ["feature", 1], ["add support", 1], ["new endpoint", 1], ["integrate", 0.5], ["add", 0.5], ["build", 0.5],
    ["create", 0.5], ["endpoint", 0.5], ["pagination", 0.5], ["support for", 0.5],
  ],
  refactor: [
    ["refactor", 1], ["rename", 1], ["restructure", 1], ["duplication", 1], ["over engineered", 1], ["overengineered", 1],
    ["dead code", 1], ["unused", 1], ["simplify", 1], ["clean up", 0.5], ["cleanup", 0.5], ["extract", 0.5], ["abstraction", 0.5],
    ["tech debt", 1], ["technical debt", 1], ["decouple", 0.5],
  ],
  test: [
    ["test", 1], ["tests", 1], ["unit test", 1], ["coverage", 1], ["tdd", 1], ["test driven", 1], ["pytest", 1], ["jest", 1],
    ["vitest", 1], ["e2e", 1], ["end to end", 1], ["spec file", 1], ["assertion", 0.5], ["mock", 0.5],
  ],
  review: [
    ["review", 1], ["pull request", 1], ["code review", 1], ["review comments", 1], ["pr", 0.5], ["audit", 0.5], ["critique", 0.5],
    ["feedback", 0.5],
  ],
  explain: [
    ["how does", 1], ["how do", 1], ["explain", 1], ["overview", 1], ["onboarding", 1], ["walk me through", 1], ["walkthrough", 1],
    ["understand", 1], ["what does", 0.5], ["where is", 0.5], ["tour", 0.5], ["codebase", 0.5],
  ],
  plan: [
    ["plan", 1], ["implementation plan", 1.5], ["brainstorm", 1], ["roadmap", 1], ["into tickets", 1], ["tickets", 0.5], ["spec", 0.5], ["approach", 0.5], ["approaches", 0.5],
    ["design doc", 1], ["proposal", 0.5], ["break down", 1], ["break this", 0.5], ["milestones", 0.5], ["requirements", 0.5],
    ["strategy", 0.5], ["decide", 0.5], ["trade off", 0.5], ["tradeoffs", 0.5],
  ],
  ship: [
    ["ship", 1], ["release", 1], ["deploy", 1], ["rollout", 1], ["canary", 1], ["publish", 1], ["bump version", 1], ["version bump", 1],
    ["production", 0.5], ["launch", 0.5], ["land", 0.5], ["open a pr", 0.5],
  ],
  git: [
    ["commit", 1], ["commit message", 1], ["merge conflict", 1], ["merge conflicts", 1], ["rebase", 1], ["rebasing", 1],
    ["branch", 0.5], ["cherry pick", 1], ["git", 1], ["worktree", 1], ["merge", 0.5], ["push", 0.5],
  ],
  security: [
    ["security", 1], ["vulnerability", 1], ["vulnerabilities", 1], ["injection", 1], ["xss", 1], ["csrf", 1], ["threat model", 1],
    ["owasp", 1], ["sql injection", 1.5], ["secrets", 1], ["pentest", 1], ["penetration", 1], ["exploit", 1], ["cve", 1], ["guardrail", 0.5],
    ["guardrails", 0.5], ["permission", 0.5], ["permissions", 0.5], ["authorization", 0.5], ["sanitize", 0.5], ["audit", 0.5],
  ],
  performance: [
    ["performance", 1], ["slow", 1], ["bottleneck", 1], ["latency", 1], ["speed up", 1], ["optimize", 0.5], ["faster", 1],
    ["memory leak", 1], ["throughput", 1], ["profile", 0.5], ["profiling", 1], ["benchmark", 1], ["cache", 0.5], ["n+1", 1],
  ],
  docs: [
    ["readme", 1], ["documentation", 1], ["document", 1], ["docs", 0.5], ["changelog", 1], ["docstring", 1], ["release notes", 1.5],
    ["guide", 0.5], ["tutorial", 0.5],
  ],
  ui: [
    ["ui", 1], ["ux", 1], ["page", 0.5], ["component", 0.5], ["form", 0.5], ["css", 1], ["layout", 1], ["accessible", 1],
    ["accessibility", 1], ["a11y", 1], ["screen reader", 1], ["keyboard navigable", 1], ["keyboard navigation", 1], ["design system", 1],
    ["frontend", 1], ["responsive", 1], ["button", 0.5], ["modal", 0.5], ["dashboard", 0.5], ["animation", 1], ["styling", 1],
  ],
  research: [
    ["research", 1], ["compare", 0.5], ["which library", 1], ["evaluate options", 1], ["alternatives", 0.5], ["literature", 1],
    ["prior art", 1], ["before implementing", 0.5], ["investigate options", 1],
  ],
  database: [
    // Product names (Postgres, Redis…) are technologies, not a database *task*.
    ["database", 1], ["sql", 1], ["query", 0.5], ["queries", 0.5], ["index", 0.5], ["migration", 0.5], ["schema", 0.5],
    ["orm", 1], ["table", 0.5],
  ],
  devops: [
    ["docker", 1], ["dockerfile", 1], ["containerize", 1], ["kubernetes", 1], ["k8s", 1], ["helm", 1], ["terraform", 1], ["ci", 1],
    ["github actions", 1], ["circleci", 1], ["jenkins", 1], ["travis", 1], ["gitlab ci", 1], ["buildkite", 1], ["ci pipeline", 1], ["pipeline", 0.5], ["infrastructure", 1], ["pre commit hook", 1], ["hook", 0.5], ["monitoring", 0.5],
    ["deploy", 0.5], ["build", 0.5], ["manifests", 0.5],
  ],
  ai: [
    ["llm", 1], ["prompt", 1], ["rag", 1], ["retrieval augmented", 1], ["embeddings", 1], ["embedding", 1], ["fine tune", 1],
    ["agent", 0.5], ["model", 0.5], ["openai", 1], ["claude", 0.5], ["classify", 0.5], ["vector", 0.5],
  ],
  communicate: [
    ["fewer tokens", 1], ["less tokens", 1], ["terse", 1], ["be brief", 1], ["concise", 1], ["short answers", 1], ["shorter", 0.5],
    ["compress", 1], ["verbose", 0.5], ["caveman", 1], ["keep your answers short", 1], ["token usage", 1],
  ],
  verify: [
    ["verify", 1], ["make sure", 1], ["passes", 1], ["actually passes", 1], ["is done", 1], ["before i say", 0.5], ["validate", 0.5],
    ["confirm", 0.5], ["check that", 0.5],
  ],
};

/** Knowledge domains, independent of activity. */
export const DOMAIN_RULES: Record<string, string[]> = {
  authentication: ["auth", "authentication", "login", "logging in", "oauth", "jwt", "session", "password", "sso", "signup", "sign in", "identity", "credential"],
  security: ["security", "vulnerability", "injection", "xss", "csrf", "threat", "owasp", "secrets", "encryption", "permission", "guardrail"],
  database: ["database", "sql", "postgres", "postgresql", "mysql", "redis", "mongodb", "sqlite", "orm", "migration", "schema", "index", "query"],
  frontend: ["ui", "frontend", "react", "vue", "angular", "svelte", "css", "component", "page", "form", "browser", "dashboard", "accessible", "a11y"],
  backend: ["api", "endpoint", "rest", "graphql", "server", "backend", "express", "service", "webhook", "middleware", "grpc"],
  testing: ["test", "tests", "coverage", "tdd", "e2e", "unit test", "qa", "pytest", "jest"],
  devops: ["docker", "kubernetes", "k8s", "ci", "deploy", "deployment", "pipeline", "infrastructure", "terraform", "container"],
  mobile: ["mobile", "ios", "android", "flutter", "react native", "swiftui", "app store"],
  ai: ["llm", "prompt", "rag", "embeddings", "model", "agent", "ml", "machine learning", "openai"],
  data: ["csv", "etl", "analytics", "data pipeline", "spreadsheet", "dataset", "warehouse"],
  documentation: ["readme", "docs", "documentation", "changelog", "guide"],
  git: ["git", "commit", "branch", "merge", "rebase", "pull request"],
  performance: ["performance", "latency", "slow", "bottleneck", "throughput", "benchmark", "optimize"],
  accessibility: ["accessibility", "a11y", "screen reader", "wcag", "keyboard navigable", "aria"],
  design: ["design system", "visual design", "typography", "brand", "figma", "layout"],
  marketing: ["marketing", "seo", "campaign", "brand voice", "growth", "newsletter", "social media", "ads"],
  payments: ["payment", "payments", "billing", "invoice", "checkout", "stripe", "subscription"],
};

/**
 * Technologies: canonical name → whole-word aliases (lowercase, unstemmed).
 * Canonical names match catalog path segments (languages/go, frameworks/react).
 */
export const TECHNOLOGIES: Record<string, string[]> = {
  typescript: ["typescript", "ts", "tsx"],
  javascript: ["javascript", "js", "node", "nodejs", "node.js"],
  python: ["python", "py", "pytest", "pip"],
  go: ["go", "golang"],
  rust: ["rust", "cargo"],
  java: ["java", "jvm", "maven"],
  kotlin: ["kotlin", "ktor"],
  swift: ["swift"],
  ruby: ["ruby", "gem"],
  php: ["php", "composer"],
  perl: ["perl"],
  cpp: ["c++", "cpp", "cmake"],
  csharp: ["c#", "csharp", ".net", "dotnet"],
  dart: ["dart"],
  fsharp: ["f#", "fsharp"],
  react: ["react", "jsx", "react-dom"],
  nextjs: ["next.js", "nextjs", "next"],
  vue: ["vue", "vuejs"],
  nuxt: ["nuxt"],
  angular: ["angular"],
  svelte: ["svelte", "sveltekit"],
  "react-native": ["react-native", "react native", "expo"],
  flutter: ["flutter"],
  swiftui: ["swiftui"],
  express: ["express", "expressjs"],
  nestjs: ["nestjs", "nest"],
  fastapi: ["fastapi"],
  django: ["django"],
  flask: ["flask"],
  rails: ["rails", "ruby on rails"],
  laravel: ["laravel"],
  springboot: ["spring", "spring boot", "springboot"],
  quarkus: ["quarkus"],
  jest: ["jest"],
  vitest: ["vitest"],
  playwright: ["playwright"],
  postgres: ["postgres", "postgresql", "pg", "psycopg2", "psycopg"],
  mysql: ["mysql", "mariadb"],
  redis: ["redis", "ioredis"],
  mongodb: ["mongodb", "mongo", "mongoose"],
  sqlite: ["sqlite", "sqlite3"],
  clickhouse: ["clickhouse"],
  prisma: ["prisma"],
  docker: ["docker", "dockerfile", "containerize"],
  kubernetes: ["kubernetes", "k8s", "helm", "kubectl"],
  terraform: ["terraform"],
  graphql: ["graphql", "apollo"],
  oauth: ["oauth", "oauth2", "passport", "openid"],
  jwt: ["jwt", "jsonwebtoken"],
  "github-actions": ["github actions", "github-actions"],
};

const TECH_PATTERNS: [string, RegExp][] = Object.entries(TECHNOLOGIES).map(([name, aliases]) => [
  name,
  new RegExp(`(?:^|[^a-z0-9+#.-])(?:${aliases.map((a) => a.replace(/[.+#-]/g, (c) => `\\${c}`).replace(/ /g, "[ -]")).join("|")})(?=$|[^a-z0-9+#-]|\\.(?:$|\\s))`, "i"),
]);

/** Ambiguous single-word aliases that only count in package names / explicit tech context. */
const WEAK_ALIASES = new Set(["go", "next", "nest", "node", "js", "ts", "py", "gem", "pip", "pg", "spring", "swift", "expo", "rails", "express"]);

/**
 * Whole-word technology detection. In free text, ambiguous English words
 * ("go", "next", "express", "swift") count only when capitalised as a name
 * ("Go", "Express") or next to a technical word.
 */
export function detectTechnologies(text: string, options: { strict?: boolean } = {}): string[] {
  const found: string[] = [];
  for (const [name, pattern] of TECH_PATTERNS) {
    const m = pattern.exec(text);
    if (!m) continue;
    const alias = m[0].replace(/^[^a-z0-9+#.]/i, "");
    if (options.strict && WEAK_ALIASES.has(alias.toLowerCase())) {
      if (!/^[A-Z]/.test(alias)) continue;
      // Sentence-initial capitals ("Go to…", "Next,") are not names.
      const start = m.index + m[0].indexOf(alias);
      if (start === 0 || /[.!?]\s*$/.test(text.slice(0, start))) continue;
    }
    found.push(name);
  }
  return found;
}

/** Technologies recognised from a package/dependency name (npm, pip, go module…). */
export function packageTechnologies(pkg: string): string[] {
  const base = pkg.toLowerCase().replace(/^@[^/]+\//, "").split("/").at(-1) ?? "";
  const out: string[] = [];
  for (const [name, aliases] of Object.entries(TECHNOLOGIES)) {
    if (aliases.includes(base) || name === base || aliases.some((a) => base === `${a}js` || base.startsWith(`${a}-`) && a.length > 3)) out.push(name);
  }
  return out;
}

/**
 * Phrases that are everyday English as much as engineering ("plan a trip",
 * "explain the difference", "review this film"). An intent matched only by
 * these is decisive only when the task has engineering context.
 */
export const GENERIC_PHRASES = new Set([
  "plan", "approach", "approaches", "strategy", "decide", "proposal", "roadmap", "requirements", "milestones",
  "explain", "how does", "how do", "understand", "what does", "where is", "overview", "walk me through", "walkthrough", "tour",
  "review", "feedback", "critique", "audit",
  "research", "compare", "alternatives", "literature",
  "document", "guide", "tutorial",
  "concise", "shorter", "compress",
  "add", "build", "create", "support for",
  "verify", "make sure", "confirm", "check that", "validate",
]);

/** Nouns that place a task in software engineering (stemmed at load). */
const ENGINEERING_NOUNS = new Set(
  ["code", "codebase", "repo", "repository", "function", "method", "class", "module", "service", "endpoint", "api", "component", "app",
    "application", "script", "config", "configuration", "build", "pipeline", "migration", "schema", "query", "feature", "readme", "cli",
    "flag", "flags", "library", "dependency", "package", "server", "client", "backend", "frontend", "worker", "crash", "error", "bug", "test",
    "tests", "deploy", "release", "architecture", "implementation", "merge", "branch", "commit", "lint", "hook", "prompt", "llm", "agent",
    "database", "column", "index", "spec", "ticket", "tickets", "pr", "logging", "logs", "cache", "queue", "middleware", "route", "router",
    "handler", "controller", "variable", "interface", "bundle", "compile", "compiler", "webhook", "repository", "microservice", "sdk"].flatMap((w) => tokenize(w)),
);

/**
 * Software-engineering context: a technology, a known domain, a code
 * identifier (snake_case / camelCase / dotted path), or an engineering noun.
 */
export function hasEngineeringContext(task: string, tokens: readonly string[], technologies: readonly string[], domains: readonly string[]): boolean {
  if (technologies.length || domains.length) return true;
  if (/\b[a-z]+_[a-z0-9_]+\b|\b[a-z]+[A-Z][A-Za-z]+\b|\b\w+\.\w+\(|\/\w+\//.test(task)) return true;
  return tokens.some((t) => ENGINEERING_NOUNS.has(t));
}

export interface WeightedMatch<T extends string> {
  name: T;
  weight: number;
  position: number;
  matched: string[];
}

/** Evaluate phrase rules; one entry per name with its strongest weight and earliest position. */
/** A match right after these words describes context ("since the deploy"), not the task. */
const TEMPORAL = new Set(["since", "after", "before", "last", "yesterday", "previous", "recent", "during"].flatMap((w) => tokenize(w, { keepStopWords: true })));

/**
 * Evaluate phrase rules. Weights above 1 order decisive phrases ahead of
 * plain ones ("sql injection" is security before database) and are capped at
 * 1 in the reported weight; matches preceded by a temporal word are halved.
 */
export function matchRules<T extends string>(tokens: readonly string[], rules: Record<T, Rule[]>): WeightedMatch<T>[] {
  const out: WeightedMatch<T>[] = [];
  // Compound phrases weighted above 1 claim their tokens: "sql injection" is
  // security, so its "sql" does not also count as a database task.
  const claimed = new Map<number, T>();
  for (const name of Object.keys(rules) as T[]) {
    for (const [phrase, base] of rules[name]) {
      if (base <= 1) continue;
      const at = findPhrase(tokens, phrase);
      if (at >= 0) for (let k = 0; k < phraseTokens(phrase).length; k += 1) claimed.set(at + k, name);
    }
  }
  const claimedByOther = (name: T, at: number, len: number): boolean => {
    for (let k = 0; k < len; k += 1) {
      const owner = claimed.get(at + k);
      if (owner !== undefined && owner !== name) return true;
    }
    return false;
  };
  for (const name of Object.keys(rules) as T[]) {
    let weight = 0;
    let position = Infinity;
    const matched: string[] = [];
    for (const [phrase, base] of rules[name]) {
      const at = findPhrase(tokens, phrase);
      if (at < 0 || claimedByOther(name, at, phraseTokens(phrase).length)) continue;
      const w = at > 0 && TEMPORAL.has(tokens[at - 1]!) ? base / 2 : base;
      matched.push(phrase);
      if (w > weight || (w === weight && at < position)) {
        weight = w;
        position = at;
      }
    }
    if (weight > 0) out.push({ name, weight, position, matched });
  }
  out.sort((a, b) => b.weight - a.weight || a.position - b.position || (a.name < b.name ? -1 : 1));
  for (const m of out) m.weight = Math.min(1, m.weight);
  return out;
}

export function matchDomains(tokens: readonly string[]): string[] {
  const out: string[] = [];
  for (const [domain, phrases] of Object.entries(DOMAIN_RULES)) if (phrases.some((p) => findPhrase(tokens, p) >= 0)) out.push(domain);
  return out;
}

/* ── Skill-side inference ─────────────────────────────────────────────── */

const TERSE = /\b(terse|ultra-compressed|compressed (communication|code review|output)|caveman|fewer tokens|cuts? output tokens|one line per finding)\b/i;
const VERBOSE = /\b(verbose|highly detailed (output|explanations?)|exhaustive (detail|explanations?)|long-form explanations?)\b/i;
const MINIMAL = /\b(surgical|minimum[- ]viable diffs?|minimal (change|diff)s?|refuses scope creep|yagni|laziest solution|most minimal|overbuilding risk|strict scope|narrowest responsible layer|without (expanding|widening) (the )?scope|no scope (creep|expansion))\b/i;
const EXPANSIVE = /\b(scope expansion|boil the (lake|ocean)|10-star|dream big|expand(s|ing)? (the )?scope|founder-mode|ceo\/founder-mode)\b/i;
const REPORT_ONLY = /\b(report-only|report only|never (fixes|modif(y|ies)) code|do(es)? not fix)\b/i;
const FIX_FIRST = /\b(and fix (bugs|them)|then fixes them|fix-first|auto-?fix(es)?)\b/i;

/** Style positions from a skill's name + description (never from the body — bodies discuss other styles). */
export function inferStyle(text: string): SkillStyle {
  const style: SkillStyle = {};
  if (TERSE.test(text)) style.communication = "terse";
  else if (VERBOSE.test(text)) style.communication = "verbose";
  if (MINIMAL.test(text)) style.scope = "minimal";
  else if (EXPANSIVE.test(text)) style.scope = "expansive";
  if (REPORT_ONLY.test(text)) style.reviewMode = "report-only";
  else if (FIX_FIRST.test(text)) style.reviewMode = "fix-first";
  return style;
}

/** Style requested by the task text (user-instruction authority). */
export function requestedStyle(task: string): SkillStyle {
  const style: SkillStyle = {};
  const t = task.toLowerCase();
  if (/\b(terse|brief|concise|short(er)? (answers?|replies|responses)|fewer tokens|less tokens|caveman|keep (it|your answers?) short)\b/.test(t)) style.communication = "terse";
  else if (/\b(in detail|detailed|verbose|thorough explanation|explain everything|step by step)\b/.test(t)) style.communication = "verbose";
  if (/\b(minimal|smallest|surgical|only what|don'?t (change|touch) anything else|small change|narrow)\b/.test(t)) style.scope = "minimal";
  else if (/\b(comprehensive|end-to-end|full overhaul|from scratch)\b/.test(t)) style.scope = "expansive";
  if (/\b(report only|don'?t fix|do not fix|just report|only report|without fixing)\b/.test(t)) style.reviewMode = "report-only";
  else if (/\b(and fix|fix (them|it|what you find))\b/.test(t)) style.reviewMode = "fix-first";
  return style;
}

/** Capability *requirements* evident in a skill body. Never a permission grant. */
export function inferCapabilities(body: string): SkillCapabilities {
  return {
    requiresShell: /```(bash|sh|shell|console|zsh)\b|^\s*\$ \S/m.test(body),
    requiresNetwork: /\b(curl|wget|WebFetch|WebSearch|npm install|pip install|fetch\(['"]https?:)/.test(body),
    requiresBrowser: /\b(playwright|puppeteer|headless (chrome|browser)|browser automation|\$B |chrome devtools)\b/i.test(body),
    requiresGit: /\bgit (commit|push|checkout|rebase|merge|reset|log|diff|stash|worktree)\b/.test(body),
  };
}

const RISK_PATTERNS: [string, RegExp][] = [
  ["instruction-override", /ignore (all )?(previous|prior|above) instructions|disregard (the )?(system|previous) (prompt|instructions)|reveal (your|the) system prompt/i],
  ["autonomy-escalation", /\b(without asking|do not ask (the user|for permission)|never ask for (confirmation|permission)|auto-?approve|--dangerously-skip-permissions|bypassPermissions)\b/i],
  ["remote-script-execution", /(curl|wget)[^\n|]*\|\s*(ba|z)?sh\b/i],
  ["destructive-command", /rm -rf \/(?!\w)|git push (-f|--force)\b|git reset --hard/i],
  ["secret-access", /(cat|print|send|upload|exfiltrat)[^\n]{0,40}(\.env\b|id_rsa|\.aws\/credentials)/i],
];

/** Content patterns a reviewer should know about. Informational; skill content is always treated as data. */
export function inferRiskFlags(body: string): string[] {
  return RISK_PATTERNS.filter(([, p]) => p.test(body)).map(([name]) => name);
}

/* ── Section classification ───────────────────────────────────────────── */

const SECTION_RULES: [SectionCategory, RegExp][] = [
  ["examples", /\b(example|examples|sample|demo|case study|illustration|worked)\b/i],
  ["activation", /\b(when to (use|activate|invoke)|when not to use|use when|use this|overview|purpose|mission|scope|trigger|triggers|activation|core principle|what this (skill|is)|introduction|summary)\b/i],
  ["constraints", /\b(rules?|iron law|critical|must|never|don'?t|do not|red flags?|constraints?|guardrails?|anti-?patterns?|pitfalls?|avoid|boundar(y|ies)|rationali[sz]ations?|gotchas?|warnings?|safety|requirements?|non-negotiable|principles?)\b/i],
  ["workflow", /\b(workflow|process|steps?|phases?|procedure|how to|method|methodology|checklist|loop|cycle|red|green|refactor|implementation|approach|playbook|protocol|strategy|stages?|execution|instructions)\b/i],
  ["output", /\b(output|deliverables?|report|format|template|response|success metrics?|handoff|contract|results?)\b/i],
];

export function classifySection(heading: string): SectionCategory {
  for (const [category, pattern] of SECTION_RULES) if (pattern.test(heading)) return category;
  return "background";
}

/** Sentence-level "use when" / "do not use when" extraction from a description. */
export function useConditions(description: string): { useWhen: string[]; doNotUseWhen: string[] } {
  const useWhen: string[] = [];
  const doNotUseWhen: string[] = [];
  for (const raw of description.split(/(?<=[.!?])\s+/)) {
    const s = raw.trim();
    if (!s) continue;
    if (/\b(do not use|don'?t use|not for|not a general|never use|avoid using)\b/i.test(s)) doNotUseWhen.push(s);
    else if (/\b(use (this|when|for|before|after|immediately|proactively)|invoke when|trigger|when (you|the user|building|writing|adding|reviewing|implementing))\b/i.test(s)) useWhen.push(s);
  }
  return { useWhen, doNotUseWhen };
}

const NEGATIVE_CLAUSE = /\b(do not|don'?t|never|not for|not when|avoid|unless|except)\b/i;

/**
 * Quoted phrases and slash commands in a description are explicit triggers —
 * but only in positive clauses: quotes after "DO NOT TRIGGER when…" are
 * anti-triggers. A single quoted word counts only if it is part of the skill's
 * own name (a generic word like "token" is not a trigger).
 */
export function extractTriggers(description: string, name = ""): string[] {
  const out = new Set<string>();
  const nameTokens = new Set(words(name));
  for (const clause of description.split(/(?<=[.!?;])\s+|\s+(?=(?:DO NOT|Do not|Don't|NOT for)\b)/)) {
    if (NEGATIVE_CLAUSE.test(clause)) continue;
    for (const m of clause.matchAll(/(?:^|\s)(\/[a-z][\w:-]*)/gi)) out.add(m[1]!.toLowerCase());
    for (const m of clause.matchAll(/["“]([^"”]{2,40})["”]/g)) {
      const phrase = m[1]!.toLowerCase().trim();
      const t = words(phrase);
      if (t.length > 1 || (t.length === 1 && nameTokens.has(t[0]!))) out.add(phrase);
    }
  }
  return [...out].sort();
}

/** Long forms → the acronym skills are usually named with (and vice versa for search). */
const ACRONYMS: [string, string][] = [
  ["retrieval augmented generation", "rag"],
  ["retrieval-augmented generation", "rag"],
  ["large language model", "llm"],
  ["pull request", "pr"],
  ["continuous integration", "ci"],
  ["end to end", "e2e"],
  ["end-to-end", "e2e"],
  ["test driven development", "tdd"],
  ["test-driven development", "tdd"],
  ["user interface", "ui"],
  ["accessibility", "a11y"],
  ["internationalization", "i18n"],
];

/** Task text plus acronym/long-form equivalents, for metadata search and name matching. */
export function expandAcronyms(text: string): string {
  const lower = text.toLowerCase();
  const extra = ACRONYMS.filter(([long, short]) => lower.includes(long) && !new RegExp(`\\b${short}\\b`).test(lower)).map(([, short]) => short);
  return extra.length ? `${text} ${[...new Set(extra)].join(" ")}` : text;
}
