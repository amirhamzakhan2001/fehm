import type { Finding, Severity } from "../findings/model.js";
import { makeFinding } from "./rules.js";
import type { CoverageReport, DebtReport, FileHistory, FunctionMetrics, Hotspot, Quadrant } from "./types.js";

/**
 * Technical-debt hotspots: where independent risk signals converge on one
 * file. Point scoring follows Skylos' debt model (`skylos debt`: severity
 * weight × dimension weight × magnitude over threshold, plus a breadth bonus
 * per extra dimension). Fehm adds what it knows beyond static rules: change
 * frequency and fix commits from git, and test protection. Every formula is
 * published with the report.
 */

const SEVERITY_WEIGHT: Record<Severity, number> = { critical: 20, high: 12, medium: 7, low: 3, info: 1 };
const DIMENSION_WEIGHT: Record<string, number> = { architecture: 1.25, modularity: 1.15, complexity: 1, maintainability: 0.9, "dead-code": 0.65, testing: 1, reliability: 1, "ai-code": 1 };
const SEVERITY_BONUS: Record<Severity, number> = { critical: 4, high: 3, medium: 2, low: 0.5, info: 0 };

export const DEBT_FORMULA = [
  "signal points = severity weight (critical 20, high 12, medium 7, low 3, info 1) × dimension weight (architecture 1.25, complexity 1, maintainability 0.9, dead code 0.65, others 1) × magnitude",
  "magnitude = 1 + min((value − threshold) / threshold, 2) when a metric exceeds its threshold, else 1",
  "file points = sum of signal points + 2 per dimension beyond the first",
  "priority = file points + strongest-severity bonus + 0.5 per commit in the git window (max 20 commits) + 1 per fix commit (max 10) + 5 if changed in the working tree + 3 if no test protects it",
  "level: high = among the top 5% of files by priority (at most 10) with priority ≥ 40; medium = within the top 25% with priority ≥ 15; otherwise low",
];

function debtDimension(ruleId: string): string | undefined {
  if (/^quality\/(?:cyclomatic|cognitive|deep-nesting|long-function|too-many-params|duplicate-branches)/.test(ruleId)) return "complexity";
  if (ruleId === "maintainability/import-cycle") return "architecture";
  if (ruleId.startsWith("maintainability/")) return "maintainability";
  if (ruleId.startsWith("dead-code/")) return "dead-code";
  if (ruleId === "test/critical-gap" || ruleId === "coverage/low-file-coverage") return "testing";
  if (ruleId.startsWith("reliability/")) return "reliability";
  if (ruleId.startsWith("ai-code/")) return "ai-code";
  return undefined;
}

interface Signal {
  path: string;
  dimension: string;
  severity: Severity;
  points: number;
}

export interface DebtInputs {
  findings: Finding[];
  functions: FunctionMetrics[];
  history: Record<string, FileHistory>;
  gitAvailable: boolean;
  changed: Set<string>;
  coverage: CoverageReport;
  sources: Set<string>;
}

