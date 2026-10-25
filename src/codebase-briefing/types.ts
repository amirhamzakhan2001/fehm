/**
 * Feature 3.2 — the codebase briefing contract. Shared by the server, the CLI
 * renderer and the browser page, so this module holds types and constants
 * only (the browser imports it type-only).
 */
import type { Provenance } from "../model.js";

/** Bump when the briefing payload changes shape. */
export const BRIEFING_SCHEMA = "1.0";
/** Bump when any section builder changes its output; invalidates `.fehm/briefing.json`. */
export const BRIEFING_VERSION = "3";

/**
 * confirmed — observed in the index (type-checker/AST/filesystem) or declared in configuration.
 * likely — inferred from structure or pattern-extracted (heuristic) evidence.
 * unknown — not enough evidence; stated, never guessed.
 */
export type ClaimState = "confirmed" | "likely" | "unknown";
/** How a claim is supported: seen in code, written in config/docs, or derived. */
export type ClaimBasis = "observed" | "declared" | "inferred";
export type EvidenceSource = "index" | "manifest" | "configuration" | "documentation" | "test";

export interface BriefingEvidence {
  path: string;
  line?: number;
  /** Graph node the evidence points at, for "Explore in graph". */
  nodeId?: string;
  source: EvidenceSource;
  /** Feature 1 provenance of the underlying fact, when it is a graph fact. */
  provenance?: Provenance;
  detail?: string;
  /** Set at serve time when the file changed after indexing. */
  stale?: boolean;
}

export interface Claim {
  id: string;
  text: string;
  state: ClaimState;
  basis: ClaimBasis;
  /** 0..1 — internal; the UI leads with `state`. */
  confidence: number;
  evidence: BriefingEvidence[];
  /** Limitation or caveat, e.g. "static reachability, not measured coverage". */
  note?: string;
}

/** A line item in a list/group. `claim` points at the claim holding its evidence. */
export interface BriefingItem {
  title: string;
  detail?: string;
  badge?: string;
  claim?: string;
  nodeId?: string;
  path?: string;
  line?: number;
  /** Entry points: a node whose call flow can be expanded on demand. */
  flowFrom?: string;
}

export interface FlowStepView {
  name: string;
  path?: string;
  line?: number;
  nodeId?: string;
  layer?: string;
  provenance?: Provenance;
}

export type Block =
  | { type: "text"; text: string; claim?: string }
  | { type: "facts"; rows: { label: string; value: string; claim?: string }[] }
  | { type: "list"; title?: string; items: BriefingItem[]; ordered?: boolean; empty?: string }
  | { type: "groups"; title?: string; groups: { title: string; note?: string; items: BriefingItem[] }[]; empty?: string }
  | { type: "flow"; title: string; steps: FlowStepView[]; claim?: string }
  | { type: "diagram"; title?: string; lines: string[]; claim?: string }
  | {
      type: "ranking";
      title?: string;
      rows: { name: string; path?: string; nodeId?: string; score: number; why: string[]; metrics: Record<string, number>; claim?: string }[];
    }
  | { type: "risks"; items: { severity: "high" | "medium" | "low" | "unknown"; title: string; why: string; claim: string }[]; empty?: string };

export const SECTION_IDS = [
  "overview",
  "architecture",
  "entryPoints",
  "features",
  "dataFlows",
  "api",
  "database",
  "integrations",
  "infrastructure",
  "security",
  "components",
  "technology",
  "testing",
  "runtime",
  "dependencies",
  "risks",
  "engineerMustKnow",
  "cheatSheet",
] as const;
export type SectionId = (typeof SECTION_IDS)[number];

export interface BriefingSection {
  id: SectionId;
  title: string;
  /** The question this section answers. */
  question: string;
  state: ClaimState;
  confidence: number;
  summary: string;
  blocks: Block[];
  claims: Claim[];
  unknowns: string[];
  /** Adaptive ordering weight for this repository's archetype (higher = more relevant). */
  priority: number;
  expanded: boolean;
  /** Set at serve time when evidence in this section changed after indexing. */
  stale?: boolean;
  links?: { label: string; href: string }[];
}

export type Archetype = "cli" | "api" | "frontend" | "library" | "ml" | "service";

export interface BriefingFreshness {
  /** Working tree matches the index this briefing was built from. */
  fresh: boolean;
  checkedAt: string;
  changed: { added: string[]; modified: string[]; deleted: string[] };
  affectedSections: SectionId[];
}

export interface CodebaseBriefing {
  schemaVersion: typeof BRIEFING_SCHEMA;
  mode: "deterministic";
  repository: { name: string; root: string; fingerprint: string };
  generatedAt: string;
  headline: { name: string; tagline: string; tags: string[] };
  archetype: { primary: Archetype; secondary: Archetype[]; signals: string[] };
  metrics: { claims: number; confirmedShare: number; unknowns: number; files: number; symbols: number; relationships: number; heuristicShare: number };
  freshness: BriefingFreshness;
  sections: BriefingSection[];
  unknowns: { section: SectionId; text: string }[];
  cache: { reused: SectionId[]; rebuilt: SectionId[]; durationMs: number };
}

export interface BriefingFlowResponse {
  root: FlowTreeNode | null;
  error?: string;
}

export interface FlowTreeNode {
  id: string;
  name: string;
  path?: string;
  provenance: Provenance;
  repeated?: boolean;
  children: FlowTreeNode[];
}

export interface BriefingAskResponse {
  query: string;
  hits: { nodeId: string; kind: string; name: string; path?: string; line?: number; summary: string; reasons: string[]; score: number }[];
}
