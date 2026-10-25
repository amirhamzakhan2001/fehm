import { execFileSync } from 'node:child_process';
import type { FileChange } from './types.js';

/** No shell, external diff drivers, textconv, network or checkout. */
export function git(root: string, args: string[], maxBuffer = 16 * 1024 * 1024): string {
  return execFileSync('git', ['--no-pager', '-c', 'core.quotepath=false', ...args], {
    cwd: root, encoding: 'utf8', timeout: 15000, maxBuffer,
    stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0', GIT_NO_REPLACE_OBJECTS: '1' },
  });
}
export function optionalGit(root: string, args: string[]): string | null {
  try { return git(root, args).trim(); } catch { return null; }
}
export function revision(root: string, ref: string): string {
  if (!ref || ref.startsWith('-') || ref.length > 256 || /[\x00-\x20]/.test(ref)) throw new Error('Invalid Git revision');
  const hash = git(root, ['rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`]).trim();
  if (!/^[a-f0-9]{40,64}$/.test(hash)) throw new Error('Revision is not a commit');
  return hash;
}
export function changes(root: string, before: string | null, after: string): FileChange[] {
  const base = before ? ['diff', before, after] : ['diff-tree', '--root', '--no-commit-id', '-r', after];
  const common = ['--no-ext-diff', '--no-textconv', '-M', '-z'];
  const fields = git(root, [...base, ...common, '--name-status', '--']).split('\0');
  const files: FileChange[] = [];
  for (let i = 0; i < fields.length - 1;) {
    const status = fields[i++]!;
    if (!status) continue;
    const first = fields[i++]!;
    const path = /^[RC]/.test(status) ? fields[i++]! : first;
    files.push({ path, ...(/^[RC]/.test(status) ? { oldPath: first } : {}), status, additions: null, deletions: null });
  }
  const counts = git(root, [...base, ...common, '--numstat', '--']).split('\0');
  const byPath = new Map(files.map(f => [f.path, f]));
  for (let i = 0; i < counts.length - 1; i++) {
    const match = /^(\d+|-)\t(\d+|-)\t([\s\S]*)$/.exec(counts[i]!);
    if (!match) continue;
    let path = match[3]!;
    if (!path) { i++; path = counts[++i]!; }
    const file = byPath.get(path);
    if (file) { file.additions = match[1] === '-' ? null : Number(match[1]); file.deletions = match[2] === '-' ? null : Number(match[2]); }
  }
  return files;
}
export function blob(root: string, commit: string | null, path: string): string {
  if (!commit) return '';
  const object = `${commit}:${path}`;
  const size = Number(git(root, ['cat-file', '-s', object]).trim());
  if (size > 512000) throw new Error('Blob exceeds 512 KB analysis limit');
  const text = git(root, ['cat-file', 'blob', object], 1024 * 1024);
  if (text.includes('\0')) throw new Error('Binary content');
  return text;
}
export function rawHistoryDiff(root: string, before: string, after: string): string {
  return git(root, ['diff', '--no-ext-diff', '--no-textconv', '--no-color', revision(root, before), revision(root, after), '--']);
}
export function historyBlame(root: string, ref: string, path: string, start = 1, end = start + 49): string {
  if (!path || path.includes('\0') || !Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < start || end - start > 500) throw new Error('Invalid blame range (maximum 501 lines)');
  const commit = revision(root, ref);
  const text = blob(root, commit, path);
  const lines = text ? text.split('\n').length - (text.endsWith('\n') ? 1 : 0) : 0;
  if (start > lines) throw new Error('Blame start is beyond the end of the file');
  return git(root, ['blame', '--line-porcelain', '-L', `${start},${Math.min(end, lines)}`, commit, '--', path]);
}
