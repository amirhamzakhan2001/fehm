import type { GraphNode, Provenance } from "../model.js";
import { strip } from "./facts.js";
import type { BriefingEvidence, BriefingSection, Claim, ClaimBasis, ClaimState } from "./types.js";

/**
 * Confidence policy. Feature 1 provenance maps onto the briefing's three
 * states: compiler/AST/filesystem facts are confirmed observations, pattern
 * extraction is likely, and declarations are confirmed *as declarations*
 * (a manifest entry proves the dependency is declared, not that it runs).
 */
export const CONFIDENCE: Record<Provenance | "declared" | "inferred", number> = {
  filesystem: 1,
  "type-checker": 0.97,
  ast: 0.92,
  declared: 0.9,
  heuristic: 0.7,
  inferred: 0.6,
};

export function stateFor(confidence: number): ClaimState {
  return confidence >= 0.85 ? "confirmed" : confidence >= 0.45 ? "likely" : "unknown";
}

export function ev(path: string, line?: number, extra: Partial<Omit<BriefingEvidence, "path" | "line">> = {}): BriefingEvidence {
  return strip<BriefingEvidence>({ path, line, source: extra.source ?? "index", nodeId: extra.nodeId, provenance: extra.provenance, detail: extra.detail });
}

export function nodeEv(node: GraphNode, detail?: string): BriefingEvidence {
  return strip<BriefingEvidence>({
    path: node.path ?? node.name,
    line: node.location?.line,
    nodeId: node.id,
    source: node.isTest ? "test" : "index",
    provenance: node.evidence.provenance,
    detail,
  });
}

/** Collects the claims of one section and hands out stable ids. */
export class ClaimSet {
  readonly claims: Claim[] = [];
  readonly unknowns: string[] = [];
  private n = 0;

  constructor(private readonly prefix: string) {}

  add(text: string, basis: ClaimBasis, evidence: BriefingEvidence[], options: { confidence?: number; note?: string; state?: ClaimState } = {}): string {
    // Inference is never presented as confirmed fact, however strong the signals.
    const confidence = round(Math.min(basis === "inferred" ? 0.8 : 1, options.confidence ?? defaultConfidence(basis, evidence)));
    const id = `${this.prefix}.${(this.n += 1)}`;
    this.claims.push(strip<Claim>({ id, text, basis, confidence, state: options.state ?? (evidence.length || basis === "inferred" ? stateFor(confidence) : "unknown"), evidence: dedupe(evidence).slice(0, 12), note: options.note }));
    return id;
  }

  /** Observed graph facts: confidence follows the weakest provenance among the evidence. */
  observed(text: string, evidence: BriefingEvidence[], note?: string): string {
    return this.add(text, "observed", evidence, note ? { note } : {});
  }

  declared(text: string, evidence: BriefingEvidence[], note?: string): string {
    return this.add(text, "declared", evidence, { confidence: CONFIDENCE.declared, ...(note ? { note } : {}) });
  }

  inferred(text: string, evidence: BriefingEvidence[], confidence = CONFIDENCE.inferred, note?: string): string {
    return this.add(text, "inferred", evidence, { confidence, ...(note ? { note } : {}) });
  }

  /** A question the evidence cannot answer. Recorded as a claim and as a section unknown. */
  unknown(text: string, note?: string): string {
    this.unknowns.push(text);
    return this.add(text, "inferred", [], { confidence: 0, state: "unknown", ...(note ? { note } : {}) });
  }
}

function defaultConfidence(basis: ClaimBasis, evidence: BriefingEvidence[]): number {
  if (basis === "declared") return CONFIDENCE.declared;
  if (basis === "inferred") return CONFIDENCE.inferred;
  if (!evidence.length) return 0;
  let min = 1;
  for (const e of evidence) {
    const c = e.provenance ? CONFIDENCE[e.provenance] : e.source === "manifest" || e.source === "configuration" ? CONFIDENCE.declared : CONFIDENCE.heuristic;
    min = Math.min(min, c);
  }
  return min;
}

function dedupe(evidence: BriefingEvidence[]): BriefingEvidence[] {
  const seen = new Set<string>();
  return evidence.filter((e) => {
    const key = `${e.path}:${e.line ?? ""}:${e.nodeId ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function round(v: number): number {
  return Math.round(v * 100) / 100;
}

export type SectionDraft = Omit<BriefingSection, "state" | "confidence" | "claims" | "unknowns" | "priority" | "expanded"> & { set: ClaimSet };

/**
 * Section confidence: the mean of its claims' confidences, with unknowns
 * pulling it down. A section whose claims are all unknown is unknown.
 */
export function finishSection(d: SectionDraft, priority: number, expanded: boolean): BriefingSection {
  const { set, ...rest } = d;
  const claims = set.claims;
  const known = claims.filter((c) => c.state !== "unknown");
  const confidence = claims.length ? round(claims.reduce((s, c) => s + c.confidence, 0) / claims.length) : 0;
  const state: ClaimState = !known.length ? "unknown" : known.every((c) => c.state === "confirmed") && confidence >= 0.8 ? "confirmed" : confidence >= 0.4 ? "likely" : "unknown";
  return { ...rest, state, confidence, claims, unknowns: set.unknowns, priority, expanded };
}
