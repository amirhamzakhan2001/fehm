import { estimateTokens, TOKEN_ESTIMATOR } from "./compression.js";
import type { FehmEngine } from "./engine.js";
import type { ContextPacket, RetrievalIntent } from "./model.js";
import type { SkillRoutingResult, TaskIntent, TaskProfile } from "./skill-model.js";
import { profileTask, repositoryProfileFromEngine } from "./skill-profile.js";
import type { SkillRegistry } from "./skill-registry.js";
import { routeSkills, type RouteOptions } from "./skill-router.js";

export const AGENT_CONTEXT_SCHEMA_VERSION = "1.0";

export interface AgentContextOptions {
  /** Overall budget the combined context must fit (default 16 000). */
  totalBudget?: number;
  /** Skill context share (default 2 500). */
  skillBudget?: number;
  /** Feature 1 code context share (default 8 000). */
  codeBudget?: number;
  /** Task/instruction share (default 1 000). */
  taskBudget?: number;
  /** Give skill tokens that routing did not use to the code context (default true). */
  reallocateUnusedSkillBudget?: boolean;
  /** `null` disables skills (code context only). */
  registry: SkillRegistry | null;
  route?: Omit<RouteOptions, "budget" | "repository">;
  /** Override Feature 1's retrieval intent (otherwise mapped from the task profile). */
  intent?: RetrievalIntent;
}

export interface AgentContext {
  schemaVersion: string;
  task: string;
  profile: TaskProfile;
  budget: {
    total: number;
    task: { maximum: number; used: number };
    skills: { maximum: number; used: number };
    code: { maximum: number; used: number; reallocatedFromSkills: number };
    /** Left for the agent's own reasoning and tool output. */
    reserved: number;
    estimator: string;
  };
  skills: SkillRoutingResult | null;
  code: ContextPacket;
  markdown: string;
}

const RETRIEVAL_INTENT: Partial<Record<TaskIntent, RetrievalIntent>> = {
  debug: "debug",
  test: "test",
  verify: "test",
  explain: "explain",
  implement: "change",
  refactor: "change",
  plan: "architecture",
  review: "change",
  security: "debug",
  performance: "debug",
};

/**
 * The one agent-context builder: task profile → skill routing (Feature 2,
 * using Feature 1's repository profile) → Feature 1 code context → combined
 * Markdown. Each part is held to its own budget; the whole never exceeds
 * `totalBudget` under Fehm's estimator.
 */
export function buildAgentContext(engine: FehmEngine, task: string, options: AgentContextOptions): AgentContext {
  const total = options.totalBudget ?? 16_000;
  const skillMax = options.registry ? (options.skillBudget ?? 2_500) : 0;
  const taskMax = options.taskBudget ?? 1_000;
  const codeMax = options.codeBudget ?? 8_000;
  if (skillMax + codeMax + taskMax > total) {
    throw new Error(`budget split exceeds total: skills ${skillMax} + code ${codeMax} + task ${taskMax} > ${total}`);
  }
  const taskSection = `# Task\n\n${task.trim()}\n`;
  const taskUsed = estimateTokens(taskSection);
  if (taskUsed > taskMax) throw new Error(`task text is ${taskUsed} estimated tokens, above the task budget of ${taskMax}`);

  const repository = repositoryProfileFromEngine(engine);
  const skills = options.registry ? routeSkills(options.registry, task, { ...options.route, budget: skillMax, repository }) : null;
  const skillUsed = skills?.budget.usedTokens ?? 0;
  const reallocated = options.reallocateUnusedSkillBudget === false ? 0 : Math.max(0, skillMax - skillUsed);
  const profile = skills?.profile ?? profileTask(task, repository);
  const primary = profile.intents[0];
  const intent = options.intent ?? (primary ? RETRIEVAL_INTENT[primary] : undefined);
  const code = engine.context(task, { budget: codeMax + reallocated, ...(intent ? { intent } : {}) });
  const codeMarkdown = engine.renderContext(code);
  const markdown = [taskSection, skills?.context ?? "", codeMarkdown].filter(Boolean).join("\n");
  const codeUsed = estimateTokens(codeMarkdown);
  return {
    schemaVersion: AGENT_CONTEXT_SCHEMA_VERSION,
    task,
    profile,
    budget: {
      total,
      task: { maximum: taskMax, used: taskUsed },
      skills: { maximum: skillMax, used: skillUsed },
      code: { maximum: codeMax + reallocated, used: codeUsed, reallocatedFromSkills: reallocated },
      reserved: total - taskUsed - skillUsed - codeUsed,
      estimator: TOKEN_ESTIMATOR,
    },
    skills,
    code,
    markdown,
  };
}
