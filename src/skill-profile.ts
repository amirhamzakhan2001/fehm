import type { FehmEngine } from "./engine.js";
import type { RepositoryProfile, TaskIntent, TaskProfile } from "./skill-model.js";
import { detectTechnologies, GENERIC_PHRASES, TECHNOLOGIES, hasEngineeringContext, INTENT_RULES, matchDomains, matchRules, packageTechnologies, requestedStyle, words } from "./skill-vocabulary.js";
import { tokenize } from "./text.js";

const ACTIVITY: Record<TaskIntent, string> = {
  debug: "debugging",
  implement: "implementation",
  refactor: "refactoring",
  test: "testing",
  review: "review",
  explain: "understanding",
  plan: "planning",
  ship: "release",
  git: "version-control",
  security: "security-assessment",
  performance: "optimization",
  docs: "documentation",
  ui: "interface-work",
  research: "research",
  database: "data-work",
  devops: "operations",
  ai: "ai-engineering",
  communicate: "communication",
  verify: "verification",
};

/** Words that carry no task-specific information on their own. */
const VAGUE = new Set(
  ["improve", "better", "fix", "make", "optimize", "optimise", "clean", "good", "stuff", "thing", "things", "update", "change", "help",
    "do", "it", "this", "that", "these", "those", "please", "can", "you", "some", "code", "work", "look", "check", "handle", "nice", "up"].map((w) => tokenize(w, { keepStopWords: true })[0] ?? w),
);

/**
 * Deterministic task profile. No model: verbs/keywords/technology terms are
 * matched as whole stemmed tokens with Feature 1's tokenizer.
 */
export function profileTask(task: string, repository?: RepositoryProfile): TaskProfile {
  const tokens = words(task);
  const style = requestedStyle(task);
  const explicitTriggers = [...task.matchAll(/(?:^|\s)(\/[a-z][\w:-]*)/gi)].map((m) => m[1]!.toLowerCase());
  const technologies = detectTechnologies(task, { strict: true });
  const domains = matchDomains(tokens);
  const engineering = explicitTriggers.length > 0 || hasEngineeringContext(task, tokens, technologies, domains);
  const content = [...new Set(tokenize(task))].filter((t) => !VAGUE.has(t));
  const reasons: string[] = [];
  if (content.length < 2 && !explicitTriggers.length && !technologies.length) reasons.push(`only ${content.length} task-specific term${content.length === 1 ? "" : "s"} (${content.join(", ") || "none"})`);

  const intentMatches = matchRules(tokens, INTENT_RULES);
  for (const m of intentMatches) {
    // "Plan a weekend trip", "explain TCP vs UDP": generic verbs need engineering context.
    if (!engineering && m.matched.every((p) => GENERIC_PHRASES.has(p))) m.weight = Math.min(m.weight, 0.5);
  }
  if (!intentMatches.some((m) => m.weight >= 1) && intentMatches.length) reasons.push("no decisive task verb");
  const ambiguous = reasons.length > 0 && content.length < 3;
  // A specific engineering task phrased with a weak verb ("add rate limiting to the API") is still a task.
  if (engineering && !ambiguous && intentMatches.length && !intentMatches.some((m) => m.weight >= 1)) intentMatches[0]!.weight = 1;
  intentMatches.sort((a, b) => b.weight - a.weight || a.position - b.position || (a.name < b.name ? -1 : 1));
  const intents = intentMatches.map((m) => m.name);
  const intentStrength: Partial<Record<TaskIntent, number>> = {};
  for (const m of intentMatches) intentStrength[m.name] = m.weight;
  const profile: TaskProfile = {
    task,
    terms: [...new Set(tokenize(task))],
    intents,
    intentStrength,
    domains,
    activities: intents.map((i) => ACTIVITY[i]),
    technologies,
    requestedStyle: style,
    explicitTriggers,
    specificity: Math.min(1, content.length / 4),
    ambiguous,
    ambiguityReasons: ambiguous ? reasons : [],
  };
  if (repository) profile.repository = repository;
  return profile;
}

/** Repository technologies from explicit languages/packages (e.g. from Feature 1). */
export function repositoryProfile(languages: readonly string[], packages: readonly string[]): RepositoryProfile {
  const technologies = new Set<string>();
  for (const l of languages) if (Object.hasOwn(TECHNOLOGIES, l)) technologies.add(l);
  for (const p of packages) for (const t of packageTechnologies(p)) technologies.add(t);
  return { languages: [...new Set(languages)].sort(), packages: [...new Set(packages)].sort(), technologies: [...technologies].sort() };
}

/**
 * Consume Feature 1's existing analysis (languages + external packages from
 * the code graph). Feature 2 never scans or parses the repository itself.
 */
export function repositoryProfileFromEngine(engine: FehmEngine): RepositoryProfile {
  const map = engine.systemMap();
  return repositoryProfile(
    Object.keys(map.languages),
    map.externalPackages.map((p) => p.name),
  );
}
