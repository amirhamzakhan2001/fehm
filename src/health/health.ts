import { engineeringReadiness } from './readiness.js';
import { analyzeWebDelivery } from './web-delivery.js';
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join, posix } from "node:path";
import { fileURLToPath } from "node:url";
import { BriefingFacts } from "../codebase-briefing/facts.js";
import type { FehmEngine } from "../engine.js";
import { compareFindings, isOpen, SEVERITIES, type AnalyzerRun, type AnalyzerStatus, type Finding, type Severity } from "../findings/model.js";
import { applyReviews, readReviews } from "../findings/review.js";
import type { Language } from "../model.js";
import { advisoryFindings, readAdvisories } from "./advisories.js";
import { attachRuns, buildFindings, detectBuild, indexFingerprint, readRuns } from "./build.js";
import { analyzeCi, ciFindings } from "./ci.js";
import { configHash, ignored, readHealthConfig } from "./config.js";
import { coverageFindings, readCoverage, structuralCoverage } from "./coverage.js";
import { analyzeDeadCode } from "./dead-code.js";
import { analyzeDebt } from "./debt.js";
import { analyzeDependencies } from "./dependencies.js";
import { gitHistory } from "./git.js";
import { applyBaseline, readBaseline, readCache, recordTrend, writeCache } from "./history.js";
import { analyzable, analyzeFile } from "./metrics.js";
import { aiGraphFindings, classFindings, classMetrics, complexityFindings, cycleFindings, hitFindings, qualityReport, signalFindings } from "./quality.js";
import { dimensionOf } from "./rules.js";
import { analyzeTests } from "./tests.js";
import { HEALTH_SCHEMA, HEALTH_VERSION, type CheckSupport, type DependencyReport, type DimensionId, type FileAnalysisResult, type FunctionMetrics, type HealthDimension, type HealthReport, type HealthStatus, type LanguageSupport } from "./types.js";

/**
 * Feature 3.5 — Project health.
 *
 *   FehmEngine (graph, files) ─┬─ per-file analysis (metrics.ts; cached by hash)
 *   3.2 BriefingFacts ─────────┤  tests · coverage artifacts · git history
 *                              ├─ quality · dead code · reliability · AI-code indicators
 *                              ├─ dependencies (lockfiles, licenses, SBOM; advisories opt-in)
 *                              ├─ build checks (run only on request) · CI gates
 *                              └─ technical-debt hotspots (Skylos debt scoring + git + tests)
 *                                          │
 *                  findings (shared model, src/findings) + dimensions → /health
 *
 * Deterministic, local and model-free. The only network access is the
 * advisory check, and only when asked for.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
export const FEHM_VERSION = ((): string => {
  try {
    return (JSON.parse(readFileSync(join(HERE, "..", "..", "package.json"), "utf8")) as { version: string }).version;
  } catch {
    return "unknown";
  }
})();

export const DIMENSIONS: { id: DimensionId; title: string }[] = [
  { id: "build", title: "Build" },
  { id: "tests", title: "Tests" },
  { id: "coverage", title: "Coverage" },
  { id: "quality", title: "Code quality" },
  { id: "maintainability", title: "Maintainability" },
  { id: "dead-code", title: "Dead code" },
  { id: "dependencies", title: "Dependencies" },
  { id: "reliability", title: "Reliability" },
  { id: "debt", title: "Technical debt" },
  { id: "ai-code", title: "Implementation integrity" },
  { id: "web-delivery", title: "Web Delivery & SEO" },
  { id: "ci", title: "CI" },
];

export interface HealthOptions {
  engine: FehmEngine;
  facts?: BriefingFacts;
  /** Where baselines, reviews, runs, advisories, trend and cache live. Omit for a read-only run. */
  stateDirectory?: string;
  /** Read state, never write it (no cache, no trend point). */
  dryRun?: boolean;
  scope?: "all" | "changed";
  /** Fresh advisory results to use instead of the cached ones. */
  advisories?: DependencyReport["advisories"];
  now?: number;
}

