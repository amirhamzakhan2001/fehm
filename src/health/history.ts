import { join } from "node:path";
import type { Finding, Severity } from "../findings/model.js";
import { readJson, writeJsonAtomic } from "../persistence.js";
import { HEALTH_VERSION, type BaselineDiff, type FileAnalysisResult, type TrendPoint } from "./types.js";

/**
 * Baseline, trend and cache files in the state directory (Feature 3.6 reuses
 * the baseline and trend helpers with its own file names):
 *   - health-baseline.json: the findings accepted at a point in time; later
 *     runs split findings into new and existing, and list what was fixed;
 *   - health-history.json: one metrics point per distinct analysis (a new
 *     commit or new working-tree state), so trends build up as the project is
 *     analysed; nothing is back-filled from git;
 *   - health-cache.json: per-file analysis keyed by content hash.
 */

export const BASELINE_FILE = "health-baseline.json";
export const HISTORY_FILE = "health-history.json";
export const CACHE_FILE = "health-cache.json";
const MAX_POINTS = 200;

interface Baseline {
  version: 1;
  createdAt: string;
  commit?: string;
  findings: { id: string; title: string; severity: Severity }[];
}

export function readBaseline(stateDirectory: string, file = BASELINE_FILE): Baseline | undefined {
  const r = readJson<Baseline>(join(stateDirectory, file));
  return r.ok && r.value?.version === 1 && Array.isArray(r.value.findings) ? r.value : undefined;
}

export function writeBaseline(stateDirectory: string, findings: Finding[], commit?: string, file = BASELINE_FILE): Baseline {
  const b: Baseline = { version: 1, createdAt: new Date().toISOString(), ...(commit ? { commit } : {}), findings: findings.map((f) => ({ id: f.id, title: f.title, severity: f.severity })) };
  writeJsonAtomic(join(stateDirectory, file), b);
  return b;
}

export function clearBaseline(stateDirectory: string, file = BASELINE_FILE): void {
  writeJsonAtomic(join(stateDirectory, file), { version: 0 });
}

/** Mark each finding new or existing, and list baseline findings that are gone. */
export function applyBaseline(findings: Finding[], baseline: Baseline | undefined): BaselineDiff | undefined {
  if (!baseline) {
    for (const f of findings) delete f.baseline;
    return undefined;
  }
  const before = new Set(baseline.findings.map((f) => f.id));
  const now = new Set(findings.map((f) => f.id));
  let added = 0;
  for (const f of findings) {
    f.baseline = before.has(f.id) ? "existing" : "new";
    if (f.baseline === "new") added += 1;
  }
  return { createdAt: baseline.createdAt, ...(baseline.commit ? { commit: baseline.commit } : {}), added, fixed: baseline.findings.filter((f) => !now.has(f.id)), unchanged: findings.length - added };
}

interface History {
  version: 1;
  points: (TrendPoint & { digest: string })[];
}

export function readTrend(stateDirectory: string, file = HISTORY_FILE): (TrendPoint & { digest: string })[] {
  const r = readJson<History>(join(stateDirectory, file));
  return r.ok && r.value?.version === 1 && Array.isArray(r.value.points) ? r.value.points : [];
}

/** Append a point unless the last one has the same digest (same inputs, same results). */
export function recordTrend(stateDirectory: string | undefined, point: TrendPoint & { digest: string }, file = HISTORY_FILE): TrendPoint[] {
  const points = stateDirectory ? readTrend(stateDirectory, file) : [];
  if (points.at(-1)?.digest !== point.digest) points.push(point);
  const kept = points.slice(-MAX_POINTS);
  if (stateDirectory) writeJsonAtomic(join(stateDirectory, file), { version: 1, points: kept } satisfies History);
  return kept.map(({ digest: _d, ...p }) => p);
}

interface Cache {
  version: string;
  files: Record<string, FileAnalysisResult>;
}

export function readCache(stateDirectory: string): Map<string, FileAnalysisResult> {
  const r = readJson<Cache>(join(stateDirectory, CACHE_FILE));
  if (!r.ok || r.value?.version !== HEALTH_VERSION || typeof r.value.files !== "object") return new Map();
  return new Map(Object.entries(r.value.files));
}

export function writeCache(stateDirectory: string, results: Map<string, FileAnalysisResult>): void {
  writeJsonAtomic(join(stateDirectory, CACHE_FILE), { version: HEALTH_VERSION, files: Object.fromEntries(results) } satisfies Cache);
}
