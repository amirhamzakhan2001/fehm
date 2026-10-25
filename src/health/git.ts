import { execFileSync } from "node:child_process";
import type { FileHistory, GitReport } from "./types.js";

/**
 * Change history for hotspots and the changed-files scope. Bounded (window
 * and commit count) so it stays fast on long histories. A commit is counted
 * as a fix when its subject says so (fix, bug, hotfix, regression, revert):
 * a proxy for defect history, labelled as such, not a measured defect rate.
 */

export const WINDOW_DAYS = 180;
const MAX_COMMITS = 2000;
const FIX = /\b(?:fix(?:e[sd])?|bug|hotfix|regression|revert|patch(?:ed)?)\b/i;

const git = (root: string, args: string[]): string => execFileSync("git", ["-C", root, ...args], { stdio: ["ignore", "pipe", "ignore"], timeout: 30_000, maxBuffer: 64 * 1024 * 1024 }).toString();

export function gitHistory(root: string, indexed: ReadonlySet<string>): GitReport {
  const empty: GitReport = { available: false, windowDays: WINDOW_DAYS, commits: 0, files: {}, changed: [] };
  try {
    git(root, ["rev-parse", "--show-toplevel"]);
  } catch {
    return { ...empty, reason: "Not a git working tree (or git is not installed): change frequency, fix history and the changed-files scope are unavailable." };
  }
  let commit: string | undefined;
  try {
    commit = git(root, ["rev-parse", "HEAD"]).trim();
  } catch {
    return { ...empty, available: true, reason: "The repository has no commits yet." };
  }
  // Paths from git are relative to the top level; the index is relative to `root`.
  let prefix = "";
  try {
    prefix = git(root, ["rev-parse", "--show-prefix"]).trim();
  } catch {
    /* root is the top level */
  }
  const strip = (p: string): string | undefined => (prefix ? (p.startsWith(prefix) ? p.slice(prefix.length) : undefined) : p);

  const files: Record<string, FileHistory> = {};
  const authors = new Map<string, Set<string>>();
  let commits = 0;
  try {
    const log = git(root, ["log", `--since=${WINDOW_DAYS}.days`, "-n", String(MAX_COMMITS), "--no-merges", "--name-only", "--format=%x1e%H%x1f%cI%x1f%ae%x1f%s", "--", "."]);
    for (const block of log.split("\x1e").slice(1)) {
      const [head, ...paths] = block.split("\n");
      const [, date, author, subject] = head!.split("\x1f") as [string, string, string, string];
      commits += 1;
      const fix = FIX.test(subject ?? "");
      for (const raw of paths) {
        const p = raw.trim() ? strip(raw.trim()) : undefined;
        if (!p || !indexed.has(p)) continue;
        const f = (files[p] ??= { commits: 0, fixes: 0, authors: 0 });
        f.commits += 1;
        if (fix) f.fixes += 1;
        if (!f.last || date! > f.last) f.last = date!;
        const a = authors.get(p) ?? new Set<string>();
        a.add(author ?? "");
        authors.set(p, a);
      }
    }
  } catch {
    return { ...empty, available: true, commit, reason: "git log failed; history signals are unavailable." };
  }
  for (const [p, a] of authors) files[p]!.authors = a.size;

  let changed: string[] = [];
  let dirty = false;
  try {
    const diff = git(root, ["diff", "--name-only", "--relative", "HEAD", "--", "."]).split("\n");
    const untracked = git(root, ["ls-files", "--others", "--exclude-standard", "--", "."]).split("\n");
    changed = [...new Set([...diff, ...untracked].map((p) => p.trim()).filter(Boolean))].sort(); // both relative to root
    dirty = changed.length > 0;
  } catch {
    /* scope falls back to everything */
  }
  return { available: true, commit, dirty, windowDays: WINDOW_DAYS, commits, files, changed };
}
