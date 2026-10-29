import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export const STATE_DIRECTORY = ".fehm";

export function stateDir(root: string, override?: string): string {
  return override ? resolve(override) : join(resolve(root), STATE_DIRECTORY);
}

export type ReadResult<T> = { ok: true; value: T } | { ok: false; reason: "missing" | "malformed"; detail: string };

/** Read JSON without throwing. A malformed file is reported, never trusted. */
export function readJson<T>(path: string): ReadResult<T> {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    return { ok: false, reason: "missing", detail: (error as Error).message };
  }
  try {
    return { ok: true, value: JSON.parse(text) as T };
  } catch (error) {
    return { ok: false, reason: "malformed", detail: (error as Error).message };
  }
}

/** Write via temp file + rename so readers never see a half-written file. */
export function writeJsonAtomic(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(value)}\n`);
  renameSync(tmp, path);
}
