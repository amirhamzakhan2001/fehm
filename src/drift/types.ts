/**
 * Feature 3.4 contract, shared with the browser (type-only imports there).
 *
 * Architecture drift in Fehm is not "expected vs actual architecture". It is
 * where the code deviates from a *contextual baseline*:
 *
 *   explicit project rules → approved project patterns → patterns mined from
 *   the project itself → framework conventions → industry practice → heuristics
 *
 * Every finding says what was observed, what it differs from, why that was
 * detected, the exact evidence, how confident Fehm is, what attention it may
 * deserve, when it appeared (with git), and a possible direction. The
 * developer decides. Nothing here says code is "wrong".
 */

import type { ArchNodeType, DiagramLayout, DriftMark } from "../architecture/types.js";

export const DRIFT_SCHEMA = "2.0";
/** Bump when findings change for the same code (invalidates cached history points). */
export const DRIFT_VERSION = "3";
export const CONTRACT_VERSION = 1;

// ─── vocabulary ─────────────────────────────────────────────────────

export type DriftCategory =
  | "file-placement"
  | "responsibility"
  | "dependency"
  | "layer"
  | "cycle"
  | "pattern"
  | "naming"
  | "granularity"
  | "module-boundary"
  | "configuration"
  | "testing"
  | "api"
  | "database"
  | "external-service"
  | "abstraction"
  | "dependency-injection"
  | "error-handling"
  | "observability"
  | "security-boundary"
  | "framework"
  | "monorepo"
  | "historical"
  | "ai-associated";

/** The architectural dimensions findings are grouped into (spec §6). */
export type DriftGroup = "structure" | "dependencies" | "responsibilities" | "patterns" | "runtime" | "engineering" | "historical" | "ai";

/** Where the baseline a finding is measured against comes from. */
export type BaselineSource = "project" | "framework" | "industry" | "historical" | "heuristic";

/** Finer than the source: which rung of the priority ladder decided. */
export type Basis = "explicit-rule" | "approved-pattern" | "project-pattern" | "framework" | "industry" | "heuristic";

export type Confidence = "high" | "medium" | "low";
export type Attention = "informational" | "low" | "moderate" | "high" | "critical";

/**
 * new       — appeared after the comparison point (baseline, or within the analysed git window);
 * existing  — already present at the comparison point;
 * resolved  — present at the comparison point, gone now;
 * undated   — no baseline and git history not analysed yet (or unavailable).
 */
export type FindingStatus = "new" | "existing" | "resolved" | "undated";

export type DecisionKind = "intentional" | "accepted" | "dismissed";

// ─── project context ────────────────────────────────────────────────

export type ProjectType =
  | "web-application"
  | "backend-service"
  | "microservice"
  | "cli"
  | "library"
  | "ml-project"
  | "data-pipeline"
  | "research"
  | "mobile"
  | "game"
  | "infrastructure"
  | "monorepo";

export interface ContextItem {
  id: string;
  label: string;
  /** Why Fehm believes it: file paths, packages, signals. */
  evidence: string[];
}

export interface ProjectContext {
  languages: { name: string; files: number; share: number }[];
  frameworks: (ContextItem & { kind: "backend" | "frontend" | "fullstack" | "ml" | "data" | "cli" | "mobile" | "other" })[];
  projectTypes: (ContextItem & { type: ProjectType; score: number })[];
  /** The strongest project type; decides which industry practices apply. */
  primaryType: ProjectType;
  architectureSignals: ContextItem[];
  scale: { files: number; sourceFiles: number; lines: number; label: "small" | "medium" | "large" };
  /** Workspace packages, when the repository is a monorepo. */
  workspaces: { name: string; path: string; kind: "app" | "package" | "service" | "other" }[];
  /** What the context detector could not decide. */
  unknowns: string[];
}

// ─── baselines ──────────────────────────────────────────────────────

/** A framework convention or an industry practice, from Fehm's catalog. */
export interface Practice {
  id: string;
  source: "framework" | "industry";
  /** For framework conventions: the framework it belongs to. */
  framework?: string;
  title: string;
  /** "Commonly observed practice", never "required". */
  statement: string;
  category: DriftCategory;
  /** The project pattern kind that measures it (see ProjectPattern.kind). */
  measuredBy?: string;
}

export interface PatternShare {
  label: string;
  count: number;
  share: number;
}