export function buildHealthReport(options: HealthOptions): HealthReport {
  const started = performance.now();
  const { engine } = options;
  const facts = options.facts ?? new BriefingFacts(engine);
  const state = options.stateDirectory;
  const writable = Boolean(state) && !options.dryRun;
  const runs: AnalyzerRun[] = [];
  const timed = <T>(id: string, name: string, fn: () => T, status: (r: T) => { status: AnalyzerStatus; reason?: string; findings?: number } = () => ({ status: "complete" })): T => {
    const t0 = performance.now();
    try {
      const r = fn();
      const s = status(r);
      runs.push({ id, name, status: s.status, ...(s.reason ? { reason: s.reason } : {}), findings: s.findings ?? 0, durationMs: Math.round(performance.now() - t0) });
      return r;
    } catch (e) {
      runs.push({ id, name, status: "error", reason: (e as Error).message, findings: 0, durationMs: Math.round(performance.now() - t0) });
      throw e;
    }
  };

  const { config, file: configFile, issues: configIssues } = readHealthConfig(engine.root);
  const skip = ignored(config);
  const hashes = engine.fileHashes();
  const indexed = new Set(hashes.keys());
  const sources = new Set(facts.sourceFiles.filter((p) => !skip(p) && !/\.d\.[cm]?ts$/.test(p)));

  // Per-file analysis, cached by content hash.
  const cache = state ? readCache(state) : new Map<string, FileAnalysisResult>();
  const results = new Map<string, FileAnalysisResult>();
  const fnsByPath = new Map<string, ReturnType<FehmEngine["graph"]["nodes"]>>();
  for (const n of engine.graph.nodes()) if ((n.kind === "function" || n.kind === "method") && n.path) fnsByPath.set(n.path, [...(fnsByPath.get(n.path) ?? []), n]);
  let reused = 0;
  timed(
    "metrics",
    "Code metrics and patterns",
    () => {
      for (const f of facts.files) {
        if ((f.role !== "source" && f.role !== "test") || skip(f.path) || !f.node.language) continue;
        const hash = hashes.get(f.path);
        if (!hash || !analyzable(f.node.language)) continue;
        const hit = cache.get(f.path);
        if (hit && hit.hash === hash) {
          results.set(f.path, hit);
          reused += 1;
          continue;
        }
        const r = analyzeFile({ path: f.path, hash, language: f.node.language, lines: facts.lines(f.path), isTest: f.role === "test", functions: fnsByPath.get(f.path) ?? [] });
        if (r) results.set(f.path, r);
      }
      if (writable) writeCache(state!, results);
    },
    () => {
      const unsupported = [...sources].filter((p) => !results.has(p)).length;
      return unsupported ? { status: "partial", reason: `${unsupported} source files are in languages without metric support; their symbols still take part in graph-based checks.` } : { status: "complete", ...(reused ? { reason: `${reused} files reused from cache` } : {}) };
    },
  );

  // Graph ids for the measured functions.
  const functions: FunctionMetrics[] = [];
  for (const r of results.values()) {
    const nodes = fnsByPath.get(r.path) ?? [];
    for (const fn of r.functions) {
      const short = fn.name.split(".").pop();
      const node = nodes.find((n) => n.location?.line === fn.line && n.name.split(".").pop() === short) ?? (fn.kind !== "anonymous" ? nodes.find((n) => n.location?.line === fn.line) : undefined);
      const copy: FunctionMetrics = { ...fn };
      if (node) copy.nodeId = node.id;
      else delete copy.nodeId;
      functions.push(copy);
    }
  }
  const metricsByNode = new Map(functions.filter((f) => f.nodeId).map((f) => [f.nodeId!, f]));

  const git = timed("git", "Git history", () => gitHistory(engine.root, indexed), (g) => (g.available && !g.reason ? { status: "complete" } : { status: g.available ? "partial" : "unsupported", ...(g.reason ? { reason: g.reason } : {}) }));
  const manifestDirs = facts.manifests.map((m) => posix.dirname(m.path));
  const cov = timed("coverage", "Runtime coverage artifacts", () => readCoverage(engine.root, [...indexed], config.coverage, manifestDirs), (c) => (c.report ? { status: "complete" } : { status: "skipped", reason: "No supported coverage artifact was found; coverage is structural (test relationships) only." }));
  const tests = timed("tests", "Tests and test gaps", () => analyzeTests({ engine, facts, results, runtimeLines: cov.lines, history: git.files, functionMetrics: metricsByNode, thresholds: config.thresholds, skip, ...(options.now ? { now: options.now } : {}) }), (t) => ({ status: "complete", findings: t.findings.length }));
  const structural = structuralCoverage(tests.symbols, tests.protection);

  const findings: Finding[] = [...tests.findings];
  const classes = classMetrics(engine, sources);
  timed("quality", "Quality and maintainability", () => {
    findings.push(...complexityFindings(functions.filter((f) => sources.has(f.path)), config.thresholds), ...classFindings(classes, config.thresholds), ...cycleFindings(facts, skip));
  });
  const signals = timed("signals", "Engineering signals", () => signalFindings(engine, facts, skip), (s) => ({ status: "complete", findings: s.findings.length }));
  findings.push(...signals.findings, ...hitFindings(results, skip));
  findings.push(...timed("ai-code", "Implementation integrity", () => aiGraphFindings(engine, facts, sources, tsPathAliases(engine.root, facts)), (f) => ({ status: "complete", findings: f.length })));
  const dead = timed("dead-code", "Dead code", () => analyzeDeadCode({ engine, facts, results, skip }), (d) => ({ status: "complete", findings: d.findings.length }));
  findings.push(...dead.findings);
  const deps = timed("dependencies", "Dependencies and licenses", () => analyzeDependencies(engine.root, facts, config, signals.unusedDependencies), (d) => ({ status: d.report.manifests.length ? "complete" : "skipped", ...(d.report.manifests.length ? {} : { reason: "No supported manifest found." }), findings: d.findings.length }));
  const advisories = options.advisories ?? (state ? readAdvisories(state, deps.report.components) : undefined);
  if (advisories) deps.report.advisories = advisories;
  runs.push({ id: "advisories", name: "Known vulnerabilities (OSV.dev)", status: deps.report.advisories.status === "checked" ? "complete" : deps.report.advisories.status === "stale" ? "partial" : deps.report.advisories.status === "error" ? "error" : "skipped", reason: deps.report.advisories.reason ?? `Checked ${deps.report.advisories.checkedAt}`, findings: deps.report.advisories.items.length, durationMs: 0 });
  findings.push(...deps.findings, ...advisoryFindings(deps.report.advisories, deps.report.components));

  const fingerprint = indexFingerprint(engine);
  const build = timed("build", "Build checks", () => {
    const b = detectBuild(engine.root, facts);
    if (state) attachRuns(b, readRuns(state), fingerprint);
    return b;
  }, (b) => (b.checks.some((c) => c.last) ? { status: "complete" } : { status: "skipped", reason: b.checks.length ? `${b.checks.length} checks detected; none has been run through Fehm yet.` : "No build, test, lint or type-check command was detected." }));
  findings.push(...buildFindings(build));
  const ci = timed("ci", "CI configuration", () => analyzeCi(engine.root, facts));
  findings.push(...ciFindings(ci, sources.size), ...coverageFindings(cov.report, sources));

  const coverageReport = { ...(cov.report ? { runtime: cov.report } : {}), structural, detected: cov.detected };
  const debt = timed("debt", "Technical debt", () => analyzeDebt({ findings, functions: functions.filter((f) => sources.has(f.path)), history: git.files, gitAvailable: git.available && !git.reason, changed: new Set(git.changed), coverage: coverageReport, sources }), (d) => ({ status: "complete", findings: d.findings.length }));
  findings.push(...debt.findings);

  const web = timed('web-delivery', 'Web Delivery & SEO', () => analyzeWebDelivery(engine, config.readiness.profiles, skip), w => ({ status: 'partial', reason: w.report.limitations.join(' '), findings: w.findings.length }));
  findings.push(...web.findings);

  // Unique ids (two findings can collide when a file has same-named functions).
  const seen = new Map<string, number>();
  for (const f of findings) {
    const n = seen.get(f.id) ?? 0;
    seen.set(f.id, n + 1);
    if (n) f.id = `${f.id}#${n + 1}`;
  }
  const scope = options.scope ?? "all";
  let shown = findings;
  if (scope === "changed") {
    const changed = new Set(git.changed);
    shown = findings.filter((f) => (f.file && changed.has(f.file)) || f.evidence.some((e) => e.path && changed.has(e.path)));
  }
  if (state) applyReviews(shown, readReviews(state));
  const baseline = applyBaseline(shown, state ? readBaseline(state) : undefined);
  shown.sort(compareFindings);

  const quality = qualityReport(functions.filter((f) => sources.has(f.path)), classes.length, config.thresholds);
  const report: Omit<HealthReport, "status" | "statusReasons" | "dimensions" | "provenance" | "trend" | "durationMs" | "summary"> = {
    readiness: engineeringReadiness(shown, build, web.report),
    webDelivery: web.report,
    schemaVersion: HEALTH_SCHEMA,
    version: HEALTH_VERSION,
    repository: { name: facts.name, root: engine.root },
    generatedAt: new Date(options.now ?? Date.now()).toISOString(),
    scope,
    findings: shown,
    tests: tests.report,
    coverage: coverageReport,
    quality,
    deadCode: dead.report,
    dependencies: deps.report,
    build,
    ci,
    debt: debt.report,
    git: { available: git.available, ...(git.reason ? { reason: git.reason } : {}), ...(git.commit ? { commit: git.commit } : {}), ...(git.dirty !== undefined ? { dirty: git.dirty } : {}), windowDays: git.windowDays, commits: git.commits, changed: git.changed, tracked: Object.keys(git.files).length },
    analyzers: runs,
    languages: languageSupport(facts, sources),
    ...(baseline ? { baseline } : {}),
    config: { ...(configFile ? { file: configFile } : {}), issues: configIssues },
    unknowns: [],
    freshness: engine.freshness(),
  };
  const dimensions = DIMENSIONS.map(({ id, title }) => dimension(id, title, report as HealthReport, sources.size));
  const { status, reasons } = overall(dimensions);
  const summary = summarize(shown);
  const provenance = {
    fehmVersion: FEHM_VERSION,
    healthVersion: HEALTH_VERSION,
    ...(git.commit ? { commit: git.commit } : {}),
    ...(git.dirty !== undefined ? { dirty: git.dirty } : {}),
    digest: digest(engine, skip, [configHash(config), ...cov.hashes, ...build.checks.map((c) => (c.last ? `${c.id}@${c.last.at}` : "")), deps.report.advisories.checkedAt ?? "", scope]),
    inputs: [`${indexed.size} indexed files (content hashes)`, configFile ? `${configFile} (${configHash(config)})` : "default configuration", ...(cov.report ? [`coverage artifact ${cov.report.artifacts[0]!.path}`] : []), ...(build.checks.some((c) => c.last) ? ["build check results"] : []), ...(deps.report.advisories.checkedAt ? [`OSV.dev advisories (${deps.report.advisories.checkedAt})`] : []), `health rules v${HEALTH_VERSION}`],
    excluded: ["files the repository scanner ignores (.gitignore, .fehmignore, node_modules, build output)", ...config.ignore.map((g) => `${g} (.fehm/health.json ignore)`)],
    rulesDerivedFrom: "Skylos 4.x rule catalog (Apache-2.0), re-implemented in TypeScript; see THIRD_PARTY_NOTICES.md",
  };
  const trendMetrics = trendPoint(report as HealthReport, summary, structural);
  const trend = writable ? recordTrend(state, { at: report.generatedAt, ...(git.commit ? { commit: git.commit } : {}), ...(git.dirty !== undefined ? { dirty: git.dirty } : {}), version: HEALTH_VERSION, metrics: trendMetrics, digest: provenance.digest }) : [{ at: report.generatedAt, version: HEALTH_VERSION, metrics: trendMetrics }];

  const full: HealthReport = { ...(report as HealthReport), status, statusReasons: reasons, dimensions, summary, provenance, trend, durationMs: Math.round(performance.now() - started) };
  full.unknowns = unknowns(full, sources.size);
  return full;
}

