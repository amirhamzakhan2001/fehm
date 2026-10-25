import type { RetrievalHit } from "./model.js";

/*
 * ── Upstream adaptation ───────────────────────────────────────────────────
 * Upstream: trailhq/Graft @ 8c05769618d413041ea2c8891f82d566f0461b3c
 * File:     src/ask/file-selection.ts (MIT, see legal/upstream/graft)
 * Copied:   FileFirstCandidate, fileFirstRoundRobin — algorithm unchanged.
 * Changed:  `queue[depth]` → `queue[depth]!` for Fehm's noUncheckedIndexedAccess.
 * Omitted:  roundRobinQueues (unused), and all of Graft's CLI, hooks, daemon,
 *           graph, ranking and visualization.
 */

/** One already-ranked result and the file/partition whose output queue owns it. */
export interface FileFirstCandidate<T> {
  group: string;
  value: T;
}

/**
 * Project an existing ranking through file-first round-robin selection.
 *
 * The input MUST already be in baseline rank order. Map insertion order makes
 * the first pass exactly the baseline first-occurrence order of groups; later
 * passes expose additional spans only after every group has contributed its
 * leader. Concepts can participate without pretending to be source files by
 * receiving singleton group keys.
 *
 * Values are returned by identity and are never mutated.
 */
export function fileFirstRoundRobin<T>(
  ranked: readonly FileFirstCandidate<T>[],
  limit = Number.POSITIVE_INFINITY,
): T[] {
  const cap = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : Number.POSITIVE_INFINITY;
  if (cap === 0) return [];

  const grouped = new Map<string, T[]>();
  for (const candidate of ranked) {
    const queue = grouped.get(candidate.group);
    if (queue) queue.push(candidate.value);
    else grouped.set(candidate.group, [candidate.value]);
  }

  const queues = [...grouped.values()];
  const out: T[] = [];
  for (let depth = 0; ; depth += 1) {
    let added = false;
    for (const queue of queues) {
      if (depth >= queue.length) continue;
      out.push(queue[depth]!);
      added = true;
      if (out.length >= cap) return out;
    }
    if (!added) break;
  }
  return out;
}

// ── Fehm adapter ──────────────────────────────────────────────────────────

export interface DiversifyOptions {
  /**
   * Hits kept in their original rank order before diversification. A hit is an
   * anchor if it is within the first `maxAnchors` and scores at least
   * `anchorRatio` × the top score.
   */
  maxAnchors?: number;
  anchorRatio?: number;
  limit?: number;
}

/**
 * Preserve the strongest anchors, then diversify the rest across files before
 * taking a second item from any file. Hits without a path (packages) get a
 * singleton group, as Graft does for concepts. Duplicate node ids keep their
 * first (best-ranked) occurrence.
 */
export function diversifyHits(hits: readonly RetrievalHit[], options: DiversifyOptions = {}): { ordered: RetrievalHit[]; anchors: Set<string> } {
  const maxAnchors = options.maxAnchors ?? 3;
  const ratio = options.anchorRatio ?? 0.75;
  const seen = new Set<string>();
  const unique = hits.filter((h) => (seen.has(h.nodeId) ? false : (seen.add(h.nodeId), true)));
  const top = unique[0]?.score ?? 0;
  const anchors: RetrievalHit[] = [];
  const rest: RetrievalHit[] = [];
  for (const hit of unique) {
    if (anchors.length < maxAnchors && hit.score >= top * ratio && anchors.length === unique.indexOf(hit)) anchors.push(hit);
    else rest.push(hit);
  }
  const diversified = fileFirstRoundRobin(rest.map((h) => ({ group: h.path ?? `@${h.nodeId}`, value: h })));
  const ordered = [...anchors, ...diversified];
  return { ordered: options.limit !== undefined ? ordered.slice(0, options.limit) : ordered, anchors: new Set(anchors.map((a) => a.nodeId)) };
}
