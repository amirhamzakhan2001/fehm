/**
 * Feature 3.5 contract, shared with the browser (type-only imports there).
 *
 * Health is a set of explainable dimensions, never one invented number. A
 * dimension shows a number only when it is a measurement with a stated
 * definition (line coverage from an artifact, the share of functions within
 * the complexity limits). Missing data is `unknown`, never zero.
 */

import type { AnalyzerRun, Confidence, Finding, Severity } from "../findings/model.js";
import type { Language } from "../model.js";

export const HEALTH_SCHEMA = "1.1";
/** Bump when findings or metrics change for the same code (invalidates the per-file cache and marks trend points). */
export const HEALTH_VERSION = "2";

export type HealthStatus = "healthy" | "attention" | "degraded" | "critical" | "unknown";

export type DimensionId = "web-delivery" | "build" | "tests" | "coverage" | "quality" | "maintainability" | "dead-code" | "dependencies" | "reliability" | "debt" | "ai-code" | "ci";

export interface DimensionMetric {
  label: string;
  value: number;
  unit: "%" | "count";
  /** Exactly what the number measures. */
  definition: string;
}

export interface HealthDimension {
  id: DimensionId;
  title: string;
  status: HealthStatus;
  metric?: DimensionMetric;
  /** Why the status is what it is, in order of weight. */
  reasons: string[];
  findings: Record<Severity, number>;
}

// ─── code metrics ───────────────────────────────────────────────────

export interface FunctionMetrics {
  name: string;
  kind: "function" | "method" | "anonymous";
  path: string;
  line: number;
  endLine: number;
  nodeId?: string;
  lines: number;
  params: number;
  cyclomatic: number;
  /** Cognitive complexity; only where an AST is available. */
  cognitive?: number;
  nesting: number;
  resolution: "ast" | "heuristic";
}

export interface ClassMetrics {
  name: string;
  path: string;
  line: number;
  nodeId?: string;
  methods: number;
  fields: number;
  lines: number;
}

/** A pattern hit found while walking one file (reliability, AI-code, dead code). */
export interface PatternHit {
  rule: string;
  line: number;
  detail: string;
  symbol?: string;
}

export interface FileAnalysisResult {
  path: string;
  hash: string;
  resolution: "ast" | "heuristic";
  functions: FunctionMetrics[];
  classes: ClassMetrics[];
  hits: PatternHit[];
  /** Test files only. */
  test?: TestFileFacts;
}

// ─── tests ──────────────────────────────────────────────────────────

export type TestCategory = "unit" | "integration" | "e2e" | "component" | "api" | "contract" | "database" | "security" | "performance" | "smoke" | "regression";

export interface TestFileFacts {
  path: string;
  framework?: string;
  cases: number;
  assertions: number;
  skipped: number;
  focused: number;
  /** Test cases with an empty body. */
  empty: number;
  /** Test cases whose body contains no recognised assertion. */
  assertionless: number;
  /** Always-true assertions such as `expect(true).toBe(true)` or `assert True`. */
  tautologies: number;
  mocks: number;
  hooks: boolean;
  /** Tests expecting failure: throws, rejects, error statuses. */
  failurePath: number;
  category: TestCategory;
  /** `path`: a folder or file name says so; `content`: imports or calls suggest it; `default`: nothing did. */
  categoryBasis: "path" | "content" | "default";
  productionFiles: number;
}

export interface TestGap {
  nodeId: string;
  name: string;
  kind: string;
  path: string;
  line?: number;
  risk: number;
  reasons: string[];
  fanIn: number;
  exported: boolean;
  entryReach: number;
  security: boolean;
  changedRecently: boolean;
  cyclomatic?: number;
}

export type Protection = "runtime" | "direct" | "transitive" | "none";

export interface CriticalPathStep {
  nodeId: string;
  name: string;
  path?: string;
  depth: number;
  protection: Protection;
}

export interface CriticalPath {
  id: string;
  kind: "route" | "cli";
  label: string;
  path: string;
  line: number;
  steps: CriticalPathStep[];
  unprotected: number;
}

export interface TestReport {
  files: TestFileFacts[];
  categories: Partial<Record<TestCategory, number>>;
  totals: { files: number; cases: number; assertions: number; skipped: number; focused: number; empty: number; assertionless: number; tautologies: number; mocks: number };
  gaps: TestGap[];
  paths: CriticalPath[];
}

