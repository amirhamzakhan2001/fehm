import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { reproduceHistoricalBug, verifyBugFix } from "../src/bug-lifecycle.js";
import { createConfig } from "../src/config.js";
import { buildIndex } from "../src/indexer.js";
import { searchEverything } from "../src/project-intelligence.js";

const execFileAsync = promisify(execFile);

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "fehm-bug-lifecycle-"));
  await mkdir(path.join(root, "src"), { recursive: true }); await mkdir(path.join(root, "test"), { recursive: true });
  await writeFile(path.join(root, "package.json"), JSON.stringify({ type: "module", scripts: { test: "node --test test/math.test.js" } }));
  await writeFile(path.join(root, "src", "math.js"), "export function add(a, b) { return a - b; }\n");
  await writeFile(path.join(root, "test", "math.test.js"), "import assert from 'node:assert/strict';\nimport test from 'node:test';\nimport { add } from '../src/math.js';\ntest('adds', () => assert.equal(add(1, 2), 3));\n");
  await execFileAsync("git", ["init"], { cwd: root }); await execFileAsync("git", ["config", "user.email", "bugs@example.com"], { cwd: root }); await execFileAsync("git", ["config", "user.name", "Bug Tester"], { cwd: root });
  await execFileAsync("git", ["add", "."], { cwd: root }); await execFileAsync("git", ["commit", "-m", "initial buggy calculator"], { cwd: root });
  await writeFile(path.join(root, "src", "math.js"), "export function add(a, b) { return a + b; }\n");
  await writeFile(path.join(root, "test", "math.test.js"), "import assert from 'node:assert/strict';\nimport test from 'node:test';\nimport { add } from '../src/math.js';\ntest('adds positive and negative values', () => { assert.equal(add(1, 2), 3); assert.equal(add(-1, 1), 0); });\n");
  await execFileAsync("git", ["add", "."], { cwd: root }); await execFileAsync("git", ["commit", "-m", "fix: add numbers correctly #91"], { cwd: root });
  const graph = await buildIndex(createConfig(root));
  return { root, graph, cleanup: () => rm(root, { recursive: true, force: true }) };
}

test("replays a historical fix and proves the parent failure", async () => {
  const project = await fixture();
  try {
    const report = await reproduceHistoricalBug(project.graph, { timeoutMs: 20_000 });
    assert.equal(report.status, "reproduced");
    assert.equal(report.buggyRun.status, "failed");
    assert.equal(report.fixedRun.status, "passed");
    assert.ok(report.parentCommit);
    assert.ok(report.changedFiles.includes("src/math.js"));
    assert.ok(report.suspectedNodeIds.some((item) => item.includes("math")));
    assert.ok(report.failureSignature.length > 0);
    assert.ok((await readFile(path.join(project.root, ".fehm", "bugs", "reproductions", `${report.fixCommit}.json`), "utf8")).includes("reproduced"));
  } finally { await project.cleanup(); }
});

test("verifies the fix with reproduction, regression, static, and mutation gates", async () => {
  const project = await fixture();
  try {
    const report = await verifyBugFix(project.graph, { timeoutMs: 20_000, mutationLimit: 10 });
    assert.equal(report.passed, true, report.failures.join(", "));
    assert.ok(Object.values(report.criteria).every(Boolean));
    assert.ok(report.regressionTests.includes("test/math.test.js"));
    assert.equal(report.mutation?.survived, 0);
    assert.ok(report.mutation?.killed);
    assert.ok((await readFile(path.join(project.root, ".fehm", "bugs", "latest-verification.json"), "utf8")).includes('"passed": true'));
    assert.ok((await searchEverything(project.graph, "reproduced parent failed")).some((item) => item.kind === "bug-history"));
    const serverSource = await readFile(path.join(process.cwd(), "src", "server.ts"), "utf8");
    assert.ok(serverSource.includes("/api/bug-reproduce") && serverSource.includes("/api/bug-fix-verify"));
  } finally { await project.cleanup(); }
});
