import { edgeStyle, nodeStyle } from "../model.js";
import type { GraphModel } from "./graph-model.js";

/** Node visibility under the active filters. */
export const HIDDEN = 0;
/** Filtered-off structural node kept faintly so regions keep their meaning. */
export const CONTEXT = 1;
export const PRIMARY = 2;

/** Focus levels, strongest last. */
export const LEVEL_DIM = 0;
export const LEVEL_NORMAL = 1;
export const LEVEL_ANCESTOR = 2;
export const LEVEL_EXTERNAL = 3;
export const LEVEL_RELATED = 4;
export const LEVEL_SELECTED = 5;

export interface Filters {
  nodeKinds: ReadonlySet<string>;
  edgeKinds: ReadonlySet<string>;
}

export interface Focus {
  selected: number;
  hovered: number;
  /** Search candidates to emphasize while no node is selected. */
  matches: ReadonlySet<number> | null;
}

export interface Visibility {
  node: Uint8Array;
  edge: Uint8Array;
  primaryCount: number;
  edgeCount: number;
}

export interface VisualState {
  visibility: Visibility;
  level: Uint8Array;
  nodeAlpha: Float32Array;
  nodeGlow: Float32Array;
  edgeAlpha: Float32Array;
  edgeWidth: Float32Array;
  /** Nodes directly related to the selection (for labels and fit-to-focus). */
  related: number[];
}

/**
 * Filters are a view operation: the graph keeps every node and edge, only
 * visibility changes. An edge is shown when its kind is active and neither
 * endpoint is hidden.
 */
export function computeVisibility(model: GraphModel, filters: Filters): Visibility {
  const kindState = model.kindNames.map((k) => (filters.nodeKinds.has(k) ? PRIMARY : nodeStyle(k).structural ? CONTEXT : HIDDEN));
  const edgeKindOn = model.edgeKindNames.map((k) => filters.edgeKinds.has(k));
  const node = new Uint8Array(model.n);
  let primaryCount = 0;
  for (let i = 0; i < model.n; i += 1) {
    node[i] = kindState[model.kind[i]!]!;
    if (node[i] === PRIMARY) primaryCount += 1;
  }
  const edge = new Uint8Array(model.m);
  let edgeCount = 0;
  for (let e = 0; e < model.m; e += 1) {
    if (edgeKindOn[model.edgeKind[e]!] && node[model.source[e]!] !== HIDDEN && node[model.target[e]!] !== HIDDEN) {
      edge[e] = 1;
      edgeCount += 1;
    }
  }
  return { node, edge, primaryCount, edgeCount };
}

/**
 * Focus mode: the selection is brightest, its direct relationships and (for
 * folders, files and classes) its contents are emphasized, and everything
 * else is dimmed — never removed — so the rest of the codebase stays in view.
 */
export function computeVisualState(model: GraphModel, visibility: Visibility, focus: Focus): VisualState {
  const { n, m } = model;
  const level = new Uint8Array(n).fill(LEVEL_NORMAL);
  const nodeAlpha = new Float32Array(n);
  const nodeGlow = new Float32Array(n);
  const edgeAlpha = new Float32Array(m);
  const edgeWidth = new Float32Array(m);
  const related: number[] = [];
  const vis = visibility.node;
  const selected = focus.selected >= 0 && vis[focus.selected] !== HIDDEN ? focus.selected : -1;

  // Many visible edges → each one fainter, so dense graphs read as streams rather than a wall.
  const density = Math.min(1, Math.max(0.3, Math.sqrt(2500 / Math.max(1, visibility.edgeCount))));
  const baseEdgeAlpha = model.edgeKindNames.map((k) => edgeStyle(k).alpha * density);
  const hierarchyWidth = 0.8;

  let inScope: Uint8Array | undefined;
  let relatedMark: Uint8Array | undefined;
  if (selected >= 0) {
    relatedMark = new Uint8Array(n);
    level.fill(LEVEL_DIM);
    inScope = new Uint8Array(n);
    inScope[selected] = 1;
    for (const d of model.descendants(selected)) {
      inScope[d] = 1;
      level[d] = LEVEL_RELATED;
    }
    for (const a of model.ancestors(selected)) level[a] = LEVEL_ANCESTOR;
    level[selected] = LEVEL_SELECTED;
  }

  for (let e = 0; e < m; e += 1) {
    if (!visibility.edge[e]) continue;
    const s = model.source[e]!;
    const t = model.target[e]!;
    const hierarchy = model.hierarchyKind[model.edgeKind[e]!]!;
    let alpha = baseEdgeAlpha[model.edgeKind[e]!]!;
    let width = hierarchy ? hierarchyWidth : 1;
    if (inScope) {
      if (s === selected || t === selected) {
        const other = s === selected ? t : s;
        if (level[other]! < LEVEL_RELATED) level[other] = LEVEL_RELATED;
        if (!relatedMark![other]) {
          relatedMark![other] = 1;
          related.push(other);
        }
        alpha = 0.95;
        width = hierarchy ? 1.2 : 1.8;
      } else if (inScope[s] && inScope[t]) {
        alpha = hierarchy ? 0.28 : 0.55;
        width = hierarchy ? 0.9 : 1.2;
      } else if (inScope[s] || inScope[t]) {
        if (hierarchy) alpha *= 0.4;
        else {
          const other = inScope[s] ? t : s;
          if (level[other]! < LEVEL_EXTERNAL) level[other] = LEVEL_EXTERNAL;
          alpha = 0.6;
          width = 1.3;
        }
      } else alpha *= 0.12;
    }
    edgeAlpha[e] = alpha;
    edgeWidth[e] = width;
  }

  const searching = selected < 0 && focus.matches !== null && focus.matches.size > 0;
  for (let i = 0; i < n; i += 1) {
    const v = vis[i]!;
    if (v === HIDDEN) continue;
    let alpha: number;
    let glow = 0;
    switch (level[i]) {
      case LEVEL_SELECTED:
        alpha = 1;
        glow = 1;
        break;
      case LEVEL_RELATED:
        alpha = 1;
        glow = 0.4;
        break;
      case LEVEL_EXTERNAL:
        alpha = 0.8;
        glow = 0.15;
        break;
      case LEVEL_ANCESTOR:
        alpha = 0.7;
        break;
      case LEVEL_DIM:
        alpha = 0.14;
        break;
      default:
        alpha = 1;
    }
    if (searching) {
      if (focus.matches!.has(i)) glow = 0.6;
      else alpha *= 0.35;
    }
    if (v === CONTEXT) {
      alpha *= level[i]! >= LEVEL_ANCESTOR ? 0.45 : 0.18;
      glow = 0;
    }
    nodeAlpha[i] = alpha;
    nodeGlow[i] = glow;
  }

  const hovered = focus.hovered >= 0 && vis[focus.hovered] === PRIMARY ? focus.hovered : -1;
  if (hovered >= 0 && hovered !== selected) {
    nodeAlpha[hovered] = 1;
    nodeGlow[hovered] = Math.max(nodeGlow[hovered]!, 0.7);
    if (selected < 0) {
      for (const list of [model.outEdges(hovered), model.inEdges(hovered)]) {
        for (const e of list) {
          if (!visibility.edge[e]) continue;
          edgeAlpha[e] = Math.max(edgeAlpha[e]!, 0.7);
          edgeWidth[e] = Math.max(edgeWidth[e]!, 1.4);
        }
      }
    }
  }
  return { visibility, level, nodeAlpha, nodeGlow, edgeAlpha, edgeWidth, related };
}
