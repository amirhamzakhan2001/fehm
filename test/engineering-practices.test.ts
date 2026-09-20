import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, mkdir, readFile, rm, writeFile, unlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createConfig } from "../src/config.js";
import { buildIndex } from "../src/indexer.js";
import { auditEngineeringPractices, approvePracticesPolicy, proposePracticesPolicy, savePracticesBaseline, validatePracticesPolicy } from "../src/engineering-practices.js";
import { runAgentPreflight } from "../src/agent-control.js";

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "fehm-practices-"));
  await mkdir(path.join(root, "src"));
  await writeFile(path.join(root, "src", "main.ts"), "export function sum(a: number, b: number) { return a + b; }\n");
  const graph = await buildIndex(createConfig(root));
  return { root, graph, cleanup: () => rm(root, { recursive: true, force: true }) };
}

test("practices cover the engineering lifecycle without treating prose as executable evidence", async () => {
  const project = await fixture();
  try {
    await writeFile(path.join(project.root, "README.md"), "Architecture: layered library. npm ci. Contribution procedure: pull request. createServer openai test('example') requireAuth");
    await writeFile(path.join(project.root, "src", "catalog.ts"), "export const names = ['prisma', 'express', 'openai'];");
    const report = await auditEngineeringPractices(project.graph);
    assert.equal(report.findings.length, 31);
    assert.equal(report.policySource, "advisory");
    assert.equal(report.passed, true);
    assert.deepEqual(report.blockers, []);
    assert.deepEqual(report.contexts, ["all"]);
    assert.equal(report.findings.find((item) => item.id === "architecture-intent")?.status, "detected");
    assert.equal(report.findings.find((item) => item.id === "automated-tests")?.status, "review");
    assert.equal(report.findings.find((item) => item.id === "ai-evaluations")?.status, "not-applicable");
    assert.ok(new Set(report.findings.map((item) => item.domain)).size >= 10);
    assert.ok(report.findings.every((item) => item.reference.startsWith("https://")));
  } finally { await project.cleanup(); }
});

test("approved required rules gate preflight, exemptions have reasons, and proposals do not enforce", async () => {
  const project = await fixture();
  try {
    const proposed = await proposePracticesPolicy(project.graph, "library");
    proposed.policy.rules = { "automated-tests": { mode: "require" }, "container-hardening": { mode: "off", reason: "This is a library without a container deployment." } };
    await writeFile(proposed.path, JSON.stringify(proposed.policy));
    assert.equal((await auditEngineeringPractices(project.graph)).policySource, "advisory");
    await approvePracticesPolicy(project.graph);
    const report = await auditEngineeringPractices(project.graph);
    assert.deepEqual(report.blockers, ["automated-tests"]);
    assert.equal(report.findings.find((item) => item.id === "container-hardening")?.status, "exempt");
    await writeFile(path.join(project.root, ".fehm", "agent-policy.json"), JSON.stringify({ version: 1, requireUnderstanding: false, maxRiskWithoutApproval: 100, blockArchitectureViolations: true, protectedZones: [], requiredChecks: [] }));
    const diff = { source: "unified-diff" as const, files: [] };
    const blocked = await runAgentPreflight(project.graph, diff);
    assert.equal(blocked.passed, false);
    assert.equal(blocked.requiresApproval, true);
    const overridden = await runAgentPreflight(project.graph, diff, { approval: true });
    assert.equal(overridden.passed, true);
    assert.ok(overridden.evidence.some((item) => item.includes("explicit approval override")));
    await mkdir(path.join(project.root, "test"));
    await writeFile(path.join(project.root, "test", "main.test.ts"), "test('sum', () => assert.equal(sum(1, 2), 3));");
    assert.equal((await auditEngineeringPractices(project.graph)).passed, true, "non-indexed practice artifacts are read fresh");
  } finally { await project.cleanup(); }
});

