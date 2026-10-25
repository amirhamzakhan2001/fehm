/**
 * Feature 2 — Skill Intelligence types. Fehm owns this normalized schema;
 * adapters map upstream formats (catalog manifest, SKILL.md directories,
 * agent definitions) into it.
 */

export const SKILL_SCHEMA_VERSION = "1.0";
/** Bump when derived metadata changes so cached registries are rebuilt. */
export const SKILL_INDEX_VERSION = "4";

/** Progressive disclosure levels 0–4. */
export type SkillLevel = "metadata" | "routing" | "summary" | "sections" | "full";
export const SKILL_LEVELS: readonly SkillLevel[] = ["metadata", "routing", "summary", "sections", "full"];

export type SkillRole = "primary" | "secondary" | "supporting" | "reference";

/**
 * Who authored a metadata field:
 * - upstream: verbatim from the upstream file's own frontmatter
 * - catalog:  assigned by Fehm's curated skills catalog (category, principles, intents, routing.json)
 * - inferred: derived by Fehm heuristics at index time
 */
export type MetadataProvenance = "upstream" | "catalog" | "inferred";

export type TaskIntent =
  | "debug"
  | "implement"
  | "refactor"
  | "test"
  | "review"
  | "explain"
  | "plan"
  | "ship"
  | "git"
  | "security"
  | "performance"
  | "docs"
  | "ui"
  | "research"
  | "database"
  | "devops"
  | "ai"
  | "communicate"
  | "verify";

export type SectionCategory = "activation" | "constraints" | "workflow" | "output" | "examples" | "background";
/** Compression priority: earlier categories survive budget pressure longer. */
export const SECTION_PRIORITY: readonly SectionCategory[] = ["activation", "constraints", "workflow", "output", "examples", "background"];

export interface SkillSource {
  repository: string;
  url?: string;
  /** Git commit/tag, or "unpinned" when the snapshot carried no commit. */
  commit: string;
  path: string;
  /** SHA-256 of the upstream file as recorded when the catalog was built. */
  sha256?: string;
  section?: string;
}

export interface SkillSectionOutline {
  heading: string;
  depth: number;
  category: SectionCategory;
  tokens: number;
}

/** Style positions used for conflict detection. */
export interface SkillStyle {
  communication?: "terse" | "verbose";
  scope?: "minimal" | "expansive";
  reviewMode?: "fix-first" | "report-only";
}

export interface SkillCapabilities {
  requiresShell: boolean;
  requiresNetwork: boolean;
  requiresBrowser: boolean;
  requiresGit: boolean;
}

/** Level-0/1 record: everything routing needs, and no skill body. */
export interface SkillRecord {
  id: string;
  name: string;
  description: string;
  kind: string;
  category: string;
  /** Primary upstream repository name. */
  source: string;
  sourceRepository: string;
  sourceCommit: string;
  sourcePath: string;
  sources: SkillSource[];
  license: string;
  version: string;
  domains: string[];
  tasks: TaskIntent[];
  /** Evidence per task: 1 = catalog/category/name, 0.5 = description wording only. */
  taskEvidence: Partial<Record<TaskIntent, number>>;
  languages: string[];
  frameworks: string[];
  triggers: string[];
  useWhen: string[];
  doNotUseWhen: string[];
  /** Skill ids this skill needs (resolved, self-references removed). */
  dependencies: string[];
  /** Non-skill files the skill references (loaded only on demand). */
  resources: string[];
  /** Explicit conflicts (skill ids). Style conflicts are computed from `style`. */
  conflicts: string[];
  style: SkillStyle;
  /** Cross-cutting principle skills this skill defers to (not dependencies). */
  principles: string[];
  crossCutting: boolean;
  /** Rank (0 = first) in the catalog's curated list for an intent (routing.json). */
  canonicalFor: Partial<Record<TaskIntent, number>>;
  priority: number;
  /** "explicit" skills are selected only when the task names one of their triggers. */
  invocationMode: "auto" | "explicit";
  capabilities: SkillCapabilities;
  /** Content patterns worth a reviewer's attention; informational, never a grant. */
  riskFlags: string[];
  tokens: { metadata: number; summary: number; full: number };
  sections: SkillSectionOutline[];
  /** Bottom-k hashes of the body's distinct stemmed terms (instructional overlap). */
  signature: number[];
  /** Catalog-relative path of the skill file. */
  path: string;
  contentHash: string;
  indexedAt: string;
  metadataProvenance: Record<string, MetadataProvenance>;
}

