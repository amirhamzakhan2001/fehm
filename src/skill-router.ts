import { estimateTokens, TOKEN_ESTIMATOR } from "./compression.js";
import { commandProvider } from "./semantic-summary.js";
import { signatureSimilarity } from "./skill-adapters.js";
import { composeSkillContext, type ComposedSkill } from "./skill-compose.js";
import { historicalSignals, type HistoricalSignal } from "./skill-feedback.js";
import {
  SKILL_LEVELS,
  SKILL_SCHEMA_VERSION,
  type RejectedSkill,
  type RepositoryProfile,
  type SelectedSkill,
  type SkillCandidate,
  type SkillConflict,
  type SkillDependencyResolution,
  type SkillFeedbackEntry,
  type SkillLevel,
  type SkillOverlap,
  type SkillRecord,
  type SkillRole,
  type SkillRoutingResult,
  type SkillStyle,
  type TaskIntent,
  type TaskProfile,
} from "./skill-model.js";
import { profileTask } from "./skill-profile.js";
import { StaleSkillError, type SkillRegistry } from "./skill-registry.js";
import { detectTechnologies, expandAcronyms, findPhrase, INTENT_RULES, matchRules, requestedStyle, words } from "./skill-vocabulary.js";
import { tokenize } from "./text.js";

export interface SkillWeights {
  task: number;
  lexical: number;
  name: number;
  canonical: number;
  domain: number;
  technology: number;
  repository: number;
  priority: number;
  trigger: number;
  history: number;
  cost: number;
  /** Bonus when the skill's style matches a style the user asked for. */
  style: number;
  /** Penalty when the skill's named purpose (e.g. "…-reviewer") is not what the task asks. */
  purpose: number;
}

/**
 * Base signals sum to 1; trigger/history are bounded adjustments; cost is a
 * penalty. Values were chosen on eval/skills-bench.json and are checked on the
 * held-out eval/skills-heldout.json (see docs/FEATURE_2.md).
 */
export const DEFAULT_SKILL_WEIGHTS: SkillWeights = {
  task: 0.28,
  lexical: 0.16,
  name: 0.12,
  canonical: 0.24,
  domain: 0.04,
  technology: 0.07,
  repository: 0.04,
  priority: 0.05,
  trigger: 0.25,
  history: 0.08,
  cost: 0.05,
  purpose: 0.1,
  style: 0.1,
};

export const DEFAULT_SKILL_BUDGET = 2500;
export const DEFAULT_MAX_SKILLS = 4;
export const DEFAULT_MIN_SCORE = 0.35;
/** Overlap at or above this, with no uncovered need, marks a candidate redundant. */
export const REDUNDANCY_OVERLAP = 0.35;
export const MAX_DEPENDENCY_DEPTH = 3;
export const MAX_DEPENDENCIES = 12;
const CLOSE_MARGIN = 0.03;
const RERANK_K = 8;
const REJECTED_LIMIT = 15;

export interface RouteOptions {
  /** Token budget for the composed skill context. */
  budget?: number;
  maxSkills?: number;
  minScore?: number;
  repository?: RepositoryProfile;
  feedback?: readonly SkillFeedbackEntry[];
  weights?: Partial<SkillWeights>;
  /** Project instruction text (e.g. CLAUDE.md); style requests in it outrank skills. */
  projectInstructions?: string;
  /** Force-select these ids (manual selection). They still respect the budget. */
  include?: string[];
  exclude?: string[];
  now?: Date;
}

export interface RerankInput {
  task: string;
  profile: TaskProfile;
  /** Metadata only — the reranker never sees the registry or skill bodies. */
  candidates: { skillId: string; name: string; description: string; score: number }[];
}

/** Optional model-based reranker. It may only reorder the ids it is given. */
export interface SkillReranker {
  name: string;
  rerank(input: RerankInput): Promise<string[]>;
}

interface Scored extends SkillCandidate {
  record: SkillRecord;
  gate?: string;
}

const round = (n: number): number => Math.round(n * 1e4) / 1e4;
const clamp01 = (n: number): number => Math.max(0, Math.min(1, n));
const byScore = (a: Scored, b: Scored): number => b.score - a.score || b.record.priority - a.record.priority || (a.skillId < b.skillId ? -1 : 1);

function isTechSpecific(r: SkillRecord): boolean {
  return r.metadataProvenance.languages === "catalog" || r.metadataProvenance.frameworks === "catalog";
}

/**
 * Reranker backed by a local command (e.g. a model CLI). The command receives
 * a JSON prompt on stdin and must print a JSON array of skill ids.
 */
export function commandReranker(command: string): SkillReranker {
  const provider = commandProvider(command, command);
  return {
    name: `command:${command}`,
    async rerank(input) {
      const prompt = JSON.stringify({
        instruction: "Order these candidate skills by usefulness for the task. Reply with a JSON array of skillId strings chosen only from the candidates.",
        task: input.task,
        candidates: input.candidates,
      });
      const out = await provider.summarize(prompt);
      const match = /\[[\s\S]*\]/.exec(out);
      const parsed: unknown = match ? JSON.parse(match[0]) : [];
      return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
    },
  };
}

/* ── Scoring ──────────────────────────────────────────────────────────── */

