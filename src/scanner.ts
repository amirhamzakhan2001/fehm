import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import type { FehmConfig } from "./config.js";

const SUPPORTED_EXTENSIONS = new Set([".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx", ".mts", ".cts", ".py", ".go", ".rs", ".java"]);

export interface ScannedFile {
  absolutePath: string;
  relativePath: string;
  content: string;
  hash: string;
  language: "javascript" | "typescript" | "python" | "go" | "rust" | "java";
  test: boolean;
}

export interface ScanResult {
  files: ScannedFile[];
  skipped: Array<{ path: string; reason: string }>;
}

function toPosix(value: string): string {
  return value.split(path.sep).join("/");
}

function isTestFile(relativePath: string): boolean {
  return /(^|\/)(__tests__|test|tests)(\/|$)|\.(spec|test)\.[cm]?[jt]sx?$|(?:^|\/)test_[^/]+\.py$|_test\.(?:py|go)$|Test\.java$/.test(relativePath);
}

function languageFor(extension: string): ScannedFile["language"] {
  if (extension === ".py") return "python";
  if (extension === ".go") return "go";
  if (extension === ".rs") return "rust";
  if (extension === ".java") return "java";
  return extension.includes("t") ? "typescript" : "javascript";
}

export async function scanRepository(config: FehmConfig): Promise<ScanResult> {
  const files: ScannedFile[] = [];
  const skipped: ScanResult["skipped"] = [];

  async function walk(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of entries) {
      const absolutePath = path.join(directory, entry.name);
      const relativePath = toPosix(path.relative(config.root, absolutePath));
      if (entry.isDirectory()) {
        if (!config.excludeDirectories.has(entry.name)) await walk(absolutePath);
        continue;
      }
      if (!entry.isFile() || !SUPPORTED_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) continue;
      const details = await stat(absolutePath);
      if (details.size > config.maxFileBytes) {
        skipped.push({ path: relativePath, reason: `larger than ${config.maxFileBytes} bytes` });
        continue;
      }
      const content = await readFile(absolutePath, "utf8");
      files.push({
        absolutePath,
        relativePath,
        content,
        hash: createHash("sha256").update(content).digest("hex"),
        language: languageFor(path.extname(entry.name).toLowerCase()),
        test: isTestFile(relativePath),
      });
    }
  }

  await walk(config.root);
  return { files, skipped };
}
