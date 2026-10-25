import { createHash } from 'node:crypto';
import { lstatSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Snapshot } from './types.js';
export const digest = (v: unknown): string => createHash('sha256').update(JSON.stringify(v)).digest('hex');
export const isTest = (p: string): boolean => /(^|\/)(__tests__|tests?|specs?)(\/|\.)|[._-](test|spec)\.|(^|\/)(pytest|jest|vitest|playwright)\./i.test(p);
/** Explicit output/dependency exclusions; symlinks and unreadable/oversized files fail closed. */
export function snapshot(root: string): Snapshot {
  const files: Record<string, string> = {}, tests: Record<string, string> = {}, incomplete: string[] = [];
  let total = 0, count = 0;
  const walk = (dir: string): void => {
    for (const name of readdirSync(join(root, dir)).sort()) {
      const p = dir ? `${dir}/${name}` : name;
      if (['.git','node_modules','dist','build','coverage','.cache','__pycache__'].includes(name) || (dir === '.fehm' && !['health.json','findings-review.json'].includes(name))) continue;
      try {
        const stat = lstatSync(join(root, p));
        if (stat.isSymbolicLink()) { incomplete.push(`Symlink not followed: ${p}`); continue; }
        if (stat.isDirectory()) { walk(p); continue; }
        if (!stat.isFile()) { incomplete.push(`Unsupported entry: ${p}`); continue; }
        total += stat.size;
        if (stat.size > 5_000_000 || total > 250_000_000 || count >= 30_000) { incomplete.push(`Snapshot limit: ${p}`); continue; }
        count++;
        files[p] = createHash('sha256').update(readFileSync(join(root, p))).digest('hex');
        if (isTest(p)) tests[p] = files[p]!;
      } catch { incomplete.push(`Unreadable: ${p}`); }
    }
  };
  walk('');
  return { files, tests, fingerprint: digest(files), implementation: digest(Object.fromEntries(Object.entries(files).filter(([p]) => !isTest(p)))), incomplete };
}
export function changedFiles(a: Snapshot, b: Snapshot): string[] {
  return [...new Set([...Object.keys(a.files), ...Object.keys(b.files)])].filter(p => a.files[p] !== b.files[p]).sort();
}