// ─── coverage ───────────────────────────────────────────────────────

export interface Ratio {
  covered: number;
  total: number;
  pct: number;
}

export type CoverageFormat = "istanbul-summary" | "istanbul-final" | "lcov" | "cobertura" | "jacoco" | "go-profile" | "coverage-py-json";

export interface CoverageArtifact {
  path: string;
  format: CoverageFormat;
  modifiedAt: string;
  files: number;
  /** Source files changed after the artifact was written: its numbers may no longer describe them. */
  staleFiles: string[];
}

export interface CoverageFile {
  path: string;
  lines?: Ratio;
  statements?: Ratio;
  functions?: Ratio;
  branches?: Ratio;
}

export interface CoverageReport {
  runtime?: {
    artifacts: CoverageArtifact[];
    totals: { lines?: Ratio; statements?: Ratio; functions?: Ratio; branches?: Ratio };
    files: CoverageFile[];
    /** File records in the artifact that match no indexed file (generated, deleted or outside the index). */
    unmatchedRecords: number;
  };
  /** Symbols a test reaches through the code graph (a relationship, not measured execution). */
  structural: { symbols: number; direct: number; transitive: number; none: number; files: { path: string; symbols: number; protected: number }[] };
  detected: { path: string; format: string; problem: string }[];
}

// ─── quality ────────────────────────────────────────────────────────

export interface QualityReport {
  functions: number;
  classes: number;
  /** Cyclomatic bands: low ≤ 5, medium ≤ threshold, high ≤ 2×threshold, critical above. */
  distribution: { low: number; medium: number; high: number; critical: number };
  withinLimits: number;
  top: FunctionMetrics[];
  files: { path: string; functions: number; maxCyclomatic: number; totalCyclomatic: number; lines: number }[];
}

// ─── dead code ──────────────────────────────────────────────────────

export type DeadCodeState = "definitely-unused" | "likely-unused" | "possibly-unused" | "external-api" | "framework-entrypoint" | "dynamic-reference";

export interface DeadCodeItem {
  id: string;
  kind: string;
  name: string;
  path: string;
  line?: number;
  nodeId?: string;
  state: DeadCodeState;
  /** Checks performed, each passed (✓) or failed (✗) as text. */
  evidence: { check: string; passed: boolean }[];
}

export interface DeadCodeReport {
  counts: Record<DeadCodeState, number>;
  /** Candidates (the three `*-unused` states). */
  items: DeadCodeItem[];
  /** Kept-alive symbols, sampled, so the page can show why they were not reported. */
  kept: DeadCodeItem[];
  unusedFiles: DeadCodeItem[];
  unusedImports: number;
  unreachable: number;
}

// ─── dependencies ───────────────────────────────────────────────────

export type Ecosystem = "npm" | "pypi" | "cargo" | "golang" | "maven";

export interface Component {
  name: string;
  version: string;
  ecosystem: Ecosystem;
  direct: boolean;
  dev: boolean;
  /** SPDX expression as declared, or `NOASSERTION`. Never inferred from the name. */
  license: string;
  licenseSource: "lockfile" | "installed-package" | "none";
  depth?: number;
  purl: string;
  /** Source files importing it (direct dependencies only). */
  importers?: number;
}

export interface Advisory {
  id: string;
  aliases: string[];
  summary: string;
  severity: Severity | "unknown";
  package: string;
  version: string;
  ecosystem: Ecosystem;
}

export interface DependencyReport {
  manifests: { path: string; kind: string; direct: number; dev: number; lockfile?: string }[];
  components: Component[];
  counts: { total: number; direct: number; transitive: number; dev: number; duplicates: number };
  maxDepth?: number;
  licenses: { license: string; count: number; policy: "allowed" | "review" | "denied" | "unknown" }[];
  advisories: { status: "not-checked" | "checked" | "stale" | "error"; checkedAt?: string; source?: string; reason?: string; items: Advisory[] };
  unused: string[];
}

// ─── build and CI ───────────────────────────────────────────────────

export type CheckKind = "build" | "test" | "lint" | "typecheck" | "coverage";

export interface RunResult {
  checkId: string;
  command: string;
  status: "passed" | "failed" | "timeout" | "error";
  exitCode?: number;
  durationMs: number;
  at: string;
  commit?: string;
  /** Index fingerprint when it ran; differs from now → the result may be stale. */
  fingerprint: string;
  output: string;
}