export function scoreCandidates(
  registry: SkillRegistry,
  profile: TaskProfile,
  options: { weights: SkillWeights; budget: number; history: Map<string, HistoricalSignal>; exclude?: Set<string> },
): Scored[] {
  const w = options.weights;
  const strength = (i: TaskIntent): number => profile.intentStrength[i] ?? 0;
  const primary = profile.intents[0];
  const intentWeight = (i: TaskIntent): number => strength(i) * (i === primary ? 1.5 : 1);
  const totalIntent = profile.intents.reduce((s, i) => s + intentWeight(i), 0);
  const taskTokens = words(profile.task);
  const taskTech = new Set(profile.technologies);
  const repoTech = new Set(profile.repository?.technologies ?? []);
  const lowerTask = profile.task.toLowerCase();
  const decisive = profile.intents.filter((i) => strength(i) >= 1);

  const searchText = expandAcronyms(profile.task);
  const searchTerms = new Set(tokenize(searchText));
  const hits = registry.index.search(searchText, 80);
  const topRaw = hits[0] ? hits[0].lexical + hits[0].semantic : 0;
  const lexical = new Map(hits.map((h) => [h.id, h]));

  const triggerHit = (t: string): boolean => (t.startsWith("/") ? profile.explicitTriggers.includes(t) || lowerTask.includes(t) : findPhrase(taskTokens, t) >= 0);

  // Discovery from metadata only: lexical hits, intent matches, trigger matches.
  const ids = new Set(lexical.keys());
  for (const r of registry.all()) if (r.tasks.some((t) => strength(t) > 0) || r.triggers.some(triggerHit)) ids.add(r.id);

  const out: Scored[] = [];
  for (const id of ids) {
    if (options.exclude?.has(id)) continue;
    const r = registry.get(id)!;
    const reasons: string[] = [];
    const mismatches: string[] = [];
    const matched = r.tasks.filter((t) => strength(t) > 0);
    const task = totalIntent ? matched.reduce((s, i) => s + intentWeight(i) * (r.taskEvidence[i] ?? 0.5), 0) / totalIntent : 0;
    if (matched.length) reasons.push(`task intent ${matched.map((i) => (i === primary ? `${i} (primary)` : i)).join(", ")} matches skill tasks`);
    else if (profile.intents.length) mismatches.push(`no task-intent match (task: ${profile.intents.join(", ")}; skill: ${r.tasks.join(", ") || "none"})`);

    const hit = lexical.get(id);
    const raw = hit ? hit.lexical + hit.semantic : 0;
    const lex = raw && topRaw ? 0.5 * (raw / topRaw) + 0.5 * Math.min(1, raw / 20) : 0;
    if (hit?.matchedTerms.length) reasons.push(`metadata terms: ${hit.matchedTerms.slice(0, 5).join(", ")}`);

    const own = nameTerms(r);
    const nameHits = own.filter((t) => searchTerms.has(t));
    const name = own.length ? nameHits.length / own.length : 0;
    if (nameHits.length) reasons.push(`skill name matches ${nameHits.join(", ")}`);

    const domains = r.domains.filter((d) => profile.domains.includes(d));
    const domain = profile.domains.length ? domains.length / profile.domains.length : 0;
    if (domains.length) reasons.push(`domain ${domains.join(", ")}`);

    const skillTech = [...r.languages, ...r.frameworks];
    const techTask = skillTech.filter((t) => taskTech.has(t));
    const techRepo = skillTech.filter((t) => repoTech.has(t) && !taskTech.has(t));
    if (techTask.length) reasons.push(`task mentions ${techTask.join(", ")}`);
    if (techRepo.length) reasons.push(`repository uses ${techRepo.join(", ")}`);

    let canonical = 0;
    for (const [intent, rank] of Object.entries(r.canonicalFor) as [TaskIntent, number][]) {
      const s = strength(intent) * (intent === primary ? 1 : 0.7) * (1 - 0.12 * rank);
      if (s > canonical) canonical = s;
    }
    if (canonical > 0) {
      const best = (Object.entries(r.canonicalFor) as [TaskIntent, number][]).filter(([i]) => strength(i) > 0).sort((a, b) => a[1] - b[1])[0]!;
      reasons.push(`catalog pick #${best[1] + 1} for ${best[0]}`);
    }

    const triggers = r.triggers.filter(triggerHit);
    const trigger = triggers.length ? 1 : 0;
    if (trigger) reasons.push(`task names trigger ${triggers.map((t) => `"${t}"`).join(", ")}`);

    // Gates: evidence that must hold regardless of score.
    let gate: string | undefined;
    if (isTechSpecific(r) && !skillTech.some((t) => taskTech.has(t) || repoTech.has(t))) {
      gate = `technology-specific (${skillTech.join(", ")}); not used by the task${profile.repository ? " or repository" : ""}`;
    } else if (r.invocationMode === "explicit") {
      const named = triggers.length > 0;
      const styled = r.style.communication !== undefined;
      const styleRequested = styled && profile.requestedStyle.communication === r.style.communication;
      const slash = triggers.some((t) => t.startsWith("/"));
      const primaryPurpose = primary !== undefined && r.tasks.includes(primary) && strength(primary) >= 1;
      if (styled ? !(slash || styleRequested) : !(named || primaryPurpose)) {
        gate = styled
          ? `explicit-invocation skill with ${r.style.communication} style; the task neither names ${r.triggers.filter((t) => t.startsWith("/"))[0] ?? "its command"} nor asks for ${r.style.communication} output`
          : `explicit-invocation skill; the task does not name its triggers (${r.triggers.slice(0, 3).join(", ")})`;
      }
    } else if (!task && !trigger && !(lex >= 0.6 && domain > 0)) {
      gate = mismatches[0] ?? "no task-intent, trigger or domain evidence";
    }

    const hist = options.history.get(id);
    const history = gate ? 0 : (hist?.signal ?? 0);
    if (hist && !gate && hist.signal !== 0) reasons.push(`history: ${hist.similarTasks} similar task${hist.similarTasks === 1 ? "" : "s"}, feedback confidence ${hist.confidence.toFixed(2)}`);

    const purposes = nameIntents(r);
    const purposeMismatch = decisive.length > 0 && purposes.length > 0 && !purposes.some((i) => strength(i) > 0) ? 1 : 0;
    if (purposeMismatch) mismatches.push(`named purpose (${purposes.join(", ")}) is not what the task asks (${decisive.join(", ")})`);

    const styleDims = (["communication", "scope", "reviewMode"] as const).filter((d) => profile.requestedStyle[d] && r.style[d] === profile.requestedStyle[d]);
    if (styleDims.length) reasons.push(`matches requested ${styleDims.map((d) => `${profile.requestedStyle[d]} ${d}`).join(", ")}`);

    const cost = Math.min(1, r.tokens.full / (options.budget * 4));
    const base =
      w.task * task + w.lexical * lex + w.name * name + w.canonical * canonical + w.domain * domain + w.technology * (techTask.length ? 1 : 0) + w.repository * (techRepo.length ? 1 : 0) + w.priority * r.priority;
    const score = round(clamp01(base + w.trigger * trigger + w.style * (styleDims.length ? 1 : 0) + w.history * history - w.cost * cost - w.purpose * purposeMismatch));
    const scored: Scored = {
      skillId: id,
      record: r,
      score,
      signals: {
        task: round(task),
        lexical: round(lex),
        name: round(name),
        domain: round(domain),
        technology: techTask.length ? 1 : 0,
        repository: techRepo.length ? 1 : 0,
        trigger,
        canonical: round(canonical),
        history: round(history),
        dependency: 0,
        conflictPenalty: 0,
        redundancyPenalty: 0,
        costPenalty: round(cost),
      },
      reasons,
      matchedIntents: matched,
      mismatches,
    };
    if (gate) scored.gate = gate;
    out.push(scored);
  }
  return out.sort(byScore);
}

