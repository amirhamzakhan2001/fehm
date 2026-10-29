import assert from "node:assert/strict";
import { chmodSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { classifyRole, detectLanguage, diffScan, IgnoreMatcher, isTestPath, scanRepository } from "../src/scanner.js";
import { corpusCopy, makeRepo } from "./helpers.js";

test("scanner: supported languages, roles and tests are identified", () => {
  const scan = scanRepository(corpusCopy());
  const byPath = new Map(scan.files.map((f) => [f.path, f]));
  assert.equal(byPath.get("src/auth/authenticate.ts")?.language, "typescript");
  assert.equal(byPath.get("scripts/report.py")?.language, "python");
  assert.equal(byPath.get("services/billing/main.go")?.language, "go");
  assert.equal(byPath.get("test/auth.test.ts")?.isTest, true);
  assert.equal(byPath.get("test/auth.test.ts")?.role, "test");
  assert.equal(byPath.get("package.json")?.role, "manifest");
  assert.equal(byPath.get("services/billing/go.mod")?.role, "manifest");
  assert.match(byPath.get("src/index.ts")!.hash, /^[0-9a-f]{64}$/);
});

test("scanner: dependency, build, cache and hidden directories are never walked", () => {
  const scan = scanRepository(corpusCopy());
  const paths = scan.files.map((f) => f.path);
  for (const p of paths) assert.doesNotMatch(p, /node_modules|^dist\/|__pycache__|^\.cache\//, p);
  assert.ok(!scan.directories.some((d) => d.includes("node_modules")));
});

test("scanner: deterministic ordering across runs", () => {
  const dir = corpusCopy();
  const a = scanRepository(dir);
  const b = scanRepository(dir);
  assert.deepEqual(a.files.map((f) => [f.path, f.hash]), b.files.map((f) => [f.path, f.hash]));
  assert.deepEqual(a.directories, b.directories);
});

test("scanner: empty, large, binary and unknown files", () => {
  const dir = makeRepo({
    "empty.ts": "",
    "big.ts": `export const x = "${"a".repeat(2000)}";\n`,
    "bin.ts": "abc\u0000def",
    "image.png": "not really",
    "notes.xyz": "unknown extension",
    ".github/workflows/ci.yml": "on: push\n",
    ".secret/hidden.ts": "export const hidden = 1;\n",
  });
  const scan = scanRepository(dir, { maxFileBytes: 1000 });
  const byPath = new Map(scan.files.map((f) => [f.path, f]));
  assert.equal(byPath.get("empty.ts")?.size, 0);
  assert.equal(byPath.get("empty.ts")?.skipped, undefined);
  assert.equal(byPath.get("big.ts")?.skipped, "too-large");
  assert.equal(byPath.get("bin.ts")?.skipped, "binary");
  assert.ok(!byPath.has("image.png") && !byPath.has("notes.xyz"), "unrecognized files are not indexed");
  assert.equal(byPath.get(".github/workflows/ci.yml")?.role, "config", ".github is the allowed hidden dir");
  assert.ok(!byPath.has(".secret/hidden.ts"));
});

test("scanner: .gitignore and .fehmignore are honored, including negation", () => {
  const dir = makeRepo({
    ".gitignore": "generated/\n*.gen.ts\n",
    ".fehmignore": "/fixtures/\n!fixtures/keep.ts\n",
    "generated/a.ts": "export const a = 1;",
    "src/x.gen.ts": "export const x = 1;",
    "src/y.ts": "export const y = 1;",
    "fixtures/drop.ts": "export const d = 1;",
  });
  const paths = scanRepository(dir).files.map((f) => f.path);
  assert.deepEqual(paths.filter((p) => p.endsWith(".ts")), ["src/y.ts"]);
  const m = new IgnoreMatcher().add("*.log\n!keep.log\nbuild/\n/root-only.txt");
  assert.equal(m.ignores("a/b.log", false), true);
  assert.equal(m.ignores("keep.log", false), false);
  assert.equal(m.ignores("x/build", true), true);
  assert.equal(m.ignores("x/build/y.ts", false), true);
  assert.equal(m.ignores("root-only.txt", false), true);
  assert.equal(m.ignores("sub/root-only.txt", false), false);
});

test("scanner: invalid source is still scanned (analysis decides what to trust)", () => {
  const dir = makeRepo({ "broken.ts": "export function (((", "broken.py": "def :\n" });
  assert.deepEqual(scanRepository(dir).files.map((f) => f.path), ["broken.py", "broken.ts"]);
});

test("scanner: unreadable files are reported, not dropped silently", { skip: process.platform === "win32" || process.getuid?.() === 0 }, () => {
  const dir = makeRepo({ "ok.ts": "export const a = 1;", "locked.ts": "export const b = 2;" });
  chmodSync(join(dir, "locked.ts"), 0o000);
  try {
    const scan = scanRepository(dir);
    assert.equal(scan.files.find((f) => f.path === "locked.ts")?.skipped, "unreadable");
    assert.ok(scan.errors.some((e) => e.path === "locked.ts"));
  } finally {
    chmodSync(join(dir, "locked.ts"), 0o644);
  }
});

test("scanner: diffScan reports added/modified/deleted/unchanged and rename evidence", () => {
  const prev = new Map([["a.ts", "h1"], ["b.ts", "h2"], ["old.ts", "h3"]]);
  const files = [
    { path: "a.ts", hash: "h1" },
    { path: "b.ts", hash: "h2x" },
    { path: "new.ts", hash: "h3" },
    { path: "c.ts", hash: "h4" },
  ].map((f) => ({ ...f, absolutePath: f.path, language: "typescript" as const, role: "source" as const, isTest: false, size: 1 }));
  const d = diffScan(prev, files);
  assert.deepEqual(d.unchanged, ["a.ts"]);
  assert.deepEqual(d.modified, ["b.ts"]);
  assert.deepEqual(d.added, ["new.ts", "c.ts"]);
  assert.deepEqual(d.deleted, ["old.ts"]);
  assert.deepEqual(d.renamed, [{ from: "old.ts", to: "new.ts" }]);
});

test("scanner: language/test/role helpers", () => {
  assert.equal(detectLanguage("a.d.ts"), "typescript");
  assert.equal(detectLanguage("Main.java"), "java");
  assert.equal(detectLanguage("lib.rs"), "rust");
  for (const p of ["pkg/foo_test.go", "tests/test_x.py", "src/a.spec.tsx", "src/test/java/FooTest.java", "__tests__/a.js"]) assert.ok(isTestPath(p), p);
  for (const p of ["src/testing.ts", "src/contest.py", "latest/a.go"]) assert.ok(!isTestPath(p), p);
  assert.equal(classifyRole("vite.config.ts", "typescript"), "config");
  assert.equal(classifyRole("README.md", "markdown"), "docs");
});