export function analyzeDebt(input: DebtInputs): { report: DebtReport; findings: Finding[] } {
  const signals: Signal[] = [];
  for (const f of input.findings) {
    const dim = debtDimension(f.ruleId);
    if (!dim) continue;
    const magnitude = f.metric && f.metric.value > f.metric.threshold && f.metric.threshold > 0 ? 1 + Math.min((f.metric.value - f.metric.threshold) / f.metric.threshold, 2) : 1;
    const points = Math.round(SEVERITY_WEIGHT[f.severity] * (DIMENSION_WEIGHT[dim] ?? 1) * magnitude * 100) / 100;
    const paths = f.file ? [f.file] : [...new Set(f.evidence.map((e) => e.path).filter((p): p is string => Boolean(p)))];
    for (const path of paths) if (input.sources.has(path)) signals.push({ path, dimension: dim, severity: f.severity, points: f.file ? points : Math.round(SEVERITY_WEIGHT[f.severity] * (DIMENSION_WEIGHT[dim] ?? 1) * 100) / 100 });
  }
  const complexity = new Map<string, { max: number; total: number }>();
  for (const fn of input.functions) {
    const c = complexity.get(fn.path) ?? { max: 0, total: 0 };
    c.max = Math.max(c.max, fn.cyclomatic);
    c.total += fn.cyclomatic - 1;
    complexity.set(fn.path, c);
  }
  const runtime = new Map((input.coverage.runtime?.files ?? []).map((f) => [f.path, f.lines?.pct]));
  const structural = new Map(input.coverage.structural.files.map((f) => [f.path, f.symbols ? Math.round((f.protected / f.symbols) * 100) : undefined]));

  const byFile = new Map<string, Signal[]>();
  for (const s of signals) byFile.set(s.path, [...(byFile.get(s.path) ?? []), s]);
  const hotspots: Hotspot[] = [];
  for (const [path, list] of byFile) {
    const dims: Record<string, number> = {};
    for (const s of list) dims[s.dimension] = Math.round(((dims[s.dimension] ?? 0) + s.points) * 100) / 100;
    const points = Math.round((list.reduce((a, s) => a + s.points, 0) + 2 * Math.max(0, Object.keys(dims).length - 1)) * 100) / 100;
    const strongest = list.reduce<Severity>((a, s) => (SEVERITY_WEIGHT[s.severity] > SEVERITY_WEIGHT[a] ? s.severity : a), "info");
    const h = input.history[path];
    const cov = runtime.get(path) ?? structural.get(path);
    const untested = cov === 0;
    const priority = Math.round((points + SEVERITY_BONUS[strongest] + 0.5 * Math.min(h?.commits ?? 0, 20) + Math.min(h?.fixes ?? 0, 10) + (input.changed.has(path) ? 5 : 0) + (untested ? 3 : 0)) * 100) / 100;
    const c = complexity.get(path);
    const reasons: string[] = [];
    if (c && c.max > 10) reasons.push(`most complex function: cyclomatic ${c.max}`);
    if (h?.commits) reasons.push(`changed in ${h.commits} ${h.commits === 1 ? "commit" : "commits"} in ${input.gitAvailable ? "the last 180 days" : "history"}`);
    if (h?.fixes) reasons.push(`${h.fixes} fix ${h.fixes === 1 ? "commit" : "commits"}`);
    if (cov !== undefined) reasons.push(runtime.has(path) ? `${cov}% line coverage` : `${cov}% of symbols reached by tests`);
    reasons.push(`${list.length} ${list.length === 1 ? "signal" : "signals"} across ${Object.keys(dims).length} ${Object.keys(dims).length === 1 ? "dimension" : "dimensions"}`);
    if (input.changed.has(path)) reasons.push("changed in the working tree");
    hotspots.push({ path, level: "low", priority, points, signals: list.length, dimensions: dims, churn: h?.commits ?? 0, fixes: h?.fixes ?? 0, complexity: c?.max ?? 0, ...(cov !== undefined ? { coverage: cov } : {}), reasons });
  }
  hotspots.sort((a, b) => b.priority - a.priority || b.points - a.points || a.path.localeCompare(b.path));
  // Levels are relative to this codebase (priorities grow with its size), with absolute floors.
  const files = Math.max(1, input.sources.size);
  const highN = Math.min(10, Math.max(1, Math.ceil(files * 0.05)));
  const mediumN = Math.max(highN, Math.ceil(files * 0.25));
  hotspots.forEach((h, i) => (h.level = i < highN && h.priority >= 40 ? "high" : i < mediumN && h.priority >= 15 ? "medium" : "low"));

  // Change × complexity quadrant (needs git history).
  const quadrant: DebtReport["quadrant"] = [];
  let medians = { complexity: 0, churn: 0 };
  if (input.gitAvailable) {
    const rows = [...input.sources].map((path) => ({ path, complexity: complexity.get(path)?.total ?? 0, churn: input.history[path]?.commits ?? 0 })).filter((r) => r.complexity > 0 || r.churn > 0);
    medians = { complexity: median(rows.map((r) => r.complexity)), churn: median(rows.map((r) => r.churn)) };
    for (const r of rows) {
      const hc = r.complexity > medians.complexity;
      const hch = r.churn > medians.churn;
      const q: Quadrant = hc && hch ? "hotspot" : hch ? "maintain" : hc ? "legacy" : "stable";
      quadrant.push({ ...r, quadrant: q });
    }
  }

  const findings = hotspots
    .filter((h) => h.level === "high")
    .slice(0, 10)
    .map((h) =>
      makeFinding("debt/hotspot", {
        id: `debt:hotspot:${h.path}`,
        title: `Debt hotspot: ${h.path}`,
        message: `Priority ${h.priority}: ${h.reasons.join("; ")}.`,
        why: "Where complexity, frequent change, missing tests and quality findings meet, changes are both likely and risky: this is where debt costs the most.",
        action: "Pay down here first: add tests around the most-changed functions, then split the most complex ones.",
        confidence: "strong",
        file: h.path,
        nodeId: `file:${h.path}`,
        metric: { name: "priority", value: h.priority, threshold: 40 },
        evidence: Object.entries(h.dimensions).map(([d, p]) => ({ type: "metric" as const, path: h.path, detail: `${d}: ${p} points` })),
      }),
    );
  return { report: { hotspots: hotspots.slice(0, 100), quadrant, medians, formula: DEBT_FORMULA }, findings };
}

function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}
