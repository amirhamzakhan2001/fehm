import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { gitInfo, resolveCommit, withCommitTree } from "../architecture/view-delta.js";
import { FehmEngine } from "../engine.js";
import { CONTRACT_FILE } from "./contract.js";
import { DECISIONS_FILE } from "./decisions.js";
import { analyzeDrift } from "./drift.js";
import { ATTENTION_ORDER } from "./signal.js";
import { DRIFT_VERSION, type Attention, type DriftBaseline, type DriftFinding, type DriftHistory, type DriftReport, type FindingStatus, type HistoryChange, type HistoryPoint } from "./types.js";

/**
 * Drift over time (spec §50–52, §69). A first scan can say where the code
 * differs from its baseline, not whether that is new. Two comparison points:
 *
 *   - a baseline the developer set (`drift-baseline.json` in the state dir);
 *   - the git window: the same analysis run on the code of the last commits
 *     (decisions and explicit rules are read from the working tree, so every
 *     commit is measured the same way).
 *
 * With the window analysed, each current finding is dated: present in the
 * oldest analysed commit → existing; appeared later → new, with the commit
 * that introduced it and the unit's dependencies before and after.
 * Commit results are cached (commits are immutable).
 */

export const HISTORY_WINDOW = 8;
const MAX_CACHED_POINTS = 200;

// ─── baseline ───────────────────────────────────────────────────────

export function readBaseline(stateDirectory: string): DriftBaseline | undefined {
  const path = join(stateDirectory, "drift-baseline.json");
  if (!existsSync(path)) return undefined;
  try {
    const b = JSON.parse(readFileSync(path, "utf8")) as DriftBaseline;
    return Array.isArray(b.findings) && typeof b.createdAt === "string" ? b : undefined;
  } catch {
    return undefined;
  }
}

export function writeBaseline(stateDirectory: string, report: DriftReport, commit?: string): DriftBaseline {
  const baseline: DriftBaseline = { version: DRIFT_VERSION, createdAt: new Date().toISOString(), ...(commit ? { commit } : {}), findings: report.findings.map((f) => ({ id: f.id, title: f.title, category: f.category })) };
  atomicWrite(join(stateDirectory, "drift-baseline.json"), JSON.stringify(baseline, null, 2));
  return baseline;
}

export function clearBaseline(stateDirectory: string): void {
  rmSync(join(stateDirectory, "drift-baseline.json"), { force: true });
}

// ─── git window ─────────────────────────────────────────────────────

export function commitWindow(root: string, n = HISTORY_WINDOW): DriftHistory {
  const info = gitInfo(root);
  if (!info) return { git: false, reason: "Not a git working tree (or git is not installed): only a baseline can date findings.", commits: [], analysed: 0, resolved: [] };
  try {
    const log = execFileSync("git", ["-C", root, "log", "-n", String(n), "--format=%H%x09%h%x09%cI%x09%s", "--", "."], { stdio: ["ignore", "pipe", "ignore"], timeout: 30_000 }).toString().trim();
    const commits = log ? log.split("\n").map((l) => {
      const [ref, short, date, subject] = l.split("\t") as [string, string, string, string];
      return { ref, short, date, subject };
    }) : [];
    return commits.length ? { git: true, commits, analysed: 0, resolved: [] } : { git: false, reason: "No commits touch this directory yet.", commits: [], analysed: 0, resolved: [] };
  } catch {
    return { git: false, reason: "git log failed.", commits: [], analysed: 0, resolved: [] };
  }
}

/** What the reference is at the moment (explicit rules + decisions): part of every cache key. */
export function configHash(root: string): string {
  const h = createHash("sha256").update(DRIFT_VERSION);
  for (const f of [CONTRACT_FILE, DECISIONS_FILE]) {
    const p = join(root, f);
    h.update(existsSync(p) ? readFileSync(p) : "-");
  }
  return h.digest("hex").slice(0, 12);
}