function summarize(findings: Finding[]): HealthReport["summary"] {
  const bySeverity = Object.fromEntries(SEVERITIES.map((s) => [s, 0])) as Record<Severity, number>;
  const byCategory: Record<string, number> = {};
  let open = 0;
  let reviewed = 0;
  for (const f of findings) {
    if (f.review && f.review.status !== "reviewed") continue;
    bySeverity[f.severity] += 1;
    byCategory[f.category] = (byCategory[f.category] ?? 0) + 1;
    if (isOpen(f)) open += 1;
    if (f.review?.status === "reviewed") reviewed += 1;
  }
  return { bySeverity, byCategory, open, reviewed };
}

// ─── dimensions ─────────────────────────────────────────────────────

const RANK: Record<HealthStatus, number> = { critical: 4, degraded: 3, attention: 2, healthy: 1, unknown: 0 };

function bySeverity(findings: Finding[]): Record<Severity, number> {
  const out = Object.fromEntries(SEVERITIES.map((s) => [s, 0])) as Record<Severity, number>;
  for (const f of findings) out[f.severity] += 1;
  return out;
}

/** Status from the findings alone: critical if any critical; degraded if any high or ≥ 10 medium; attention if any medium or ≥ 5 low. */
function fromFindings(c: Record<Severity, number>): HealthStatus {
  if (c.critical) return "critical";
  if (c.high || c.medium >= 10) return "degraded";
  if (c.medium || c.low >= 5) return "attention";
  return "healthy";
}

