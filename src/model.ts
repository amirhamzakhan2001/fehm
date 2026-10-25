/**
 * Fehm's own data model. Every other module — and every upstream adaptation —
 * speaks these types. Nothing here depends on an external project.
 */

export const GRAPH_SCHEMA_VERSION = "1.1.0";
/** Bump when analyzer output changes shape or meaning; invalidates cached analyses. */
export const ANALYSIS_VERSION = "2";
/** Bump when the semantic-summary prompt/format changes; invalidates cached summaries. */
export const SUMMARY_VERSION = "1";

export type NodeKind =
  | "repository"
  | "directory"
  | "file"
  | "package"
  /** Language-level module/namespace: TS namespace, Rust `mod`, Go/Java package clause. */
  | "module"
  | "class"
  | "interface"
  | "function"
  | "method"
  /** Class/struct/interface data member. */
  | "field"
  | "variable"
  | "type"
  | "enum"
  /** HTTP route registered in code (`app.get("/x", h)`, `@GetMapping`, `@app.route`). */
  | "route"
  /** Markdown heading. */
  | "section";

export type EdgeKind =
  | "contains"
  | "defines"
  | "imports"
  | "calls"
  | "references"
  | "uses"
  | "extends"
  | "implements"
  /** Function/method assigns to a variable or field. */
  | "writes"
  /** Manifest/config declares or points at an entity (dependency, entry point, script). */
  | "configures"
  /** Function/method handles an HTTP route. */
  | "handles";

/**
 * How a fact was established, strongest first. A `heuristic` fact is never
 * presented as if a compiler resolved it.
 */
export type Provenance = "filesystem" | "type-checker" | "ast" | "heuristic";

export interface SourceLocation {
  path: string;
  line: number;
  column?: number;
  endLine?: number;
}

export interface Evidence {
  provenance: Provenance;
  /** 0..1. 1.0 only for filesystem facts and type-checker-resolved symbols. */
  confidence: number;
  location?: SourceLocation;
  detail?: string;
}

export type Language =
  | "typescript"
  | "javascript"
  | "python"
  | "go"
  | "rust"
  | "java"
  | "json"
  | "yaml"
  | "toml"
  | "markdown"
  | "other";

export interface GraphNode {
  id: string;
  kind: NodeKind;
  name: string;
  /** Repository-relative, forward-slash path of the owning file/directory. */
  path?: string;
  language?: Language;
  location?: SourceLocation;
  /** Declaration signature (first line(s) of the declaration), when known. */
  signature?: string;
  exported?: boolean;
  isTest?: boolean;
  /** First sentence of the declaration's doc comment/docstring, when present. */
  doc?: string;
  evidence: Evidence;
}

export interface GraphEdge {
  id: string;
  kind: EdgeKind;
  source: string;
  target: string;
  evidence: Evidence;
}

/** A reference the analyzer saw but could not resolve. Kept, never guessed. */
export interface UnresolvedReference {
  kind: "import" | "call" | "dynamic-import" | "extends" | "implements" | "writes" | "handles" | "configures" | "references";
  fromNode: string;
  text: string;
  location: SourceLocation;
  reason: string;
}

export type FileRole = "source" | "test" | "config" | "manifest" | "docs" | "other";

export interface ScannedFile {
  path: string;
  absolutePath: string;
  language: Language;
  role: FileRole;
  isTest: boolean;
  size: number;
  hash: string;
  /** True when the file was too large or binary and its content was not analyzed. */
  skipped?: "too-large" | "binary" | "unreadable";
}

export interface ScanResult {
  root: string;
  files: ScannedFile[];
  directories: string[];
  /** Paths that could not be read. Reported, not silently dropped. */
  errors: { path: string; reason: string }[];
}

export interface ScanChanges {
  added: string[];
  modified: string[];
  deleted: string[];
  unchanged: string[];
  /** Content-identical delete+add pairs. Evidence only; identity is not transferred. */
  renamed: { from: string; to: string }[];
}

/**
 * A name-based reference from a heuristic analyzer. Resolved against the
 * repository-wide symbol table in the link phase, never inside the per-file
 * analyzer, so the per-file cache stays valid when other files change.
 */
