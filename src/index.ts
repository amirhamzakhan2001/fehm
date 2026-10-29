export * from "./model.js";
export { FehmEngine, commandProvider } from "./engine.js";
export type { EngineStatus, ExplainResult, FlowStep, FocusResult, RelatedNode, Resolution } from "./engine.js";
export { scanRepository, diffScan, detectLanguage, isTestPath, classifyRole, IgnoreMatcher, EXCLUDED_DIRECTORIES } from "./scanner.js";
export { indexRepository, buildGraph, loadGraph } from "./indexer.js";
export type { IndexOptions, IndexResult } from "./indexer.js";
export { CodeGraph, MAX_TRAVERSAL_DEPTH } from "./graph.js";
export type { TraversalOptions, TraversalStep } from "./graph.js";
export { retrieve, detectIntent, buildLexicalIndex, DEFAULT_WEIGHTS } from "./retrieval.js";
export type { RetrievalOptions, RetrievalWeights } from "./retrieval.js";
export { buildContextPacket, renderContextPacket } from "./context.js";
export type { ContextOptions, ContextSources } from "./context.js";
export { diversifyHits, fileFirstRoundRobin } from "./context-selection.js";
export { estimateTokens, compressSource, focusedExcerpt, fitToBudget, TOKEN_ESTIMATOR } from "./compression.js";
export { deterministicSummary } from "./summary.js";
export { generateSemanticSummaries, loadSummaries, summaryStatus, staleSummaryNodes } from "./semantic-summary.js";
export type { SummaryProvider, SemanticSummary } from "./semantic-summary.js";
export { addMemory, loadMemory, removeMemory, rankMemory } from "./memory.js";
export { systemMap, connectivity } from "./system-map.js";
export { LexicalIndex } from "./lexical-index.js";
export { splitIdentifier, tokenize } from "./text.js";

// Feature 2 — skill intelligence and routing
export * from "./skill-model.js";
export { SkillRegistry, StaleSkillError, BUNDLED_CATALOG, checkUpstreamFreshness } from "./skill-registry.js";
export type { RegistrySource, RegistryReport, LoadOptions, UpstreamFreshness } from "./skill-registry.js";
export { catalogAdapter, directoryAdapter, normalizeSkill, parseFrontmatter } from "./skill-adapters.js";
export type { SkillAdapter, SkillEntry, RawSkill, DirectorySourceOptions } from "./skill-adapters.js";
export { profileTask, repositoryProfile, repositoryProfileFromEngine } from "./skill-profile.js";
export { routeSkills, routeSkillsWithReranker, commandReranker, resolveDependencies, skillOverlap, DEFAULT_SKILL_WEIGHTS, DEFAULT_SKILL_BUDGET } from "./skill-router.js";
export type { RouteOptions, SkillReranker, SkillWeights } from "./skill-router.js";
export { composeSkillContext, AUTHORITY_NOTICE } from "./skill-compose.js";
export { loadSkillFeedback, recordSkillFeedback, historicalSignals } from "./skill-feedback.js";
export { runSkillBench, scoreCase, summarize } from "./skill-eval.js";
export type { SkillBenchCase, BenchSummary } from "./skill-eval.js";
export { buildAgentContext } from "./agent-context.js";
export type { AgentContext, AgentContextOptions } from "./agent-context.js";
export { manageSkill, integrationPlatforms, installedSkillName } from "./integrations.js";

// Feature 3.2 — codebase briefing (deterministic, evidence-backed)
export * from "./codebase-briefing/types.js";
export { buildCodebaseBriefing, withFreshness, briefingFreshness, affectedSections, SECTION_DEPENDENCIES, BUILD_ORDER } from "./codebase-briefing/briefing.js";
export type { BriefingOptions } from "./codebase-briefing/briefing.js";
export { renderBriefing, DEPTH_BUDGET } from "./codebase-briefing/render.js";
export type { BriefingDepth, RenderOptions } from "./codebase-briefing/render.js";

// Feature 3.7 — Prompt Intelligence
export * from "./prompts/types.js";
export * from "./prompts/report.js";
export * from "./prompts/analysis.js";
export * from "./prompts/evaluation.js";
export * from "./prompts/optimization.js";
export * from "./prompts/revisions.js";
export * from "./prompts/experiment.js";

// Feature 3.8 — Git Memory & Logs
export * from "./git-memory/types.js";
export * from "./git-memory/history.js";
export * from "./git-memory/snapshots.js";
export { historyBlame, rawHistoryDiff } from "./git-memory/git.js";

// Feature 3.9 — Engineering concepts and ontology
export * from "./concepts/types.js";
export * from "./concepts/catalog.js";
export * from "./concepts/analysis.js";
export * from "./concepts/context.js";

export { Guardrails, suggestedPolicy, validatePolicy, classify } from "./guardrails/workflow.js";
export type { GuardRun, GuardPolicy, GuardCheck, Requirement, CheckEvidence, CheckStatus, Phase } from "./guardrails/types.js";

export { analyzeChange, type ChangeAnalysis } from './guardrails/change.js';

export { investigate } from './debugging/investigate.js';
export { InvestigationStore } from './debugging/store.js';
export { investigationContext } from './debugging/context.js';
export type { Investigation, FailureInput, Hypothesis, DiagnosticAction, Reproduction } from './debugging/types.js';