const worse = (a: HealthStatus, b: HealthStatus): HealthStatus => (RANK[a] >= RANK[b] ? a : b);
const pct = (a: number, b: number): number => (b ? Math.round((a / b) * 1000) / 10 : 0);

function dimension(id: DimensionId, title: string, r: HealthReport, sourceFiles: number): HealthDimension {
  const mine = r.findings.filter((f) => isOpen(f) && dimensionOf(f) === id);
  const findings = bySeverity(mine);
  const reasons: string[] = [];
  const top = [...mine].sort(compareFindings).slice(0, 3).map((f) => f.title);
  let status = fromFindings(findings);
  let metric: HealthDimension["metric"];
  switch (id) {
    case "web-delivery": {
      return { id, title, status: mine.length ? status : 'unknown', findings, reasons: [...top, `${r.webDelivery.documents} static HTML documents checked; browser behavior remains unverified.`] };
    }
    case "build": {
      const run = r.build.checks.filter((c) => c.last);
      if (!r.build.checks.length) return { id, title, status: "unknown", reasons: ["No build, test, lint or type-check command was detected."], findings };
      if (!run.length) return { id, title, status: "unknown", reasons: [`${r.build.checks.length} checks detected; none has been run through Fehm. Run them (fehm health --run all, or the Build section) to know.`, ...top], findings };
      const passed = run.filter((c) => c.last!.status === "passed" && !c.last!.stale).length;
      metric = { label: "checks passing", value: pct(passed, run.length), unit: "%", definition: `Detected checks whose last run through Fehm passed on the current code (${passed} of ${run.length} run; ${r.build.checks.length - run.length} never run).` };
      if (run.some((c) => c.last!.stale)) {
        status = worse(status, "attention");
        reasons.push("Some results are from before the latest file changes.");
      }
      break;
    }
    case "tests": {
      const s = r.coverage.structural;
      metric = { label: "symbols with a test relationship", value: pct(s.direct + s.transitive, s.symbols), unit: "%", definition: `Functions, methods and classes that a test reaches (${r.coverage.runtime ? "runtime coverage where the artifact has line data, otherwise " : ""}calls and references from test code, up to 4 calls deep). A relationship, not proof that behaviour is checked.` };
      if (!r.tests.files.length && sourceFiles) status = "critical";
      reasons.push(`${r.tests.totals.cases} test cases in ${r.tests.totals.files} files; ${r.tests.gaps.length} risky symbols without protection.`);
      break;
    }
    case "coverage": {
      const rt = r.coverage.runtime;
      if (!rt) return { id, title, status: "unknown", reasons: ["No supported runtime coverage artifact (LCOV, Istanbul, Cobertura, JaCoCo, Go, coverage.py JSON). Structural test relationships are under Tests; they are not coverage."], findings };
      const lines = rt.totals.lines ?? rt.totals.statements;
      if (lines) {
        metric = { label: rt.totals.lines ? "line coverage" : "statement coverage", value: lines.pct, unit: "%", definition: `${lines.covered} of ${lines.total} ${rt.totals.lines ? "lines" : "statements"} executed, from ${rt.artifacts[0]!.path} (${rt.artifacts[0]!.format}, ${rt.artifacts[0]!.modifiedAt}).` };
        status = worse(status, lines.pct >= 80 ? "healthy" : lines.pct >= 60 ? "attention" : lines.pct >= 40 ? "degraded" : "critical");
      }
      if (rt.artifacts[0]!.staleFiles.length) {
        status = worse(status, "attention");
        reasons.push(`${rt.artifacts[0]!.staleFiles.length} files changed after the artifact was written.`);
      }
      break;
    }
    case "quality": {
      const q = r.quality;
      if (!q.functions) return { id, title, status: "unknown", reasons: ["No functions in a language with metric support."], findings };
      metric = { label: "functions within limits", value: pct(q.withinLimits, q.functions), unit: "%", definition: "Functions within every threshold: cyclomatic and cognitive complexity, nesting, length and parameters (defaults from Skylos, configurable in .fehm/health.json)." };
      status = worse(status, metric.value >= 85 ? "healthy" : metric.value >= 70 ? "attention" : "degraded");
      break;
    }
    case "dead-code": {
      const c = r.deadCode.counts["definitely-unused"] + r.deadCode.counts["likely-unused"];
      metric = { label: "unused-symbol candidates", value: c, unit: "count", definition: "Symbols judged definitely or likely unused after every keep-alive check failed. Possibly-unused names are not counted." };
      status = c === 0 && !r.deadCode.unusedFiles.length ? worse(status, "healthy") : worse(status, c > 50 ? "degraded" : "attention");
      break;
    }
    case "dependencies": {
      const d = r.dependencies;
      if (!d.manifests.length) return { id, title, status: "unknown", reasons: ["No supported manifest (package.json, pyproject/requirements, go.mod, Cargo.toml, pom.xml, build.gradle)."], findings };
      metric = { label: "components", value: d.counts.total, unit: "count", definition: `${d.counts.direct} direct and ${d.counts.transitive} transitive packages from manifests and lockfiles.` };
      if (d.advisories.status !== "checked") reasons.push(d.advisories.status === "stale" ? "Vulnerability results are from an older dependency set." : "Known vulnerabilities not checked (opt-in network lookup).");
      break;
    }
    case "debt": {
      const high = r.debt.hotspots.filter((h) => h.level === "high").length;
      metric = { label: "high-priority hotspots", value: high, unit: "count", definition: "Files where quality, test, dead-code and change-history signals converge with priority ≥ 40 (formula in the Technical debt section)." };
      status = worse(status, high === 0 ? "healthy" : high <= 3 ? "attention" : "degraded");
      break;
    }
    case "ci":
      if (!sourceFiles) return { id, title, status: "unknown", reasons: ["No source files."], findings };
      metric = { label: "gates detected", value: r.ci.gates.filter((g) => g.present).length, unit: "count", definition: `Of ${r.ci.gates.length} gates (build, tests, lint, type check, coverage, security, dependency updates, deployment approval) found in CI configuration.` };
      break;
    default:
      break;
  }
  reasons.push(...top);
  if (!mine.length && !reasons.length) reasons.push("No findings.");
  return { id, title, status, ...(metric ? { metric } : {}), reasons, findings };
}

