import { access, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { readArchitectureState } from "./architecture.js";
import { retrieveContext, tokenize } from "./context.js";
import { buildTeamKnowledgeGraph, readArchitectureTimeline } from "./history-intelligence.js";
import { buildEngineeringIntelligence } from "./intelligence.js";
import { buildApiContractIntelligence, buildInfrastructureGraph } from "./contract-intelligence.js";
import { buildSecurityGraph } from "./security-graph.js";
import { buildSystemMap } from "./system-map.js";
import type { CodeGraph, ProjectDetectionReport, UnifiedHealthReport, UnifiedSearchHit } from "./model.js";
import { listPromptEvolutions } from "./prompt-engine.js";
import { buildCoverageIntelligence, buildTestQuality } from "./testing-intelligence.js";
import { runVerification } from "./verification.js";
import { readRepositoryArtifacts } from "./repository-artifacts.js";
import { buildDeadCodeIntelligence, buildDependencyRiskIntelligence, buildHistoricalBugIntelligence } from "./code-risk-intelligence.js";
import { readLatestMutationReport } from "./mutation-testing.js";
import { buildAgentAnalytics, buildAiEvaluationGraph } from "./ai-governance.js";

async function exists(candidate: string): Promise<boolean> {
  try { await access(candidate); return true; } catch { return false; }
}

export async function detectProject(graph: CodeGraph): Promise<ProjectDetectionReport> {
  const root = graph.repository.root;
  const files = new Set(Object.keys(graph.fileHashes));
  const languages = [...new Set(graph.nodes.map((node) => node.language).filter((value): value is string => Boolean(value)))];
  const frameworks = new Set<string>();
  const packageManagers = new Set<string>();
  const databases = new Set<string>();
  const testing = new Set<string>();
  const infrastructure = new Set<string>();
  const manifests: string[] = [];
  const commands: Record<string, string> = {};
  const packagePath = path.join(root, "package.json");
  if (await exists(packagePath)) {
    manifests.push("package.json");
    const manifest = JSON.parse(await readFile(packagePath, "utf8")) as { scripts?: Record<string, string>; dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
    Object.assign(commands, manifest.scripts ?? {});
    const packages = new Set([...Object.keys(manifest.dependencies ?? {}), ...Object.keys(manifest.devDependencies ?? {})]);
    const mappings: Array<[string, string, Set<string>]> = [
      ["next", "Next.js", frameworks], ["react", "React", frameworks], ["vue", "Vue", frameworks], ["svelte", "Svelte", frameworks], ["express", "Express", frameworks], ["fastify", "Fastify", frameworks], ["@nestjs/core", "NestJS", frameworks],
      ["prisma", "Prisma", databases], ["@prisma/client", "Prisma", databases], ["pg", "PostgreSQL", databases], ["mysql2", "MySQL", databases], ["mongodb", "MongoDB", databases], ["redis", "Redis", databases],
      ["vitest", "Vitest", testing], ["jest", "Jest", testing], ["@playwright/test", "Playwright", testing], ["cypress", "Cypress", testing],
    ];
    for (const [name, label, target] of mappings) if (packages.has(name)) target.add(label);
  }
  if (files.has("pnpm-lock.yaml")) packageManagers.add("pnpm");
  if (files.has("yarn.lock")) packageManagers.add("Yarn");
  if (files.has("bun.lock") || files.has("bun.lockb")) packageManagers.add("Bun");
  if (files.has("package-lock.json")) packageManagers.add("npm");
  const fileRules: Array<[RegExp, string, Set<string>]> = [
    [/(^|\/)pyproject\.toml$|requirements.*\.txt$/, "Python", new Set<string>()],
    [/(^|\/)Cargo\.toml$/, "Rust", new Set<string>()],
    [/(^|\/)go\.mod$/, "Go", new Set<string>()],
    [/(^|\/)Dockerfile$|docker-compose/, "Docker", infrastructure],
    [/(^|\/)\.github\/workflows\//, "GitHub Actions", infrastructure],
    [/\.tf$/, "Terraform", infrastructure],
    [/prisma\/schema\.prisma$/, "Prisma", databases],
  ];
  for (const [pattern, label, target] of fileRules) {
    const matches = [...files].filter((file) => pattern.test(file));
    if (!matches.length) continue;
    if (target.size || target === infrastructure || target === databases) target.add(label);
    else if (!languages.includes(label)) languages.push(label);
    manifests.push(...matches.filter((file) => /(?:toml|txt|mod|prisma)$/.test(file)));
  }
  if (!packageManagers.size && manifests.includes("package.json")) packageManagers.add("npm");
  return { languages: languages.sort(), frameworks: [...frameworks].sort(), packageManagers: [...packageManagers].sort(), databases: [...databases].sort(), testing: [...testing].sort(), infrastructure: [...infrastructure].sort(), manifests: [...new Set(manifests)].sort(), commands, confidence: Math.min(99, 65 + manifests.length * 4 + frameworks.size * 3) };
}

interface UnifiedHealthInputs {
  verification?: Awaited<ReturnType<typeof runVerification>>;
  intelligence?: Awaited<ReturnType<typeof buildEngineeringIntelligence>>;
  coverage?: Awaited<ReturnType<typeof buildCoverageIntelligence>>;
  architecture?: Awaited<ReturnType<typeof readArchitectureState>>;
  detection?: Awaited<ReturnType<typeof detectProject>>;
  systemMap?: Awaited<ReturnType<typeof buildSystemMap>>;
  timeline?: Awaited<ReturnType<typeof readArchitectureTimeline>>;
  testQuality?: Awaited<ReturnType<typeof buildTestQuality>>;
  api?: Awaited<ReturnType<typeof buildApiContractIntelligence>>;
  security?: Awaited<ReturnType<typeof buildSecurityGraph>>;
  dependencies?: Awaited<ReturnType<typeof buildDependencyRiskIntelligence>>;
  deadCode?: Awaited<ReturnType<typeof buildDeadCodeIntelligence>>;
  bugHistory?: Awaited<ReturnType<typeof buildHistoricalBugIntelligence>>;
  mutations?: Awaited<ReturnType<typeof readLatestMutationReport>>;
  agentAnalytics?: Awaited<ReturnType<typeof buildAgentAnalytics>>;
  aiEvaluations?: Awaited<ReturnType<typeof buildAiEvaluationGraph>>;
}

export async function buildUnifiedHealth(graph: CodeGraph, provided: UnifiedHealthInputs = {}): Promise<UnifiedHealthReport> {
  const [verification, intelligence, coverage, architecture, detection, systemMap, timeline, testQuality, api, security, dependencies, deadCode, bugHistory, mutations, agentAnalytics, aiEvaluations] = await Promise.all([
    provided.verification ?? runVerification(graph, { runCommands: false }),
    provided.intelligence ?? buildEngineeringIntelligence(graph),
    provided.coverage ?? buildCoverageIntelligence(graph),
    provided.architecture ?? readArchitectureState(graph),
    provided.detection ?? detectProject(graph),
    provided.systemMap ?? buildSystemMap(graph),
    provided.timeline ?? readArchitectureTimeline(graph),
    provided.testQuality ?? buildTestQuality(graph),
    provided.api ?? buildApiContractIntelligence(graph),
    provided.security ?? buildSecurityGraph(graph),
    provided.dependencies ?? buildDependencyRiskIntelligence(graph),
    provided.deadCode ?? buildDeadCodeIntelligence(graph),
    provided.bugHistory ?? buildHistoricalBugIntelligence(graph),
    provided.mutations ?? readLatestMutationReport(graph),
    provided.agentAnalytics ?? buildAgentAnalytics(graph),
    provided.aiEvaluations ?? buildAiEvaluationGraph(graph),
  ]);
  const cutoff = Date.now() - 90 * 24 * 60 * 60 * 1_000;
  const recentDrift = timeline.events.filter((item) => Date.parse(item.at) >= cutoff);
  const freshness = graph.synchronization?.summaryFreshness.percent ?? 0;
  const measured = (score: number, detail: string, basis: "measured" | "estimated" | "configuration" = "measured"): UnifiedHealthReport["dimensions"][string] => ({ score, detail, available: true, basis });
  const unavailable = (detail: string): UnifiedHealthReport["dimensions"][string] => ({ score: null, detail, available: false, basis: "unavailable" });
  const dimensions: UnifiedHealthReport["dimensions"] = {
    verification: measured(verification.summary.confidence, `${verification.summary.failures} failures, ${verification.summary.warnings} warnings`),
    architecture: measured(architecture.contract ? 100 : architecture.proposal ? 65 : 30, architecture.contract ? "approved contract" : architecture.proposal ? "proposal awaiting approval" : "not configured", "configuration"),
    security: measured(Math.max(0, 100 - intelligence.security.filter((item) => item.severity === "high" || item.severity === "critical").length * 22 - intelligence.security.length * 4), `${intelligence.security.length} static finding(s)`, "estimated"),
    coverage: measured(coverage.available ? Math.round((coverage.overall.lines + coverage.overall.functions) / 2) : Math.max(15, 75 - coverage.criticalGaps.length * 3), coverage.available ? "measured coverage artifact" : `${coverage.criticalGaps.length} critical static coverage gap(s)`, coverage.available ? "measured" : "estimated"),
    maintainability: measured(Math.max(0, 100 - intelligence.summary.highRiskHotspots * 3 - intelligence.summary.refactoringOpportunities), `${intelligence.summary.highRiskHotspots} high-risk hotspot(s)`, "estimated"),
    operability: measured(detection.commands.test ? 85 : 55, detection.commands.test ? "test command detected" : "no test command detected", "configuration"),
    testQuality: measured(testQuality.score, `${testQuality.files.length} test file(s) assessed across assertions, coverage, isolation, reliability, and maintainability`, "estimated"),
    apiContracts: measured(Math.max(0, 100 - api.mismatches.filter((item) => item.kind !== "unused-endpoint").length * 15 - api.breakingChanges.length * 25), `${api.mismatches.length} mismatch(es), ${api.breakingChanges.length} breaking change(s)`, "estimated"),
    securityFlows: measured(Math.max(0, 100 - security.summary.riskyPaths * 20), `${security.summary.riskyPaths} unsanitized high-risk data flow(s)`, "estimated"),
    indexing: measured(freshness, `${freshness}% summaries fresh; synchronized ${graph.synchronization?.lastSyncAt ?? graph.generatedAt}`),
    aiReadiness: measured(systemMap.dna.aiReadiness, `${systemMap.unknowns.length} modeled unknown class(es)`, "estimated"),
    architectureDrift: measured(Math.max(20, 100 - recentDrift.length * 8), `${recentDrift.length} architecture change event(s) in the last 90 days`, "estimated"),
    dependencyRisk: measured(Math.max(0, 100 - dependencies.summary.criticalRisk * 25 - dependencies.summary.highRisk * 12 - dependencies.summary.undeclared * 15), `${dependencies.summary.highRisk + dependencies.summary.criticalRisk} high/critical dependency risk(s), ${dependencies.summary.undeclared} undeclared import(s)`, "estimated"),
    deadCode: measured(Math.max(0, 100 - deadCode.summary.highConfidence * 4 - deadCode.summary.unreachableFiles * 3), `${deadCode.findings.length} candidate(s), ${deadCode.summary.highConfidence} high-confidence`, "estimated"),
    bugHistory: bugHistory.historyAvailable ? measured(Math.max(20, 100 - bugHistory.summary.highRiskHotspots * 8), `${bugHistory.summary.bugFixCommits} fix commit(s), ${bugHistory.summary.highRiskHotspots} high-risk hotspot(s)`, "estimated") : unavailable(`Git history unavailable${bugHistory.error ? `: ${bugHistory.error.split("\n")[0]}` : ""}`),
    mutationTesting: mutations?.baseline.status === "passed" ? measured(mutations.score, `${mutations.killed}/${mutations.killed + mutations.survived} decisive mutants killed; ${mutations.survived} survived`) : unavailable(mutations ? `mutation baseline ${mutations.baseline.status}` : "mutation testing has not been run"),
    agentReliability: agentAnalytics.summary.runs ? measured(agentAnalytics.summary.successRate, `${agentAnalytics.summary.runs} agent run(s), ${agentAnalytics.summary.openMistakes} open mistake(s), ${agentAnalytics.summary.repeatedMistakes} repeated`) : unavailable("no agent runs have been recorded"),
    aiEvaluation: aiEvaluations.summary.cases ? measured(aiEvaluations.summary.passRate, `${aiEvaluations.summary.cases} evaluated case(s), ${aiEvaluations.summary.regressions} regression(s)`) : unavailable("no AI evaluation cases have been recorded"),
  };
  const values = Object.values(dimensions).flatMap((item) => item.score === null ? [] : [item.score]);
  const score = Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
  const priorities = Object.entries(dimensions).filter(([, value]) => value.score !== null).sort((a, b) => (a[1].score as number) - (b[1].score as number)).slice(0, 3).map(([name, value]) => `${name}: ${value.detail}`);
  const firstUnavailable = Object.entries(dimensions).find(([, value]) => !value.available);
  if (firstUnavailable) priorities.push(`${firstUnavailable[0]}: ${firstUnavailable[1].detail}`);
  const unavailableDimensions = Object.values(dimensions).filter((item) => !item.available).length;
  return { score, status: score >= 80 ? "healthy" : score >= 55 ? "attention" : "critical", dimensions, evidence: { measuredDimensions: values.length, unavailableDimensions }, priorities };
}

function textScore(query: string, text: string): number {
  const terms = tokenize(query);
  const lower = text.toLowerCase();
  return terms.length ? Math.round(terms.filter((term) => lower.includes(term)).length / terms.length * 100) : 0;
}

async function localArtifacts(directory: string, suffixes: string[]): Promise<Array<{ path: string; content: string }>> {
  const result: Array<{ path: string; content: string }> = [];
  const walk = async (current: string): Promise<void> => {
    let entries; try { entries = await readdir(current, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) await walk(absolute);
      else if (entry.isFile() && suffixes.some((suffix) => entry.name.endsWith(suffix))) { try { result.push({ path: absolute, content: await readFile(absolute, "utf8") }); } catch { /* optional artifact */ } }
    }
  };
  await walk(directory); return result;
}

async function readLocalProjectArtifacts(root: string): Promise<Array<{ path: string; content: string }>> {
  const fehm = path.join(root, ".fehm");
  const groups = await Promise.all([
    localArtifacts(path.join(fehm, "sessions"), [".json", ".md"]),
    localArtifacts(path.join(fehm, "adr-drafts"), [".json", ".md"]),
    localArtifacts(path.join(fehm, "ai-system"), [".json", ".md"]),
    localArtifacts(path.join(fehm, "bugs"), [".json", ".md"]),
    localArtifacts(path.join(fehm, "hallucinations"), [".json", ".md"]),
    localArtifacts(path.join(fehm, "agents"), [".json", ".md"]),
    localArtifacts(path.join(fehm, "ai-evaluations"), [".json", ".md"]),
    localArtifacts(path.join(fehm, "prompts", "optimizations"), [".json", ".md"]),
  ]);
  return groups.flat();
}

export async function searchEverything(graph: CodeGraph, query: string, limit = 50): Promise<UnifiedSearchHit[]> {
  const normalized = query.trim();
  if (!normalized) throw new Error("query is required");
  const [code, architecture, timeline, intelligence, prompts, team, api, infrastructure, testQuality, security, verification, coverage, detection, systemMap, adrs, localProjectArtifacts, dependencies, deadCode, bugHistory, mutations, agentAnalytics, aiEvaluations] = await Promise.all([
    retrieveContext(graph, normalized, { depth: 2, limit }),
    readArchitectureState(graph),
    readArchitectureTimeline(graph),
    buildEngineeringIntelligence(graph),
    listPromptEvolutions(graph),
    buildTeamKnowledgeGraph(graph),
    buildApiContractIntelligence(graph),
    buildInfrastructureGraph(graph),
    buildTestQuality(graph),
    buildSecurityGraph(graph),
    runVerification(graph, { runCommands: false }),
    buildCoverageIntelligence(graph),
    detectProject(graph),
    buildSystemMap(graph),
    readRepositoryArtifacts(graph.repository.root, (relative) => /(?:^|\/)docs\/adr\/.*\.md$/i.test(relative)),
    readLocalProjectArtifacts(graph.repository.root),
    buildDependencyRiskIntelligence(graph),
    buildDeadCodeIntelligence(graph),
    buildHistoricalBugIntelligence(graph),
    readLatestMutationReport(graph),
    buildAgentAnalytics(graph),
    buildAiEvaluationGraph(graph),
  ]);
  const health = await buildUnifiedHealth(graph, { verification, intelligence, coverage, architecture, detection, systemMap, timeline, testQuality, api, security, dependencies, deadCode, bugHistory, mutations, agentAnalytics, aiEvaluations });
  const hits: UnifiedSearchHit[] = code.map((item) => ({ kind: "code", title: item.node.qualifiedName, detail: item.reasons.join(", "), ...(item.node.path ? { path: item.node.path } : {}), score: Math.round(item.scores.final * 100) }));
  const architectureText = JSON.stringify(architecture);
  if (textScore(normalized, architectureText)) hits.push({ kind: "architecture", title: "Architecture contract and proposal", detail: architecture.contract ? "approved contract" : architecture.proposal ? "proposed architecture" : "not configured", score: textScore(normalized, architectureText) });
  for (const event of timeline.events) {
    const score = textScore(normalized, event.detail);
    if (score) hits.push({ kind: "history", title: `${event.kind} at ${event.at}`, detail: event.detail, score });
  }
  for (const memory of intelligence.memory) {
    const score = textScore(normalized, `${memory.title} ${memory.content}`);
    if (score) hits.push({ kind: "memory", title: memory.title, detail: memory.content.slice(0, 240), path: memory.path, score });
  }
  for (const evolution of prompts) for (const version of evolution.versions) {
    const score = textScore(normalized, version.prompt);
    if (score) hits.push({ kind: "prompt", title: `${evolution.name} · ${version.createdAt}`, detail: `score ${version.scorecard.overall}; ${version.reason || "no change reason"}`, score });
    for (const execution of version.executions ?? []) for (const item of execution.cases) {
      const searchable = `${execution.model} ${item.caseId} ${item.category} ${item.input} ${item.expectedBehavior} ${item.response ?? ""} ${item.evidence} ${item.error ?? ""} ${item.why ?? ""} ${item.recommendation ?? ""}`;
      const executionScore = textScore(normalized, searchable);
      if (executionScore) hits.push({ kind: item.passed ? "prompt" : "error", title: `${evolution.name} · ${execution.model} · ${item.caseId}`, detail: `${item.passed ? "passed" : "failed"} ${item.score}/100 — ${(item.response ?? item.error ?? item.evidence).slice(0, 240)}`, score: executionScore });
    }
  }
  for (const risk of team.sharedKnowledgeRisks) {
    const score = textScore(normalized, `${risk.path} ${risk.owner} ${risk.reason}`);
    if (score) hits.push({ kind: "history", title: `Ownership risk: ${risk.path}`, detail: risk.reason, path: risk.path, score });
  }
  for (const pullRequest of team.pullRequests) { const detail = `${pullRequest.subject} ${pullRequest.author} ${pullRequest.status ?? "merged"} ${pullRequest.files.join(" ")} ${(pullRequest.reviewers ?? []).join(" ")}`; const score = textScore(normalized, detail); if (score) hits.push({ kind: "history", title: `PR ${pullRequest.number ? `#${pullRequest.number}` : pullRequest.hash.slice(0, 8)} · ${pullRequest.status ?? "merged"}`, detail: pullRequest.subject, score }); }
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  for (const edge of graph.edges) {
    const source = byId.get(edge.source); const target = byId.get(edge.target);
    const text = `${edge.kind} ${source?.qualifiedName ?? edge.source} ${target?.qualifiedName ?? edge.target} ${edge.evidence.detail ?? ""}`;
    const score = textScore(normalized, text);
    if (score) hits.push({ kind: "relationship", title: `${source?.name ?? edge.source} ${edge.kind} ${target?.name ?? edge.target}`, detail: edge.evidence.detail ?? `${source?.qualifiedName ?? edge.source} → ${target?.qualifiedName ?? edge.target}`, ...(source?.path ? { path: source.path } : {}), score });
  }
  for (const endpoint of api.endpoints) {
    const text = `${endpoint.method} ${endpoint.route} ${endpoint.requestSignals.join(" ")} ${endpoint.responseSignals.join(" ")}`; const score = textScore(normalized, text);
    if (score) hits.push({ kind: "api", title: `${endpoint.method} ${endpoint.route}`, detail: `${endpoint.consumers.length} consumer(s); request: ${endpoint.requestSignals.join(", ") || "unknown"}`, path: endpoint.path, score });
  }
  for (const mismatch of api.mismatches) { const score = textScore(normalized, `${mismatch.kind} ${mismatch.detail}`); if (score) hits.push({ kind: "error", title: `API ${mismatch.kind}`, detail: mismatch.detail, path: mismatch.path, score }); }
  for (const node of infrastructure.nodes) { const score = textScore(normalized, `${node.kind} ${node.name} ${node.evidence.join(" ")}`); if (score) hits.push({ kind: "infrastructure", title: `${node.kind}: ${node.name}`, detail: node.evidence.join("; "), ...(node.path ? { path: node.path } : {}), score }); }
  for (const edge of infrastructure.edges) { const detail = `${edge.source} ${edge.relation} ${edge.target} ${edge.evidence}`; const score = textScore(normalized, detail); if (score) hits.push({ kind: "infrastructure", title: `${edge.source} ${edge.relation} ${edge.target}`, detail: edge.evidence, score }); }
  for (const consumer of api.consumers) { const detail = `${consumer.method} ${consumer.endpoint} ${(consumer.requestSignals ?? []).join(" ")} ${(consumer.expectedResponseSignals ?? []).join(" ")}`; const score = textScore(normalized, detail); if (score) hits.push({ kind: "api", title: `Consumer ${consumer.method} ${consumer.endpoint}`, detail: consumer.matchedEndpointId ? `matched ${consumer.matchedEndpointId}` : "unmatched", path: consumer.path, score }); }
  for (const file of testQuality.files) { const score = textScore(normalized, `${file.path} ${file.strengths.join(" ")} ${file.weaknesses.join(" ")}`); if (score) hits.push({ kind: "test", title: `${file.path} · ${file.score}/100`, detail: [...file.strengths, ...file.weaknesses].join("; "), path: file.path, score }); }
  for (const flow of security.paths) { const detail = `${flow.steps.join(" → ")} ${flow.severity} ${flow.sanitized ? "sanitized" : "unsanitized"}`; const score = textScore(normalized, detail); if (score) hits.push({ kind: "security", title: `${flow.severity} data flow`, detail, path: flow.source.path, score }); }
  for (const node of security.nodes) { const score = textScore(normalized, `${node.kind} ${node.label}`); if (score) hits.push({ kind: "security", title: `${node.kind}: ${node.label}`, detail: `${node.path}:${node.line}`, path: node.path, score }); }
  for (const dependency of dependencies.dependencies) { const detail = `${dependency.kind} ${dependency.requestedVersion} ${dependency.resolvedVersion ?? ""} ${dependency.severity} ${dependency.reasons.join(" ")} ${dependency.usedBy.join(" ")}`; const score = textScore(normalized, `${dependency.name} ${detail}`); if (score) hits.push({ kind: "dependency", title: `${dependency.name}@${dependency.requestedVersion} · ${dependency.riskScore}/100`, detail: dependency.reasons.join("; ") || "No static dependency risks detected", ...(dependency.manifest !== "<none>" ? { path: dependency.manifest } : {}), score }); }
  for (const finding of deadCode.findings) { const detail = `${finding.kind} ${finding.node.qualifiedName} ${finding.reasons.join(" ")} ${finding.recommendation}`; const score = textScore(normalized, detail); if (score) hits.push({ kind: "dead-code", title: `${finding.kind}: ${finding.node.qualifiedName}`, detail: `${Math.round(finding.confidence * 100)}% confidence — ${finding.reasons.join("; ")}`, ...(finding.node.path ? { path: finding.node.path } : {}), score }); }
  for (const commit of bugHistory.commits) { const detail = `${commit.classification} ${commit.subject} ${commit.author} ${commit.files.join(" ")} ${commit.issueReferences.join(" ")}`; const score = textScore(normalized, detail); if (score) hits.push({ kind: "bug-history", title: `${commit.classification}: ${commit.subject}`, detail: `${commit.hash.slice(0, 8)} · ${commit.date} · ${commit.files.length} file(s)`, score }); }
  for (const hotspot of bugHistory.hotspots) { const detail = `${hotspot.path} ${hotspot.severity} ${hotspot.reasons.join(" ")}`; const score = textScore(normalized, detail); if (score) hits.push({ kind: "bug-history", title: `Bug hotspot: ${hotspot.path}`, detail: `${hotspot.score}/100 — ${hotspot.reasons.join("; ")}`, path: hotspot.path, score }); }
  for (const artifact of localProjectArtifacts.filter((item) => item.path.includes(`${path.sep}bugs${path.sep}`))) { const score = textScore(normalized, artifact.content); if (score) hits.push({ kind: "bug-history", title: path.basename(artifact.path), detail: artifact.content.replace(/\s+/g, " ").slice(0, 280), path: path.relative(graph.repository.root, artifact.path).split(path.sep).join("/"), score }); }
  for (const mutation of mutations?.results ?? []) { const detail = `${mutation.status} ${mutation.operator} ${mutation.description} ${mutation.original} ${mutation.replacement}`; const score = textScore(normalized, `${mutation.path} ${detail}`); if (score) hits.push({ kind: "mutation", title: `${mutation.status}: ${mutation.description}`, detail: `${mutation.path}:${mutation.line} ${mutation.original} → ${mutation.replacement}`, path: mutation.path, score }); }
  for (const run of agentAnalytics.runs) { const detail = `${run.agent} ${run.task} ${run.outcome} ${run.changedFiles.join(" ")} ${run.errors.join(" ")}`; const score = textScore(normalized, detail); if (score) hits.push({ kind: "agent", title: `${run.agent}: ${run.task}`, detail: `${run.outcome}; ${run.testsFailed} failed test(s); verification ${run.verificationPassed ? "passed" : "failed"}`, score }); }
  for (const mistake of agentAnalytics.mistakes) { const detail = `${mistake.category} ${mistake.title} ${mistake.rootCause} ${mistake.prevention} ${mistake.evidence.join(" ")}`; const score = textScore(normalized, detail); if (score) hits.push({ kind: "mistake", title: `${mistake.occurrences}× ${mistake.title}`, detail: `${mistake.rootCause} — prevent: ${mistake.prevention}`, score }); }
  for (const model of aiEvaluations.modelAnalytics) { const score = textScore(normalized, `${model.model} evaluation ${model.passRate} ${model.averageScore}`); if (score) hits.push({ kind: "evaluation", title: `Model evaluation: ${model.model}`, detail: `${model.cases} case(s), ${model.passRate}% pass rate, ${model.averageScore} average`, score }); }
  for (const regression of aiEvaluations.regressions) { const score = textScore(normalized, `${regression.prompt} ${regression.versionId} regression ${regression.evidence.join(" ")}`); if (score) hits.push({ kind: "evaluation", title: `Prompt regression: ${regression.prompt}`, detail: `${regression.previousScore} → ${regression.currentScore} (${regression.delta})`, score }); }
  for (const artifact of localProjectArtifacts.filter((item) => item.path.includes(`${path.sep}hallucinations${path.sep}`))) { const score = textScore(normalized, artifact.content); if (score) hits.push({ kind: "claim", title: path.basename(artifact.path), detail: artifact.content.replace(/\s+/g, " ").slice(0, 280), path: path.relative(graph.repository.root, artifact.path).split(path.sep).join("/"), score }); }
  for (const artifact of localProjectArtifacts.filter((item) => item.path.includes(`${path.sep}prompts${path.sep}optimizations${path.sep}`))) { const score = textScore(normalized, artifact.content); if (score) hits.push({ kind: "prompt", title: `Prompt optimization: ${path.basename(artifact.path)}`, detail: artifact.content.replace(/\s+/g, " ").slice(0, 280), path: path.relative(graph.repository.root, artifact.path).split(path.sep).join("/"), score }); }
  for (const observation of verification.staticAnalysis.observations) { const score = textScore(normalized, `${observation.name} ${observation.detail}`); if (score) hits.push({ kind: observation.status === "failed" ? "error" : "health", title: observation.name, detail: observation.detail, ...(observation.path ? { path: observation.path } : {}), score }); }
  for (const finding of verification.security.findings) { const score = textScore(normalized, `${finding.title} ${finding.detail} ${finding.rule}`); if (score) hits.push({ kind: "security", title: finding.title, detail: `${finding.rule}: ${finding.detail}`, path: finding.path, score }); }
  for (const [dimension, value] of Object.entries(health.dimensions)) { const score = textScore(normalized, `${dimension} ${value.detail} ${value.basis}`); if (score) hits.push({ kind: "health", title: `${dimension} · ${value.score === null ? "not measured" : `${value.score}/100`}`, detail: value.detail, score }); }
  try {
    const runtime = JSON.parse(await readFile(path.join(graph.repository.root, ".fehm", "runtime", "latest.json"), "utf8")) as { bottlenecks?: Array<{ name: string; totalMs: number; errors: number; node?: { path?: string } }>; spans?: Array<{ name: string; status: string; durationMs: number; attributes?: Record<string, unknown>; node?: { path?: string } }> };
    for (const bottleneck of runtime.bottlenecks ?? []) { const detail = `${bottleneck.name} ${bottleneck.totalMs}ms ${bottleneck.errors} errors`; const score = textScore(normalized, detail); if (score) hits.push({ kind: bottleneck.errors ? "error" : "runtime", title: bottleneck.name, detail, ...(bottleneck.node?.path ? { path: bottleneck.node.path } : {}), score }); }
    for (const span of runtime.spans ?? []) { const detail = `${span.name} ${span.status} ${span.durationMs}ms ${JSON.stringify(span.attributes ?? {})}`; const score = textScore(normalized, detail); if (score) hits.push({ kind: span.status === "error" ? "error" : "runtime", title: `Span ${span.name}`, detail, ...(span.node?.path ? { path: span.node.path } : {}), score }); }
  } catch { /* runtime evidence is optional until a trace is analyzed */ }
  for (const artifact of [...adrs, ...localProjectArtifacts.filter((item) => /(?:adr-drafts|sessions)/.test(item.path))]) {
    const score = textScore(normalized, artifact.content); if (!score) continue;
    const relative = (path.isAbsolute(artifact.path) ? path.relative(graph.repository.root, artifact.path) : artifact.path).split(path.sep).join("/"); const checkpoint = /\.fehm\/sessions\//.test(relative);
    hits.push({ kind: checkpoint ? "checkpoint" : "adr", title: path.basename(relative), detail: artifact.content.replace(/\s+/g, " ").slice(0, 280), path: relative, score });
  }
  const aiArtifact = localProjectArtifacts.find((item) => item.path.endsWith(`${path.sep}ai-system${path.sep}latest.json`));
  if (aiArtifact) try {
    const ai = JSON.parse(aiArtifact.content) as { nodes?: Array<{ kind: string; label: string; status: string; path?: string }>; edges?: Array<{ source: string; relation: string; target: string }> };
    for (const node of ai.nodes ?? []) { const score = textScore(normalized, `${node.kind} ${node.label} ${node.status}`); if (score) hits.push({ kind: "ai", title: `${node.kind}: ${node.label}`, detail: node.status, ...(node.path ? { path: node.path } : {}), score }); }
    for (const edge of ai.edges ?? []) { const detail = `${edge.source} ${edge.relation} ${edge.target}`; const score = textScore(normalized, detail); if (score) hits.push({ kind: "ai", title: `${edge.source} ${edge.relation} ${edge.target}`, detail, score }); }
  } catch { /* malformed optional AI artifact */ }
  return hits.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title)).slice(0, limit);
}
