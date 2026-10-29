import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const CORPUS = join(REPO_ROOT, "bench", "corpus");

const made: string[] = [];
process.on("exit", () => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});

export function tempDir(prefix = "fehm-test-"): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  made.push(dir);
  return dir;
}

/** Write a repository from a path → content map. */
export function makeRepo(files: Record<string, string>): string {
  const dir = tempDir();
  for (const [path, content] of Object.entries(files)) writeFile(dir, path, content);
  return dir;
}

export function writeFile(root: string, path: string, content: string): void {
  const abs = join(root, path);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, content);
}

/**
 * Copy of the benchmark corpus plus dependency/build/hidden directories that
 * must never be indexed (they are not committed because of .gitignore).
 */
export function corpusCopy(): string {
  const dir = tempDir("fehm-corpus-");
  cpSync(CORPUS, dir, { recursive: true });
  writeFile(dir, "node_modules/express/index.js", "module.exports = function express() {};\n");
  writeFile(dir, "dist/index.js", "export function authenticateUser() {}\n");
  writeFile(dir, ".cache/tmp.ts", "export function cachedThing() {}\n");
  writeFile(dir, "scripts/__pycache__/report.cpython-312.py", "def stale(): pass\n");
  return dir;
}