function overall(dims: HealthDimension[]): { status: HealthStatus; reasons: string[] } {
  const known = dims.filter((d) => d.status !== "unknown");
  if (!known.length) return { status: "unknown", reasons: ["Nothing could be measured."] };
  const worst = known.reduce((a, d) => worse(a, d.status), "healthy" as HealthStatus);
  const reasons = known.filter((d) => d.status === worst && worst !== "healthy").map((d) => `${d.title}: ${d.reasons[0] ?? d.status}`);
  const unknown = dims.filter((d) => d.status === "unknown").map((d) => d.title);
  if (unknown.length) reasons.push(`Not measured: ${unknown.join(", ")}.`);
  return { status: worst, reasons: reasons.length ? reasons : ["Every measured dimension is healthy."] };
}

function trendPoint(r: HealthReport, s: HealthReport["summary"], structural: HealthReport["coverage"]["structural"]): Record<string, number> {
  const m: Record<string, number> = {
    findings: s.open,
    critical: s.bySeverity.critical,
    high: s.bySeverity.high,
    testCases: r.tests.totals.cases,
    testRelationship: pct(structural.direct + structural.transitive, structural.symbols),
    complexFunctions: r.quality.distribution.high + r.quality.distribution.critical,
    deadCode: r.deadCode.counts["definitely-unused"] + r.deadCode.counts["likely-unused"],
    hotspots: r.debt.hotspots.filter((h) => h.level === "high").length,
    dependencies: r.dependencies.counts.total,
  };
  const lines = r.coverage.runtime?.totals.lines;
  if (lines) m.coverage = lines.pct;
  if (r.dependencies.advisories.status === "checked") m.vulnerabilities = r.dependencies.advisories.items.length;
  return m;
}

