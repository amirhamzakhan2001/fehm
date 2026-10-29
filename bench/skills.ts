/**
 * Feature 2 benchmark: skill-routing quality on the labelled sets, registry
 * performance, and a routing-level ablation.
 *
 * It does NOT run a coding agent, so task completion, tests passed, tool
 * calls, errors and rework are not measured — only what routing controls:
 * which skills are selected, how many tokens they cost, and how fast.
 *
 *   npx tsx bench/skills.ts      # prints a report, writes bench/skills-results.json
 */
import { cpSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildAgentContext } from "../src/agent-context.js";
import { FehmEngine } from "../src/engine.js";
import { caseRepository, runSkillBench, scoreCase, summarize, type SkillBenchCase } from "../src/skill-eval.js";
import type { SkillFeedbackEntry } from "../src/skill-model.js";
import { profileTask } from "../src/skill-profile.js";
import { BUNDLED_CATALOG, SkillRegistry } from "../src/skill-registry.js";
import { routeSkills } from "../src/skill-router.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const load = (f: string): SkillBenchCase[] => (JSON.parse(readFileSync(join(ROOT, "eval", f), "utf8")) as { cases: SkillBenchCase[] }).cases;
const SETS = { seed: "skills-bench.json", heldout1: "skills-heldout.json", heldout2: "skills-heldout-2.json", heldout3: "skills-heldout-3.json" } as const;
const BUDGET = 2500;
const ms = (t: number): number => Math.round(t * 10) / 10;

// ── Registry performance ──
const state = mkdtempSync(join(tmpdir(), "fehm-skills-bench-"));
const catalogCopy = mkdtempSync(join(tmpdir(), "fehm-skills-catalog-"));
cpSync(BUNDLED_CATALOG, catalogCopy, { recursive: true });
const sources = [{ type: "catalog" as const, dir: catalogCopy }];
let t = performance.now();
const full = SkillRegistry.open({ sources, stateDirectory: state });
const fullMs = performance.now() - t;
t = performance.now();
SkillRegistry.open({ sources, stateDirectory: state });
const hitMs = performance.now() - t;
const touched = join(catalogCopy, full.get("testing/test-driven-development")!.path);
writeFileSync(touched, `${readFileSync(touched, "utf8")}\n<!-- bench edit -->\n`);
t = performance.now();
const inc = SkillRegistry.open({ sources, stateDirectory: state });
const incMs = performance.now() - t;
const registry = SkillRegistry.fromSources([{ type: "catalog", dir: BUNDLED_CATALOG }]);
t = performance.now();
void registry.index;
const lexicalBuildMs = performance.now() - t;

// ── Quality per set (deterministic router, warm index) ──
const quality = Object.fromEntries(Object.entries(SETS).map(([name, file]) => [name, runSkillBench(registry, load(file)).summary]));

// ── Ablation ──
const all = [...load(SETS.heldout1), ...load(SETS.heldout2), ...load(SETS.heldout3)];
const allSkillsTokens = registry.all().reduce((s, r) => s + r.tokens.full, 0);
const noSkills = summarize(all.map((c) => scoreCase(c, emptyResult(c.query))));
const manual = summarize(
  all.map((c) => {
    const include = c.required.map((g) => g[0]!);
    const repository = caseRepository(c);
    const r = routeSkills(registry, c.query, { include, maxSkills: include.length, budget: BUDGET, ...(repository ? { repository } : {}) });
    return scoreCase(c, { ...r, selected: r.selected.filter((s) => include.includes(s.skillId)) });
  }),
);
const auto = runSkillBench(registry, all, { budget: BUDGET }).summary;

