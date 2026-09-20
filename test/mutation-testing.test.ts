import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createConfig } from "../src/config.js";
import { buildIndex } from "../src/indexer.js";
import { buildMutationPlan, runMutationTesting } from "../src/mutation-testing.js";
import { buildUnifiedHealth, searchEverything } from "../src/project-intelligence.js";

test("generates AST-safe mutants and executes them in an isolated repository copy", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "fehm-mutations-"));
  try {
    await mkdir(path.join(root, "src"), { recursive: true }); await mkdir(path.join(root, "test"), { recursive: true });
    await writeFile(path.join(root, "package.json"), JSON.stringify({ type: "module", scripts: { test: "node --test test/calculator.test.js" } }));
    const sourcePath = path.join(root, "src", "calculator.js");
    const source = "export function calculate(value) { return value > 10 ? value + 1 : value - 1; }\nexport function unusedFlag() { return true; }\nexport function label(value) { return 'value:' + value; }\n";
    await writeFile(sourcePath, source);
    await writeFile(path.join(root, "test", "calculator.test.js"), [
      "import assert from 'node:assert/strict';",
      "import test from 'node:test';",
      "import { calculate } from '../src/calculator.js';",
      "test('calculates both sides and boundary', () => { assert.equal(calculate(11), 12); assert.equal(calculate(10), 9); });",
    ].join("\n"));
    const graph = await buildIndex(createConfig(root));
    const plan = await buildMutationPlan(graph);
    assert.ok(plan.some((item) => item.operator === "conditional-boundary"));
    assert.ok(plan.some((item) => item.operator === "boolean-literal"));
    assert.ok(!plan.some((item) => item.line === 3 && item.operator === "arithmetic"), "obvious string concatenation must not produce a type-invalid arithmetic mutant");
    assert.ok(plan.every((item) => item.nodeId));
    const report = await runMutationTesting(graph, { limit: 20, timeoutMs: 20_000 });
    assert.equal(report.baseline.status, "passed");
    assert.equal(report.executed, report.results.length);
    assert.ok(report.killed > 0, `covered arithmetic and boundary mutants should be killed: ${JSON.stringify(report.results.map((item) => ({ operator: item.operator, status: item.status, exitCode: item.exitCode, output: item.output.slice(-120) })))}`);
    assert.ok(report.survived > 0, "the deliberately untested boolean should survive");
    assert.ok(report.score > 0 && report.score < 100);
    assert.equal(await readFile(sourcePath, "utf8"), source, "mutation testing must never edit the source repository");
    const persisted = JSON.parse(await readFile(path.join(root, ".fehm", "mutations", "latest.json"), "utf8")) as { executed: number };
    assert.equal(persisted.executed, report.executed);
    assert.ok((await buildUnifiedHealth(graph)).dimensions.mutationTesting);
    assert.ok((await searchEverything(graph, "survived boolean literal")).some((item) => item.kind === "mutation"));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("reports unavailable execution when no test command exists", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "fehm-mutations-no-tests-"));
  try {
    await writeFile(path.join(root, "package.json"), JSON.stringify({ type: "module" }));
    await writeFile(path.join(root, "index.js"), "export const enabled = true;\n");
    const graph = await buildIndex(createConfig(root)); const report = await runMutationTesting(graph);
    assert.equal(report.baseline.status, "unavailable");
    assert.equal(report.executed, 0);
    assert.ok(report.unexecuted.length > 0);
  } finally { await rm(root, { recursive: true, force: true }); }
});
