import { FehmEngine } from '../engine.js';
import { BriefingFacts } from '../codebase-briefing/facts.js';
import { detectBuild } from '../health/build.js';
import { git, optionalGit } from '../git-memory/git.js';
import { snapshot } from './snapshot.js';
import type { GuardCheck, GuardPolicy } from './types.js';

/** A working-tree assessment, not an inferred set of user requirements. */
export function analyzeChange(root: string) {
  const before = snapshot(root), unknowns = [...before.incomplete];
  const head = optionalGit(root, ['rev-parse', 'HEAD']);
  let files: {path: string; status: string}[] = [];
  try {
    // Disabling renames gives both the removed and added path for impact traversal.
    const fields = git(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--no-renames']).split('\0');
    files = fields.filter(Boolean).map(row => ({path: row.slice(3), status: row.slice(0, 2)}));
  } catch { unknowns.push('Git change information unavailable; the current file inventory is a conservative scope, not a known diff.'); files = Object.keys(before.files).map(path => ({path, status: 'unknown'})); }
  files = files.filter(f => !f.path.startsWith('.fehm/') || ['.fehm/health.json', '.fehm/findings-review.json'].includes(f.path));
  const engine = FehmEngine.open(root, {dryRun: true}), facts = new BriefingFacts(engine);
  const paths = new Set(files.map(f => f.path)), affected = new Set(paths), queue = [...paths];
  for (let i = 0; i < queue.length && i < 10000; i++) for (const path of facts.fileDeps.in.get(queue[i]!) ?? []) if (!affected.has(path)) { affected.add(path); queue.push(path); }
  if (queue.length > 10000) unknowns.push('Impact traversal reached its bound.');
  const documentationOnly = files.length > 0 && files.every(f => /\.(md|txt|rst)$/i.test(f.path));
  const risks: {category: string; paths: string[]; reason: string}[] = [];
  const risk = (category: string, pattern: RegExp, reason: string) => { const matches = [...paths].filter(p => pattern.test(p)); if (matches.length) risks.push({category, paths: matches, reason}); };
  risk('persistence', /migrat|schema|database|(?:^|\/)db\//i, 'Review data compatibility and migration rollback; static checks cannot establish production data safety.');
  risk('security-sensitive', /auth|session|token|permission|security|upload|validat|crypto|route|api|server/i, 'Review changed trust boundaries and relevant security tests.');
  risk('dependencies/configuration', /package\.json|lock|config|Docker|\.github|Makefile/i, 'Dependency, build or environment changes can affect more than direct callers.');
  if (affected.size > paths.size) risks.push({category:'shared behavior',paths:[...paths],reason:`Reverse dependencies include ${affected.size - paths.size} additional files.`});
  if (!risks.length && files.length) risks.push({category:documentationOnly ? 'documentation' : 'functional',paths:[...paths],reason:documentationOnly ? 'Only documentation paths changed; executable checks are skipped.' : 'Behavioral correctness requires tests; path heuristics do not establish security sensitivity.'});
  const tests = facts.testFiles.filter(p => affected.has(p));
  const discovered = detectBuild(root, facts).checks.filter(c => c.kind !== 'coverage');
  const relevant = discovered.filter(c => !c.cwd || c.cwd === '.' || [...affected].some(p => p.startsWith(`${c.cwd}/`)));
  const checks = relevant.map((c, i) => ({id:`change-${i + 1}`,category:c.kind === 'test' ? 'regression' : c.kind === 'lint' ? 'lint' : 'build',argv:c.argv,cwd:c.cwd || '.',required:!documentationOnly, reason: c.kind === 'test' ? 'Existing suite retained: graph suggestions alone cannot prove a safe runner-specific subset.' : `${c.kind} check for an affected package.`, status:documentationOnly ? 'skipped' : 'not run'} satisfies GuardCheck & {reason:string;status:string}));
  if (files.length && !documentationOnly && !checks.some(c => c.category === 'regression')) unknowns.push('No executable test command discovered. Add focused normal, boundary and failure-path tests for the changed behavior.');
  if (files.length && !documentationOnly && !tests.length) unknowns.push('No statically connected tests found; existing suites may cover dynamic relationships.');
  if (!files.length) unknowns.push('No working-tree changes detected. Committed change ranges are not supported by this entry point.');
  if (snapshot(root).fingerprint !== before.fingerprint) unknowns.push('Files changed during analysis; refresh before execution.');
  const policy: GuardPolicy = {checks:checks.filter(c => c.required).map(({reason: _reason,status: _status,...c}) => c),requiredCategories:[],tdd:false,security:files.length > 0 && !documentationOnly,maxAttempts:2,timeoutMs:120000,execution:'host-approved'};
  return {fingerprint:before.fingerprint,head,files,affected:[...affected],suggestedTests:tests,risks,checks,policy,unknowns,tdd:'unknown' as const,limitations:['TDD sequence cannot be inferred from final code.', 'Static dependencies and path-based risk hints are incomplete; changed symbols and API compatibility are not established.', 'No CI import, IDE interception, baseline execution, or dynamic security testing. Existing strict runs support explicit baseline and TDD evidence.', 'Repository commands execute with host permissions only after batch approval; repository scripts may perform arbitrary operations.']};
}
export type ChangeAnalysis = ReturnType<typeof analyzeChange>;
