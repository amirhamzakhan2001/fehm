import path from 'node:path';
import type { CodeGraph } from './model.js';

/** Links untrusted review claims to graph locations, without asserting correctness. */
export function linkReviewFindings(raw: string, graph: CodeGraph) {
  if (Buffer.byteLength(raw) > 8 * 1024 * 1024) throw new Error('Review report exceeds 8 MiB');
  const report = JSON.parse(raw);
  if (!report || typeof report.status !== 'string' || !(report.comments === null || Array.isArray(report.comments))) throw new Error('Unsupported Open Code Review report schema');
  const comments: unknown[] = report.comments ?? [];
  if (comments.length > 10000) throw new Error('Review report has too many comments');
  const byPath = new Map<string, CodeGraph["nodes"]>();
  for (const node of graph.nodes) {
    if (!node.path || !node.location) continue;
    const bucket = byPath.get(node.path) ?? [];
    bucket.push(node);
    byPath.set(node.path, bucket);
  }
  const findings = comments.map((value, index) => {
    const c = value as Record<string, unknown> | null;
    if (!c || typeof c.path !== 'string' || typeof c.content !== 'string' || !Number.isSafeInteger(c.start_line) || !Number.isSafeInteger(c.end_line)) throw new Error(`Invalid review comment ${index}`);
    const file = c.path.replace(/\\/g, '/');
    if (!file || file.includes('\0') || path.posix.isAbsolute(file) || /^[a-z]:/i.test(file) || file.split('/').includes('..')) throw new Error(`Unsafe review path at comment ${index}`);
    const start = c.start_line as number, end = c.end_line as number;
    if (start < 1 || end < start) throw new Error(`Invalid review lines at comment ${index}`);
    const normalized = path.posix.normalize(file);
    const nodes = (byPath.get(normalized) ?? []).filter(n => n.location && n.location.line <= end && (n.location.endLine ?? n.location.line) >= start);
    return { path: normalized, startLine: start, endLine: end, message: c.content,
      severity: typeof c.severity === 'string' ? c.severity : 'unspecified',
      category: typeof c.category === 'string' ? c.category : 'unspecified',
      provenance: 'Open Code Review', verified: false, nodeIds: nodes.map(n => n.id),
      locationStatus: nodes.length ? 'overlaps-indexed-source' : 'unmatched' };
  });
  return { schemaVersion: '1.0', tool: 'Open Code Review', upstreamStatus: report.status,
    repository: graph.repository.root, findings,
    // Preserve partial coverage and diagnostics: zero comments does not mean a successful review.
    upstream: report,
    notice: 'Graph links use the existing index, which may be stale. They do not validate model claims or line accuracy. No graph nodes or files were modified.' };
}
