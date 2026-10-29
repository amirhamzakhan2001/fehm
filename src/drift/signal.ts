import type { Attention, Basis, BaselineSource, Confidence, DriftCategory, DriftGroup, Evidence } from "./types.js";

/**
 * A raw detection, before deduplication. Several detectors can see the same
 * deviation (a controller reaching the database is a dependency-pattern
 * outlier, a database-access outlier, an API-boundary deviation and maybe an
 * explicit rule): they share a `subject`, and `group.ts` folds them into one
 * primary finding with the others as related signals.
 */
export interface Signal {
  /** Deduplication key: `<unit path>|<target bucket>` or a scope key. */
  subject: string;
  category: DriftCategory;
  source: BaselineSource;
  basis: Basis;
  confidence: Confidence;
  attention: Attention;
  title: string;
  observed: string;
  baseline: string;
  explanation: string;
  impact: string;
  suggestion?: { text: string; chain?: string[] };
  commonChain?: string[];
  observedChain?: string[];
  unit?: string;
  target?: string;
  /** The mined pattern id. */
  pattern?: string;
  /** Pattern kind (for framework/industry practice lookup). */
  kind: string;
  stats?: { comparable: number; matching: number; frequency: number; unitLabel: string };
  evidence: Evidence[];
  /** Occurrences beyond `evidence`. */
  more?: number;
  /** Extra map anchors (module ids) beyond the unit and target. */
  modules?: string[];
}

export const GROUP_OF: Record<DriftCategory, DriftGroup> = {
  "file-placement": "structure",
  naming: "structure",
  granularity: "structure",
  "module-boundary": "structure",
  dependency: "dependencies",
  layer: "dependencies",
  cycle: "dependencies",
  monorepo: "dependencies",
  responsibility: "responsibilities",
  abstraction: "responsibilities",
  pattern: "patterns",
  "dependency-injection": "patterns",
  framework: "patterns",
  api: "runtime",
  database: "runtime",
  "external-service": "runtime",
  configuration: "runtime",
  "security-boundary": "runtime",
  testing: "engineering",
  "error-handling": "engineering",
  observability: "engineering",
  historical: "historical",
  "ai-associated": "ai",
};

export const ATTENTION_ORDER: Attention[] = ["informational", "low", "moderate", "high", "critical"];
export const CONFIDENCE_ORDER: Confidence[] = ["low", "medium", "high"];

export function raise(a: Attention, by = 1, cap: Attention = "high"): Attention {
  const i = Math.min(ATTENTION_ORDER.indexOf(a) + by, ATTENTION_ORDER.indexOf(cap));
  return ATTENTION_ORDER[Math.max(i, ATTENTION_ORDER.indexOf(a))]!;
}

/**
 * Confidence from project evidence (spec §36): many comparable units that
 * agree → high; a few that mostly agree → medium; anything weaker is low and
 * is not reported as a project convention.
 */
export function projectConfidence(comparable: number, frequency: number): Confidence {
  if (comparable >= 5 && frequency >= 0.8) return "high";
  if (comparable >= 3 && frequency >= 0.66) return "medium";
  return "low";
}

export const pct = (x: number): string => `${Math.round(x * 100)}%`;
export const plural = (n: number, w: string, ws = `${w}s`): string => `${n} ${n === 1 ? w : ws}`;
export const baseName = (p: string): string => p.split("/").pop()!.replace(/\.[^.]+$/, "");