/** A pattern mined from the project's own code (spec §34). */
export interface ProjectPattern {
  id: string;
  /** Detector family, e.g. `dependency`, `naming`, `location`, `size`, `di`, `logging`, `tests`. */
  kind: string;
  name: string;
  category: DriftCategory;
  /** "Controllers delegate to services" */
  statement: string;
  /** The comparable units, e.g. "controllers". */
  unitLabel: string;
  comparable: number;
  matching: number;
  /** matching / comparable. */
  frequency: number;
  distribution: PatternShare[];
  dominant: string;
  /** Up to a few units that follow it. */
  examples: Evidence[];
  /** Units that deviate (paths). */
  outliers: string[];
  confidence: Confidence;
  /** Developer decision; a rejected or ignored pattern produces no findings. */
  decision?: "approved" | "rejected" | "ignored";
  /** Strong enough to report deviations. */
  established: boolean;
}

export interface BaselineSummary {
  project: { patterns: number; established: number; approved: number };
  framework: { conventions: number; frameworks: string[] };
  industry: { practices: number; projectType: ProjectType };
  explicit: { rules: number; file?: string; rejected?: { file: string; issues: ContractIssue[] } };
}

/** "Industry vs project" comparison row (spec §49). */
export interface PracticeComparison {
  practice: string;
  category: DriftCategory;
  industry: boolean;
  framework?: string;
  project?: { share: number; comparable: number; pattern: string };
  deviations: number;
}

// ─── findings ───────────────────────────────────────────────────────

export interface Evidence {
  path: string;
  line?: number;
  /** Feature 1 graph node (3.1 link, source excerpt). */
  nodeId?: string;
  detail?: string;
}

/** One baseline line behind a finding: why it was generated, strongest first. */
export interface BasisLine {
  source: BaselineSource;
  basis: Basis;
  text: string;
}

export interface UnitRef {
  path: string;
  role: string;
  module: string;
  /** 3.3 component id. */
  component?: string;
}

export interface GitChange {
  commit: string;
  short: string;
  subject: string;
  date: string;
  /** For dependency findings: the unit's dependencies before and after. */
  before?: string[];
  after?: string[];
}

export interface Decision {
  kind: DecisionKind;
  reason: string;
  by: string;
  at: string;
  /** What the decision covers (a unit path, or the whole finding). */
  scope: string;
}

export interface DriftFinding {
  /** Stable across runs: history and decisions refer to it. */
  id: string;
  category: DriftCategory;
  group: DriftGroup;
  title: string;
  source: BaselineSource;
  basis: Basis;
  confidence: Confidence;
  attention: Attention;
  /** What the code does. */
  observed: string;
  /** What is common or established (never "correct"). */
  baseline: string;
  /** Why Fehm detected it. */
  explanation: string;
  /** What could happen if the pattern spreads. */
  impact: string;
  /** Suggested restructuring; the developer decides. */
  suggestion?: { text: string; chain?: string[] };
  /** Expected-vs-observed chains for the side-by-side view. */
  commonChain?: string[];
  observedChain?: string[];
  unit?: UnitRef;
  /** A file path, a store (`store:database`) or an external system id. */
  target?: string;
  /** The mined pattern it deviates from. */
  pattern?: string;
  stats?: { comparable: number; matching: number; frequency: number; unitLabel: string };
  bases: BasisLine[];
  evidence: Evidence[];
  more: number;
  /** Other signals about the same deviation, folded into this one (spec §72). */
  related: { category: DriftCategory; title: string; basis: Basis }[];
  /** Where to emphasise it on the drift map (3.3 ids). */
  map: { nodes: string[]; edges: string[]; modules: string[]; moduleEdges: string[] };
  status: FindingStatus;
  introduced?: GitChange;
  decision?: Decision;
}

export interface DriftCluster {
  id: string;
  label: string;
  kind: "group" | "module";
  findings: string[];
  categories: DriftCategory[];
}

// ─── explicit project rules (optional contract) ─────────────────────

export type LayerRole = "interface" | "application" | "domain" | "data" | "infrastructure" | "shared" | "other";
export type Severity = "high" | "medium" | "low";

export interface ContractLayer {
  id: string;
  name: string;
  description?: string;
  role?: LayerRole;
  /** Repository-relative globs; a file belongs to the first matching layer. */
  paths: string[];
  evidence?: string[];
}

/** `from` + `allow`/`forbid`, or `to` + `onlyFrom` (only these layers may use the target). */
export interface ContractRule {
  id: string;
  from?: string;
  allow?: string[];
  forbid?: string[];
  to?: string;
  onlyFrom?: string[];
  reason?: string;
  severity?: Severity;
}