/** Words that describe the *kind* of skill, not its subject. */
const GENERIC_NAME = new Set(
  ["skill", "skills", "pattern", "patterns", "standard", "standards", "workflow", "agent", "engineer", "specialist", "expert", "guide", "advisor",
    "ops", "helper", "master", "pro", "best", "practices", "core", "common", "the", "and", "for", "of", "to", "a", "with", "ecc", "gstack"].flatMap((w) => tokenize(w, { keepStopWords: true })),
);
const nameTermCache = new WeakMap<SkillRecord, string[]>();
function nameTerms(r: SkillRecord): string[] {
  let t = nameTermCache.get(r);
  if (!t) {
    t = [...new Set(tokenize(`${r.id.split(/[/:]/).at(-1)} ${r.name}`))].filter((w) => !GENERIC_NAME.has(w));
    nameTermCache.set(r, t);
  }
  return t;
}

/** Activities (what is done) as opposed to topics (ai, database, ui, devops, security, performance). */
const ACTIVITIES = new Set<TaskIntent>(["debug", "implement", "refactor", "test", "review", "explain", "plan", "ship", "docs", "research", "verify", "communicate"]);
const nameIntentCache = new WeakMap<SkillRecord, TaskIntent[]>();
/** Activities stated by the skill's own name ("rag-pipeline-reviewer" → review). */
function nameIntents(r: SkillRecord): TaskIntent[] {
  let t = nameIntentCache.get(r);
  if (!t) {
    t = matchRules(words(`${r.id.split(/[/:]/).at(-1)} ${r.name}`.replace(/-/g, " ")), INTENT_RULES)
      .filter((m) => m.weight >= 1 && ACTIVITIES.has(m.name))
      .map((m) => m.name);
    nameIntentCache.set(r, t);
  }
  return t;
}

const nameTechCache = new WeakMap<SkillRecord, string[]>();
/** Technologies named in the skill's own name ("postgres-patterns" → postgres). */
function nameTechnologies(r: SkillRecord): string[] {
  let t = nameTechCache.get(r);
  if (!t) {
    t = detectTechnologies(`${r.id.split(/[/:]/).at(-1)} ${r.name}`.replace(/-/g, " "));
    nameTechCache.set(r, t);
  }
  return t;
}

/* ── Overlap ──────────────────────────────────────────────────────────── */

const metaTermCache = new WeakMap<SkillRecord, Set<string>>();
function metaTerms(r: SkillRecord): Set<string> {
  let t = metaTermCache.get(r);
  if (!t) {
    t = new Set(tokenize(`${r.name} ${r.description} ${r.tasks.join(" ")} ${r.domains.join(" ")} ${r.sections.map((s) => s.heading).join(" ")}`));
    metaTermCache.set(r, t);
  }
  return t;
}

/** Semantic (metadata cosine) and instructional (body-term sketch) overlap. */
export function skillOverlap(a: SkillRecord, b: SkillRecord): { semantic: number; instructional: number; overlap: number; identical: boolean } {
  const ta = metaTerms(a);
  const tb = metaTerms(b);
  const inter = [...ta].filter((x) => tb.has(x)).length;
  const semantic = ta.size && tb.size ? inter / Math.sqrt(ta.size * tb.size) : 0;
  const instructional = signatureSimilarity(a.signature, b.signature);
  return { semantic: round(semantic), instructional: round(instructional), overlap: round(0.5 * semantic + 0.5 * instructional), identical: a.contentHash === b.contentHash };
}

