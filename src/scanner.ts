import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { basename, extname, join, resolve } from "node:path";
import type { FileRole, Language, ScanChanges, ScanResult, ScannedFile } from "./model.js";

/** Dependency, build-output and tool-state directories. Never walked. */
export const EXCLUDED_DIRECTORIES = new Set([
  "node_modules", "bower_components", "jspm_packages", "vendor",
  "dist", "build", "out", "target", "coverage", ".nyc_output",
  "__pycache__", ".venv", "venv", ".tox", ".mypy_cache", ".pytest_cache", ".ruff_cache",
  ".next", ".nuxt", ".svelte-kit", ".turbo", ".cache", ".parcel-cache",
  ".git", ".hg", ".svn", ".fehm", ".gradle", ".idea",
]);
/** Hidden directories are skipped except these, which hold real project config. */
const HIDDEN_ALLOWED = new Set([".github"]);

export const DEFAULT_MAX_FILE_BYTES = 1_000_000;

const LANGUAGE_BY_EXTENSION: Record<string, Language> = {
  ".ts": "typescript", ".tsx": "typescript", ".mts": "typescript", ".cts": "typescript",
  ".js": "javascript", ".jsx": "javascript", ".mjs": "javascript", ".cjs": "javascript",
  ".py": "python", ".go": "go", ".rs": "rust", ".java": "java",
  ".json": "json", ".yaml": "yaml", ".yml": "yaml", ".toml": "toml",
  ".md": "markdown", ".mdx": "markdown",
};

const MANIFESTS = new Set([
  "package.json", "pyproject.toml", "setup.py", "setup.cfg", "requirements.txt", "Pipfile",
  "go.mod", "Cargo.toml", "pom.xml", "build.gradle", "build.gradle.kts",
]);
const EXTRA_CONFIG_NAMES = new Set(["Dockerfile", "Makefile", ".env.example", ".editorconfig"]);
const CODE_LANGUAGES = new Set<Language>(["typescript", "javascript", "python", "go", "rust", "java"]);

export function detectLanguage(path: string): Language {
  if (path.endsWith(".d.ts")) return "typescript";
  return LANGUAGE_BY_EXTENSION[extname(path).toLowerCase()] ?? "other";
}

export function isTestPath(path: string): boolean {
  const name = basename(path);
  return (
    /(^|\/)(test|tests|__tests__|spec|specs)\//.test(path) ||
    /\.(test|spec)\.[cm]?[jt]sx?$/.test(name) ||
    /_test\.(go|py)$/.test(name) ||
    /^test_.*\.py$/.test(name) ||
    /(Test|Tests|IT)\.java$/.test(name) ||
    /(^|\/)src\/test\//.test(path)
  );
}

export function classifyRole(path: string, language: Language): FileRole {
  const name = basename(path);
  if (MANIFESTS.has(name)) return "manifest";
  if (CODE_LANGUAGES.has(language)) {
    if (isTestPath(path)) return "test";
    if (/\.config\.[cm]?[jt]s$/.test(name) || /^\.?[a-z]+rc\.[cm]?js$/.test(name)) return "config";
    return "source";
  }
  if (language === "markdown" || /\.txt$/i.test(name)) return "docs";
  if (language === "json" || language === "yaml" || language === "toml" || EXTRA_CONFIG_NAMES.has(name)) return "config";
  // Infrastructure as code and build/CI definitions without a language of their own (read by 3.3's deployment view and 3.6).
  if (/\.(?:tf|tfvars|hcl)$/.test(name) || /^Dockerfile\.|\.dockerfile$|^Jenkinsfile$|^Containerfile$/i.test(name)) return "config";
  if (/\.(?:prompt|jinja2?|prompt\.txt)$/.test(name) || /(?:^|\/)(?:prompts?|templates?)\/.*\.txt$/.test(path)) return "config";
  // Literal HTML is indexed as a delivery asset, not executable source.
  if (/\.html?$/i.test(name)) return "config";
  return "other";
}

/**
 * Minimal gitignore-style matcher: `#` comments, `!` negation, leading `/`
 * anchors, trailing `/` directory-only, `*`, `**`, `?`. Last match wins.
 */
export class IgnoreMatcher {
  private readonly rules: { regex: RegExp; negate: boolean; dirOnly: boolean }[] = [];

