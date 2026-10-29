import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, renameSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';
import { makeRepo, tempDir, writeFile } from './helpers.js';
import { compareGitMemory, entityGitHistory, indexGitMemory, renderGitMemory, searchGitMemory } from '../src/git-memory/history.js';
import { commitHistoryDiff, historyBlame, rawHistoryDiff } from '../src/git-memory/git.js';
import { compareMemorySnapshots, historicalSnapshot } from '../src/git-memory/snapshots.js';
import { startServer } from '../src/server.js';
const git = (root: string, ...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore','pipe','pipe'] }).trim();
function repository() {
  const root = makeRepo({ 'src/auth.ts': 'export function authenticate() { return false; }\n', 'package.json': '{"dependencies":{"example":"1.0.0"}}', '.gitignore': '.fehm/\n' });
  git(root, 'init', '-b', 'main'); git(root, 'config', 'user.name', 'Test Engineer'); git(root, 'config', 'user.email', 'test@example.com');
  commit(root, 'feat: introduce authentication'); return root;
}
function commit(root: string, message: string) { git(root, 'add', '.'); git(root, 'commit', '-m', message); return git(root, 'rev-parse', 'HEAD'); }

test('Git memory handles non-Git and unborn repositories without fabricated history', () => {
  const root = makeRepo({}); assert.equal(indexGitMemory(root).available, false);
  git(root, 'init'); const r = indexGitMemory(root); assert.equal(r.available, true); assert.equal(r.head, null); assert.equal(r.commits.length, 0);
});

test('incremental semantic history, rename lineage, dependencies, filters and bounded export', () => {
  const root = repository(), first = git(root, 'rev-parse', 'HEAD');
  writeFile(root, 'src/auth.ts', 'export function authenticate() { return true; }\n');
  writeFile(root, 'package.json', '{"dependencies":{"example":"2.0.0","added":"^1"}}');
  writeFile(root, 'src/auth.test.ts', 'export function authTest() { return true; }\n');
  const second = commit(root, 'fix: validate auth');
  renameSync(join(root, 'src/auth.ts'), join(root, 'src/session.ts')); const third = commit(root, 'refactor: move authentication');
  const r = indexGitMemory(root);
  assert.equal(r.commits.length, 3); assert.equal(r.coverage.analyzed, 3);
  assert.ok(r.commits.find(c => c.id === first)!.events.some(e => e.type === 'SYMBOL_CREATED' && e.entity === 'authenticate'));
  assert.ok(r.commits.find(c => c.id === second)!.events.some(e => e.type === 'SYMBOL_MODIFIED'));
  assert.ok(r.commits.find(c => c.id === second)!.events.some(e => e.type === 'DEPENDENCY_VERSION_CHANGED' && e.before === '1.0.0' && e.after === '2.0.0'));
  assert.ok(r.commits[0]!.files.some(f => f.oldPath === 'src/auth.ts' && f.path === 'src/session.ts'));
  assert.ok(r.commits[0]!.events.some(e => e.type === 'SYMBOL_MOVED'));
  assert.equal(indexGitMemory(root).coverage.reused, 3);
  assert.equal(searchGitMemory(r, { category: 'dependencies' }).length, 2);
  assert.equal(searchGitMemory(r, { entity: 'authenticate' }).length, 3);
  assert.equal(entityGitHistory(r, 'src/session.ts', 'authenticate').commits.length, 3);
  assert.equal(entityGitHistory(r, 'src', 'authenticate').commits.length, 3);
  assert.equal(entityGitHistory(r, '', 'authenticate').commits.length, 3);
  assert.ok(r.churn.find(c => c.path === 'src/auth.ts')!.testsTogether > 0);
  const comparison = compareGitMemory(root, first, third);
  assert.equal(comparison.before, first); assert.ok(comparison.events.length);
  assert.match(rawHistoryDiff(root, first, second), /return true/);
  assert.match(historyBlame(root, third, 'src/session.ts'), /author Test Engineer/);
  assert.ok(Buffer.byteLength(renderGitMemory(r, {}, 150)) <= 600);
  assert.equal(indexGitMemory(root, { limit: 1 }).coverage.truncated, true);
  assert.throws(() => indexGitMemory(root, { limit: NaN }), /limit/);
  assert.throws(() => compareGitMemory(root, '--output=oops', 'HEAD'), /Invalid/);
  assert.throws(() => historyBlame(root, 'HEAD', 'src/session.ts', 0, 1000), /Invalid/);
});

test('branch reachability, merge DAG, unusual filenames, detached HEAD and rewritten refs', () => {
  const root = repository();
  git(root, 'checkout', '-b', 'feature');
  // Windows forbids newlines in file names; retain an unusual valid path there.
  const oddPath = process.platform === 'win32' ? 'odd name.ts' : 'odd\tname\n.ts';
  writeFile(root, oddPath, 'export const odd = 1;\n'); const feature = commit(root, 'feat: side branch');
  git(root, 'checkout', 'main');
  assert.equal(indexGitMemory(root).commits.some(c => c.id === feature), false);
  assert.equal(indexGitMemory(root, { ref: 'feature' }).commits[0]!.files[0]!.path, oddPath);
  writeFile(root, 'main.ts', 'export const main = 1;\n'); commit(root, 'feat: main change');
  git(root, 'merge', '--no-ff', 'feature', '-m', 'merge feature');
  const merged = indexGitMemory(root); assert.equal(merged.commits[0]!.parents.length, 2); assert.ok(merged.commits.some(c => c.id === feature));
  git(root, 'checkout', '--detach', feature);
  const detached = indexGitMemory(root); assert.equal(detached.branch, null); assert.equal(detached.commits.length, 2);
});

test('shallow clones do not pretend boundary commits created all files; deepening repairs the index', () => {
  const source = repository(); writeFile(source, 'next.ts', 'export const next = 1;\n'); commit(source, 'next');
  const clone = join(tempDir(), 'clone'); git(source, 'clone', '--depth=1', `file://${source}`, clone);
  const shallow = indexGitMemory(clone); assert.equal(shallow.shallow, true);
  // Git show exposes true parent IDs even when rev-list stops at shallow boundaries.
  assert.ok(shallow.commits[0]!.warnings.some(w => w.includes('Parent/tree')));
  assert.equal(shallow.commits[0]!.events.length, 0);
  git(clone, 'fetch', '--unshallow');
  const full = indexGitMemory(clone); assert.equal(full.commits.length, 2); assert.ok(full.commits[0]!.events.length > 0);
});

test('snapshots use committed content, skip symlinks and preserve the dirty working tree', () => {
  const root = repository(), before = git(root, 'rev-parse', 'HEAD');
  writeFile(root, 'src/auth.ts', 'export function authenticate() { return true; }\n');
  writeFile(root, 'assistant.prompt.txt', 'You are a helpful assistant. Return JSON only.\n');
  symlinkSync('/etc/passwd', join(root, 'external.txt')); const after = commit(root, 'feat: prompt');
  writeFile(root, 'src/auth.ts', 'UNCOMMITTED CONTENT\n');
  const status = git(root, 'status', '--porcelain');
  const a = historicalSnapshot(root, before), b = historicalSnapshot(root, after);
  assert.equal(b.commit, after); assert.ok(b.prompts.length > 0);
  assert.ok(b.coverage.skipped.some(s => s.includes('external.txt')));
  assert.equal(b.metrics.coveragePercent, null);
  assert.equal(git(root, 'status', '--porcelain'), status); assert.equal(readFileSync(join(root, 'src/auth.ts'), 'utf8'), 'UNCOMMITTED CONTENT\n');
  assert.deepEqual(historicalSnapshot(root, after), b);
  assert.equal(compareMemorySnapshots(a, b).metrics.prompts!.after, b.prompts.length);
  const state = tempDir(); indexGitMemory(root, { stateDirectory: state, dryRun: true }); historicalSnapshot(root, after, { stateDirectory: state, dryRun: true });
  assert.equal(existsSync(join(state, 'git-memory-index.json')), false);
  assert.equal(existsSync(join(state, 'git-memory-snapshots')), false);
});

test('Git memory CLI and HTTP serve real history, validate methods and expose browser assets only', async () => {
  const root = repository();
  const cli = JSON.parse(execFileSync(process.execPath, ['--import', 'tsx', 'src/cli.ts', 'git-memory', '--root', root, '--json'], { encoding: 'utf8' }));
  assert.equal(cli.commits.length, 1);
  const server = await startServer(root, 0, { stateDirectory: tempDir() });
  const port = (server.address() as AddressInfo).port;
  const request = (path: string, method = 'GET', headers = {}) => new Promise<{ status: number; body: string }>((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path, method, headers }, res => { let body = ''; res.on('data', d => body += d); res.on('end', () => resolve({ status: res.statusCode!, body })); }); req.on('error', reject); req.end();
  });
  try {
    assert.equal((await request('/git-memory')).status, 200);
    assert.equal((await request('/git-memory/assets/git-memory/ui/main.js')).status, 200);
    assert.equal((await request('/git-memory/assets/git-memory/routes.js')).status, 404);
    assert.equal(JSON.parse((await request('/api/git-memory')).body).commits.length, 1);
    assert.equal((await request('/api/git-memory/snapshot')).status, 405);
    assert.equal((await request('/api/git-memory/snapshot', 'POST')).status, 403);
    assert.equal((await request('/api/git-memory/snapshot', 'POST', { 'x-fehm': '1' })).status, 200);
    assert.equal((await request('/api/git-memory?limit=bad')).status, 400);
    assert.match((await request('/api/git-memory/context')).body, /FEHM project memory/);
  } finally { await new Promise<void>(r => server.close(() => r())); }
});

 test('root commit diff is available without inventing a parent revision', () => {
  const root = repository();
  const diff = commitHistoryDiff(root, 'HEAD');
  assert.match(diff, /new file mode/); assert.match(diff, /authenticate/);
  assert.throws(() => commitHistoryDiff(root, '--help'));
});
