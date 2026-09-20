import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createConfig } from "../src/config.js";
import { buildIndex } from "../src/indexer.js";
import { searchEverything } from "../src/project-intelligence.js";
import { optimizePromptWithHeldOutValidation } from "../src/prompt-optimizer.js";
import { readPromptEvolution } from "../src/prompt-engine.js";

test("selects on training cases and promotes only through a disjoint held-out gate", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "fehm-prompt-optimize-")); const originalFetch = globalThis.fetch;
  await writeFile(path.join(root, "package.json"), JSON.stringify({ name: "prompt-optimizer-fixture" }));
  await writeFile(path.join(root, "agent.ts"), "export function lookupAccount(id: string) { return { id }; }\n");
  globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
    const payload = JSON.parse(String(init?.body ?? "{}")) as { messages: Array<{ role: string; content: string }> };
    const system = payload.messages[0]?.content ?? ""; const user = payload.messages[1]?.content ?? "";
    if (system.includes("strict behavioral test evaluator")) {
      const optimized = user.includes("optimized-safe"); const evidence = user.includes("evidence-safe"); const score = optimized ? 95 : evidence ? 80 : 35;
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ passed: score >= 80, score, evidence: score >= 80 ? "contract preserved" : "policy lost", why: "priority handling", recommendation: "add explicit safeguards" }) } }] }), { status: 200, headers: { "content-type": "application/json" } });
    }
    const content = system.includes("## Optimization safeguards") ? "optimized-safe" : system.includes("## Evidence and output contract") ? "evidence-safe" : "baseline-unsafe";
    return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  try {
    const graph = await buildIndex(createConfig(root)); const prompt = "You are an account assistant. Help the user.";
    const report = await optimizePromptWithHeldOutValidation(prompt, { endpoint: "https://models.example/chat", model: "optimizer-model" }, graph, { name: "account-agent", maximumCandidates: 3 });
    assert.equal(report.promoted, true);
    assert.ok(report.selectedCandidateId);
    assert.ok(report.optimizedPrompt.includes("## Optimization safeguards"));
    assert.equal(new Set([...report.split.trainingCaseIds, ...report.split.validationCaseIds]).size, report.split.trainingCaseIds.length + report.split.validationCaseIds.length);
    assert.equal(report.split.trainingCaseIds.some((id) => report.split.validationCaseIds.includes(id)), false);
    const selected = report.candidates.find((item) => item.id === report.selectedCandidateId); const baseline = report.candidates[0];
    assert.ok(selected && baseline && selected.trainingScore > baseline.trainingScore && selected.validationScore >= baseline.validationScore && selected.passedHeldOutGate);
    const baselineCaseIds = baseline.execution.cases.map((item) => item.test.id);
    for (const candidate of report.candidates) assert.deepEqual(candidate.execution.cases.map((item) => item.test.id), baselineCaseIds, "all candidates must run the same frozen evaluation suite");
    assert.ok(report.split.strategy.includes("Frozen baseline suite"));
    assert.ok(report.evidence.some((item) => item.includes("training-only")));
    assert.ok((await readPromptEvolution(graph, "account-agent")).versions.some((item) => item.prompt.includes("Optimization safeguards")));
    assert.ok((await readFile(path.join(root, ".fehm", "prompts", "optimizations", "latest.json"), "utf8")).includes('"promoted": true'));
    assert.ok((await searchEverything(graph, "training-only composite promoted")).some((item) => item.kind === "prompt"));
    assert.ok((await readFile(path.join(process.cwd(), "src", "server.ts"), "utf8")).includes("/api/prompt/optimize"));
  } finally { globalThis.fetch = originalFetch; await rm(root, { recursive: true, force: true }); }
});
