import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

const EXCLUDED_DIRECTORIES = new Set([".git", ".next", ".turbo", "build", "coverage", "dist", "node_modules", "out", "vendor"]);

export interface RepositoryArtifact {
  path: string;
  absolutePath: string;
  content: string;
}

function posix(value: string): string { return value.split(path.sep).join("/"); }

export async function readRepositoryArtifacts(
  root: string,
  accept: (relativePath: string, basename: string) => boolean,
  maximumBytes = 2 * 1024 * 1024,
): Promise<RepositoryArtifact[]> {
  const repository = path.resolve(root);
  const artifacts: RepositoryArtifact[] = [];
  async function walk(directory: string): Promise<void> {
    let entries;
    try { entries = await readdir(directory, { withFileTypes: true }); } catch { return; }
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const absolutePath = path.join(directory, entry.name);
      const relativePath = posix(path.relative(repository, absolutePath));
      if (entry.isDirectory()) {
        if (!EXCLUDED_DIRECTORIES.has(entry.name) && !(relativePath === ".fehm" || relativePath.startsWith(".fehm/"))) await walk(absolutePath);
        continue;
      }
      if (!entry.isFile() || !accept(relativePath, entry.name)) continue;
      try {
        if ((await stat(absolutePath)).size > maximumBytes) continue;
        artifacts.push({ path: relativePath, absolutePath, content: await readFile(absolutePath, "utf8") });
      } catch { /* disappearing or unreadable files are ignored */ }
    }
  }
  await walk(repository);
  return artifacts;
}

export function isInfrastructureArtifact(relativePath: string, basename: string): boolean {
  return /^Dockerfile(?:\..+)?$/i.test(basename)
    || /(?:^|\/)docker-compose(?:\.[^.]+)?\.ya?ml$/i.test(relativePath)
    || /(?:^|\/)compose\.ya?ml$/i.test(relativePath)
    || /\.ya?ml$/i.test(relativePath)
    || /\.tf(?:vars)?$/i.test(relativePath)
    || /(?:^|\/)\.env(?:\..+)?$/i.test(relativePath)
    || /(?:^|\/)package\.json$/i.test(relativePath);
}

export function isAiArtifact(relativePath: string): boolean {
  return /(?:^|\/)(?:data|dataset|datasets|fixtures|evals?|benchmarks?)(?:\/|$)/i.test(relativePath)
    && /\.(?:jsonl?|csv|tsv|ya?ml|txt|md)$/i.test(relativePath)
    || /\.(?:prompt|system-prompt)\.(?:txt|md)$/i.test(relativePath)
    || /(?:^|\/)(?:prompt|prompts)\//i.test(relativePath) && /\.(?:txt|md|json|ya?ml)$/i.test(relativePath);
}
