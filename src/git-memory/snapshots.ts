import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { FehmEngine } from '../engine.js';
import { BriefingFacts } from '../codebase-briefing/facts.js';
import { buildArchitectureModel } from '../architecture/model.js';
import { analyzeDrift } from '../drift/drift.js';
import { buildSecurityReport } from '../security/security.js';
import { buildHealthReport } from '../health/health.js';
import { buildPromptReport } from '../prompts/report.js';
import { readJson, stateDir, writeJsonAtomic } from '../persistence.js';
import { ANALYSIS_VERSION } from '../model.js';
import { ARCHITECTURE_VERSION } from '../architecture/types.js';
import { DRIFT_VERSION } from '../drift/types.js';
import { HEALTH_VERSION } from '../health/types.js';
import { blob, git, optionalGit, revision } from './git.js';
import type { HistoryOptions } from './types.js';

// Bump for changes to snapshot analysis, including prompt/security analyzer changes.
const VERSION = `1:${ANALYSIS_VERSION}:${ARCHITECTURE_VERSION}:${DRIFT_VERSION}:${HEALTH_VERSION}`;
export interface MemorySnapshot {
  version: string; commit: string; at: string; analyzedAt: string;
  coverage: { materialized: number; indexed: number; skipped: string[]; complete: boolean };
  architecture: { id: string; name: string; type: string; files: string[] }[];
  relationships: { source: string; target: string; kind: string }[];
  security: { id: string; title: string; file: string | null }[];
  drift: { id: string; title: string }[];
  health: { id: string; title: string }[];
  prompts: { id: string; path: string; name: string; line: number; digest: string; staticScore: number; model: string | null; tools: string[] }[];
  metrics: Record<string, number | null>; unknowns: string[];
}
const digest = (s: string) => createHash('sha256').update(s).digest('hex');
export function historicalSnapshot(root: string, ref: string, options: HistoryOptions = {}): MemorySnapshot {
  root = optionalGit(root, ['rev-parse', '--show-toplevel']) ?? root;
  const commit = revision(root, ref);
  const cachePath = join(stateDir(root, options.stateDirectory), 'git-memory-snapshots', `${commit}.json`);
  const cached = readJson<MemorySnapshot>(cachePath);
  if (!options.force && cached.ok && cached.value?.version === VERSION && cached.value.commit === commit && Array.isArray(cached.value.architecture) && Array.isArray(cached.value.prompts) && cached.value.coverage) return cached.value;
  const temp = mkdtempSync(join(tmpdir(), 'fehm-history-'));
  const skipped: string[] = [], materialized: string[] = [];
  let bytes = 0;
  try {
    const tree = git(root, ['ls-tree', '-rz', '--full-tree', commit]).split('\0').filter(Boolean);
    for (const entry of tree) {
      const match = /^(\d+) (\w+) ([a-f0-9]+)\t([\s\S]+)$/.exec(entry);
      if (!match) continue;
      const [, mode, type, , path] = match;
      const target = resolve(temp, path!);
      if (type !== 'blob' || !mode!.startsWith('100') || !target.startsWith(`${temp}${sep}`) || path!.split('/').some(p => p === '.git' || p === 'node_modules') || /^\.fehm\/(?!architecture\.json$|drift-decisions\.json$|health\.json$|security\.json$)/.test(path!)) { skipped.push(`${path}: non-source/state/submodule/symlink`); continue; }
      if (materialized.length >= 5000 || bytes >= 20 * 1024 * 1024) { skipped.push(`${path}: snapshot size limit`); continue; }
      try {
        const text = blob(root, commit, path!);
        bytes += Buffer.byteLength(text);
        mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, text); materialized.push(path!);
      } catch { skipped.push(`${path}: binary, oversized or unavailable blob`); }
    }
    const engine = FehmEngine.open(temp, { dryRun: true });
    const facts = new BriefingFacts(engine), model = buildArchitectureModel(engine, facts);
    const security = buildSecurityReport({ engine, facts, dryRun: true });
    const health = buildHealthReport({ engine, facts, dryRun: true });
    const drift = analyzeDrift({ engine, facts, model, files: materialized }).report;
    const prompts = buildPromptReport({ engine, facts, security });
    const snapshot: MemorySnapshot = {
      version: VERSION, commit, at: git(root, ['show', '-s', '--format=%aI', commit]).trim(), analyzedAt: new Date().toISOString(),
      coverage: { materialized: materialized.length, indexed: engine.fileHashes().size, skipped, complete: skipped.length === 0 },
      architecture: model.nodes.map(n => ({ id: n.id, name: n.name, type: n.type, files: n.files })),
      relationships: engine.graph.edges().filter(e => e.kind !== 'contains' && e.kind !== 'defines').map(e => ({ source: e.source, target: e.target, kind: e.kind })),
      security: security.findings.map(f => ({ id: f.id, title: f.title, file: f.file ?? null })),
      drift: drift.findings.map(f => ({ id: f.id, title: f.title })),
      health: health.findings.map(f => ({ id: f.id, title: f.title })),
      prompts: prompts.prompts.map(p => ({ id: p.id, path: p.path, name: p.name, line: p.line, digest: digest(p.text), staticScore: p.score.static, model: p.model, tools: p.tools })),
      metrics: { securityFindings: security.findings.length, driftFindings: drift.findings.length, healthFindings: health.findings.length, prompts: prompts.prompts.length, promptStaticScore: prompts.summary.averageScore, testFiles: engine.graph.nodes().filter(n => n.kind === 'file' && n.isTest).length, coveragePercent: null, passingTests: null },
      unknowns: ['Reconstructed with current FEHM analyzers, not measurements made at commit time.', 'Only committed content is used. No project scripts, model evaluations or tests execute.', 'Static finding absence is not proof of a fix. Changes in finding identity can reflect line moves.', 'Drift uses the contract and decisions committed at this revision, when present.', 'Coverage and runtime test results remain unknown.', ...prompts.unknowns, ...model.unknowns],
    };
    if (!options.dryRun) writeJsonAtomic(cachePath, snapshot);
    return snapshot;
  } finally { rmSync(temp, { recursive: true, force: true }); }
}
export function compareMemorySnapshots(before: MemorySnapshot, after: MemorySnapshot) {
  if (before.version !== after.version) throw new Error('Snapshot analyzer versions differ; rebuild both snapshots');
  const delta = <T extends { id: string }>(a: T[], b: T[]) => {
    const old = new Set(a.map(x => x.id)), next = new Set(b.map(x => x.id));
    const oldItems = new Map(a.map(x => [x.id, x]));
    return { appeared: b.filter(x => !old.has(x.id)), noLongerDetected: a.filter(x => !next.has(x.id)), modified: b.filter(x => old.has(x.id) && JSON.stringify(oldItems.get(x.id)) !== JSON.stringify(x)).map(x => ({ before: oldItems.get(x.id)!, after: x })) };
  };
  // Prompt IDs can depend on line numbers. Match unique path/name pairs; ambiguity is retained as unknown.
  const promptChanges = after.prompts.flatMap(p => {
    const candidates = before.prompts.filter(q => q.path === p.path && q.name === p.name);
    if (candidates.length !== 1 || after.prompts.filter(q => q.path === p.path && q.name === p.name).length !== 1) return [];
    const old = candidates[0]!;
    return old.digest === p.digest ? [] : [{ path: p.path, name: p.name, before: old.staticScore, after: p.staticScore, staticRegression: p.staticScore < old.staticScore, evidence: 'Unique path/name association; static score change, not behavioral quality' }];
  });
  const edges = (s: MemorySnapshot) => s.relationships.map(e => ({ ...e, id: JSON.stringify(e) }));
  return { before: before.commit, after: after.commit, coverage: { before: before.coverage, after: after.coverage }, architecture: delta(before.architecture, after.architecture), relationships: delta(edges(before), edges(after)), security: delta(before.security, after.security), drift: delta(before.drift, after.drift), health: delta(before.health, after.health), prompts: promptChanges, metrics: Object.fromEntries(Object.keys(after.metrics).map(k => [k, { before: before.metrics[k] ?? null, after: after.metrics[k] ?? null }])), caveat: 'Observed differences between two analyzed revisions. This does not prove the exact introduction/fix commit, causality, or behavior; skipped files and identity changes affect results.' };
}