export function pointOf(ref: string, short: string, subject: string, date: string | undefined, report: DriftReport): HistoryPoint {
  const byAttention = Object.fromEntries(ATTENTION_ORDER.map((a) => [a, 0])) as Record<Attention, number>;
  for (const f of report.findings) byAttention[f.attention] += 1;
  return {
    ref,
    short,
    subject,
    ...(date ? { date } : {}),
    total: report.findings.length,
    byAttention,
    findings: report.findings.map((f) => ({ id: f.id, title: f.title, category: f.category, attention: f.attention })),
    deps: report.deps,
    files: report.context.scale.sourceFiles,
  };
}

interface PointCache {
  version: string;
  entries: Record<string, HistoryPoint & { savedAt: string }>;
}

export class HistoryEvaluator {
  private memo = new Map<string, HistoryPoint>();

  constructor(
    private readonly root: string,
    private readonly stateDirectory: string | undefined,
  ) {}

  /** Cached result for a commit, if any (no analysis). */
  cached(commit: string): HistoryPoint | undefined {
    const key = `${commit}:${configHash(this.root)}`;
    const hit = this.memo.get(key) ?? this.readCache()?.entries[key];
    if (hit) this.memo.set(key, hit);
    return hit;
  }

  /** Drift at a commit: the full analysis on that commit's code, measured against today's rules and decisions. */
  point(ref: string): HistoryPoint {
    const commit = resolveCommit(this.root, ref);
    if (!commit) return { ref, short: ref.slice(0, 7), subject: "", total: 0, byAttention: { informational: 0, low: 0, moderate: 0, high: 0, critical: 0 }, findings: [], deps: {}, files: 0, error: `unknown revision ${ref}` };
    const hit = this.cached(commit);
    if (hit) return hit;
    const [subject, date] = this.meta(commit);
    try {
      const point = withCommitTree(this.root, commit, (dir) => {
        const engine = FehmEngine.open(dir, { stateDirectory: join(dir, ".fehm-history-state") });
        const { report } = analyzeDrift({ engine, configRoot: this.root });
        return pointOf(commit, commit.slice(0, 7), subject, date, report);
      });
      const key = `${commit}:${configHash(this.root)}`;
      this.memo.set(key, point);
      this.writeCache(key, point);
      return point;
    } catch (e) {
      return { ref: commit, short: commit.slice(0, 7), subject, total: 0, byAttention: { informational: 0, low: 0, moderate: 0, high: 0, critical: 0 }, findings: [], deps: {}, files: 0, error: `could not analyse ${commit.slice(0, 7)}: ${(e as Error).message.split("\n")[0]}` };
    }
  }

  private meta(commit: string): [string, string] {
    try {
      const [s, d] = execFileSync("git", ["-C", this.root, "log", "-n", "1", "--format=%s%x09%cI", commit], { stdio: ["ignore", "pipe", "ignore"], timeout: 10_000 }).toString().trim().split("\t");
      return [s ?? "", d ?? ""];
    } catch {
      return ["", ""];
    }
  }

  private cachePath(): string | undefined {
    return this.stateDirectory ? join(this.stateDirectory, "drift-history.json") : undefined;
  }

  private readCache(): PointCache | undefined {
    const path = this.cachePath();
    if (!path || !existsSync(path)) return undefined;
    try {
      const c = JSON.parse(readFileSync(path, "utf8")) as PointCache;
      return c.version === DRIFT_VERSION && c.entries ? c : undefined;
    } catch {
      return undefined;
    }
  }

  private writeCache(key: string, point: HistoryPoint): void {
    const path = this.cachePath();
    if (!path) return;
    const cache = this.readCache() ?? { version: DRIFT_VERSION, entries: {} };
    cache.entries[key] = { ...point, savedAt: new Date().toISOString() };
    const keys = Object.keys(cache.entries);
    if (keys.length > MAX_CACHED_POINTS) for (const k of keys.sort((a, b) => (cache.entries[a]!.savedAt < cache.entries[b]!.savedAt ? -1 : 1)).slice(0, keys.length - MAX_CACHED_POINTS)) delete cache.entries[k];
    try {
      atomicWrite(path, JSON.stringify(cache));
    } catch {
      // A cache: failing to write it never fails a request.
    }
  }
}