/* ── Conflicts ────────────────────────────────────────────────────────── */

function conflictBetween(a: SkillRecord, b: SkillRecord): { dimension: SkillConflict["dimension"]; values: [string, string] } | undefined {
  if (a.conflicts.includes(b.id) || b.conflicts.includes(a.id)) return { dimension: "explicit", values: ["declared", "declared"] };
  for (const dim of ["communication", "scope", "reviewMode"] as const) {
    const va = a.style[dim];
    const vb = b.style[dim];
    if (va && vb && va !== vb) return { dimension: dim, values: [va, vb] };
  }
  return undefined;
}

/**
 * Explicit precedence: user instruction → project instruction → task
 * requirement → skill priority (role, then kind priority) → score.
 */
function resolveConflict(
  candidate: Scored,
  existing: { c: Scored; order: number },
  dim: SkillConflict["dimension"],
  profile: TaskProfile,
  project: SkillStyle,
): { keep: "candidate" | "existing"; rule: SkillConflict["rule"]; reason: string } {
  if (dim !== "explicit") {
    const want = profile.requestedStyle[dim];
    if (want) {
      if (candidate.record.style[dim] === want) return { keep: "candidate", rule: "user-instruction", reason: `the task asks for ${want} ${dim}` };
      if (existing.c.record.style[dim] === want) return { keep: "existing", rule: "user-instruction", reason: `the task asks for ${want} ${dim}` };
    }
    const proj = project[dim];
    if (proj) {
      if (candidate.record.style[dim] === proj) return { keep: "candidate", rule: "project-instruction", reason: `project instructions ask for ${proj} ${dim}` };
      if (existing.c.record.style[dim] === proj) return { keep: "existing", rule: "project-instruction", reason: `project instructions ask for ${proj} ${dim}` };
    }
    if (dim === "scope" && profile.intents.some((i) => i === "debug" || i === "refactor" || i === "verify")) {
      const keep = candidate.record.style.scope === "minimal" ? "candidate" : "existing";
      return { keep, rule: "task-requirement", reason: `${profile.intents.filter((i) => i === "debug" || i === "refactor" || i === "verify").join("/")} tasks favour minimal scope` };
    }
  }
  if (existing.order === 0) return { keep: "existing", rule: "skill-priority", reason: "the existing skill is the primary selection" };
  if (candidate.record.priority !== existing.c.record.priority) {
    return candidate.record.priority > existing.c.record.priority
      ? { keep: "candidate", rule: "skill-priority", reason: `${candidate.record.kind} outranks ${existing.c.record.kind}` }
      : { keep: "existing", rule: "skill-priority", reason: `${existing.c.record.kind} outranks ${candidate.record.kind}` };
  }
  return candidate.score > existing.c.score
    ? { keep: "candidate", rule: "score", reason: "higher relevance score" }
    : { keep: "existing", rule: "score", reason: "higher relevance score" };
}

/* ── Dependencies ─────────────────────────────────────────────────────── */

export interface DependencyPlan {
  /** Dependency ids in load order (dependencies before dependents), excluding the roots. */
  order: string[];
  requiredBy: Map<string, string[]>;
  cycles: string[][];
  missing: { skillId: string; dependency: string }[];
  truncated: boolean;
}

/** Depth- and size-bounded DFS; cycles are reported and their back-edge skipped. */
export function resolveDependencies(registry: Pick<SkillRegistry, "get">, roots: readonly string[], maxDepth = MAX_DEPENDENCY_DEPTH, maxNodes = MAX_DEPENDENCIES): DependencyPlan {
  const rootSet = new Set(roots);
  const state = new Map<string, "visiting" | "done">();
  const order: string[] = [];
  const requiredBy = new Map<string, string[]>();
  const cycles: string[][] = [];
  const missing: { skillId: string; dependency: string }[] = [];
  let truncated = false;
  const stack: string[] = [];
  const visit = (id: string, depth: number): void => {
    state.set(id, "visiting");
    stack.push(id);
    for (const dep of registry.get(id)?.dependencies ?? []) {
      if (!registry.get(dep)) {
        missing.push({ skillId: id, dependency: dep });
        continue;
      }
      if (!rootSet.has(dep)) requiredBy.set(dep, [...new Set([...(requiredBy.get(dep) ?? []), id])]);
      const s = state.get(dep);
      if (s === "visiting") {
        cycles.push([...stack.slice(stack.indexOf(dep)), dep]);
        continue;
      }
      if (s === "done") continue;
      if (depth >= maxDepth || order.length >= maxNodes) {
        truncated = true;
        continue;
      }
      visit(dep, depth + 1);
    }
    stack.pop();
    state.set(id, "done");
    if (!rootSet.has(id)) order.push(id);
  };
  for (const root of roots) if (!state.has(root)) visit(root, 0);
  return { order, requiredBy, cycles, missing, truncated };
}

/* ── Routing ──────────────────────────────────────────────────────────── */

interface Choice {
  c: Scored;
  role: SkillRole | "dependency";
  forced?: boolean;
}

export function routeSkills(registry: SkillRegistry, task: string, options: RouteOptions = {}): SkillRoutingResult {
  return routeCore(registry, task, options);
}

/**
 * Deterministic routing, plus an optional model reranker that is consulted
 * only when the task is ambiguous or the top candidates are within
 * CLOSE_MARGIN. It sees at most RERANK_K candidates' metadata and can only
 * reorder them; unknown ids it returns are reported and ignored.
 */
