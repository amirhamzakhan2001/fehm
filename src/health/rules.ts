import type { Confidence, Finding, FindingCategory, FindingEvidence, Severity } from "../findings/model.js";
import type { DimensionId } from "./types.js";

/**
 * Feature 3.5's rule catalog. Each rule names the dimension it counts toward
 * and, when it was adapted from Skylos (Apache-2.0, see
 * THIRD_PARTY_NOTICES.md), the Skylos rule id it corresponds to. The Skylos
 * checks were re-implemented in TypeScript over Fehm's code graph; no Python
 * runs.
 */

export interface RuleEntry {
  id: string;
  title: string;
  category: FindingCategory;
  dimension: DimensionId;
  severity: Severity;
  upstream?: string;
}

const R = (id: string, title: string, category: FindingCategory, dimension: DimensionId, severity: Severity, upstream?: string): RuleEntry => ({ id, title, category, dimension, severity, ...(upstream ? { upstream } : {}) });

export const RULES: readonly RuleEntry[] = [
  ...['viewport', 'image-alt', 'title', 'description', 'noindex', 'canonical', 'duplicate-title'].map(id => R(`web/${id}`, `Web delivery: ${id}`, 'web-delivery', 'web-delivery', id === 'noindex' ? 'high' : id === 'description' ? 'low' : 'medium')),
  // quality
  R("quality/cyclomatic-complexity", "Cyclomatic complexity", "quality", "quality", "medium", "SKY-Q301"),
  R("quality/cognitive-complexity", "Cognitive complexity", "quality", "quality", "medium", "SKY-Q306"),
  R("quality/deep-nesting", "Deep nesting", "quality", "quality", "low", "SKY-Q302"),
  R("quality/long-function", "Function too long", "quality", "quality", "low", "SKY-C304"),
  R("quality/too-many-params", "Too many parameters", "quality", "quality", "low", "SKY-C303"),
  R("quality/duplicate-branches", "Duplicate branch logic", "quality", "quality", "medium", "SKY-Q305"),
  R("quality/compiler-suppression", "Compiler suppression directive", "quality", "quality", "low", "SKY-T104"),
  R("quality/blanket-lint-disable", "Blanket lint disable", "quality", "quality", "medium", "SKY-L035"),
  R("quality/debug-leftover", "Debug leftover", "quality", "quality", "low", "SKY-L009"),
  // maintainability
  R("maintainability/large-class", "Class too large", "quality", "maintainability", "medium", "SKY-Q502"),
  R("maintainability/import-cycle", "Circular dependency", "quality", "maintainability", "medium", "SKY-CIRC"),
  R("maintainability/duplicate-implementation", "Duplicated implementation", "quality", "maintainability", "low", "SKY-C401"),
  R("maintainability/similar-implementation", "Near-duplicate implementation", "quality", "maintainability", "low", "SKY-C401"),
  R("maintainability/pass-through-wrapper", "Pass-through wrapper", "quality", "maintainability", "info"),
  R("maintainability/large-file", "Very large file", "quality", "maintainability", "low"),
  R("maintainability/todo-markers", "Unfinished-work markers", "quality", "maintainability", "info"),
  // dead code
  R("dead-code/unused-symbol", "Unused symbol", "dead-code", "dead-code", "low", "SKY-U001"),
  R("dead-code/unused-file", "Unused file", "dead-code", "dead-code", "low"),
  R("dead-code/unused-import", "Unused import", "dead-code", "dead-code", "info", "SKY-U002"),
  R("dead-code/unreachable", "Unreachable statement", "dead-code", "dead-code", "low", "SKY-UC002"),
  R("dead-code/unused-dependency", "Unused dependency", "dead-code", "dead-code", "low", "SKY-U005"),
  // reliability
  R("reliability/empty-catch", "Empty error handler", "reliability", "reliability", "medium", "SKY-L007"),
  R("reliability/bare-except", "Bare except", "reliability", "reliability", "medium", "SKY-L002"),
  R("reliability/swallowed-exception", "Broad exception with trivial handler", "reliability", "reliability", "medium", "SKY-L030"),
  R("reliability/missing-timeout", "Missing network timeout", "reliability", "reliability", "medium", "SKY-L031"),
  R("reliability/async-foreach", "Async Array.forEach callback", "reliability", "reliability", "high", "SKY-Q406"),
  R("reliability/async-promise-executor", "Async Promise executor", "reliability", "reliability", "high", "SKY-Q405"),
  R("reliability/discarded-async-map", "Discarded async Array.map result", "reliability", "reliability", "high", "SKY-Q407"),
  R("reliability/await-in-loop", "Await in loop", "reliability", "reliability", "info", "SKY-Q402"),
  R("reliability/missing-cleanup", "Missing resource cleanup", "reliability", "reliability", "low", "SKY-L008"),
  // tests
  R("test/no-tests", "No tests", "test", "tests", "critical"),
  R("test/focused-test", "Focused test", "test", "tests", "high"),
  R("test/skipped-test", "Skipped tests", "test", "tests", "low"),
  R("test/empty-test", "Empty test", "test", "tests", "medium"),
  R("test/assertionless-test", "Test without assertion", "test", "tests", "low"),
  R("test/mock-heavy", "Mock-heavy test file", "test", "tests", "info"),
  R("test/critical-gap", "Critical symbol without a test relationship", "test", "tests", "high", "SKY-A102"),
  R("test/critical-path-gap", "Entry path with untested steps", "test", "tests", "medium"),
  R("test/no-failure-path", "No failure-path test for a sensitive symbol", "test", "tests", "low"),
  // coverage
  R("coverage/low-file-coverage", "Low runtime coverage", "coverage", "coverage", "medium"),
  R("coverage/stale-artifact", "Stale coverage artifact", "coverage", "coverage", "low"),
  // dependencies
  R("dependency/no-lockfile", "No lockfile", "dependency", "dependencies", "medium"),
  R("dependency/unpinned-version", "Unpinned dependency", "dependency", "dependencies", "low"),
  R("dependency/license-denied", "License denied by policy", "dependency", "dependencies", "high", "SKY-SCA-LIC001"),
  R("dependency/license-review", "License needs review", "dependency", "dependencies", "medium", "SKY-SCA-LIC001"),
  R("dependency/license-unknown", "License not declared", "dependency", "dependencies", "info"),
  R("dependency/vulnerability", "Known vulnerability", "dependency", "dependencies", "high"),
  R("dependency/duplicate-versions", "Several versions of one package", "dependency", "dependencies", "info"),
  // AI-code defect indicators
  R("ai-code/phantom-import", "Import of a file that does not exist", "ai-code", "ai-code", "high", "SKY-L012"),
  R("ai-code/undeclared-package", "Import of an undeclared package", "ai-code", "ai-code", "high", "SKY-D223"),
  R("ai-code/placeholder", "Placeholder implementation", "ai-code", "ai-code", "medium", "SKY-L026"),
  R("ai-code/weakened-test", "Always-true assertion", "ai-code", "ai-code", "medium", "SKY-A101"),
  R("ai-code/disabled-control", "Disabled safety control", "ai-code", "ai-code", "high", "SKY-L011"),
  R("ai-code/placeholder-data", "Placeholder data in source", "ai-code", "ai-code", "low", "SKY-L032"),
  // build and CI
  R("build/check-failed", "Build check failed", "build", "build", "critical"),
  R("build/not-strict", "Type checking is not strict", "build", "build", "low"),
  R("ci/no-ci", "No CI configuration", "ci", "ci", "medium"),
  R("ci/missing-gate", "CI gate not detected", "ci", "ci", "low"),
  // debt
  R("debt/hotspot", "Technical-debt hotspot", "debt", "debt", "medium"),
];

