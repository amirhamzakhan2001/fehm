/**
 * The finding model shared by Feature 3.5 (project health) and Feature 3.6
 * (security review). One format, so a finding can move between pages, into a
 * baseline, into review state and into CI output without conversion.
 *
 * Severity and confidence are separate axes: a finding can be severe but
 * weakly evidenced, or certain but minor. Confidence uses Fehm's evidence
 * vocabulary (as 3.3 and 3.4 do) rather than a percentage, which would claim
 * a precision static analysis does not have.
 */

import type { Confidence } from "../architecture/types.js";

export type { Confidence };

export type Severity = "critical" | "high" | "medium" | "low" | "info";

export const SEVERITIES: readonly Severity[] = ["critical", "high", "medium", "low", "info"];

export type FindingCategory =
  | "build"
  | "test"
  | "coverage"
  | "quality"
  | "dead-code"
  | "dependency"
  | "reliability"
  | "ai-code"
  | "debt"
  | "ci"
  | "security"
  | "secret"
  | "configuration"
  | "deployment";

/** What kind of fact a piece of evidence is. */
export type EvidenceType =
  | "ast"
  | "call-site"
  | "import"
  | "test"
  | "coverage"
  | "git"
  | "config"
  | "dependency"
  | "runtime"
  | "taint-flow"
  | "framework"
  | "registry"
  | "package-export"
  | "metric"
  | "pattern"
  | "absence";

export interface FindingEvidence {
  type: EvidenceType;
  path?: string;
  line?: number;
  /** Graph node, so the page can open the 3.1 graph on it. */
  nodeId?: string;
  detail: string;
  confidence?: Confidence;
}

/** A measured value against the threshold it broke. */
export interface FindingMetric {
  name: string;
  value: number;
  threshold: number;
  unit?: string;
}

/** Review state a person set (`.fehm/findings-review.json`). */
export type ReviewStatus = "reviewed" | "false-positive" | "accepted-risk" | "suppressed";

export interface FindingReview {
  status: ReviewStatus;
  note?: string;
  at: string;
}

export interface Finding {
  /** Stable across runs for the same code: baselines and reviews key on it. */
  id: string;
  /** Fehm rule id, e.g. `quality/cyclomatic-complexity`. */
  ruleId: string;
  /** The upstream rule it was adapted from, when there is one (e.g. `SKY-Q301`). */
  upstream?: string;
  category: FindingCategory;
  severity: Severity;
  confidence: Confidence;
  title: string;
  /** What was observed, in one or two sentences. */
  message: string;
  file?: string;
  line?: number;
  symbol?: string;
  nodeId?: string;
  metric?: FindingMetric;
  evidence: FindingEvidence[];
  /** Evidence rows not included (the list is sampled). */
  more: number;
  /** What evidence would have changed the verdict, or was looked for and not found. */
  missing?: string[];
  why: string;
  action: string;
  verification: string[];
  /** Baseline comparison, when a baseline exists. */
  baseline?: "new" | "existing";
  review?: FindingReview;
}

/**
 * How far an analyzer got. `unsupported` means the check does not exist for
 * this input (a language, a manifest kind); `skipped` means it exists but was
 * not run (not requested, or nothing to analyze). Neither is ever shown as a
 * clean result.
 */
export type AnalyzerStatus = "complete" | "partial" | "skipped" | "unsupported" | "error";

export interface AnalyzerRun {
  id: string;
  name: string;
  status: AnalyzerStatus;
  reason?: string;
  findings: number;
  durationMs: number;
}

export const SEVERITY_RANK: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
export const CONFIDENCE_RANK: Record<Confidence, number> = { verified: 0, strong: 1, inferred: 2, unknown: 3 };

export function compareFindings(a: Finding, b: Finding): number {
  return SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || CONFIDENCE_RANK[a.confidence] - CONFIDENCE_RANK[b.confidence] || (a.file ?? "").localeCompare(b.file ?? "") || (a.line ?? 0) - (b.line ?? 0) || a.id.localeCompare(b.id);
}

/** A finding still asking for attention: not suppressed, not a false positive, not an accepted risk. */
export function isOpen(f: Finding): boolean {
  return !f.review || f.review.status === "reviewed";
}