export interface BuildCheck {
  id: string;
  kind: CheckKind;
  label: string;
  /** argv, run without a shell. */
  argv: string[];
  /** Repository-relative working directory ("" for the root). */
  cwd: string;
  display: string;
  source: { path: string; line?: number };
  last?: RunResult & { stale: boolean };
}

export interface BuildReport {
  packageManagers: string[];
  systems: string[];
  checks: BuildCheck[];
  typescript?: { path: string; strict?: boolean; line?: number };
}

export type GateId = "build" | "test" | "lint" | "typecheck" | "coverage" | "security" | "dependency-updates" | "deployment-approval";

export interface CiReport {
  files: string[];
  providers: string[];
  triggers: string[];
  gates: { id: GateId; label: string; present: boolean; evidence?: { path: string; line: number; text: string } }[];
}

// ─── git and debt ───────────────────────────────────────────────────

export interface FileHistory {
  commits: number;
  fixes: number;
  authors: number;
  last?: string;
}

export interface GitReport {
  available: boolean;
  reason?: string;
  commit?: string;
  dirty?: boolean;
  windowDays: number;
  commits: number;
  files: Record<string, FileHistory>;
  /** Working-tree changes against HEAD (for the changed-files scope). */
  changed: string[];
}

export type Quadrant = "hotspot" | "maintain" | "legacy" | "stable";

export interface Hotspot {
  path: string;
  level: "high" | "medium" | "low";
  priority: number;
  points: number;
  signals: number;
  dimensions: Record<string, number>;
  churn: number;
  fixes: number;
  complexity: number;
  coverage?: number;
  reasons: string[];
}

export interface DebtReport {
  hotspots: Hotspot[];
  quadrant: { path: string; complexity: number; churn: number; quadrant: Quadrant }[];
  medians: { complexity: number; churn: number };
  formula: string[];
}

// ─── history ────────────────────────────────────────────────────────

export interface TrendPoint {
  at: string;
  commit?: string;
  dirty?: boolean;
  version: string;
  metrics: Record<string, number>;
}

export interface BaselineDiff {
  createdAt: string;
  commit?: string;
  added: number;
  fixed: { id: string; title: string; severity: Severity }[];
  unchanged: number;
}

// ─── the report ─────────────────────────────────────────────────────

export type CheckSupport = "ast" | "heuristic" | "unsupported";

export interface LanguageSupport {
  language: Language;
  files: number;
  checks: Record<string, CheckSupport>;
}

export interface Provenance {
  fehmVersion: string;
  healthVersion: string;
  commit?: string;
  dirty?: boolean;
  /** SHA-256 over the analysed inputs: file hashes, configuration, coverage artifacts, run results, advisories and versions. */
  digest: string;
  inputs: string[];
  excluded: string[];
  rulesDerivedFrom: string;
}

export interface HealthReport {
  readiness: import('./readiness.js').EngineeringReadiness;
  webDelivery: import('./readiness.js').WebAssessment;
  schemaVersion: string;
  version: string;
  repository: { name: string; root: string };
  generatedAt: string;
  scope: "all" | "changed";
  status: HealthStatus;
  statusReasons: string[];
  dimensions: HealthDimension[];
  findings: Finding[];
  summary: { bySeverity: Record<Severity, number>; byCategory: Record<string, number>; open: number; reviewed: number };
  tests: TestReport;
  coverage: CoverageReport;
  quality: QualityReport;
  deadCode: DeadCodeReport;
  dependencies: DependencyReport;
  build: BuildReport;
  ci: CiReport;
  debt: DebtReport;
  git: Omit<GitReport, "files"> & { tracked: number };
  analyzers: AnalyzerRun[];
  languages: LanguageSupport[];
  provenance: Provenance;
  baseline?: BaselineDiff;
  trend: TrendPoint[];
  config: { file?: string; issues: string[] };
  unknowns: string[];
  freshness: { fresh: boolean; added: number; modified: number; deleted: number };
  durationMs: number;
}

export interface HealthPagePayload extends HealthReport {
  writable: boolean;
}

export interface SourceExcerpt {
  path: string;
  start: number;
  focus: number;
  lines: string[];
}

export type { Confidence };
