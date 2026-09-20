import path from "node:path";
import type ts from "typescript";

/** A per-analysis compiler-host cache. Never shared across scans or projects. */
export function cacheCompilerReads(host: ts.CompilerHost, sources: ReadonlyMap<string, string>): void {
  const read = host.readFile.bind(host);
  const exists = host.fileExists.bind(host);
  const reads = new Map<string, string | undefined>();
  const existence = new Map<string, boolean>();
  host.readFile = name => {
    const key = path.resolve(name);
    if (sources.has(key)) return sources.get(key);
    if (!reads.has(key)) reads.set(key, read(name));
    return reads.get(key);
  };
  host.fileExists = name => {
    const key = path.resolve(name);
    if (sources.has(key)) return true;
    if (!existence.has(key)) existence.set(key, exists(name));
    return existence.get(key)!;
  };
}
