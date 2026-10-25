import { readFileSync } from "node:fs";
import { join } from "node:path";

/** Lazy, memoized line access to repository files. Missing files read as undefined. */
export class SourceReader {
  private readonly cache = new Map<string, string[] | null>();

  constructor(private readonly root: string) {}

  lines(path: string): string[] | undefined {
    if (!this.cache.has(path)) {
      try {
        this.cache.set(path, readFileSync(join(this.root, path), "utf8").split(/\r?\n/));
      } catch {
        this.cache.set(path, null);
      }
    }
    return this.cache.get(path) ?? undefined;
  }

  /** 1-based inclusive line range. */
  slice(path: string, start: number, end: number): string[] | undefined {
    const lines = this.lines(path);
    if (!lines) return undefined;
    return lines.slice(Math.max(0, start - 1), Math.min(lines.length, end));
  }
}
