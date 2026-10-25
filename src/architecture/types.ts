/**
 * Feature 3.3 contract, shared with the browser (type-only imports there).
 *
 * Two IRs, never mixed:
 *   - the semantic Architecture IR (`ArchitectureModel`, `ArchNode`,
 *     `ArchRelationship`): what exists, what connects, why, evidence and
 *     confidence. It carries layout *hints* (a semantic tier), never pixels.
 *   - the Layout IR (`DiagramLayout`): rectangles, ports, routes, labels and
 *     a viewBox for one view, produced deterministically from the semantic IR
 *     and validated before it is published.
 */

import type { EdgeKind, Provenance } from "../model.js";

export const ARCHITECTURE_SCHEMA = "1.0";
/** Bump when the semantic model's output changes shape or meaning. */
export const ARCHITECTURE_VERSION = "3";
/** Bump when layout geometry changes for the same semantic input. */
export const LAYOUT_VERSION = "2";

/**
 * How strongly the code supports a claim.
 *   verified  — observed by the type-checker/AST/filesystem, or declared in a manifest.
 *   strong    — pattern-extracted from a specific source line, or several independent signals.
 *   inferred  — a reasonable reading of names/structure; not explicit in code.
 *   unknown   — no evidence; the claim is withheld, not guessed.
 */
export type Confidence = "verified" | "strong" | "inferred" | "unknown";

export type ArchNodeType =
  /** Someone or something outside the codebase that drives it (HTTP client, CLI operator). */
  | "actor"
  /** Receives HTTP requests (route registration observed). */
  | "api"
  /** Parses command-line arguments / dispatches commands. */
  | "cli"
  /** Renders a user interface (browser or UI framework code). */
  | "frontend"
  /** Background work: workers, schedulers, watchers. */
  | "worker"
  /** Business/application logic by naming convention. */
  | "service"
  /** Talks to a data store (SQL, models, database clients). */
  | "data-access"
  /** Used by many, uses little: utilities and shared foundations. */
  | "shared"
  /** A cohesive group of source files whose role the evidence does not settle. */
  | "component"
  /** A Feature 3.2 source module (directory or filename-prefix group). */
  | "module"
  /** A single source file (drill-down level). */
  | "file"
  /** An SQL/NoSQL store the code queries. */
  | "database"
  /** The local filesystem, when code writes files. */
  | "filesystem"
  /** A network service reached through an SDK or outbound HTTP. */
  | "external-system"
  // ─── behaviour and operations views ───
  /** A function taking part in a flow (runtime, data flow). */
  | "function"
  /** A step of a workflow (one or more calls). */
  | "step"
  /** A branch point in a workflow. */
  | "decision"
  /** A loop in a workflow (iteration or retry). */
  | "loop"
  /** Where a workflow or lifecycle begins. */
  | "start"
  /** Normal end of a workflow or lifecycle. */
  | "end"
  /** Failure end or error path. */
  | "failure"
  /** A state of a lifecycle. */
  | "state"
  /** A container, workload or deployable service. */
  | "container"
  /** Ingress, load balancer, reverse proxy or API gateway. */
  | "gateway"
  /** Hosting platform or CI system. */
  | "platform"
  /** Authentication / authorization code. */
  | "auth"
  /** A security-relevant sink (process execution, eval, raw HTML, deserialization). */
  | "sink"
  /** Secrets read from the environment. */
  | "secret";

export type ArchLevel = 0 | 1 | 2 | 3 | 4 | 5;

export type RelationshipType =
  | "calls"
  | "uses"
  | "imports"
  | "extends"
  | "reads"
  | "writes"
  | "requests"
  | "invokes"
  /** Sequence: the reply to an earlier call. */
  | "returns"
  /** Lifecycle: state change. */
  | "transitions"
  /** Workflow: control passes to the next step (optionally under a condition). */
  | "flows"
  /** Deployment: runs / hosts / routes to. */
  | "deploys"
  | "routes"
  | "exposes"
  /** Security: checks identity or permissions. */
  | "authenticates"
  | "contains";

export interface ArchEvidence {
  path: string;
  line?: number;
  /** Graph node id (3.1 graph, `explain`, source excerpt). */
  nodeId?: string;
  provenance: Provenance | "declared";
  detail?: string;
}

