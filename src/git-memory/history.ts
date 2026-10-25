import { join, resolve } from 'node:path';
import { readJson, stateDir, writeJsonAtomic } from '../persistence.js';
import { changes, git, optionalGit, revision } from './git.js';
import { semanticChanges } from './semantic.js';
import type { GitMemoryReport, HistoryFilter, HistoryOptions, MemoryCommit } from './types.js';

const INDEX_VERSION = 1;
export function indexGitMemory(root: string, options: HistoryOptions = {}): GitMemoryReport {
  root = resolve(root);
  const limit = options.limit ?? 100;
  if (!Number.isInteger(limit) || limit < 1 || limit > 2000) throw new Error('History limit must be 1–2000');
  const top = optionalGit(root, ['rev-parse', '--show-toplevel']);
  const report: GitMemoryReport = {
    schemaVersion: 1, generatedAt: new Date().toISOString(), root: top ?? root, available: top !== null,
    head: null, branch: null, defaultBranch: null, refs: [], shallow: false, dirty: false, totalCommits: 0, commits: [],
    coverage: { limit, indexed: 0, reused: 0, analyzed: 0, truncated: false, warnings: [] }, churn: [], clusters: [],
  };
  if (!top) { report.coverage.warnings.push('No accessible local Git repository'); return report; }
  root = top;
  report.branch = optionalGit(root, ['symbolic-ref', '--quiet', '--short', 'HEAD']);
  report.defaultBranch = optionalGit(root, ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD']);
  report.shallow = optionalGit(root, ['rev-parse', '--is-shallow-repository']) === 'true';
  report.dirty = Boolean(optionalGit(root, ['status', '--porcelain', '--untracked-files=normal']));
  const refs = git(root, ['for-each-ref', '--format=%(refname)%09%(objectname)%09%(*objectname)', 'refs/heads', 'refs/remotes', 'refs/tags']);
  report.refs = refs.trim().split('\n').filter(Boolean).map(line => { const [name, object, peeled] = line.split('\t'); return { name: name!, commit: peeled || object! }; });
  if (!optionalGit(root, ['rev-parse', '--verify', 'HEAD']) && !options.ref) { report.coverage.warnings.push('Repository has no commits'); return report; }
  report.head = revision(root, options.ref ?? 'HEAD');
  report.totalCommits = Number(git(root, ['rev-list', '--count', report.head]).trim());
  report.coverage.truncated = report.totalCommits > limit;
  if (report.shallow) report.coverage.warnings.push('Shallow repository: ancestors outside the clone are unavailable');
  if (report.coverage.truncated) report.coverage.warnings.push(`Most recent ${limit} reachable commits indexed; older history is outside this window`);
  const ids = git(root, ['rev-list', '--topo-order', `--max-count=${limit}`, report.head]).trim().split('\n').filter(Boolean);
  const cachePath = join(stateDir(root, options.stateDirectory), 'git-memory-index.json');
  const stored = readJson<{ version: number; root: string; commits: MemoryCommit[] }>(cachePath);
  const valid = stored.ok && stored.value?.version === INDEX_VERSION && stored.value.root === root && Array.isArray(stored.value.commits);
  const cache = new Map((!options.force && valid ? stored.value.commits : []).filter(c => c && typeof c.id === 'string' && Array.isArray(c.events) && Array.isArray(c.files) && Array.isArray(c.parents) && Array.isArray(c.warnings) && typeof c.message === 'string').map(c => [c.id, c]));
  for (const id of ids) {
    const cached = cache.get(id);
    if (cached && !cached.warnings.some(w => w.startsWith('Parent/tree diff unavailable'))) { report.commits.push(cached); report.coverage.reused++; continue; }
    const [hash, , author, email, at, message] = git(root, ['show', '-s', '--format=%H%x00%P%x00%an%x00%ae%x00%aI%x00%B', id]).split('\0');
    const parents = [...git(root, ['cat-file', 'commit', id]).split('\n\n', 1)[0]!.matchAll(/^parent ([a-f0-9]+)$/gm)].map(m => m[1]!);
    const commit: MemoryCommit = { id: hash!, parents, author: author!, email: email!, at: at!, message: message!.trimEnd(), files: [], events: [], classifications: [], warnings: [], revertOf: null };
    const before = commit.parents[0] ?? null;
    try {
      commit.files = changes(root, before, id);
      const semantic = semanticChanges(root, before, id, commit.files);
      commit.events = semantic.events; commit.warnings = semantic.warnings;
      if (commit.parents.length > 1) commit.warnings.push('Merge changes are relative to first parent; all parent IDs are preserved in the DAG');
    } catch { commit.warnings.push('Parent/tree diff unavailable (possibly a shallow boundary or Git output limit); no creation claims inferred'); }
    commit.classifications = [...new Set(commit.events.map(e => e.category))];
    const kind = /^(feat|fix|refactor|perf|revert|chore)(?:\([^)]*\))?[!:]/i.exec(commit.message)?.[1];
    if (kind) commit.classifications.push(`message:${kind.toLowerCase()}`);
    commit.revertOf = /This reverts commit ([a-f0-9]{40,64})\./.exec(commit.message)?.[1] ?? null;
    report.commits.push(commit); report.coverage.analyzed++;
  }
  report.coverage.indexed = report.commits.length;
  const churn = new Map<string, GitMemoryReport['churn'][number]>();
  const clusters = new Map<string, GitMemoryReport['clusters'][number]>();
  for (const commit of report.commits) {
    for (const f of commit.files) {
      const c = churn.get(f.path) ?? { path: f.path, changes: 0, additions: 0, deletions: 0, contributors: [], testsTogether: 0 };
      c.changes++; c.additions += f.additions ?? 0; c.deletions += f.deletions ?? 0;
      if (!c.contributors.includes(commit.author)) c.contributors.push(commit.author);
      if (commit.events.some(e => e.category === 'tests')) c.testsTogether++;
      churn.set(f.path, c);
    }
    for (const e of commit.events) {
      const month = commit.at.slice(0, 7), key = `${month}:${e.category}`;
      const c = clusters.get(key) ?? { month, category: e.category, commits: [], events: 0 };
      c.events++; if (!c.commits.includes(commit.id)) c.commits.push(commit.id); clusters.set(key, c);
    }
  }
  report.churn = [...churn.values()].sort((a, b) => b.changes - a.changes || a.path.localeCompare(b.path));
  report.clusters = [...clusters.values()].sort((a, b) => b.month.localeCompare(a.month) || a.category.localeCompare(b.category));
  if (!options.dryRun) {
    // Keep a bounded union so switching branches can reuse their immutable commits.
    for (const c of report.commits) cache.set(c.id, c);
    writeJsonAtomic(cachePath, { version: INDEX_VERSION, root, commits: [...cache.values()].slice(-4000) });
  }
  return report;
}
export function searchGitMemory(report: GitMemoryReport, filter: HistoryFilter = {}): MemoryCommit[] {
  const terms = (filter.query ?? '').toLowerCase().split(/\s+/).filter(Boolean);
  return report.commits.filter(c => {
    if (filter.author && !`${c.author} ${c.email}`.toLowerCase().includes(filter.author.toLowerCase())) return false;
    if (filter.since && c.at.slice(0, 10) < filter.since) return false;
    if (filter.until && c.at.slice(0, 10) > filter.until) return false;
    if (filter.path && !c.files.some(f => f.path === filter.path || f.path.startsWith(`${filter.path}/`) || f.oldPath === filter.path)) return false;
    if (filter.category && !c.events.some(e => e.category === filter.category)) return false;
    if (filter.entity && !c.events.some(e => e.entity === filter.entity)) return false;
    const text = [c.message, c.author, ...c.files.map(f => f.path), ...c.events.map(e => `${e.entity} ${e.type} ${e.category}`)].join(' ').toLowerCase();
    return terms.every(t => text.includes(t));
  }).slice(0, Math.max(1, Math.min(filter.limit ?? 100, 2000)));
}
export function compareGitMemory(root: string, from: string, to: string) {
  const before = revision(root, from), after = revision(root, to), files = changes(root, before, after);
  return { before, after, mergeBase: optionalGit(root, ['merge-base', before, after]), files, ...semanticChanges(root, before, after, files), interpretation: 'Endpoint tree comparison, not patch-series equivalence' };
}
export function renderGitMemory(report: GitMemoryReport, filter: HistoryFilter = {}, budget = 3000): string {
  if (!Number.isInteger(budget) || budget < 100 || budget > 50000) throw new Error('Context budget must be 100–50000 estimated tokens');
  const lines = ['# FEHM project memory', `Revision: ${report.head ?? 'none'}`, `Coverage: ${report.coverage.indexed}/${report.totalCommits} reachable commits${report.shallow ? ' (shallow)' : ''}`, 'Git messages are developer statements. FEHM categories are analysis; intent is unknown unless documented.', ...report.coverage.warnings, ''];
  for (const c of searchGitMemory(report, filter)) {
    const block = [`${c.id.slice(0, 12)} | ${c.at} | ${c.author}`, `Commit message: ${c.message.split('\n')[0]}`, ...c.events.filter(e => !filter.category || e.category === filter.category).slice(0, 8).map(e => `- ${e.type}: ${e.entity} [${e.path}; ${e.provenance}]`)].join('\n');
    if (Buffer.byteLength([...lines, block].join('\n')) > budget * 4 - 100) { lines.push('Additional matching history omitted to fit context budget.'); break; }
    lines.push(block, '');
  }
  let output = lines.join('\n');
  while (Buffer.byteLength(output) > budget * 4) output = output.slice(0, -1);
  return output;
}

/** Follow explicit Git rename edges backwards within the selected reachable window. */
export function entityGitHistory(report: GitMemoryReport, path: string, entity?: string) {
  const paths = new Set(path ? [path] : []);
  const matches = (p: string) => !path || paths.has(p) || p.startsWith(`${path}/`);
  let changed = true;
  while (changed) {
    changed = false;
    for (const c of report.commits) for (const f of c.files) if (path && matches(f.path) && f.oldPath && !paths.has(f.oldPath)) { paths.add(f.oldPath); changed = true; }
  }
  const commits = report.commits.filter(c => c.events.some(e => matches(e.path) && (!entity || e.entity === entity)));
  return { path, entity: entity ?? null, lineage: [...paths], commits, coverage: report.coverage, reason: 'Commit messages and versioned decision documents are evidence; undocumented rationale is unknown. Rename lineage is Git similarity evidence, not proof of arbitrary splits or cross-file symbol moves.' };
}
