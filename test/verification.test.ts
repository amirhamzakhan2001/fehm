import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createConfig } from "../src/config.js";
import { buildIndex } from "../src/indexer.js";
import {
  detectVerificationCommands,
  runBuiltInStaticAnalysis,
  runVerification,
} from "../src/verification.js";

test("runs static, security, and architecture verification with source evidence", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "fehm-verification-"));
  try {
    await mkdir(path.join(root, "src", "controllers"), { recursive: true });
    await mkdir(path.join(root, "src", "db"), { recursive: true });
    await writeFile(
      path.join(root, "src", "db", "userDb.ts"),
      "export function rawQuery(value: string) { return value; }\n",
    );
    await writeFile(
      path.join(root, "src", "controllers", "userController.ts"),
      [
        'import { rawQuery } from "../db/userDb.js";',
        'const password = "supersecret123";',
        "export function getUserController(id: string) {",
        "  eval(id);",
        "  return rawQuery(`SELECT * FROM users WHERE id = ${id}`);",
        "}",
      ].join("\n"),
    );
    const architecturePath = path.join(root, "architecture.json");
    await writeFile(
      architecturePath,
      JSON.stringify({
        version: 1,
        layers: [
          { name: "controller", patterns: ["src/controllers/**"] },
          { name: "database", patterns: ["src/db/**"] },
        ],
        allowedDependencies: { controller: ["service"], database: [] },
        forbiddenDependencies: [
          { from: "src/controllers/**", to: "src/db/**", reason: "controllers must use services" },
        ],
      }),
    );
    const graph = await buildIndex(createConfig(root));
    const report = await runVerification(graph, {
      runCommands: false,
      architectureConfigPath: architecturePath,
    });
    assert.equal(report.summary.passed, false);
    assert.equal(report.security.status, "failed");
    assert.ok(report.security.findings.some((finding) => finding.id.startsWith("dynamic-eval")));
    const secret = report.security.findings.find((finding) => finding.id.startsWith("hardcoded-secret"));
    assert.ok(secret);
    assert.ok(secret.snippet.includes("***REDACTED***"));
    assert.ok(!secret.snippet.includes("supersecret123"));
    assert.equal(report.architecture.status, "failed");
    assert.ok(report.architecture.violations.some((violation) => violation.rule === "allowed-dependencies"));
    assert.ok(report.architecture.violations.some((violation) => violation.rule === "forbidden-dependency"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("detects and executes supported project verification scripts without a shell", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "fehm-commands-"));
  try {
    await writeFile(path.join(root, "index.ts"), "export const clean = true;\n");
    await writeFile(
      path.join(root, "package.json"),
      JSON.stringify({
        scripts: {
          check: 'node -e "console.log(\'types ok\')"',
          test: 'node -e "console.log(\'tests ok\')"',
        },
      }),
    );
    const commands = await detectVerificationCommands(root);
    assert.deepEqual(commands.map((command) => command.category), ["types", "test"]);
    const graph = await buildIndex(createConfig(root));
    const report = await runVerification(graph, { commandTimeoutMs: 10_000 });
    assert.equal(report.projectCommands.status, "passed");
    assert.equal(report.projectCommands.results[0]?.exitCode, 0);
    assert.ok(report.projectCommands.results[0]?.output.includes("types ok"));
    assert.equal(report.tests.status, "passed");
    assert.ok(report.tests.result?.output.includes("tests ok"));
    assert.equal(report.summary.passed, true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("warns when the graph is stale relative to source files", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "fehm-stale-"));
  try {
    const sourcePath = path.join(root, "source.ts");
    await writeFile(sourcePath, "export const version = 1;\n");
    const graph = await buildIndex(createConfig(root));
    await writeFile(sourcePath, "export const version = 2;\n");
    const observations = await runBuiltInStaticAnalysis(graph);
    const freshness = observations.find((observation) => observation.name === "index freshness");
    assert.equal(freshness?.status, "warning");
    assert.ok(freshness?.detail.includes("1 stale"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
