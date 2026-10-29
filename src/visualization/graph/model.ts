/**
 * Feature 3.1 view model, shared by the server (adapter, layout, routes) and
 * the browser (renderer, UI). Only type imports from Feature 1 are allowed
 * here: this module is also served to the browser as-is.
 */
import type { EdgeKind, NodeKind, Provenance } from "../../model.js";

/** Bump when the payload shape changes. */
export const GRAPH_VIEW_SCHEMA = "2";
/** Bump when layout output changes meaning; invalidates `.fehm/graph-layout.json`. */
export const LAYOUT_VERSION = "3";

export interface NodeKindStyle {
  label: string;
  /**
   * World-space radius. Size encodes structural level, never connection
   * count, over a deliberately narrow range: kinds are told apart by glow
   * colour, not by shape or large size differences.
   */
  radius: number;
  /** Smallest on-screen radius in CSS pixels, so far-zoomed entities stay visible as points. */
  minPixels: number;
  /** Fill and glow colour; the only per-kind visual identity. */
  color: string;
  /** Structural order: lower is higher in the hierarchy. Also draw and label priority. */
  rank: number;
  /** Kinds that keep spatial meaning as faint context when filtered off. */
  structural: boolean;
  /** High-volume kinds that start filtered off (the user can switch them on). */
  defaultHidden?: boolean;
}

export const NODE_STYLES: Readonly<Record<NodeKind, NodeKindStyle>> = {
  repository: { label: "Project", radius: 7, minPixels: 3.6, color: "#f2f5ff", rank: 0, structural: true },
  directory: { label: "Folder", radius: 5, minPixels: 2.8, color: "#5b8cff", rank: 1, structural: true },
  module: { label: "Module", radius: 4, minPixels: 2.3, color: "#7aa2f7", rank: 2, structural: false },
  file: { label: "File", radius: 3.6, minPixels: 2.1, color: "#a07cff", rank: 2, structural: true },
  package: { label: "Package", radius: 3.2, minPixels: 1.9, color: "#ff9e64", rank: 3, structural: false },
  section: { label: "Section", radius: 2.2, minPixels: 1.4, color: "#e8d5b5", rank: 3, structural: false },
  class: { label: "Class", radius: 3, minPixels: 1.8, color: "#ffd166", rank: 4, structural: false },
  interface: { label: "Interface", radius: 2.8, minPixels: 1.7, color: "#f08cff", rank: 5, structural: false },
  enum: { label: "Enum", radius: 2.4, minPixels: 1.5, color: "#b9f27c", rank: 6, structural: false },
  type: { label: "Type", radius: 2.4, minPixels: 1.5, color: "#9ece6a", rank: 6, structural: false },
  route: { label: "Route", radius: 2.6, minPixels: 1.6, color: "#ff6b3d", rank: 7, structural: false },
  function: { label: "Function", radius: 2.4, minPixels: 1.5, color: "#3ee6c4", rank: 7, structural: false },
  method: { label: "Method", radius: 2.2, minPixels: 1.4, color: "#38bdf8", rank: 8, structural: false },
  field: { label: "Field", radius: 1.6, minPixels: 1.1, color: "#89ddff", rank: 9, structural: false, defaultHidden: true },
  variable: { label: "Variable", radius: 1.8, minPixels: 1.2, color: "#ff5c8a", rank: 9, structural: false },
};

/** Fallback for node kinds a future analyzer adds before the UI knows them. */
export const DEFAULT_NODE_STYLE: NodeKindStyle = { label: "Entity", radius: 2, minPixels: 1.3, color: "#a9b1d6", rank: 10, structural: false };

export function nodeStyle(kind: string): NodeKindStyle {
  return (NODE_STYLES as Record<string, NodeKindStyle>)[kind] ?? { ...DEFAULT_NODE_STYLE, label: kind };
}

export interface EdgeKindStyle {
  label: string;
  /** Label for the incoming direction in the inspector ("called by"). */
  inverse: string;
  color: string;
  /** Hierarchy edges are structural and drawn fainter and straight. */
  hierarchy: boolean;
  /** Base opacity in the unfocused state. */
  alpha: number;
}

/**
 * View-only refinements of `contains`/`defines`, split by the target's kind so
 * "contains folder", "contains file", "defines method" and "defines field" can
 * be filtered separately. Feature 1 still stores a single `contains`/`defines`.
 */
export type ViewEdgeKind = "contains-folder" | "contains-file" | "defines-method" | "defines-field";

export function viewEdgeKind(kind: string, targetKind: string): string {
  if (kind === "contains" && targetKind === "directory") return "contains-folder";
  if (kind === "contains" && targetKind === "file") return "contains-file";
  if (kind === "defines" && targetKind === "method") return "defines-method";
  if (kind === "defines" && targetKind === "field") return "defines-field";
  return kind;
}