function digest(engine: FehmEngine, skip: (p: string) => boolean, extra: string[]): string {
  const h = createHash("sha256");
  for (const [p, x] of [...engine.fileHashes()].filter(([p]) => !skip(p)).sort((a, b) => (a[0] < b[0] ? -1 : 1))) h.update(`${p}\0${x}\n`);
  h.update(`health:${HEALTH_VERSION}\n`);
  for (const e of extra) h.update(`${e}\n`);
  return h.digest("hex");
}

// ─── analysis coverage ──────────────────────────────────────────────

const CHECKS = ["complexity", "cognitive", "nesting", "unused imports", "unreachable code", "reliability", "test facts", "dead code", "runtime coverage"] as const;

function support(language: Language, check: (typeof CHECKS)[number]): CheckSupport {
  const ts = language === "typescript" || language === "javascript";
  switch (check) {
    case "complexity":
    case "nesting":
    case "test facts":
      return ts ? "ast" : ["python", "go", "java", "rust"].includes(language) ? "heuristic" : "unsupported";
    case "cognitive":
    case "unreachable code":
      return ts ? "ast" : "unsupported";
    case "unused imports":
      return ts ? "ast" : language === "python" ? "heuristic" : "unsupported";
    case "reliability":
      return ts ? "ast" : ["python", "go", "java"].includes(language) ? "heuristic" : "unsupported";
    case "dead code":
      return ts ? "ast" : "heuristic";
    case "runtime coverage":
      return ["typescript", "javascript", "python", "go", "java"].includes(language) ? "heuristic" : "unsupported";
  }
}