  add(patterns: string): this {
    for (let line of patterns.split(/\r?\n/)) {
      line = line.trim();
      if (!line || line.startsWith("#")) continue;
      const negate = line.startsWith("!");
      if (negate) line = line.slice(1);
      const dirOnly = line.endsWith("/");
      if (dirOnly) line = line.slice(0, -1);
      const anchored = line.startsWith("/") || line.slice(0, -1).includes("/");
      line = line.replace(/^\//, "");
      if (!line) continue;
      const body = line
        .split("**")
        .map((part) => part.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*").replace(/\?/g, "[^/]"))
        .join(".*");
      const regex = new RegExp(`${anchored ? "^" : "(^|/)"}${body}(/.*)?$`);
      this.rules.push({ regex, negate, dirOnly });
    }
    return this;
  }

  ignores(path: string, isDirectory: boolean): boolean {
    let ignored = false;
    for (const rule of this.rules) {
      if (rule.dirOnly && !isDirectory && !rule.regex.test(path.replace(/\/[^/]*$/, ""))) continue;
      if (rule.regex.test(path)) ignored = !rule.negate;
    }
    return ignored;
  }
}

function readIgnoreFile(path: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}

export function hashContent(content: Buffer | string): string {
  return createHash("sha256").update(content).digest("hex");
}

function isBinary(buffer: Buffer): boolean {
  const limit = Math.min(buffer.length, 8192);
  for (let i = 0; i < limit; i += 1) if (buffer[i] === 0) return true;
  return false;
}

export interface ScanOptions {
  maxFileBytes?: number;
  /** Extra ignore patterns (gitignore syntax). */
  ignore?: string[];
}

/**
 * Walk the repository deterministically (sorted entries, no symlink following)
 * and fingerprint every recognized file. Honors `.gitignore` and `.fehmignore`
 * at the root.
 */
export function scanRepository(rootInput: string, options: ScanOptions = {}): ScanResult {
  const root = resolve(rootInput);
  const maxBytes = options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES;
  const matcher = new IgnoreMatcher()
    .add(readIgnoreFile(join(root, ".gitignore")))
    .add(readIgnoreFile(join(root, ".fehmignore")))
    .add((options.ignore ?? []).join("\n"));
  const files: ScannedFile[] = [];
  const directories: string[] = [];
  const errors: ScanResult["errors"] = [];

  const walk = (relativeDir: string): void => {
    let entries;
    try {
      entries = readdirSync(join(root, relativeDir), { withFileTypes: true });
    } catch (error) {
      errors.push({ path: relativeDir || ".", reason: (error as Error).message });
      return;
    }
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const entry of entries) {
      const rel = relativeDir ? `${relativeDir}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (EXCLUDED_DIRECTORIES.has(entry.name)) continue;
        if (entry.name.startsWith(".") && !HIDDEN_ALLOWED.has(entry.name)) continue;
        if (matcher.ignores(rel, true)) continue;
        directories.push(rel);
        walk(rel);
        continue;
      }
      if (!entry.isFile() || matcher.ignores(rel, false)) continue;
      const language = detectLanguage(rel);
      const role = classifyRole(rel, language);
      if (language === "other" && role === "other") continue;
      files.push(fingerprint(root, rel, language, role, maxBytes, errors));
    }
  };

  walk("");
  return { root, files, directories, errors };
}

function fingerprint(
  root: string,
  path: string,
  language: Language,
  role: FileRole,
  maxBytes: number,
  errors: ScanResult["errors"],
): ScannedFile {
  const absolutePath = join(root, path);
  const base = { path, absolutePath, language, role, isTest: role === "test" };
  try {
    const size = statSync(absolutePath).size;
    const content = readFileSync(absolutePath);
    const hash = hashContent(content);
    if (size > maxBytes) return { ...base, size, hash, skipped: "too-large" };
    if (isBinary(content)) return { ...base, size, hash, skipped: "binary" };
    return { ...base, size, hash };
  } catch (error) {
    errors.push({ path, reason: (error as Error).message });
    return { ...base, size: 0, hash: "", skipped: "unreadable" };
  }
}

/** Compare a new scan against previously recorded file hashes. */
export function diffScan(previous: ReadonlyMap<string, string>, files: readonly ScannedFile[]): ScanChanges {
  const changes: ScanChanges = { added: [], modified: [], deleted: [], unchanged: [], renamed: [] };
  const current = new Set<string>();
  for (const file of files) {
    current.add(file.path);
    const before = previous.get(file.path);
    if (before === undefined) changes.added.push(file.path);
    else if (before !== file.hash || file.skipped === "unreadable") changes.modified.push(file.path);
    else changes.unchanged.push(file.path);
  }
  for (const path of [...previous.keys()].sort()) if (!current.has(path)) changes.deleted.push(path);
  // Rename evidence: identical content hash, one deleted and one added. Reported
  // only; identity is not transferred, both paths are analyzed as themselves.
  const addedByHash = new Map<string, string[]>();
  for (const file of files) {
    if (!changes.added.includes(file.path) || !file.hash) continue;
    addedByHash.set(file.hash, [...(addedByHash.get(file.hash) ?? []), file.path]);
  }
  for (const path of changes.deleted) {
    const candidates = addedByHash.get(previous.get(path) ?? "");
    if (candidates?.length === 1) changes.renamed.push({ from: path, to: candidates[0]! });
  }
  return changes;
}