export interface ArchNode {
  /** Stable, identity-derived: `component:src/auth`, `module:src/skill*`, `file:src/a.ts`, `external:stripe`. */
  id: string;
  type: ArchNodeType;
  level: ArchLevel;
  name: string;
  /** Short human description from docs/comments, when the code has one. */
  description?: string;
  /** Why the node has its type, and how sure that is. */
  role: { confidence: Confidence; reasons: string[] };
  /** Direct semantic children (component → modules → files). */
  children: string[];
  parent?: string;
  /** Source files this node covers (empty for actors/externals). */
  files: string[];
  symbols: number;
  /** Graph node to focus in 3.1. */
  graphNodeId?: string;
  /** External libraries the node's files import (catalog labels), for the inspector. */
  technologies: string[];
  evidence: ArchEvidence[];
  /** Semantic tier hint for layout: 0 = outside/top (actors) … 3 = outside/bottom (stores, externals). */
  tier: 0 | 1 | 2 | 3;
  /** Architecture delta only. */
  status?: DeltaStatus;
}

export interface ArchRelationship {
  /** `rel:<source>→<target>` */
  id: string;
  source: string;
  target: string;
  type: RelationshipType;
  /** Short edge label, only where it adds meaning (HTTP, reads, writes). */
  label?: string;
  /** Underlying code relationships, by Feature 1 edge kind. */
  counts: Partial<Record<EdgeKind | "signal", number>>;
  weight: number;
  confidence: Confidence;
  evidence: ArchEvidence[];
  /** Architecture delta only. */
  status?: DeltaStatus;
}

export interface EvidenceCoverage {
  verified: number;
  strong: number;
  inferred: number;
  unknown: number;
}

export const VIEW_TYPES = ["system", "components", "runtime", "dataflow", "workflow", "lifecycle", "deployment", "security", "dependencies", "delta"] as const;
export type ViewType = (typeof VIEW_TYPES)[number];

export interface ViewOption {
  /** The `focus` value that selects it. */
  id: string;
  label: string;
  detail?: string;
}

export interface ViewDescriptor {
  type: ViewType;
  title: string;
  question: string;
  /** core: structure; behaviour: runtime/data/workflow/lifecycle; operations: deployment/security/delta. */
  group: "core" | "behaviour" | "operations";
  available: boolean;
  reason?: string;
  /** Views about one thing at a time (an entry point, an entity, a git revision) list their choices. */
  optionLabel?: string;
  options?: ViewOption[];
}

export interface ArchitectureModel {
  schemaVersion: string;
  version: string;
  repository: { name: string; root: string };
  /** Hash of indexed file contents + model/layout versions. */
  fingerprint: string;
  generatedAt: string;
  nodes: ArchNode[];
  relationships: ArchRelationship[];
  /** Component ids at the system level, in stable order. */
  components: string[];
  coverage: EvidenceCoverage;
  views: ViewDescriptor[];
  /** What the model could not determine, stated rather than guessed. */
  unknowns: string[];
  /** Density control: modules left out of the dependency view. */
  hiddenModules: number;
  /** File-level code dependencies every level is aggregated from (server-side only; never sent whole). */
  codeLinks: CodeLink[];
  /** File-level links to actors, stores and external systems (server-side only). */
  externalLinks: FileLink[];
}

export interface CodeLink {
  source: string;
  target: string;
  counts: Partial<Record<EdgeKind, number>>;
  evidence: ArchEvidence[];
}

export interface FileLink {
  file: string;
  /** Actor, store or external node id. */
  target: string;
  type: RelationshipType;
  /** Actor → file (the actor drives the code) instead of file → external. */
  inbound?: boolean;
  evidence: ArchEvidence;
}

// ─── Layout IR ─────────────────────────────────────────────────────

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

export type NodeShape = "box" | "pill" | "cylinder" | "dashed" | "hexagon" | "rounded";

/** Architecture delta status of a node or edge. */
export type DeltaStatus = "added" | "removed" | "changed" | "unchanged";

/** Feature 3.4: an edge's standing against the reference architecture. */
export type DriftMark = "allowed" | "violation" | "review";

