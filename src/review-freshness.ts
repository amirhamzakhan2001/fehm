// Review binding state adapted from garrytan/gstack lib/review-evidence.ts (MIT).
// Modified: hash Fehm-indexed source only, no gstack environment, logging or gates.
// Original copyright/license and pinned source: third_party/gstack/.
import { createHash } from 'node:crypto';
import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import type { CodeGraph } from './model.js';
import { mapConcurrent } from './concurrency.js';

export interface SourceSnapshot { fingerprint: string | null; matchesIndex: boolean; files: number }
export async function captureIndexedSource(graph: CodeGraph): Promise<SourceSnapshot> {
  const root = await realpath(graph.repository.root);
  const entries = Object.entries(graph.fileHashes).sort(([a], [b]) => a.localeCompare(b));
  const results = await mapConcurrent(entries, 8, async ([file, expected]) => {
    const absolute = path.resolve(root, file);
    if (!absolute.startsWith(root + path.sep)) return null;
    try {
      const resolved = await realpath(absolute);
      if (!resolved.startsWith(root + path.sep)) return null;
      const digest = createHash('sha256').update(await readFile(resolved)).digest('hex');
      return { file, digest, matches: digest === expected };
    } catch { return null; }
  });
  if (!results.length || results.some(result => !result)) return { fingerprint: null, matchesIndex: false, files: entries.length };
  return { fingerprint: createHash('sha256').update(JSON.stringify(results.map(result => [result!.file, result!.digest]))).digest('hex'), matchesIndex: results.every(result => result!.matches), files: entries.length };
}
export function reviewSourceFreshness(before: SourceSnapshot, after: SourceSnapshot) {
  const state = !before.fingerprint || !after.fingerprint ? 'uncaptured'
    : before.fingerprint !== after.fingerprint ? 'changed'
    : !before.matchesIndex || !after.matchesIndex ? 'index-stale' : 'unchanged';
  return { state, before: before.fingerprint, after: after.fingerprint, files: before.files,
    scope: 'Files in the existing Fehm index only; excludes new/unindexed files, dependencies and Git reference changes. Does not establish review correctness.' };
}