export interface PendingReference {
  kind: "call" | "import" | "extends" | "implements" | "writes" | "handles" | "configures" | "references";
  fromNode: string;
  /**
   * Callee/base/field name, the import specifier for `import`, the handler name
   * for `handles` (fromNode is the route), or a path / `module:function` spec
   * for `configures`.
   */
  name: string;
  /** For `call`: `receiver.name(...)` style member call (weaker evidence). */
  member?: boolean;
  /** Receiver text for member calls, e.g. a Go package alias or `self`. */
  receiver?: string;
  /** For `import`: names bound by the import (`from m import a, b`). */
  names?: string[];
  /** Evidence override for kinds whose strength the analyzer knows (manifests, links). */
  confidence?: number;
  provenance?: Provenance;
  detail?: string;
  location: SourceLocation;
}

/** Everything a single file contributes to the graph. Cached per file hash. */
export interface FileAnalysis {
  path: string;
  hash: string;
  analysisVersion: string;
  language: Language;
  /** Quality of analysis actually achieved for this file. */
  resolution: "type-checker" | "ast" | "heuristic" | "none";
  nodes: GraphNode[];
  edges: GraphEdge[];
  unresolved: UnresolvedReference[];
  pending: PendingReference[];
  /** Files this file depends on (resolved import targets), for invalidation. */
  dependsOn: string[];
  diagnostics: string[];
}

export interface GraphStats {
  nodes: number;
  edges: number;
  files: number;
  nodesByKind: Partial<Record<NodeKind, number>>;
  edgesByKind: Partial<Record<EdgeKind, number>>;
  edgesByProvenance: Partial<Record<Provenance, number>>;
  unresolved: number;
}

export interface SerializedGraph {
  schemaVersion: string;
  analysisVersion: string;
  root: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
  unresolved: UnresolvedReference[];
}

export type SyncMode = "full" | "incremental" | "cache-hit";

export interface SyncReport {
  mode: SyncMode;
  /** Why a full rebuild happened, when it did. */
  reason?: string;
  analyzedFiles: string[];
  reusedFiles: string[];
  /** Unchanged files re-analyzed because a dependency changed. */
  invalidatedFiles: string[];
  removedFiles: string[];
  changedSymbols: { added: string[]; removed: string[] };
  changedRelationships: { added: number; removed: number };
  staleSummaries: string[];
  scanErrors: { path: string; reason: string }[];
  durationMs: number;
}

export type RetrievalIntent = "locate" | "explain" | "change" | "debug" | "test" | "architecture";

export interface RetrievalSignals {
  lexical: number;
  symbol: number;
  semantic: number;
  graph: number;
  intent: number;
}

export interface RetrievalHit {
  nodeId: string;
  kind: NodeKind;
  name: string;
  path?: string;
  score: number;
  signals: RetrievalSignals;
  /** Graph distance from the nearest direct match (0 = matched directly). */
  depth: number;
  /** Why this hit is here, e.g. "name match", "called by authenticateUser". */
  reasons: string[];
}

/** Progressive detail levels, most detailed first. */
export type DetailLevel = "source" | "section" | "signature" | "summary" | "relationship";

export interface ContextItem {
  nodeId: string;
  kind: NodeKind;
  name: string;
  path?: string;
  score: number;
  detail: DetailLevel;
  /** The text that enters the model context at this detail level. */
  text: string;
  tokens: number;
  location?: SourceLocation;
  summarySource: "deterministic" | "semantic";
}

export interface ContextRelationship {
  kind: EdgeKind;
  source: string;
  target: string;
  sourceName: string;
  targetName: string;
  provenance: Provenance;
  confidence: number;
}

export interface ContextBudget {
  maximumTokens: number;
  usedTokens: number;
  remainingTokens: number;
  truncated: boolean;
  /** Candidates dropped or downgraded to fit. */
  dropped: number;
  downgraded: number;
  estimator: string;
}

/** Observable evidence metrics — not a claim about model understanding. */
export interface ContextQuality {
  queryTermCoverage: number;
  exactSymbolMatch: boolean;
  meanConfidence: number;
  heuristicShare: number;
  filesCovered: number;
  testsIncluded: number;
  relationshipsIncluded: number;
  unresolvedNearby: number;
}

export interface MemoryEntry {
  id: string;
  text: string;
  /** Paths/symbols this fact is about; used to link and rank it. */
  links: string[];
  tags: string[];
  createdAt: string;
}

export interface ContextPacket {
  schemaVersion: string;
  query: string;
  intent: RetrievalIntent;
  budget: ContextBudget;
  quality: ContextQuality;
  architecture: { languages: Partial<Record<Language, number>>; topDirectories: string[]; entryPoints: string[] };
  memory: MemoryEntry[];
  tests: string[];
  recommendedNodes: ContextItem[];
  relationships: ContextRelationship[];
  unknowns: string[];
  index: { root: string; files: number; symbols: number; relationships: number; fresh: boolean };
}
