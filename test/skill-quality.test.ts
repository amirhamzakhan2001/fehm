import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { runSkillBench, type SkillBenchCase } from "../src/skill-eval.js";
import { repositoryProfile } from "../src/skill-profile.js";
import { BUNDLED_CATALOG, SkillRegistry } from "../src/skill-registry.js";
import { routeSkills } from "../src/skill-router.js";
import { REPO_ROOT } from "./helpers.js";

// Routing quality on the real bundled catalog. These are regression floors,
// not targets: the tuned seed set must not slip, and precision guards
// (forbidden skills, abstention) must hold on every labelled set.
const registry = SkillRegistry.fromSources([{ type: "catalog", dir: BUNDLED_CATALOG }]);
const cases = (file: string): SkillBenchCase[] => (JSON.parse(readFileSync(join(REPO_ROOT, "eval", file), "utf8")) as { cases: SkillBenchCase[] }).cases;

test("catalog: every skill normalizes with provenance, hash and a known license", () => {
  assert.ok(registry.size >= 1000);
  for (const r of registry.all()) {
    assert.match(r.contentHash, /^[0-9a-f]{64}$/, r.id);
    assert.ok(r.sources.length && r.sourcePath, r.id);
    assert.notEqual(r.license, "unknown", r.id);
    assert.ok(r.tokens.full > 0, r.id);
  }
  assert.deepEqual(registry.report.warnings, []);
});

test("seed benchmark: regression floor (tuned set)", () => {
  const { summary } = runSkillBench(registry, cases("skills-bench.json"));
  assert.ok(summary.f1 >= 0.9, `F1 ${summary.f1}`);
  assert.ok(summary.top[3] >= 0.95, `top-3 ${summary.top[3]}`);
  assert.equal(summary.forbiddenRate, 0);
  assert.equal(summary.abstention.correct, summary.abstention.cases);
});

test("held-out benchmarks: precision guards hold", () => {
  for (const file of ["skills-heldout.json", "skills-heldout-2.json", "skills-heldout-3.json"]) {
    const { summary } = runSkillBench(registry, cases(file));
    assert.ok(summary.f1 >= 0.6, `${file} F1 ${summary.f1}`);
    assert.ok(summary.forbiddenRate <= 0.1, `${file} forbidden ${summary.forbiddenRate}`);
    assert.equal(summary.ambiguity.correct, summary.ambiguity.cases, file);
  }
});

test("negative routing (spec): 'Fix PostgreSQL timeout' selects no frontend, marketing or mobile skill", () => {
  const r = routeSkills(registry, "Fix PostgreSQL timeout");
  assert.ok(r.selected.length >= 1);
  for (const s of r.selected) assert.doesNotMatch(s.skillId, /^(frontend|design|marketing|mobile|sales)\//);
});

test("ambiguous tasks (spec) never trigger broad selection", () => {
  for (const t of ["Improve this.", "Fix the architecture.", "Make this better.", "Optimize the API."]) {
    const r = routeSkills(registry, t);
    assert.ok(r.selected.length <= 2 && r.confidence < 0.5 && r.clarification, t);
  }
});

test("spec example: auth bug + tests with an Express/Jest repo → debugging primary, testing support", () => {
  const r = routeSkills(registry, "Fix the authentication bug and add tests", { repository: repositoryProfile(["typescript"], ["express", "jest"]) });
  assert.match(r.selected[0]!.skillId, /^debugging\//);
  assert.ok(r.selected.some((s) => /tdd|test/.test(s.skillId) && s.role !== "primary"));
  assert.ok(r.budget.usedTokens <= 2500);
});

test("regressions from benchmark failures", () => {
  const top = (t: string, repo?: ReturnType<typeof repositoryProfile>): string[] => routeSkills(registry, t, repo ? { repository: repo } : {}).selected.map((s) => s.skillId);
  // Description-only intent mentions (prisma "debugging N+1") no longer beat curated debugging skills.
  assert.match(top("Debug the Redis connection timeout in our API")[0]!, /^debugging\//);
  // "DO NOT TRIGGER" quotes are not triggers.
  assert.ok(!registry.get("ai/token-budget-advisor")!.triggers.includes("token"));
  assert.equal(top("Compress our CLAUDE.md to use fewer tokens")[0], "memory/caveman-compress");
  // Named purpose: a reviewer is not picked for an implementation task.
  assert.ok(!top("Add retrieval augmented generation over our docs with embeddings").includes("ai/rag/rag-pipeline-reviewer"));
  // Name specificity: "tickets" → to-tickets.
  assert.ok(top("Break this spec into tickets for the team").includes("project-management/to-tickets"));
  // General-knowledge questions are not codebase exploration.
  assert.deepEqual(top("Explain the difference between TCP and UDP"), []);
  // Weak verb + engineering context is still a task.
  assert.ok(top("Add rate limiting to the public API").length > 0);
  // Generic mention of Go is not Go coverage.
  assert.ok(!top("The Go worker crashes with a nil pointer dereference in production").includes("engineering/error-handling"));
});