export const EDGE_STYLES: Readonly<Record<EdgeKind | ViewEdgeKind, EdgeKindStyle>> = {
  "contains-folder": { label: "Contains folder", inverse: "In folder", color: "#5b6f96", hierarchy: true, alpha: 0.24 },
  "contains-file": { label: "Contains file", inverse: "In folder", color: "#50607d", hierarchy: true, alpha: 0.22 },
  contains: { label: "Contains", inverse: "Contained in", color: "#50607d", hierarchy: true, alpha: 0.22 },
  defines: { label: "Defines", inverse: "Defined in", color: "#50607d", hierarchy: true, alpha: 0.22 },
  "defines-method": { label: "Defines method", inverse: "Method of", color: "#4a6a86", hierarchy: true, alpha: 0.22 },
  "defines-field": { label: "Defines field", inverse: "Field of", color: "#4a7386", hierarchy: true, alpha: 0.2 },
  imports: { label: "Imports", inverse: "Imported by", color: "#7aa2f7", hierarchy: false, alpha: 0.3 },
  calls: { label: "Calls", inverse: "Called by", color: "#5fd4c0", hierarchy: false, alpha: 0.34 },
  uses: { label: "Usage", inverse: "Used by", color: "#9ece6a", hierarchy: false, alpha: 0.26 },
  references: { label: "References", inverse: "Referenced by", color: "#a9b1d6", hierarchy: false, alpha: 0.22 },
  writes: { label: "Writes", inverse: "Written by", color: "#f7768e", hierarchy: false, alpha: 0.4 },
  extends: { label: "Inherits", inverse: "Inherited by", color: "#e0af68", hierarchy: false, alpha: 0.5 },
  implements: { label: "Implements", inverse: "Implemented by", color: "#d8c47a", hierarchy: false, alpha: 0.5 },
  handles: { label: "Handles", inverse: "Handled by", color: "#ff6b3d", hierarchy: false, alpha: 0.5 },
  configures: { label: "Configures", inverse: "Configured by", color: "#ff9e64", hierarchy: false, alpha: 0.3 },
};

export const DEFAULT_EDGE_STYLE: EdgeKindStyle = { label: "Related", inverse: "Related from", color: "#a9b1d6", hierarchy: false, alpha: 0.22 };

export function edgeStyle(kind: string): EdgeKindStyle {
  return (EDGE_STYLES as Record<string, EdgeKindStyle>)[kind] ?? { ...DEFAULT_EDGE_STYLE, label: kind };
}

export const HIERARCHY_EDGE_KINDS: ReadonlySet<string> = new Set(["contains", "defines", "contains-folder", "contains-file", "defines-method", "defines-field"]);

/**
 * Columnar graph payload. Parallel arrays keep large graphs compact on the
 * wire and map straight onto typed arrays in the renderer. Every node and
 * edge here is a Feature 1 fact; nothing is invented by the view.
 */
export interface GraphViewPayload {
  schema: string;
  root: string;
  project: string;
  generatedAt: string;
  nodeKinds: string[];
  edgeKinds: string[];
  provenances: Provenance[] | string[];
  /** Path table; nodes refer to it by index to avoid repeating file paths. */
  paths: string[];
  nodes: {
    id: string[];
    kind: number[];
    name: string[];
    /** Index into `paths`, or -1. */
    path: number[];
    /** 1-based declaration line, or 0. */
    line: number[];
    /** Index of the hierarchical parent node, or -1 for the root. */
    parent: number[];
    /** Bit 1 = exported, bit 2 = test. */
    flags: number[];
    x: number[];
    y: number[];
  };
  edges: {
    source: number[];
    target: number[];
    kind: number[];
    /** Evidence confidence × 100. */
    confidence: number[];
    provenance: number[];
  };
  stats: { nodes: number; edges: number; files: number; directories: number; symbols: number; semanticEdges: number; unresolved: number };
  layout: { mode: "full" | "incremental" | "cached"; version: string; durationMs: number; reused: number; placed: number };
  sync: { mode: string; durationMs: number };
}

export const NODE_FLAG_EXPORTED = 1;
export const NODE_FLAG_TEST = 2;

export interface GraphStatus {
  state: "ready" | "empty";
  root: string;
  project: string;
  /** Whether a layout for the current graph is already cached (no layout pass needed). */
  layoutCached: boolean;
  stats: { nodes: number; edges: number; files: number };
  sync: { mode: string; durationMs: number };
}

export interface GraphSearchHit {
  id: string;
  kind: string;
  name: string;
  path?: string;
  line?: number;
  score: number;
}

export interface GraphNodeDetail {
  id: string;
  kind: string;
  name: string;
  path?: string;
  absolutePath?: string;
  line?: number;
  endLine?: number;
  signature?: string;
  doc?: string;
  exported?: boolean;
  isTest?: boolean;
  provenance: string;
  confidence: number;
  summary: string;
  semanticSummary?: { text: string; model: string };
  related: {
    id: string;
    name: string;
    kind: string;
    path?: string;
    line?: number;
    relation: string;
    direction: "out" | "in";
    provenance: string;
    confidence: number;
    detail?: string;
  }[];
  unresolved: { text: string; reason: string; line: number }[];
}

export interface GraphFreshness {
  fresh: boolean;
  added: number;
  modified: number;
  deleted: number;
}