export interface LayoutNode extends Rect {
  id: string;
  type: ArchNodeType;
  shape: NodeShape;
  /** Wrapped title lines, each measured to fit `width - 2 * padding`. */
  lines: string[];
  subtitle?: string;
  /** Short type tag drawn in the node (never colour alone). */
  tag: string;
  layer: number;
  /** A context node outside the drilled-into component (components view). */
  context?: boolean;
  /** Can be drilled into. */
  expandable?: boolean;
  status?: DeltaStatus;
}

export interface LayoutEdge {
  id: string;
  source: string;
  target: string;
  /** Orthogonal polyline, source port → target port. */
  points: Point[];
  weight: number;
  type: RelationshipType;
  confidence: Confidence;
  label?: { text: string } & Rect;
  /** Drawn against the layer direction (cycle or upward dependency). */
  reversed?: boolean;
  status?: DeltaStatus;
  drift?: DriftMark;
  /** Sequence diagrams: message order (1-based). */
  order?: number;
}

/** Sequence diagrams: the vertical line under a participant. */
export interface Lifeline {
  node: string;
  x: number;
  y1: number;
  y2: number;
}

export interface LayoutBoundary extends Rect {
  id: string;
  title: string;
  members: string[];
  titleRect: Rect;
}

export interface DiagramLayout {
  view: ViewType;
  /** layered: rows and routing channels; sequence: participants, lifelines and ordered messages. */
  kind?: "layered" | "sequence";
  focus?: string;
  lifelines?: Lifeline[];
  nodes: LayoutNode[];
  edges: LayoutEdge[];
  boundaries: LayoutBoundary[];
  viewBox: Rect;
  metrics: { crossings: number; bends: number; layers: number };
}

export type Severity = "error" | "warning";

export interface Diagnostic {
  /** Rule code, e.g. `node/overlap`, `edge/through-node`, `label/overlap-node`. */
  code: string;
  severity: Severity;
  message: string;
  subjects: string[];
  measured?: number;
  required?: number;
  suggestions: string[];
}

export type QualityProfile = "standard" | "showcase";

export interface ValidationReport {
  profile: QualityProfile;
  valid: boolean;
  diagnostics: Diagnostic[];
}

export interface PublishedView {
  view: ViewType;
  focus?: string;
  title: string;
  /** Semantic nodes/relationships shown in this view. */
  nodes: ArchNode[];
  relationships: ArchRelationship[];
  /** Null when no layout passed validation and there is no last known good. */
  layout: DiagramLayout | null;
  validation: ValidationReport & {
    attempts: number;
    /** fresh: this candidate passed; last-known-good: candidate failed, previous verified layout served; unverified: nothing passed. */
    source: "fresh" | "last-known-good" | "unverified";
    /** The failed candidate, only when source is "unverified" (the UI shows it on explicit request). */
    draft?: DiagramLayout;
  };
  /** Breadcrumb for drill-down: system → component → module. */
  path: { id: string; name: string }[];
  notes: string[];
}

export interface ArchitectureSummary {
  schemaVersion: string;
  repository: { name: string; root: string };
  fingerprint: string;
  generatedAt: string;
  counts: { components: number; modules: number; files: number; relationships: number; externals: number; boundaries: number };
  coverage: EvidenceCoverage;
  views: ViewDescriptor[];
  unknowns: string[];
  freshness: { fresh: boolean; added: number; modified: number; deleted: number };
  durationMs: number;
}

export interface NodeDetail {
  node: ArchNode;
  dependsOn: { id: string; name: string; type: ArchNodeType; relationship: string; relType: RelationshipType; weight: number; confidence: Confidence }[];
  usedBy: { id: string; name: string; type: ArchNodeType; relationship: string; relType: RelationshipType; weight: number; confidence: Confidence }[];
  children: { id: string; name: string; type: ArchNodeType; files: number }[];
  keySymbols: { id: string; name: string; kind: string; path: string; line?: number; inbound: number }[];
  path: { id: string; name: string }[];
}

export interface RelationshipDetail {
  relationship: ArchRelationship;
  source: { id: string; name: string; type: ArchNodeType };
  target: { id: string; name: string; type: ArchNodeType };
}

export interface SourceExcerpt {
  path: string;
  start: number;
  focus: number;
  lines: string[];
}

export interface SearchHit {
  id: string;
  name: string;
  type: ArchNodeType;
  /** The architecture node to show; for code-level hits, the node that owns the file. */
  target: string;
  via?: { name: string; kind: string; path?: string };
}