export interface StructurePolicy {
  path: string;
  allow: string[];
  reason?: string;
}

export interface ArchitectureContract {
  version: number;
  status: "approved" | "proposed";
  style: "layered" | "hexagonal" | "onion" | "modular" | "custom";
  description?: string;
  layers: ContractLayer[];
  layering: "relaxed" | "strict" | "none";
  rules: ContractRule[];
  cycles: "forbid" | "review" | "allow";
  allowUnassigned: boolean;
  structure: StructurePolicy[];
  coupling: { maxDependencies: number };
  ignore: string[];
  generatedAt?: string;
  approvedAt?: string;
}

export interface ContractIssue {
  path: string;
  message: string;
}

export interface RuleResult {
  id: string;
  text: string;
  status: "met" | "deviation" | "unverified";
  deviations: number;
}

// ─── history ────────────────────────────────────────────────────────

export interface HistoryPoint {
  /** `working-tree` or a commit hash. */
  ref: string;
  short: string;
  subject: string;
  date?: string;
  total: number;
  byAttention: Record<Attention, number>;
  findings: { id: string; title: string; category: DriftCategory; attention: Attention }[];
  /** Unit → dependencies (file paths, store/external ids), for before/after. */
  deps: Record<string, string[]>;
  /** Source files at this point (sudden-structural-change signal). */
  files: number;
  error?: string;
}

export interface HistoryChange {
  ref: string;
  short: string;
  subject: string;
  date?: string;
  added: { id: string; title: string }[];
  resolved: { id: string; title: string }[];
  total: number;
  files: number;
}

export interface DriftHistory {
  git: boolean;
  reason?: string;
  commits: { ref: string; short: string; subject: string; date: string }[];
  /** Filled once the window is analysed: oldest → newest. */
  changes?: HistoryChange[];
  /** What "new" is measured against. */
  comparison?: { kind: "baseline" | "window"; label: string };
  baseline?: { createdAt: string; commit?: string; findings: number };
  /** Window commits already analysed (cached). */
  analysed: number;
  /** Findings present at the comparison point and gone now. */
  resolved: { id: string; title: string }[];
}

export interface DriftBaseline {
  version: string;
  createdAt: string;
  commit?: string;
  findings: { id: string; title: string; category: DriftCategory }[];
}

// ─── report and page ────────────────────────────────────────────────

export interface DriftSummary {
  findings: number;
  new: number;
  highAttention: number;
  patterns: number;
  categories: number;
  byGroup: Record<DriftGroup, number>;
  byConfidence: Record<Confidence, number>;
  byAttention: Record<Attention, number>;
  decided: number;
}

export interface DriftReport {
  areas?: import('./scope.js').ArchitectureArea[];
  schemaVersion: string;
  version: string;
  repository: { name: string; root: string };
  fingerprint: string;
  generatedAt: string;
  context: ProjectContext;
  baseline: BaselineSummary;
  patterns: ProjectPattern[];
  practices: Practice[];
  comparison: PracticeComparison[];
  rules: RuleResult[];
  findings: DriftFinding[];
  /** Findings with a developer decision (intentional / accepted / dismissed), kept apart. */
  decided: DriftFinding[];
  clusters: DriftCluster[];
  summary: DriftSummary;
  /** Unit → dependencies now (history before/after). */
  deps: Record<string, string[]>;
  unknowns: string[];
  freshness: { fresh: boolean; added: number; modified: number; deleted: number };
  durationMs: number;
}

export interface MapView {
  level: "components" | "modules";
  title: string;
  /** Null when 3.3 has no verified layout for this level. */
  layout: DiagramLayout | null;
  nodes: { id: string; name: string; type: ArchNodeType; confidence: "verified" | "strong" | "inferred" | "unknown"; files: string[] }[];
  /** Edge id → drift mark; node id → finding ids. */
  marks: { edges: Record<string, DriftMark>; nodes: Record<string, string[]> };
  note?: string;
}

export interface DriftPagePayload extends Omit<DriftReport, "deps"> {
  map: { components: MapView; modules: MapView };
  history: DriftHistory;
  writable: boolean;
}

export interface SourceExcerpt {
  path: string;
  start: number;
  focus: number;
  lines: string[];
}

export interface CommitDetail {
  diffTruncated?: boolean;
  ref: string;
  short: string;
  subject: string;
  author: string;
  date: string;
  files: { path: string; added: number; removed: number }[];
  /** Diff of one file, when asked for (capped). */
  diff?: string[];
}