/**
 * Date the current findings. `points` are the analysed commits, newest first
 * (as git log lists them); `current` is the working tree. Returns the
 * findings with status (and introduction point), the per-commit changes for
 * the trend, and what "new" was measured against.
 */
export function dateFindings(findings: DriftFinding[], current: HistoryPoint, points: HistoryPoint[], baseline: DriftBaseline | undefined): { findings: DriftFinding[]; changes: HistoryChange[]; resolved: { id: string; title: string }[]; comparison?: DriftHistory["comparison"] } {
  const chrono = [...points].filter((p) => !p.error).reverse();
  const series = [...chrono, current];
  const changes: HistoryChange[] = series.map((p, i) => {
    const prev = series[i - 1];
    const before = new Set(prev?.findings.map((f) => f.id) ?? []);
    const now = new Set(p.findings.map((f) => f.id));
    return {
      ref: p.ref,
      short: p.short,
      subject: p.subject,
      ...(p.date ? { date: p.date } : {}),
      added: prev ? p.findings.filter((f) => !before.has(f.id)).map((f) => ({ id: f.id, title: f.title })) : [],
      resolved: prev ? prev.findings.filter((f) => !now.has(f.id)).map((f) => ({ id: f.id, title: f.title })) : [],
      total: p.total,
      files: p.files,
    };
  });
  const introduction = (id: string): { at: HistoryPoint; before?: HistoryPoint } | undefined => {
    // The last time it went from absent to present within the window.
    for (let i = series.length - 1; i > 0; i -= 1) {
      const has = series[i]!.findings.some((f) => f.id === id);
      const had = series[i - 1]!.findings.some((f) => f.id === id);
      if (!has) return undefined;
      if (!had) return { at: series[i]!, before: series[i - 1]! };
    }
    return undefined;
  };
  const windowed = chrono.length > 0;
  const baseIds = baseline ? new Set(baseline.findings.map((f) => f.id)) : windowed ? new Set(chrono[0]!.findings.map((f) => f.id)) : undefined;
  const dated = findings.map((f): DriftFinding => {
    let status: FindingStatus = baseIds ? (baseIds.has(f.id) ? "existing" : "new") : "undated";
    const intro = windowed ? introduction(f.id) : undefined;
    const out: DriftFinding = { ...f, status };
    if (intro) {
      const unit = f.unit?.path;
      out.introduced = {
        commit: intro.at.ref,
        short: intro.at.short,
        subject: intro.at.subject,
        date: intro.at.date ?? "",
        ...(unit && intro.before?.deps[unit] ? { before: intro.before.deps[unit] } : unit ? { before: [] } : {}),
        ...(unit && intro.at.deps[unit] ? { after: intro.at.deps[unit] } : {}),
      };
      if (!baseline) status = "new";
      out.status = status;
    }
    return out;
  });
  const baseList = baseline ? baseline.findings : windowed ? chrono[0]!.findings : [];
  const now = new Set(findings.map((f) => f.id));
  const resolved = baseList.filter((f) => !now.has(f.id)).map((f) => ({ id: f.id, title: f.title }));
  const comparison: DriftHistory["comparison"] | undefined = baseline ? { kind: "baseline", label: `baseline of ${new Date(baseline.createdAt).toLocaleDateString()}` } : windowed ? { kind: "window", label: `${chrono[0]!.short} (${chrono.length} commits analysed)` } : undefined;
  return { findings: dated, changes, resolved, ...(comparison ? { comparison } : {}) };
}

function atomicWrite(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, text);
  renameSync(tmp, path);
}