export async function routeSkillsWithReranker(registry: SkillRegistry, task: string, reranker: SkillReranker, options: RouteOptions = {}): Promise<SkillRoutingResult> {
  const first = routeCore(registry, task, options);
  const eligible = first.rejected.concat(first.selected.map((s) => ({ skillId: s.skillId, score: s.score, reason: [] })));
  const top = [...new Map(eligible.map((e) => [e.skillId, e])).values()].sort((a, b) => b.score - a.score || (a.skillId < b.skillId ? -1 : 1)).slice(0, RERANK_K);
  const close = top.length > 1 && top[0]!.score - top[1]!.score < CLOSE_MARGIN;
  if (!first.profile.ambiguous && !close) return { ...first, reranker: { used: false, reason: "deterministic ranking was decisive" } };
  const candidates = top.map((t) => {
    const r = registry.get(t.skillId)!;
    return { skillId: r.id, name: r.name, description: r.description, score: t.score };
  });
  let proposed: string[];
  try {
    proposed = await reranker.rerank({ task, profile: first.profile, candidates });
  } catch (error) {
    return { ...first, reranker: { used: false, reason: `reranker failed: ${(error as Error).message}` } };
  }
  const allowed = new Set(candidates.map((c) => c.skillId));
  const invented = proposed.filter((id) => !allowed.has(id));
  const order = [...new Set(proposed.filter((id) => allowed.has(id)))];
  for (const c of candidates) if (!order.includes(c.skillId)) order.push(c.skillId);
  const result = routeCore(registry, task, options, order);
  const info: NonNullable<SkillRoutingResult["reranker"]> = { used: true, reason: first.profile.ambiguous ? "ambiguous task" : `top scores within ${CLOSE_MARGIN}` };
  if (invented.length) info.invented = invented;
  return { ...result, reranker: info };
}