function languageSupport(facts: BriefingFacts, sources: Set<string>): LanguageSupport[] {
  const counts = new Map<Language, number>();
  for (const f of facts.files) if (sources.has(f.path) && f.node.language) counts.set(f.node.language, (counts.get(f.node.language) ?? 0) + 1);
  return [...counts]
    .filter(([l]) => !["json", "yaml", "toml", "markdown", "other"].includes(l))
    .sort((a, b) => b[1] - a[1])
    .map(([language, files]) => ({ language, files, checks: Object.fromEntries(CHECKS.map((c) => [c, support(language, c)])) }));
}

function unknowns(r: HealthReport, sourceFiles: number): string[] {
  const out: string[] = [];
  if (!r.coverage.runtime) out.push("Runtime coverage: no artifact found, so no line, branch or function coverage is reported. Test protection uses code-graph relationships, which show that a test calls something, not that its behaviour is checked.");
  if (r.dependencies.advisories.status !== "checked") out.push("Known vulnerabilities: not checked. The advisory lookup (OSV.dev) uses the network and runs only when asked for.");
  if (!r.build.checks.some((c) => c.last)) out.push("Build status: Fehm does not run repository commands on its own. Detected checks show as not run until you run them.");
  if (!r.git.available || r.git.reason) out.push(`Change history: ${r.git.reason ?? "unavailable"}`);
  if (r.languages.some((l) => Object.values(l.checks).includes("heuristic"))) out.push("Some languages are analysed from source lines rather than a syntax tree (marked heuristic under Analysis coverage). Their metrics are estimates.");
  out.push("Dead code: reflection, dependency injection, plugin loading and calls from outside the repository are invisible to static analysis. Candidates are for review, not automatic deletion.");
  out.push("AI-code indicators are defect patterns common in generated code. They say nothing about who or what wrote the code.");
  if (!sourceFiles) out.push("No source files were indexed.");
  return out;
}

