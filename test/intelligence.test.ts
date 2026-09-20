import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { createConfig } from "../src/config.js";
import {
  buildCodeArchaeology,
  buildEngineeringIntelligence,
  collectArchitectureMemory,
  collectGitHistory,
  compareArchitectureDrift,
} from "../src/intelligence.js";
import { buildIndex } from "../src/indexer.js";

const execFileAsync = promisify(execFile);

test("builds architecture memory, Git archaeology, risk hotspots, and engineering recommendations", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "fehm-intelligence-"));
  try {
    await mkdir(path.join(root, "src"), { recursive: true });
    await mkdir(path.join(root, "docs", "adr"), { recursive: true });
    await writeFile(
      path.join(root, "docs", "adr", "0001-processing.md"),
      ["# ADR-001 Processing", "", "## Context", "Large batches must remain local.", "", "## Decision", "Use a bounded processor.", "", "## Consequences", "Memory is predictable."].join("\n"),
    );
    const body = [
      'import { readFileSync } from "node:fs";',
      "// WHY: synchronous reads preserve the legacy ordering contract",
      "export function processItems(value: number): number {",
      "  readFileSync(\"input.txt\");",
      ...Array.from({ length: 62 }, (_, index) => `  if (value === ${index}) value += ${index};`),
      "  return value;",
      "}",
    ].join("\n");
    await writeFile(path.join(root, "src", "processor.ts"), body);
    await execFileAsync("git", ["init", "-q"], { cwd: root });
    await execFileAsync("git", ["config", "user.email", "fehm@example.test"], { cwd: root });
    await execFileAsync("git", ["config", "user.name", "fehm Test"], { cwd: root });
    await execFileAsync("git", ["add", "."], { cwd: root });
    await execFileAsync("git", ["commit", "-qm", "add bounded processing decision"], { cwd: root });

    const graph = await buildIndex(createConfig(root));
    const memory = await collectArchitectureMemory(graph);
    assert.ok(memory.some((record) => record.kind === "adr"));
    assert.ok(memory.some((record) => record.kind === "why" && record.path === "src/processor.ts"));
    const history = await collectGitHistory(root);
    assert.equal(history.available, true);
    assert.equal(history.commits, 1);
    const report = await buildEngineeringIntelligence(graph);
    assert.ok(report.performance.some((finding) => finding.rule === "sync-io"));
    assert.ok(report.hotspots.some((hotspot) => hotspot.node.name === "processItems" && hotspot.level !== "low"));
    assert.ok(report.refactoring.some((item) => item.kind === "large-function"));
    const archaeology = await buildCodeArchaeology(graph, "processItems");
    assert.equal(archaeology.origin?.subject, "add bounded processing decision");
    assert.ok(archaeology.relatedMemory.length >= 1);
    assert.ok(archaeology.confidence >= 75);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("detects architecture degradation between graph versions", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "fehm-drift-"));
  try {
    await mkdir(path.join(root, "src", "controllers"), { recursive: true });
    await mkdir(path.join(root, "src", "services"), { recursive: true });
    await mkdir(path.join(root, "src", "db"), { recursive: true });
    await writeFile(path.join(root, "src", "services", "userService.ts"), "export const userService = 1;\n");
    await writeFile(path.join(root, "src", "db", "userDb.ts"), "export const userDb = 1;\n");
    const controllerPath = path.join(root, "src", "controllers", "userController.ts");
    await writeFile(controllerPath, 'import { userService } from "../services/userService.js";\nexport const user = userService;\n');
    const configPath = path.join(root, "architecture.json");
    await writeFile(configPath, JSON.stringify({
      version: 1,
      layers: [
        { name: "controller", patterns: ["src/controllers/**"] },
        { name: "service", patterns: ["src/services/**"] },
        { name: "database", patterns: ["src/db/**"] },
      ],
      allowedDependencies: { controller: ["service"], service: ["database"], database: [] },
    }));
    const before = await buildIndex(createConfig(root));
    await writeFile(controllerPath, 'import { userDb } from "../db/userDb.js";\nexport const user = userDb;\n');
    const after = await buildIndex(createConfig(root));
    const drift = await compareArchitectureDrift(before, after, configPath);
    assert.equal(drift.status, "degraded");
    assert.equal(drift.addedViolations.length, 1);
    assert.equal(drift.resolvedViolations.length, 0);
    assert.equal(drift.addedViolations[0]?.sourceLayer, "controller");
    assert.equal(drift.addedViolations[0]?.targetLayer, "database");
    await writeFile(controllerPath, 'import { userService } from "../services/userService.js";\nexport const user = userService;\n');
    await writeFile(path.join(root, "src", "controllers", "otherController.ts"), 'import { userDb } from "../db/userDb.js";\nexport const other = userDb;\n');
    const replacement = await buildIndex(createConfig(root));
    const replaced = await compareArchitectureDrift(after, replacement, configPath);
    assert.equal(replaced.addedViolations.length, 1);
    assert.equal(replaced.resolvedViolations.length, 1);
    assert.equal(replaced.status, "degraded", "resolved violations cannot cancel out new violations");

  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