function routeCore(registry: SkillRegistry, task: string, options: RouteOptions, rerankOrder?: string[]): SkillRoutingResult {
  const t0 = performance.now();
  const budget = Math.max(0, Math.floor(options.budget ?? DEFAULT_SKILL_BUDGET));
  const weights = { ...DEFAULT_SKILL_WEIGHTS, ...options.weights };
  const profile = profileTask(task, options.repository);
  const t1 = performance.now();
  const history = historicalSignals(options.feedback ?? [], profile, options.now);
  const scored = scoreCandidates(registry, profile, { weights, budget, history, exclude: new Set(options.exclude ?? []) });
  if (rerankOrder) {
    const pos = new Map(rerankOrder.map((id, i) => [id, i]));
    scored.sort((a, b) => {
      const pa = pos.get(a.skillId);
      const pb = pos.get(b.skillId);
      if (pa !== undefined && pb !== undefined) return pa - pb;
      if (pa !== undefined) return -1;
      if (pb !== undefined) return 1;
      return byScore(a, b);
    });
  }

  const maxSkills = profile.ambiguous ? Math.min(2, options.maxSkills ?? DEFAULT_MAX_SKILLS) : (options.maxSkills ?? DEFAULT_MAX_SKILLS);
  const minScore = (options.minScore ?? DEFAULT_MIN_SCORE) + (profile.ambiguous ? 0.1 : 0);
  const decisive = profile.intents.some((i) => (profile.intentStrength[i] ?? 0) >= 1) || scored.some((c) => !c.gate && c.signals.trigger > 0);
  const project = options.projectInstructions ? requestedStyle(options.projectInstructions) : {};

  const picks: Choice[] = [];
  const rejected: RejectedSkill[] = [];
  const conflicts: SkillConflict[] = [];
  const redundancy: SkillOverlap[] = [];
  const reject = (c: Scored, reason: string[]): void => void rejected.push({ skillId: c.skillId, score: c.score, reason: [...reason, ...c.mismatches.filter((m) => !reason.includes(m)).slice(0, 1)] });

  // Manual selections first (ablation "manual" and --skill); they skip gates but not the budget.
  for (const id of options.include ?? []) {
    const c = scored.find((s) => s.skillId === id) ?? manualCandidate(registry, id);
    if (c && !picks.some((p) => p.c.skillId === id)) picks.push({ c: { ...c, reasons: ["requested explicitly", ...c.reasons] }, role: "supporting", forced: true });
  }

  const strength = (i: TaskIntent): number => profile.intentStrength[i] ?? 0;
  /**
   * Needs a skill can satisfy: decisive task intents it has evidence for, and
   * technologies the task names (when the skill is otherwise relevant).
   * Weak intents, domains and repository-only technologies raise scores but
   * never justify adding another skill on their own.
   */
  const strongFor = (c: Scored, i: TaskIntent): boolean => (c.record.taskEvidence[i] ?? 0) >= 1;
  const needsOf = (c: Scored): string[] => {
    const r = c.record;
    const needs = c.matchedIntents.filter((i) => strength(i) >= 1 && strongFor(c, i)).map((i) => `intent:${i}`);
    if (needs.length || c.signals.lexical >= 0.5) {
      const subject = new Set([...(isTechSpecific(r) ? [...r.languages, ...r.frameworks] : []), ...nameTechnologies(r)]);
      for (const t of subject) if (profile.technologies.includes(t)) needs.push(`tech:${t}`);
    }
    return needs;
  };
  const covered = (): Set<string> => new Set(picks.filter((p) => p.role !== "dependency").flatMap((p) => needsOf(p.c)));

  if (!decisive && !(options.include?.length)) {
    // Nothing decisive to act on: load nothing. Ambiguous tasks get suggestions instead of a guess.
    for (const c of scored.slice(0, REJECTED_LIMIT)) reject(c, [c.gate ?? (profile.ambiguous ? "task too ambiguous to select skills" : "no engineering task recognised in the task text")]);
  } else {
    let crossCuttingUsed = false;
    for (const c of scored) {
      if (picks.some((p) => p.c.skillId === c.skillId)) continue;
      if (c.gate) {
        reject(c, [c.gate]);
        continue;
      }
      if (c.score < minScore) {
        reject(c, [`score ${c.score.toFixed(2)} below threshold ${minScore.toFixed(2)}`]);
        continue;
      }
      if (picks.length >= maxSkills) {
        reject(c, [`selection limit ${maxSkills} reached`]);
        continue;
      }
      // Conflicts: never load two contradictory skills.
      let lost = false;
      for (const [order, p] of [...picks.entries()]) {
        const k = conflictBetween(c.record, p.c.record);
        if (!k) continue;
        const res = p.forced ? { keep: "existing" as const, rule: "user-instruction" as const, reason: "the existing skill was requested explicitly" } : resolveConflict(c, { c: p.c, order }, k.dimension, profile, project);
        const kept = res.keep === "candidate" ? c : p.c;
        const dropped = res.keep === "candidate" ? p.c : c;
        conflicts.push({
          skills: [c.skillId, p.c.skillId],
          dimension: k.dimension,
          values: k.values,
          kept: kept.skillId,
          dropped: dropped.skillId,
          rule: res.rule,
          reason: `${k.dimension === "explicit" ? "declared conflict" : `${k.dimension}: ${k.values[0]} vs ${k.values[1]}`}; ${res.reason}`,
        });
        if (res.keep === "existing") {
          c.signals.conflictPenalty = 1;
          reject(c, [`conflicts with ${p.c.skillId} (${k.dimension}); kept ${p.c.skillId} by ${res.rule}: ${res.reason}`]);
          lost = true;
          break;
        }
        picks.splice(picks.indexOf(p), 1);
        p.c.signals.conflictPenalty = 1;
        reject(p.c, [`conflicts with ${c.skillId} (${k.dimension}); kept ${c.skillId} by ${res.rule}: ${res.reason}`]);
      }
      if (lost) continue;
      const have = covered();
      const unique = needsOf(c).filter((n) => !have.has(n));
      let nearest: { id: string; o: ReturnType<typeof skillOverlap> } | undefined;
      for (const p of picks) {
        const o = skillOverlap(c.record, p.c.record);
        if (!nearest || o.overlap > nearest.o.overlap) nearest = { id: p.c.skillId, o };
      }
      // At most one cross-cutting principle, and only one that serves the primary intent.
      const reference = c.record.crossCutting && !crossCuttingUsed && picks.length > 0 && !!profile.intents[0] && (c.record.taskEvidence[profile.intents[0]] ?? 0) >= 1;
      if (nearest?.o.identical || (!unique.length && !reference && picks.length > 0)) {
        if (nearest) {
          redundancy.push({ skillId: c.skillId, overlapsWith: nearest.id, ...nearest.o, uniqueCoverage: unique, decision: "dropped" });
          c.signals.redundancyPenalty = nearest.o.overlap;
          reject(c, [
            nearest.o.identical
              ? `identical content to ${nearest.id}`
              : nearest.o.overlap >= REDUNDANCY_OVERLAP
                ? `redundant: overlaps ${nearest.id} (${nearest.o.overlap.toFixed(2)}: semantic ${nearest.o.semantic.toFixed(2)}, instructional ${nearest.o.instructional.toFixed(2)}) and adds no uncovered task need`
                : `adds no uncovered task need (needs already covered by ${picks.map((p) => p.c.skillId).join(", ")}; content overlap with ${nearest.id} is only ${nearest.o.overlap.toFixed(2)})`,
          ]);
        } else reject(c, ["adds no uncovered task need"]);
        continue;
      }
      if (nearest && nearest.o.overlap >= REDUNDANCY_OVERLAP) redundancy.push({ skillId: c.skillId, overlapsWith: nearest.id, ...nearest.o, uniqueCoverage: unique, decision: "kept" });

      if (reference && !unique.length) crossCuttingUsed = true;
      picks.push({ c, role: reference && !unique.length ? "reference" : "supporting" });
    }
  }

  // Roles: primary covers the primary intent; other decisive intents are secondary.
  const primaryIntent = profile.intents[0];
  const main = picks.filter((p) => p.role !== "reference");
  const primaryPick =
    main.find((p) => primaryIntent && p.c.matchedIntents.includes(primaryIntent) && strongFor(p.c, primaryIntent) && !p.forced) ??
    main.find((p) => primaryIntent && p.c.matchedIntents.includes(primaryIntent) && !p.forced) ??
    main.find((p) => !p.forced) ??
    main[0];
  const coveredByPrimary = new Set(primaryPick?.c.matchedIntents ?? []);
  for (const p of picks) {
    if (p === primaryPick) p.role = "primary";
    else if (p.role === "reference" || (p.c.record.crossCutting && !p.forced)) p.role = "reference";
    else if (!p.forced && p.c.matchedIntents.some((i) => strength(i) >= 1 && !coveredByPrimary.has(i)) && !p.c.matchedIntents.every((i) => i === "test" || i === "verify") && !isTechSpecific(p.c.record)) p.role = "secondary";
    else p.role = "supporting";
    p.c.reasons.push(`role: ${p.role}`);
  }
  const roleRank: Record<string, number> = { primary: 0, secondary: 1, supporting: 2, reference: 3, dependency: 4 };
  picks.sort((a, b) => roleRank[a.role]! - roleRank[b.role]! || byScore(a.c, b.c));

  // Dependencies (bounded), loaded at the cheapest useful level.
  const deps = resolveDependencies(registry, picks.map((p) => p.c.skillId));
  for (const id of deps.order) {
    const r = registry.get(id)!;
    picks.push({ c: { skillId: id, record: r, score: 0, signals: emptySignals(), reasons: [`required by ${deps.requiredBy.get(id)?.join(", ")}`], matchedIntents: [], mismatches: [] }, role: "dependency" });
  }

  const t2 = performance.now();
  const composed = fitToSkillBudget(registry, picks, profile, budget, history, conflicts);
  const t3 = performance.now();

  const loadedById = new Map(composed.skills.map((s) => [s.record.id, s]));
  const selected: SelectedSkill[] = picks
    .filter((p) => p.role !== "dependency" && loadedById.has(p.c.skillId))
    .map((p) => {
      const s = loadedById.get(p.c.skillId)!;
      const r = p.c.record;
      const out: SelectedSkill = {
        skillId: r.id,
        name: r.name,
        role: p.role as SkillRole,
        score: p.c.score,
        reason: [...p.c.reasons, ...(conflicts.some((k) => k.kept === r.id) ? [] : ["no conflict detected"])],
        loadedLevel: s.level,
        estimatedTokens: s.loaded?.tokens ?? 0,
        source: { repository: r.source, commit: r.sourceCommit, path: r.sourcePath, license: r.license, contentHash: r.contentHash },
        metadataProvenance: r.metadataProvenance,
        capabilities: r.capabilities,
        riskFlags: r.riskFlags,
      };
      if (s.stale) out.stale = s.stale;
      return out;
    });
  for (const d of composed.dropped) {
    const p = picks.find((x) => x.c.skillId === d.skillId);
    if (p && p.role !== "dependency") reject(p.c, [d.reason]);
  }
  const dependencies: SkillDependencyResolution[] = deps.order.map((id, order) => ({
    skillId: id,
    requiredBy: deps.requiredBy.get(id) ?? [],
    order,
    loadedLevel: loadedById.get(id)?.level ?? "not-loaded",
    reason: loadedById.has(id) ? "dependency loaded at the cheapest level that fits" : "dependency not loaded: skill budget",
  }));

  // Confidence describes the selection: nothing selected means no confidence in any skill.
  const top = selected[0]?.score ?? 0;
  const confidence = round(clamp01(top * (0.6 + 0.4 * profile.specificity) * (profile.ambiguous ? 0.5 : 1)));
  const result: SkillRoutingResult = {
    schemaVersion: SKILL_SCHEMA_VERSION,
    task,
    profile,
    confidence,
    selected,
    rejected: dedupeRejected(rejected).slice(0, REJECTED_LIMIT),
    conflicts,
    redundancy,
    dependencies,
    dependencyIssues: { cycles: deps.cycles, missing: deps.missing, truncated: deps.truncated },
    budget: {
      maximumTokens: budget,
      usedTokens: composed.tokens,
      remainingTokens: budget - composed.tokens,
      dropped: composed.dropped,
      downgraded: composed.downgraded,
      estimator: TOKEN_ESTIMATOR,
    },
    context: composed.text,
    timings: { profileMs: round(t1 - t0), routeMs: round(t2 - t1), composeMs: round(t3 - t2) },
  };
  if (profile.ambiguous) {
    const suggestions = scored.filter((c) => !c.gate).slice(0, 3).map((c) => c.skillId);
    result.clarification = `The task is ambiguous (${profile.ambiguityReasons.join("; ")}). Say what should change, where, and how success is judged — e.g. "reduce p95 latency of GET /orders below 200 ms".${suggestions.length ? ` Possibly relevant: ${suggestions.join(", ")}.` : ""}`;
  } else if (!selected.length && !decisive) {
    result.clarification = "No engineering task was recognised, so no skill was loaded.";
  }
  return result;
}