function tsPathAliases(root: string, facts: BriefingFacts): string[] {
  const out: string[] = [];
  for (const c of facts.configOf("typescript")) {
    try {
      const text = readFileSync(join(root, c.path), "utf8").replace(/\/\*[\s\S]*?\*\/|^\s*\/\/.*$/gm, "");
      const paths = /"paths"\s*:\s*\{([^}]*)\}/.exec(text)?.[1] ?? "";
      for (const m of paths.matchAll(/"([^"]+)"\s*:/g)) out.push(m[1]!.replace(/\/\*$/, "*").replace(/\*$/, "*"));
    } catch {
      /* unreadable config: no aliases */
    }
  }
  return out;
}

// ─── text output ────────────────────────────────────────────────────

const ICON: Record<HealthStatus, string> = { healthy: "✓", attention: "!", degraded: "▲", critical: "✗", unknown: "?" };

export function renderHealthText(r: HealthReport, options: { all?: boolean } = {}): string {
  const out: string[] = [];
  out.push(`Project health — ${r.repository.name}${r.scope === "changed" ? " (changed files only)" : ""}`);
  out.push(`Overall: ${ICON[r.status]} ${r.status.toUpperCase()}`);
  for (const reason of r.statusReasons) out.push(`  ${reason}`);
  out.push("");
  out.push(`Engineering readiness: ${r.readiness.status} — ${r.readiness.summary}`, 'Authorship: unknown (no AI-use or developer-expertise classification).');
  for (const d of r.dimensions) {
    const m = d.metric ? `${d.metric.unit === "%" ? `${d.metric.value}%` : d.metric.value} ${d.metric.label}` : "";
    out.push(`  ${ICON[d.status]} ${d.title.padEnd(20)} ${d.status.padEnd(10)} ${m}`);
  }
  out.push("");
  const s = r.summary.bySeverity;
  out.push(`Findings: ${s.critical} critical · ${s.high} high · ${s.medium} medium · ${s.low} low · ${s.info} info${r.baseline ? ` · ${r.baseline.added} new since baseline, ${r.baseline.fixed.length} fixed` : ""}`);
  const shown = r.findings.filter((f) => isOpen(f) && (options.all || f.severity === "critical" || f.severity === "high" || f.severity === "medium"));
  for (const f of shown.slice(0, options.all ? shown.length : 40)) {
    out.push(`  [${f.severity}] ${f.title}${f.baseline === "new" ? "  (new)" : ""}`);
    const loc = f.file ? `${f.file}${f.line ? `:${f.line}` : ""}` : f.evidence[0]?.path ? `${f.evidence[0].path}${f.evidence[0].line ? `:${f.evidence[0].line}` : ""}` : "";
    if (loc) out.push(`      ${loc}`);
  }
  if (!options.all && shown.length > 40) out.push(`  … ${shown.length - 40} more (--all)`);
  if (r.debt.hotspots.length) {
    out.push("");
    out.push("Hotspots:");
    for (const h of r.debt.hotspots.slice(0, 5)) out.push(`  ${h.level.padEnd(6)} ${h.path}  (${h.reasons.slice(0, 2).join("; ")})`);
  }
  out.push("");
  out.push("Not determined:");
  for (const u of r.unknowns) out.push(`  ? ${u}`);
  out.push("");
  out.push(`digest ${r.provenance.digest.slice(0, 16)} · ${r.durationMs} ms · no model calls`);
  return out.join("\n");
}