const BY_ID = new Map(RULES.map((r) => [r.id, r]));

export function rule(id: string): RuleEntry {
  const r = BY_ID.get(id);
  if (!r) throw new Error(`unknown health rule ${id}`);
  return r;
}

export const EVIDENCE_SAMPLE = 12;

export interface FindingInput {
  id: string;
  title: string;
  message: string;
  why: string;
  action: string;
  confidence: Confidence;
  evidence: FindingEvidence[];
  severity?: Severity;
  file?: string;
  line?: number;
  symbol?: string;
  nodeId?: string;
  metric?: Finding["metric"];
  missing?: string[];
  verification?: string[];
  total?: number;
}

/** Build a finding from its rule's defaults. Evidence is sampled to `EVIDENCE_SAMPLE` rows. */
export function makeFinding(ruleId: string, input: FindingInput): Finding {
  const r = rule(ruleId);
  const total = input.total ?? input.evidence.length;
  const f: Finding = {
    id: input.id,
    ruleId,
    category: r.category,
    severity: input.severity ?? r.severity,
    confidence: input.confidence,
    title: input.title,
    message: input.message,
    evidence: input.evidence.slice(0, EVIDENCE_SAMPLE),
    more: Math.max(0, total - Math.min(EVIDENCE_SAMPLE, input.evidence.length)),
    why: input.why,
    action: input.action,
    verification: input.verification ?? ["Run Fehm health again: the finding disappears when the cause is gone."],
  };
  if (r.upstream) f.upstream = r.upstream;
  for (const k of ["file", "line", "symbol", "nodeId", "metric", "missing"] as const) if (input[k] !== undefined) (f as unknown as Record<string, unknown>)[k] = input[k];
  return f;
}

export function dimensionOf(f: Finding): DimensionId {
  return BY_ID.get(f.ruleId)?.dimension ?? "quality";
}