function emptySignals(): SkillCandidate["signals"] {
  return { task: 0, lexical: 0, name: 0, domain: 0, technology: 0, repository: 0, trigger: 0, canonical: 0, history: 0, dependency: 1, conflictPenalty: 0, redundancyPenalty: 0, costPenalty: 0 };
}

function manualCandidate(registry: SkillRegistry, id: string): Scored | undefined {
  const r = registry.get(id);
  return r ? { skillId: id, record: r, score: 0, signals: emptySignals(), reasons: [], matchedIntents: [], mismatches: [] } : undefined;
}

function dedupeRejected(list: RejectedSkill[]): RejectedSkill[] {
  const seen = new Map<string, RejectedSkill>();
  for (const r of list) if (!seen.has(r.skillId)) seen.set(r.skillId, r);
  return [...seen.values()].sort((a, b) => b.score - a.score || (a.skillId < b.skillId ? -1 : 1));
}

/* ── Budget + progressive loading ─────────────────────────────────────── */

interface PlanItem {
  pick: Choice;
  level: SkillLevel | "dropped";
  allowance: number;
}

const LADDER: (SkillLevel | "dropped")[] = ["full", "sections", "summary", "metadata", "dropped"];

function fitToSkillBudget(
  registry: SkillRegistry,
  picks: Choice[],
  profile: TaskProfile,
  budget: number,
  history: Map<string, HistoricalSignal>,
  conflicts: SkillConflict[],
): { text: string; tokens: number; skills: ComposedSkill[]; dropped: { skillId: string; reason: string }[]; downgraded: { skillId: string; from: SkillLevel; to: SkillLevel }[] } {
  const initial = (p: Choice): { level: SkillLevel; allowance: number } => {
    const r = p.c.record;
    let level: SkillLevel;
    let allowance = 0;
    if (p.role === "primary") {
      if (r.tokens.full <= budget * 0.6) level = "full";
      else {
        level = "sections";
        allowance = Math.floor(budget * 0.5);
      }
    } else if (p.role === "secondary") {
      allowance = Math.floor(budget * 0.25);
      level = r.tokens.full <= allowance ? "full" : "sections";
    } else if (p.role === "dependency") level = "metadata";
    else level = "summary";
    if (history.get(r.id)?.preferShorter && SKILL_LEVELS.indexOf(level) > SKILL_LEVELS.indexOf("summary")) level = "summary";
    return { level, allowance };
  };
  const plan: PlanItem[] = picks.map((pick) => ({ pick, ...initial(pick) }));
  const desired = new Map(plan.map((p) => [p.pick.c.skillId, p.level as SkillLevel]));
  const estimate = (p: PlanItem): number => {
    const t = p.pick.c.record.tokens;
    switch (p.level) {
      case "full":
        return t.full;
      case "sections":
        return Math.min(t.full, p.allowance);
      case "summary":
        return t.summary;
      case "metadata":
      case "routing":
        return t.metadata;
      default:
        return 0;
    }
  };
  // Downgrade the least important item first: dependencies, references, supporting, secondary, primary.
  const downgradeOne = (): boolean => {
    for (let i = plan.length - 1; i >= 0; i -= 1) {
      const p = plan[i]!;
      if (p.level === "dropped") continue;
      const next = LADDER[LADDER.indexOf(p.level === "routing" ? "metadata" : p.level) + 1]!;
      if (p.level === "sections" && p.allowance > 400 && p.pick.role === "primary") {
        p.allowance = Math.floor(p.allowance * 0.6);
        return true;
      }
      p.level = next;
      if (next === "sections") p.allowance = Math.floor(budget * 0.3);
      return true;
    }
    return false;
  };
  const overhead = 160 + 40 * plan.length;
  while (plan.reduce((s, p) => s + estimate(p), 0) + overhead > budget && downgradeOne());
  // Give leftover budget to section-level skills in role order (primary first) rather than leave it unused.
  const filled = new Map<PlanItem, number>();
  for (const p of plan) {
    if (p.level !== "sections") continue;
    const slack = budget - overhead - plan.reduce((s, q) => s + estimate(q), 0);
    if (slack <= 0) break;
    const before = p.allowance;
    p.allowance = Math.min(p.pick.c.record.tokens.full, p.allowance + slack);
    filled.set(p, p.allowance - before);
  }
  /** Over budget after composing: first give back slack that was added, then downgrade. */
  const shrink = (overflow: number): boolean => {
    for (const [p, extra] of [...filled].reverse()) {
      if (extra <= 0 || p.level !== "sections") continue;
      const cut = Math.min(extra, overflow + 40);
      p.allowance -= cut;
      filled.set(p, extra - cut);
      return true;
    }
    return downgradeOne();
  };

  const cache = new Map<string, ComposedSkill>();
  const load = (p: PlanItem): ComposedSkill | undefined => {
    if (p.level === "dropped") return undefined;
    const key = `${p.pick.c.skillId}|${p.level}|${p.allowance}`;
    let s = cache.get(key);
    if (!s) {
      const record = p.pick.c.record;
      try {
        const loaded = registry.load(record.id, p.level, { focus: profile.terms, ...(p.allowance ? { maxTokens: p.allowance } : {}) });
        s = { record, role: p.pick.role, level: p.level, loaded };
      } catch (error) {
        if (!(error instanceof StaleSkillError)) throw error;
        const loaded = registry.load(record.id, "metadata");
        s = { record, role: p.pick.role, level: "metadata", loaded, stale: error.message };
      }
      cache.set(key, s);
    }
    return s;
  };
  let composed = composeSkillContext(plan.map(load).filter((s): s is ComposedSkill => !!s), profile, conflicts);
  while (estimateTokens(composed) > budget && shrink(estimateTokens(composed) - budget)) composed = composeSkillContext(plan.map(load).filter((s): s is ComposedSkill => !!s), profile, conflicts);
  const skills = plan.map(load).filter((s): s is ComposedSkill => !!s);
  if (estimateTokens(composed) > budget) {
    composed = "";
    for (const p of plan) p.level = "dropped";
  }
  const tokens = estimateTokens(composed);
  const dropped = plan.filter((p) => p.level === "dropped").map((p) => ({ skillId: p.pick.c.skillId, reason: `skill budget (${budget} tokens) exhausted` }));
  const downgraded = plan
    .filter((p) => p.level !== "dropped" && p.level !== desired.get(p.pick.c.skillId))
    .map((p) => ({ skillId: p.pick.c.skillId, from: desired.get(p.pick.c.skillId)!, to: p.level as SkillLevel }));
  return { text: composed, tokens, skills: composed ? skills : [], dropped, downgraded };
}