export interface LoadedSkill {
  id: string;
  level: SkillLevel;
  text: string;
  tokens: number;
  /** Section headings included at the sections/full level. */
  includedSections: string[];
  omittedSections: string[];
}

export interface RepositoryProfile {
  languages: string[];
  packages: string[];
  /** Technologies recognised from languages + packages. */
  technologies: string[];
}

export interface TaskProfile {
  task: string;
  terms: string[];
  /** Ordered strongest-first; the first is the primary intent. */
  intents: TaskIntent[];
  /** 1 = decisive wording, 0.5 = supporting evidence only. */
  intentStrength: Partial<Record<TaskIntent, number>>;
  domains: string[];
  activities: string[];
  technologies: string[];
  /** Style requests found in the task text itself (user-instruction authority). */
  requestedStyle: SkillStyle;
  explicitTriggers: string[];
  specificity: number;
  ambiguous: boolean;
  ambiguityReasons: string[];
  repository?: RepositoryProfile;
}

export interface SkillSignals {
  task: number;
  lexical: number;
  /** Share of the skill's distinctive name words that the task uses. */
  name: number;
  domain: number;
  technology: number;
  repository: number;
  trigger: number;
  canonical: number;
  history: number;
  dependency: number;
  conflictPenalty: number;
  redundancyPenalty: number;
  costPenalty: number;
}

export interface SkillCandidate {
  skillId: string;
  score: number;
  signals: SkillSignals;
  reasons: string[];
  matchedIntents: TaskIntent[];
  mismatches: string[];
}

export interface SelectedSkill {
  skillId: string;
  name: string;
  role: SkillRole;
  score: number;
  reason: string[];
  loadedLevel: SkillLevel;
  estimatedTokens: number;
  source: { repository: string; commit: string; path: string; license: string; contentHash: string };
  metadataProvenance: Record<string, MetadataProvenance>;
  capabilities: SkillCapabilities;
  riskFlags: string[];
  stale?: string;
}

export interface RejectedSkill {
  skillId: string;
  score: number;
  reason: string[];
}

export interface SkillConflict {
  skills: [string, string];
  dimension: keyof SkillStyle | "explicit";
  values: [string, string];
  kept: string;
  dropped: string;
  rule: "user-instruction" | "project-instruction" | "task-requirement" | "skill-priority" | "score";
  reason: string;
}

export interface SkillOverlap {
  skillId: string;
  overlapsWith: string;
  semantic: number;
  instructional: number;
  overlap: number;
  /** True only when the skill bodies are byte-identical (same content hash). */
  identical: boolean;
  uniqueCoverage: string[];
  decision: "dropped" | "kept";
}

export interface SkillDependencyResolution {
  skillId: string;
  requiredBy: string[];
  order: number;
  loadedLevel: SkillLevel | "not-loaded";
  reason: string;
}

export interface SkillRoutingResult {
  schemaVersion: string;
  task: string;
  profile: TaskProfile;
  confidence: number;
  clarification?: string;
  selected: SelectedSkill[];
  rejected: RejectedSkill[];
  conflicts: SkillConflict[];
  redundancy: SkillOverlap[];
  dependencies: SkillDependencyResolution[];
  dependencyIssues: { cycles: string[][]; missing: { skillId: string; dependency: string }[]; truncated: boolean };
  budget: {
    maximumTokens: number;
    usedTokens: number;
    remainingTokens: number;
    dropped: { skillId: string; reason: string }[];
    downgraded: { skillId: string; from: SkillLevel; to: SkillLevel }[];
    estimator: string;
  };
  reranker?: { used: boolean; reason: string; invented?: string[] };
  context: string;
  timings: { profileMs: number; routeMs: number; composeMs: number };
}

export type SkillFeedbackValue = "useful" | "neutral" | "irrelevant" | "conflicting" | "too-verbose" | "missing";

export interface SkillFeedbackEntry {
  task: string;
  terms: string[];
  intents: TaskIntent[];
  skillId: string;
  feedback: SkillFeedbackValue;
  outcome?: "success" | "failure" | "unknown";
  at: string;
}
