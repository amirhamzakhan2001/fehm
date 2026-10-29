import type { RepositoryProfile, SkillRoutingResult } from "./skill-model.js";
import { repositoryProfile } from "./skill-profile.js";
import type { SkillRegistry } from "./skill-registry.js";
import { routeSkills, type RouteOptions } from "./skill-router.js";

/**
 * FEHM-Skill-Bench metrics. Labels: `required` = groups, any member of a
 * group satisfies that need; `optional` = acceptable extras; `forbidden` =
 * precision failures; empty `required` = abstain; `ambiguous` = expect low
 * confidence and at most two skills.
 */
export interface SkillBenchCase {
  query: string;
  required: string[][];
  optional?: string[];
  forbidden?: string[];
  ambiguous?: boolean;
  repository?: { languages?: string[]; packages?: string[] };
}

export interface CaseResult {
  query: string;
  selected: string[];
  ranked: string[];
  recall: number | null;
  precision: number | null;
  forbiddenHits: string[];
  overSelected: string[];
  top: { 1: boolean; 3: boolean; 5: boolean } | null;
  recallAt: { 1: number; 3: number; 5: number } | null;
  precisionAt: { 1: number; 3: number; 5: number } | null;
  abstainOk: boolean | null;
  ambiguousOk: boolean | null;
  confidence: number;
  tokens: number;
  latencyMs: number;
}

export interface BenchSummary {
  cases: number;
  recall: number;
  precision: number;
  f1: number;
  recallAt: { 1: number; 3: number; 5: number };
  precisionAt: { 1: number; 3: number; 5: number };
  top: { 1: number; 3: number; 5: number };
  forbiddenRate: number;
  overSelection: number;
  meanSelected: number;
  abstention: { cases: number; correct: number };
  ambiguity: { cases: number; correct: number };
  tokens: { mean: number; max: number };
  latencyMs: { p50: number; p95: number; max: number };
}

const mean = (xs: number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const r3 = (n: number): number => Math.round(n * 1000) / 1000;
const pct = (xs: number[], p: number): number => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]!;
};

export function caseRepository(c: SkillBenchCase): RepositoryProfile | undefined {
  return c.repository ? repositoryProfile(c.repository.languages ?? [], c.repository.packages ?? []) : undefined;
}

export function scoreCase(c: SkillBenchCase, result: SkillRoutingResult): CaseResult {
  const selected = result.selected.map((s) => s.skillId);
  const ranked = [...selected, ...result.rejected.map((r) => r.skillId).filter((id) => !selected.includes(id))];
  const relevant = new Set([...c.required.flat(), ...(c.optional ?? [])]);
  const forbidden = new Set(c.forbidden ?? []);
  const satisfied = (ids: readonly string[]): number => c.required.filter((g) => g.some((id) => ids.includes(id))).length;
  const hasRequired = c.required.length > 0;
  const at = (k: 1 | 3 | 5): string[] => ranked.slice(0, k);
  const res: CaseResult = {
    query: c.query,
    selected,
    ranked: ranked.slice(0, 5),
    recall: hasRequired ? satisfied(selected) / c.required.length : null,
    precision: selected.length && (hasRequired || !c.ambiguous) ? selected.filter((id) => relevant.has(id)).length / selected.length : null,
    forbiddenHits: selected.filter((id) => forbidden.has(id)),
    overSelected: selected.filter((id) => !relevant.has(id)),
    top: hasRequired ? { 1: satisfied(at(1)) > 0, 3: satisfied(at(3)) > 0, 5: satisfied(at(5)) > 0 } : null,
    recallAt: hasRequired ? { 1: satisfied(at(1)) / c.required.length, 3: satisfied(at(3)) / c.required.length, 5: satisfied(at(5)) / c.required.length } : null,
    precisionAt: hasRequired
      ? { 1: at(1).filter((id) => relevant.has(id)).length / 1, 3: at(3).filter((id) => relevant.has(id)).length / 3, 5: at(5).filter((id) => relevant.has(id)).length / 5 }
      : null,
    abstainOk: !hasRequired && !c.ambiguous ? selected.length === 0 : null,
    ambiguousOk: c.ambiguous ? result.confidence < 0.5 && selected.length <= 2 && !!result.clarification && selected.every((id) => relevant.has(id)) : null,
    confidence: result.confidence,
    tokens: result.budget.usedTokens,
    latencyMs: r3(result.timings.profileMs + result.timings.routeMs + result.timings.composeMs),
  };
  return res;
}

export function summarize(results: readonly CaseResult[]): BenchSummary {
  const withReq = results.filter((r) => r.recall !== null);
  const withPrec = results.filter((r) => r.precision !== null);
  const recall = mean(withReq.map((r) => r.recall!));
  const precision = mean(withPrec.map((r) => r.precision!));
  const k = (f: (r: CaseResult) => number): number => r3(mean(withReq.map(f)));
  return {
    cases: results.length,
    recall: r3(recall),
    precision: r3(precision),
    f1: r3(recall + precision ? (2 * recall * precision) / (recall + precision) : 0),
    recallAt: { 1: k((r) => r.recallAt![1]), 3: k((r) => r.recallAt![3]), 5: k((r) => r.recallAt![5]) },
    precisionAt: { 1: k((r) => r.precisionAt![1]), 3: k((r) => r.precisionAt![3]), 5: k((r) => r.precisionAt![5]) },
    top: { 1: k((r) => (r.top![1] ? 1 : 0)), 3: k((r) => (r.top![3] ? 1 : 0)), 5: k((r) => (r.top![5] ? 1 : 0)) },
    forbiddenRate: r3(mean(results.map((r) => (r.forbiddenHits.length ? 1 : 0)))),
    overSelection: r3(mean(results.map((r) => r.overSelected.length))),
    meanSelected: r3(mean(results.map((r) => r.selected.length))),
    abstention: { cases: results.filter((r) => r.abstainOk !== null).length, correct: results.filter((r) => r.abstainOk === true).length },
    ambiguity: { cases: results.filter((r) => r.ambiguousOk !== null).length, correct: results.filter((r) => r.ambiguousOk === true).length },
    tokens: { mean: Math.round(mean(results.map((r) => r.tokens))), max: Math.max(0, ...results.map((r) => r.tokens)) },
    latencyMs: { p50: r3(pct(results.map((r) => r.latencyMs), 50)), p95: r3(pct(results.map((r) => r.latencyMs), 95)), max: r3(Math.max(0, ...results.map((r) => r.latencyMs))) },
  };
}

export function runSkillBench(registry: SkillRegistry, cases: readonly SkillBenchCase[], options: RouteOptions = {}): { results: CaseResult[]; summary: BenchSummary } {
  const results = cases.map((c) => {
    const repository = caseRepository(c);
    return scoreCase(c, routeSkills(registry, c.query, { ...options, ...(repository ? { repository } : {}) }));
  });
  return { results, summary: summarize(results) };
}
