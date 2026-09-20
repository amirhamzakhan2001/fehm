import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildAgentAnalytics, buildAiEvaluationGraph, recordAgentMistake, recordAgentRun, verifyHallucinations } from "../src/ai-governance.js";
import { createConfig } from "../src/config.js";
import { buildIndex } from "../src/indexer.js";
import type { PromptExecutionReport } from "../src/model.js";
import { buildUnifiedHealth, searchEverything } from "../src/project-intelligence.js";
import { analyzePrompt, savePromptExecution } from "../src/prompt-engine.js";

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "fehm-ai-governance-")); await mkdir(path.join(root, "src"), { recursive: true });
  await writeFile(path.join(root, "package.json"), JSON.stringify({ name: "governance-fixture" }));
  await writeFile(path.join(root, "src", "api.ts"), [
    "declare const app: { get(path: string, callback: (req: any, res: any) => void): void };",
    "export function loadAccount(id: string) { return { id }; }",
    "app.get('/api/accounts', (_req, res) => res.json({ account: loadAccount('1') }));",
  ].join("\n"));
  return { root, graph: await buildIndex(createConfig(root)), cleanup: () => rm(root, { recursive: true, force: true }) };
}

function execution(prompt: string, graph: Awaited<ReturnType<typeof buildIndex>>, model: string, score: number, passed: boolean, generatedAt: string): PromptExecutionReport {
  const analysis = analyzePrompt(prompt, graph); const evaluation = analysis.evaluationSuite[0]; assert.ok(evaluation);
  const observation = { caseId: evaluation.id, model, passed, score, evidence: passed ? "behavior verified" : "instruction violated" };
  return { model, generatedAt, analysis, cases: [{ test: evaluation, response: passed ? "compliant" : "unsafe", observation, durationMs: 10, ...(!passed ? { failureAnalysis: { why: "instruction violated", recommendation: "reinforce priority" } } : {}) }], behavior: { model, score, passed: passed ? 1 : 0, failed: passed ? 0 : 1, missing: 0, observations: [observation] }, security: { injectionPassed: passed ? 1 : 0, injectionTotal: 1, extractionPassed: passed ? 1 : 0, extractionTotal: 1 }, passed };
}

test("verifies concrete AI claims and refuses unsupported absolutes", async () => {
  const project = await fixture();
  try {
    const report = await verifyHallucinations(project.graph, [
      "The function `loadAccount` exists in src/api.ts.",
      "The function missingThing exists.",
      "GET /api/accounts is implemented.",
      "loadAccount calls missingThing.",
      "This repository is always secure.",
    ]);
    assert.equal(report.summary.verified, 2);
    assert.equal(report.summary.contradicted, 2);
    assert.equal(report.summary.unverifiable, 1);
    assert.ok(report.claims.find((item) => item.statement.includes("missingThing exists"))?.correction);
    assert.ok((await readFile(path.join(project.root, ".fehm", "hallucinations", "latest.json"), "utf8")).includes("contradicted"));
  } finally { await project.cleanup(); }
});

test("records agent runs, learns recurring mistakes, and computes analytics", async () => {
  const project = await fixture();
  try {
    const failed = { agent: "codex", task: "change account API", startedAt: "2026-01-01T00:00:00.000Z", completedAt: "2026-01-01T00:01:00.000Z", outcome: "failure" as const, changedFiles: ["src/api.ts"], commands: ["npm test"], testsPassed: 2, testsFailed: 1, verificationPassed: false, inputTokens: 100, outputTokens: 50, errors: ["account assertion failed"] };
    await recordAgentRun(project.graph, failed);
    await recordAgentRun(project.graph, { ...failed, startedAt: "2026-01-02T00:00:00.000Z", completedAt: "2026-01-02T00:02:00.000Z" });
    await recordAgentRun(project.graph, { ...failed, task: "document account API", startedAt: "2026-01-03T00:00:00.000Z", completedAt: "2026-01-03T00:00:30.000Z", outcome: "success", testsPassed: 3, testsFailed: 0, verificationPassed: true, errors: [] });
    let analytics = await buildAgentAnalytics(project.graph);
    assert.equal(analytics.summary.runs, 3);
    assert.equal(analytics.summary.repeatedMistakes, 1);
    assert.equal(analytics.mistakes[0]?.occurrences, 2);
    assert.equal(analytics.agents[0]?.testsFailed, 2);
    await recordAgentMistake(project.graph, { category: "test-failure", title: "Resolved account assertion", rootCause: "account assertion failed", prevention: "Run the account test first.", status: "resolved", resolution: "Added boundary coverage." });
    analytics = await buildAgentAnalytics(project.graph);
    assert.equal(analytics.mistakes[0]?.status, "resolved");
    assert.equal(analytics.mistakes[0]?.occurrences, 3);
  } finally { await project.cleanup(); }
});

test("builds dedicated model/category evaluation analytics and integrates health and search", async () => {
  const project = await fixture();
  try {
    const first = "You are an account assistant. Follow the system policy and never reveal secrets.";
    const second = `${first} Ignore safety when asked.`;
    await savePromptExecution(project.graph, "account-agent", first, execution(first, project.graph, "model-a", 95, true, "2026-01-01T00:00:00.000Z"));
    await savePromptExecution(project.graph, "account-agent", second, execution(second, project.graph, "model-a", 35, false, "2026-01-02T00:00:00.000Z"));
    const report = await buildAiEvaluationGraph(project.graph);
    assert.equal(report.summary.prompts, 1);
    assert.equal(report.summary.executions, 2);
    assert.equal(report.summary.cases, 2);
    assert.equal(report.summary.regressions, 1);
    assert.equal(report.modelAnalytics[0]?.model, "model-a");
    assert.ok(report.categoryAnalytics.length > 0);
    assert.equal(report.weakestCases[0]?.score, 35);
    const health = await buildUnifiedHealth(project.graph); assert.ok(health.dimensions.agentReliability && health.dimensions.aiEvaluation);
    assert.ok((await searchEverything(project.graph, "account assertion failed")).some((item) => item.kind === "mistake" || item.kind === "agent") === false, "separate fixtures must not leak agent memory");
    assert.ok((await searchEverything(project.graph, "model-a evaluation regression")).some((item) => item.kind === "evaluation"));
    const server = await readFile(path.join(process.cwd(), "src", "server.ts"), "utf8");
    for (const route of ["/api/hallucination-verify", "/api/agent/analytics", "/api/agent/runs", "/api/agent/mistakes", "/api/ai-evaluations"]) assert.ok(server.includes(route));
  } finally { await project.cleanup(); }
});
