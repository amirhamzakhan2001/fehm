import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import {
  analyzeChangeImpact,
  collectGitDiff,
  parseUnifiedDiff,
  verifyChange,
} from "../src/change.js";
import { createConfig } from "../src/config.js";
import { buildIndex } from "../src/indexer.js";

const execFileAsync = promisify(execFile);

const GREETING_DIFF = [
  "diff --git a/src/greeting.ts b/src/greeting.ts",
  "index 1111111..2222222 100644",
  "--- a/src/greeting.ts",
  "+++ b/src/greeting.ts",
  "@@ -2 +2 @@ export function formatGreeting(name: string): string {",
  "-  return `Hello ${name}`;",
  "+  return `Welcome ${name}`;",
  "",
].join("\n");

async function impactFixture(): Promise<{ root: string; cleanup: () => Promise<void> }> {
  const root = await mkdtemp(path.join(os.tmpdir(), "fehm-impact-"));
  await mkdir(path.join(root, "src", "api"), { recursive: true });
  await mkdir(path.join(root, "test"), { recursive: true });
  await writeFile(
    path.join(root, "src", "greeting.ts"),
    [
      "export function formatGreeting(name: string): string {",
      "  return `Hello ${name}`;",
      "}",
      "export function greetUser(name: string): string {",
      "  return formatGreeting(name);",
      "}",
    ].join("\n"),
  );
  await writeFile(
    path.join(root, "src", "api", "greetingRoute.ts"),
    'import { greetUser } from "../greeting.js";\nexport function getGreetingHandler() { return greetUser("API"); }\n',
  );
  await writeFile(
    path.join(root, "test", "greeting.test.ts"),
    'import { greetUser } from "../src/greeting.js";\nexport const actual = greetUser("Test");\n',
  );
  return { root, cleanup: () => rm(root, { recursive: true, force: true }) };
}

test("parses modified, added, deleted, and renamed unified-diff files", () => {
  const diff = [
    GREETING_DIFF,
    "diff --git a/src/new.ts b/src/new.ts",
    "--- /dev/null",
    "+++ b/src/new.ts",
    "@@ -0,0 +1 @@",
    "+export const added = true;",
    "diff --git a/src/old.ts b/src/old.ts",
    "--- a/src/old.ts",
    "+++ /dev/null",
    "@@ -1 +0,0 @@",
    "-export const old = true;",
    "diff --git a/src/from.ts b/src/to.ts",
    "similarity index 100%",
    "rename from src/from.ts",
    "rename to src/to.ts",
  ].join("\n");
  const projection = parseUnifiedDiff(diff);
  assert.deepEqual(
    projection.files.map((file) => [file.path, file.status, file.oldPath]),
    [
      ["src/greeting.ts", "modified", undefined],
      ["src/new.ts", "added", undefined],
      ["src/old.ts", "deleted", undefined],
      ["src/to.ts", "renamed", "src/from.ts"],
    ],
  );
  assert.deepEqual(projection.files[0]?.hunks[0], { oldStart: 2, oldLines: 1, newStart: 2, newLines: 1 });
});

test("projects changed lines onto symbols and calculates blast radius, tests, routes, and risk", async () => {
  const project = await impactFixture();
  try {
    const graph = await buildIndex(createConfig(project.root));
    const report = analyzeChangeImpact(graph, parseUnifiedDiff(GREETING_DIFF), { depth: 4 });
    assert.ok(report.directlyAffected.some((item) => item.node.name === "formatGreeting"));
    assert.ok(report.blastRadius.some((item) => item.node.name === "greetUser"));
    assert.ok(report.affectedFiles.includes("src/api/greetingRoute.ts"));
    assert.deepEqual(report.affectedTests, ["test/greeting.test.ts"]);
    assert.ok(report.affectedRoutes.some((route) => route.includes("greetingRoute")));
    assert.ok(report.risk.score > 0);
    assert.notEqual(report.risk.level, "low");
    assert.equal(report.recommendedInspectionOrder[0], "src/greeting.ts");
  } finally {
    await project.cleanup();
  }
});

test("collects an actual working-tree Git diff", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "fehm-git-"));
  try {
    await execFileAsync("git", ["init", "-q"], { cwd: root });
    await execFileAsync("git", ["config", "user.email", "fehm@example.test"], { cwd: root });
    await execFileAsync("git", ["config", "user.name", "fehm Test"], { cwd: root });
    await writeFile(path.join(root, "value.ts"), "export const value = 1;\n");
    await execFileAsync("git", ["add", "value.ts"], { cwd: root });
    await execFileAsync("git", ["commit", "-qm", "initial"], { cwd: root });
    await writeFile(path.join(root, "value.ts"), "export const value = 2;\n");
    const projection = await collectGitDiff(root);
    assert.equal(projection.source, "git");
    assert.equal(projection.files[0]?.path, "value.ts");
    assert.equal(projection.files[0]?.status, "modified");
    assert.equal(projection.files[0]?.hunks.length, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("verifies graph refresh and detects newly introduced import cycles", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "fehm-verify-"));
  try {
    await writeFile(path.join(root, "a.ts"), 'import { b } from "./b.js";\nexport const a = b;\n');
    await writeFile(path.join(root, "b.ts"), "export const b = 1;\n");
    const before = await buildIndex(createConfig(root));
    await writeFile(path.join(root, "b.ts"), 'import { a } from "./a.js";\nexport const b = a;\n');
    const after = await buildIndex(createConfig(root));
    const projection = parseUnifiedDiff([
      "diff --git a/b.ts b/b.ts",
      "--- a/b.ts",
      "+++ b/b.ts",
      "@@ -1 +1,2 @@",
      "+import { a } from \"./a.js\";",
      " export const b = 1;",
    ].join("\n"));
    const report = verifyChange(before, after, projection);
    assert.equal(report.passed, false);
    assert.equal(report.newImportCycles.length, 1);
    assert.ok(report.checks.some((check) => check.name === "import cycles" && check.status === "failed"));
    assert.ok(report.addedNodes.length > 0 || report.removedNodes.length > 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