// E: automatic routing + Feature 1 code context, on the benchmark corpus.
const corpus = mkdtempSync(join(tmpdir(), "fehm-skills-corpus-"));
cpSync(join(HERE, "corpus"), corpus, { recursive: true });
const engine = FehmEngine.open(corpus, { stateDirectory: mkdtempSync(join(tmpdir(), "fehm-skills-state-")) });
const eTasks = ["Fix the authentication bug in token validation and add tests", "How does payment processing work?", "Refactor the user repository to remove duplication", "Add rate limiting to the API routes"];
const eRuns = eTasks.map((task) => {
  const s = performance.now();
  const ctx = buildAgentContext(engine, task, { registry, totalBudget: 16000, skillBudget: BUDGET, codeBudget: 8000, taskBudget: 1000 });
  return { task, ms: ms(performance.now() - s), skills: ctx.budget.skills.used, code: ctx.budget.code.used, total: ctx.budget.task.used + ctx.budget.skills.used + ctx.budget.code.used, selected: ctx.skills!.selected.map((x) => x.skillId) };
});

// F: + historical feedback learned from the seed set's labels (never from the evaluated sets).
const feedback: SkillFeedbackEntry[] = [];
for (const c of load(SETS.seed)) {
  const p = profileTask(c.query);
  const entry = (skillId: string, value: SkillFeedbackEntry["feedback"]): SkillFeedbackEntry => ({ task: c.query, terms: p.terms, intents: p.intents, skillId, feedback: value, at: "2026-09-26T00:00:00.000Z" });
  for (const g of c.required) feedback.push(entry(g[0]!, "useful"));
  for (const f of c.forbidden ?? []) feedback.push(entry(f, "irrelevant"));
  for (const s of routeSkills(registry, c.query).selected) if (![...c.required.flat(), ...(c.optional ?? [])].includes(s.skillId)) feedback.push(entry(s.skillId, "irrelevant"));
}
const withHistory = runSkillBench(registry, all, { budget: BUDGET, feedback, now: new Date("2026-09-26T00:00:00Z") }).summary;

const results = {
  generatedAt: new Date().toISOString(),
  node: process.version,
  catalog: { skills: registry.size, fullTokens: allSkillsTokens },
  registry: { fullIndexMs: ms(fullMs), cacheHitMs: ms(hitMs), incrementalMs: ms(incMs), incrementalReindexed: inc.report.reindexed, lexicalIndexBuildMs: ms(lexicalBuildMs) },
  quality,
  ablation: {
    note: "Held-out sets 1–3 combined (48 cases). Routing-level only: no agent was run, so completion/tests/tool calls/errors/rework are not measured.",
    A_noSkills: { recall: noSkills.recall, precision: noSkills.precision, f1: noSkills.f1, skillTokensMean: 0 },
    B_allSkills: { recall: 1, precisionNote: "every skill loaded; precision ≈ relevant/1018", skillTokens: allSkillsTokens, fitsBudget: allSkillsTokens <= BUDGET },
    C_manual: { recall: manual.recall, precision: manual.precision, f1: manual.f1, skillTokensMean: manual.tokens.mean, note: "oracle: first labelled skill per required group" },
    D_auto: { recall: auto.recall, precision: auto.precision, f1: auto.f1, top1: auto.top[1], top3: auto.top[3], skillTokensMean: auto.tokens.mean, forbiddenRate: auto.forbiddenRate, latencyP50Ms: auto.latencyMs.p50, latencyP95Ms: auto.latencyMs.p95 },
    E_autoPlusFeature1: { runs: eRuns, note: "combined context on bench/corpus; routing quality equals D (Feature 1 contributes the repository profile and code context)" },
    F_autoPlusHistory: { recall: withHistory.recall, precision: withHistory.precision, f1: withHistory.f1, top1: withHistory.top[1], forbiddenRate: withHistory.forbiddenRate, note: "feedback derived from seed-set labels only" },
  },
};
writeFileSync(join(HERE, "skills-results.json"), `${JSON.stringify(results, null, 2)}\n`);
console.log(JSON.stringify(results, null, 2));
for (const d of [state, catalogCopy, corpus]) rmSync(d, { recursive: true, force: true });

function emptyResult(task: string) {
  const r = routeSkills(registry, task, { budget: 0 });
  return { ...r, selected: [], context: "" };
}
