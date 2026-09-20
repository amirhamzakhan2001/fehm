import path from "node:path";

export interface FehmConfig {
  root: string;
  outputDirectory: string;
  excludeDirectories: Set<string>;
  maxFileBytes: number;
}

const DEFAULT_EXCLUDES = [
  ".git",
  ".fehm",
  ".next",
  ".turbo",
  ".venv",
  "__pycache__",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "out",
  "vendor",
];

export function createConfig(root: string, outputDirectory?: string): FehmConfig {
  const absoluteRoot = path.resolve(root);
  return {
    root: absoluteRoot,
    outputDirectory: outputDirectory
      ? path.resolve(outputDirectory)
      : path.join(absoluteRoot, ".fehm"),
    excludeDirectories: new Set(DEFAULT_EXCLUDES),
    maxFileBytes: 2 * 1024 * 1024,
  };
}