test("practice drift records lost evidence and does not conceal regression behind improvements", async () => {
  const project = await fixture();
  try {
    const readme = path.join(project.root, "README.md");
    await writeFile(readme, "Architecture and boundaries");
    await savePracticesBaseline(project.graph);
    await unlink(readme);
    await writeFile(path.join(project.root, "SECURITY.md"), "Report vulnerabilities privately");
    const report = await auditEngineeringPractices(project.graph);
    assert.equal(report.drift.status, "degraded");
    assert.ok(report.drift.regressed.includes("architecture-intent"));
    assert.ok(report.drift.improved.includes("security-policy"));
    await proposePracticesPolicy(project.graph, "library");
    await approvePracticesPolicy(project.graph);
    assert.equal((await auditEngineeringPractices(project.graph)).drift.status, "incompatible-baseline");
  } finally { await project.cleanup(); }
});

test("practices fail closed on invalid, edited, or unapproved policy and corrupt baselines", async () => {
  const project = await fixture();
  try {
    assert.throws(() => validatePracticesPolicy({ version: 1, profile: "auto", rules: { fake: { mode: "require" } } }));
    assert.throws(() => validatePracticesPolicy({ version: 1, profile: "auto", rules: { ownership: { mode: "off" } } }));
    assert.throws(() => validatePracticesPolicy({ version: 1, profile: ["auto"], rules: {} }));
    assert.throws(() => validatePracticesPolicy({ version: 1, profile: "auto", rules: { ownership: { mode: ["require"] } } }));
    await proposePracticesPolicy(project.graph);
    const approved = await approvePracticesPolicy(project.graph);
    const policy = JSON.parse(await readFile(approved.path, "utf8"));
    policy.rules["automated-tests"].mode = "warn";
    await writeFile(approved.path, JSON.stringify(policy));
    await assert.rejects(auditEngineeringPractices(project.graph), /changed after approval/);
    await approvePracticesPolicy(project.graph);
    await writeFile(path.join(project.root, ".fehm", "practices-baseline.json"), "{}");
    await assert.rejects(auditEngineeringPractices(project.graph), /invalid engineering practices baseline/);
    await assert.rejects(auditEngineeringPractices({ ...project.graph, repository: { ...project.graph.repository, root: path.join(project.root, "moved") } }), /repository root is unavailable/);
  } finally { await project.cleanup(); }
});

test("AI and service profiles surface applicable controls and source locations", async () => {
  const project = await fixture();
  try {
    await writeFile(path.join(project.root, "src", "server.ts"), "export function server() {\n return createServer({ timeout: 1000, requestId: 'id' });\n}\n");
    await writeFile(path.join(project.root, "src", "model.ts"), "export const model = callPromptModel();\n");
    const report = await auditEngineeringPractices(project.graph);
    assert.ok(report.contexts.includes("ai"));
    assert.ok(report.contexts.includes("service"));
    assert.equal(report.findings.find((item) => item.id === "ai-evaluations")?.status, "review");
    const timeouts = report.findings.find((item) => item.id === "timeouts");
    assert.equal(timeouts?.status, "detected");
    assert.equal(timeouts?.evidence[0]?.line, 2);
  } finally { await project.cleanup(); }
});


test("practices CLI supports profiles, explicit approval, and CI failure exit codes", async () => {
  const project = await fixture();
  try {
    const graphPath = path.join(project.root, "graph.json");
    await writeFile(graphPath, JSON.stringify(project.graph));
    const execute = promisify(execFile);
    const cli = (args: string[]) => execute(process.execPath, ["--import", "tsx", "src/cli.ts", "practices", ...args, "--json"], { timeout: 30000 });
    const advisory = JSON.parse((await cli(["audit", graphPath])).stdout);
    assert.equal(advisory.policySource, "advisory");
    const proposal = JSON.parse((await cli(["propose", "--profile", "ai-service", graphPath])).stdout);
    assert.equal(proposal.policy.profile, "ai-service");
    await cli(["approve", graphPath]);
    await assert.rejects(cli(["audit", graphPath]), (error: Error & { code?: number; stdout?: string }) => {
      assert.equal(error.code, 2);
      assert.equal(JSON.parse(error.stdout ?? "{}").policySource, "approved");
      return true;
    });
    const baseline = JSON.parse((await cli(["baseline", graphPath])).stdout);
    assert.equal(baseline.report.version, 1);
  } finally { await project.cleanup(); }
});
