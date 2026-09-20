import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { buildDeadCodeIntelligence, buildDependencyRiskIntelligence, buildHistoricalBugIntelligence } from "../src/code-risk-intelligence.js";
import { createConfig } from "../src/config.js";
import { buildIndex, writeIndex } from "../src/indexer.js";
import { buildUnifiedHealth, searchEverything } from "../src/project-intelligence.js";
import { createCockpitServer } from "../src/server.js";

const execFileAsync = promisify(execFile);

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "fehm-risk-"));
  await mkdir(path.join(root, "src"), { recursive: true });
  await mkdir(path.join(root, "test"), { recursive: true });
  await writeFile(path.join(root, "package.json"), JSON.stringify({
    main: "dist/index.js",
    scripts: { test: "node --test" },
    dependencies: { "left-pad": "^1.3.0", "unused-floating": "latest", "deprecated-package": "1.0.0" },
    devDependencies: { "build-helper": "1.0.0" },
  }));
  await writeFile(path.join(root, "package-lock.json"), JSON.stringify({
    lockfileVersion: 3,
    packages: {
      "": { dependencies: { "left-pad": "^1.3.0", "unused-floating": "latest", "deprecated-package": "1.0.0" } },
      "node_modules/left-pad": { version: "1.3.0" },
      "node_modules/unused-floating": { version: "9.0.0" },
      "node_modules/deprecated-package": { version: "1.0.0", deprecated: "unsupported", hasInstallScript: true },
      "node_modules/build-helper": { version: "1.0.0" },
    },
  }));
  await writeFile(path.join(root, "src", "index.ts"), "export { calculate } from './used.js';\n");
  await writeFile(path.join(root, "src", "used.ts"), [
    "import leftPad from 'left-pad';",
    "import helper from 'build-helper';",
    "import mystery from 'mystery-package';",
    "export function calculate(value: string) { return mystery(helper(leftPad(value, 3))); }",
  ].join("\n"));
  await writeFile(path.join(root, "src", "orphan.ts"), "function hidden() { return 1; }\nexport function abandoned() { return hidden(); }\n");
  await writeFile(path.join(root, "src", "test-only.ts"), "export function onlyForTests() { const result = 'fixture'; return { result }; }\n");
  await writeFile(path.join(root, "test", "only.test.ts"), "import { onlyForTests } from '../src/test-only.js';\nvoid onlyForTests();\n");
  await execFileAsync("git", ["init"], { cwd: root });
  await execFileAsync("git", ["config", "user.email", "risk@example.com"], { cwd: root });
  await execFileAsync("git", ["config", "user.name", "Risk Tester"], { cwd: root });
  await execFileAsync("git", ["add", "."], { cwd: root });
  await execFileAsync("git", ["commit", "-m", "initial implementation"], { cwd: root });
  await writeFile(path.join(root, "src", "used.ts"), "import leftPad from 'left-pad';\nimport helper from 'build-helper';\nimport mystery from 'mystery-package';\nexport function calculate(value: string) { return mystery(helper(leftPad(value.trim(), 3))); }\n");
  await execFileAsync("git", ["add", "."], { cwd: root });
  await execFileAsync("git", ["commit", "-m", "fix: correct parser edge case #42"], { cwd: root });
  await writeFile(path.join(root, "src", "used.ts"), "import leftPad from 'left-pad';\nimport helper from 'build-helper';\nimport mystery from 'mystery-package';\nexport function calculate(value: string) { return mystery(helper(leftPad(value.replace(/[<>]/g, ''), 3))); }\n");
  await execFileAsync("git", ["add", "."], { cwd: root });
  await execFileAsync("git", ["commit", "-m", "fix security injection CVE-2025-1234"], { cwd: root });
  const config = createConfig(root);
  const graph = await buildIndex(config);
  const graphPath = await writeIndex(graph, config.outputDirectory);
  return { root, graph, graphPath, cleanup: () => rm(root, { recursive: true, force: true }) };
}

test("builds evidence-backed dependency, dead-code, and historical bug intelligence", async () => {
  const project = await fixture();
  try {
    const dependencies = await buildDependencyRiskIntelligence(project.graph);
    assert.ok(dependencies.lockfiles.includes("package-lock.json"));
    assert.ok(dependencies.dependencies.some((item) => item.name === "mystery-package" && item.kind === "undeclared" && item.severity === "high"));
    assert.ok(dependencies.dependencies.some((item) => item.name === "unused-floating" && item.reasons.some((reason) => reason.includes("floating"))));
    assert.ok(dependencies.dependencies.some((item) => item.name === "deprecated-package" && item.reasons.some((reason) => reason.includes("deprecated"))));
    assert.ok(dependencies.dependencies.some((item) => item.name === "build-helper" && item.reasons.some((reason) => reason.includes("production code"))));

    const deadCode = await buildDeadCodeIntelligence(project.graph);
    assert.ok(deadCode.findings.some((item) => item.kind === "unreachable-file" && item.node.path === "src/orphan.ts"));
    assert.ok(deadCode.findings.some((item) => item.kind === "unused-export" && item.node.name === "abandoned"));
    assert.ok(deadCode.findings.some((item) => item.kind === "test-only-code" && item.node.name === "onlyForTests"));
    assert.ok(!deadCode.findings.some((item) => item.node.name === "result"), "shorthand object references must keep local variables live");
    assert.ok(!deadCode.findings.some((item) => item.node.path === "src/index.ts"));

    const bugs = await buildHistoricalBugIntelligence(project.graph);
    assert.equal(bugs.summary.bugFixCommits, 2);
    assert.equal(bugs.summary.securityFixes, 1);
    assert.ok(bugs.commits.some((item) => item.issueReferences.includes("#42")));
    assert.ok(bugs.commits.some((item) => item.issueReferences.includes("CVE-2025-1234")));
    assert.ok(bugs.hotspots.some((item) => item.path === "src/used.ts" && item.fixes === 2 && item.nodeIds.length > 0));

    const health = await buildUnifiedHealth(project.graph);
    for (const dimension of ["dependencyRisk", "deadCode", "bugHistory"]) assert.ok(health.dimensions[dimension]);
    assert.ok((await searchEverything(project.graph, "deprecated unsupported")).some((item) => item.kind === "dependency"));
    assert.ok((await searchEverything(project.graph, "abandoned unused export")).some((item) => item.kind === "dead-code"));
    assert.ok((await searchEverything(project.graph, "CVE-2025-1234 injection")).some((item) => item.kind === "bug-history"));
  } finally { await project.cleanup(); }
});

test("registers all three code-risk reports with the cockpit API", async () => {
  const project = await fixture();
  const server = createCockpitServer({ graphPath: project.graphPath });
  try {
    assert.equal(typeof server.listen, "function");
    const source = await readFile(path.join(process.cwd(), "src", "server.ts"), "utf8");
    for (const route of ["/api/dependency-risk", "/api/dead-code", "/api/bug-history"]) assert.ok(source.includes(route));
  } finally {
    await project.cleanup();
  }
});
