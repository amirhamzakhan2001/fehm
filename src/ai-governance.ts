import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { buildApiContractIntelligence } from "./contract-intelligence.js";
import type { AgentAnalyticsReport, AgentMistakeRecord, AgentRunRecord, AiEvaluationGraph, ClaimVerification, CodeGraph, HallucinationVerificationReport, PromptEvaluationCategory } from "./model.js";
import { listPromptEvolutions } from "./prompt-engine.js";
import { atomicWriteJson } from "./persistence.js";

function hash(value: string): string { return createHash("sha256").update(value).digest("hex").slice(0, 20); }

async function atomicJson(destination: string, value: unknown): Promise<void> {
  await atomicWriteJson(destination, value);
}

function referencedPaths(statement: string): string[] {
  return [...new Set(statement.match(/(?:^|[\s`'"(])([A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)+\.[cm]?[jt]sx?)/g)?.map((item) => item.trim().replace(/^[`'"(]|[`'"),.;:]$/g, "")) ?? [])];
}

function referencedSymbols(statement: string): string[] {
  const explicit = [...statement.matchAll(/\b(?:function|class|interface|method|symbol|type)\s+[`'"]?([A-Za-z_$][\w$]*)/gi)].map((item) => item[1] as string);
  const quoted = [...statement.matchAll(/`([A-Za-z_$][\w$]*)`/g)].map((item) => item[1] as string);
  return [...new Set([...explicit, ...quoted])];
}

function findNode(graph: CodeGraph, reference: string) {
  const lower = reference.toLowerCase();
  return graph.nodes.find((node) => node.id === reference || node.qualifiedName.toLowerCase() === lower)
    ?? graph.nodes.find((node) => node.name.toLowerCase() === lower);
}

export async function verifyHallucinations(graph: CodeGraph, input: string | Array<string | { id?: string; statement: string }>): Promise<HallucinationVerificationReport> {
  const raw = typeof input === "string" ? input.split(/\r?\n/).map((statement) => statement.trim()).filter(Boolean) : input;
  const claims = raw.map((item, index) => typeof item === "string" ? { id: `claim-${index + 1}`, statement: item } : { id: item.id?.trim() || `claim-${index + 1}`, statement: item.statement.trim() }).filter((item) => item.statement);
  const contracts = await buildApiContractIntelligence(graph); const results: ClaimVerification[] = [];
  for (const claim of claims) {
    const evidence: string[] = []; const references: string[] = []; const corrections: string[] = []; let checked = 0; let contradicted = false;
    for (const filePath of referencedPaths(claim.statement)) {
      checked += 1; references.push(filePath); const node = graph.nodes.find((item) => item.kind === "file" && item.path === filePath);
      if (node) evidence.push(`verified file ${filePath} as ${node.id}`); else { contradicted = true; corrections.push(`No indexed file matches ${filePath}.`); }
    }
    for (const symbol of referencedSymbols(claim.statement)) {
      checked += 1; references.push(symbol); const node = findNode(graph, symbol);
      if (node) evidence.push(`verified symbol ${symbol} as ${node.qualifiedName}`); else { contradicted = true; corrections.push(`No indexed symbol matches ${symbol}.`); }
    }
    const relationship = /[`'"]?([A-Za-z_$][\w$]*)[`'"]?\s+(calls|imports|extends|implements|references|uses)\s+[`'"]?([A-Za-z_$][\w$]*)[`'"]?/i.exec(claim.statement);
    if (relationship) {
      checked += 1; const source = findNode(graph, relationship[1] as string); const target = findNode(graph, relationship[3] as string); const relation = (relationship[2] as string).toLowerCase();
      references.push(relationship[1] as string, relationship[3] as string);
      const edge = source && target ? graph.edges.find((item) => item.source === source.id && item.target === target.id && item.kind === relation) : undefined;
      if (edge) evidence.push(`verified ${source?.qualifiedName} ${relation} ${target?.qualifiedName} with ${edge.evidence.provenance} evidence`);
      else { contradicted = true; corrections.push(source && target ? `No ${relation} edge exists from ${source.qualifiedName} to ${target.qualifiedName}.` : "One or both relationship symbols are not indexed."); }
    }
    const route = /\b(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)\s+(\/[^\s`'"]+)/i.exec(claim.statement);
    if (route) {
      checked += 1; const method = (route[1] as string).toUpperCase(); const routePath = (route[2] as string).replace(/[.,;:]$/, ""); references.push(`${method} ${routePath}`);
      const endpoint = contracts.endpoints.find((item) => item.method === method && item.route === routePath);
      if (endpoint) evidence.push(`verified API endpoint at ${endpoint.path}:${endpoint.line}`);
      else { contradicted = true; corrections.push(`No ${method} ${routePath} endpoint was discovered.`); }
    }
    const negativeOrSubjective = /\b(?:never|always|best|fastest|secure|safe|no\s+code|does\s+not|cannot)\b/i.test(claim.statement);
    const status: ClaimVerification["status"] = contradicted ? "contradicted" : checked && !negativeOrSubjective ? "verified" : "unverifiable";
    if (status === "unverifiable") evidence.push(checked ? "Referenced facts exist, but the absolute/negative assertion is not statically provable." : "No concrete file, symbol, relationship, or API reference could be extracted.");
    results.push({ id: claim.id, statement: claim.statement, status, confidence: status === "verified" ? 96 : status === "contradicted" ? 92 : checked ? 55 : 20, references: [...new Set(references)], evidence, ...(corrections.length ? { correction: corrections.join(" ") } : {}) });
  }
  const verified = results.filter((item) => item.status === "verified").length; const contradictedCount = results.filter((item) => item.status === "contradicted").length; const unverifiable = results.length - verified - contradictedCount;
  const report: HallucinationVerificationReport = { generatedAt: new Date().toISOString(), repositoryFingerprint: graph.repository.fingerprint, claims: results, summary: { total: results.length, verified, contradicted: contradictedCount, unverifiable, score: results.length ? Math.round(verified / results.length * 100) : 100 } };
  await atomicJson(path.join(graph.repository.root, ".fehm", "hallucinations", "latest.json"), report); return report;
}

export type AgentRunInput = Omit<AgentRunRecord, "id"> & { id?: string };
export type AgentMistakeInput = Pick<AgentMistakeRecord, "category" | "title" | "rootCause" | "prevention"> & { agent?: string; task?: string; evidence?: string[]; resolution?: string; status?: AgentMistakeRecord["status"] };

async function readMistakes(graph: CodeGraph): Promise<AgentMistakeRecord[]> {
  try { const value = JSON.parse(await readFile(path.join(graph.repository.root, ".fehm", "agents", "mistakes.json"), "utf8")) as { mistakes?: AgentMistakeRecord[] }; return value.mistakes ?? []; }
  catch { return []; }
}

export async function recordAgentMistake(graph: CodeGraph, input: AgentMistakeInput): Promise<AgentMistakeRecord> {
  const now = new Date().toISOString(); const fingerprint = hash(`${input.category}:${input.rootCause.toLowerCase().replace(/\s+/g, " ").trim()}`); const mistakes = await readMistakes(graph); const existing = mistakes.find((item) => item.fingerprint === fingerprint);
  const record: AgentMistakeRecord = existing ? {
    ...existing, title: input.title, prevention: input.prevention, status: input.status ?? existing.status, occurrences: existing.occurrences + 1, lastSeenAt: now,
    agentIds: [...new Set([...existing.agentIds, ...(input.agent ? [input.agent] : [])])], tasks: [...new Set([...existing.tasks, ...(input.task ? [input.task] : [])])], evidence: [...new Set([...existing.evidence, ...(input.evidence ?? [])])], ...(input.resolution ? { resolution: input.resolution } : existing.resolution ? { resolution: existing.resolution } : {}),
  } : { id: `mistake-${fingerprint}`, fingerprint, category: input.category, title: input.title, rootCause: input.rootCause, prevention: input.prevention, status: input.status ?? "open", occurrences: 1, firstSeenAt: now, lastSeenAt: now, agentIds: input.agent ? [input.agent] : [], tasks: input.task ? [input.task] : [], evidence: input.evidence ?? [], ...(input.resolution ? { resolution: input.resolution } : {}) };
  const next = existing ? mistakes.map((item) => item.fingerprint === fingerprint ? record : item) : [...mistakes, record];
  await atomicJson(path.join(graph.repository.root, ".fehm", "agents", "mistakes.json"), { version: 1, mistakes: next.sort((left, right) => right.occurrences - left.occurrences || right.lastSeenAt.localeCompare(left.lastSeenAt)) }); return record;
}

export async function recordAgentRun(graph: CodeGraph, input: AgentRunInput): Promise<AgentRunRecord> {
  if (!input.agent.trim() || !input.task.trim()) throw new Error("agent and task are required");
  if (!Number.isFinite(Date.parse(input.startedAt)) || !Number.isFinite(Date.parse(input.completedAt))) throw new Error("agent run timestamps must be ISO-compatible dates");
  const id = input.id?.trim() || `run-${hash(`${input.agent}:${input.task}:${input.startedAt}:${input.completedAt}`)}`; const record: AgentRunRecord = { ...input, id, changedFiles: [...new Set(input.changedFiles)].sort(), commands: [...input.commands], errors: [...input.errors] };
  await atomicJson(path.join(graph.repository.root, ".fehm", "agents", "runs", `${id.replace(/[^A-Za-z0-9_.-]/g, "-")}.json`), record);
  if (record.outcome !== "success" || !record.verificationPassed || record.testsFailed || record.errors.length) {
    const category: AgentMistakeRecord["category"] = record.testsFailed ? "test-failure" : !record.verificationPassed ? "verification-failure" : "tool-error";
    await recordAgentMistake(graph, { category, title: `${record.agent} failed: ${record.task}`, rootCause: record.errors.join("; ") || `${record.testsFailed} test(s) failed and verification=${record.verificationPassed}`, prevention: record.testsFailed ? "Run affected tests before finalizing and inspect the first deterministic failure." : "Run the required verification gates before finalizing.", agent: record.agent, task: record.task, evidence: [...record.errors, ...record.commands] });
  }
  return record;
}

async function readRuns(graph: CodeGraph): Promise<AgentRunRecord[]> {
  const directory = path.join(graph.repository.root, ".fehm", "agents", "runs"); let entries;
  try { entries = await readdir(directory, { withFileTypes: true }); } catch { return []; }
  const runs: AgentRunRecord[] = [];
  for (const entry of entries) if (entry.isFile() && entry.name.endsWith(".json")) try { runs.push(JSON.parse(await readFile(path.join(directory, entry.name), "utf8")) as AgentRunRecord); } catch { /* malformed run record */ }
  return runs.sort((left, right) => right.startedAt.localeCompare(left.startedAt));
}

export async function buildAgentAnalytics(graph: CodeGraph): Promise<AgentAnalyticsReport> {
  const [runs, mistakes] = await Promise.all([readRuns(graph), readMistakes(graph)]); const agents: AgentAnalyticsReport["agents"] = [];
  for (const agent of [...new Set(runs.map((item) => item.agent))].sort()) {
    const values = runs.filter((item) => item.agent === agent); const successes = values.filter((item) => item.outcome === "success").length; const errors = new Map<string, number>();
    for (const error of values.flatMap((item) => item.errors)) errors.set(error, (errors.get(error) ?? 0) + 1);
    agents.push({ agent, runs: values.length, successes, failures: values.filter((item) => item.outcome === "failure").length, partial: values.filter((item) => item.outcome === "partial").length, successRate: Math.round(successes / Math.max(1, values.length) * 1_000) / 10, averageDurationMs: Math.round(values.reduce((sum, item) => sum + Math.max(0, Date.parse(item.completedAt) - Date.parse(item.startedAt)), 0) / Math.max(1, values.length)), inputTokens: values.reduce((sum, item) => sum + (item.inputTokens ?? 0), 0), outputTokens: values.reduce((sum, item) => sum + (item.outputTokens ?? 0), 0), testsFailed: values.reduce((sum, item) => sum + item.testsFailed, 0), verificationFailures: values.filter((item) => !item.verificationPassed).length, commonErrors: [...errors].sort((left, right) => right[1] - left[1]).slice(0, 5).map(([error]) => error) });
  }
  const dates = [...new Set(runs.map((item) => item.startedAt.slice(0, 10)))].sort(); const trends = dates.map((date) => { const values = runs.filter((item) => item.startedAt.startsWith(date)); const successes = values.filter((item) => item.outcome === "success").length; return { date, runs: values.length, successRate: Math.round(successes / Math.max(1, values.length) * 1_000) / 10, failures: values.length - successes }; }); const successes = runs.filter((item) => item.outcome === "success").length;
  const report: AgentAnalyticsReport = { generatedAt: new Date().toISOString(), repositoryFingerprint: graph.repository.fingerprint, runs, agents, mistakes, trends, summary: { runs: runs.length, agents: agents.length, successRate: Math.round(successes / Math.max(1, runs.length) * 1_000) / 10, openMistakes: mistakes.filter((item) => item.status === "open").length, repeatedMistakes: mistakes.filter((item) => item.occurrences > 1).length } };
  await atomicJson(path.join(graph.repository.root, ".fehm", "agents", "analytics.json"), report); return report;
}

export async function buildAiEvaluationGraph(graph: CodeGraph): Promise<AiEvaluationGraph> {
  const histories = await listPromptEvolutions(graph); const nodes: AiEvaluationGraph["nodes"] = []; const edges: AiEvaluationGraph["edges"] = []; const modelCases = new Map<string, Array<{ passed: boolean; score: number; duration: number }>>(); const categoryCases = new Map<PromptEvaluationCategory, Array<{ passed: boolean; score: number }>>(); const regressions: AiEvaluationGraph["regressions"] = []; const weakestCases: AiEvaluationGraph["weakestCases"] = [];
  for (const history of histories) {
    const promptId = `prompt:${history.name}`; nodes.push({ id: promptId, kind: "prompt", label: history.name, status: "unknown" }); let previousScore: number | undefined;
    for (const version of history.versions) {
      const versionId = `version:${history.name}:${version.id}`; const executionScores = (version.executions ?? []).map((item) => item.score); const currentScore = executionScores.length ? executionScores.reduce((sum, value) => sum + value, 0) / executionScores.length : version.scorecard.overall;
      nodes.push({ id: versionId, kind: "version", label: version.id, status: version.regression?.passed === false ? "failed" : "unknown", score: Math.round(currentScore), metadata: { createdAt: version.createdAt, staticScore: version.scorecard.overall } }); edges.push({ source: promptId, target: versionId, relation: "has-version" });
      if (previousScore !== undefined && currentScore < previousScore - 3) regressions.push({ prompt: history.name, versionId: version.id, previousScore: Math.round(previousScore), currentScore: Math.round(currentScore), delta: Math.round((currentScore - previousScore) * 10) / 10, evidence: [`execution/static score decreased from ${Math.round(previousScore)} to ${Math.round(currentScore)}`, ...(version.regression?.regressions ?? [])] }); previousScore = currentScore;
      for (const execution of version.executions ?? []) {
        const executionId = `execution:${history.name}:${version.id}:${execution.id}`; const modelId = `model:${execution.model}`;
        nodes.push({ id: executionId, kind: "execution", label: execution.id, status: execution.passed ? "passed" : "failed", score: execution.score, metadata: { durationMs: execution.durationMs, recordedAt: execution.recordedAt } }); if (!nodes.some((item) => item.id === modelId)) nodes.push({ id: modelId, kind: "model", label: execution.model, status: "unknown" }); edges.push({ source: executionId, target: versionId, relation: "uses-version" }, { source: executionId, target: modelId, relation: "ran-on" });
        for (const item of execution.cases) {
          const caseId = `case:${history.name}:${version.id}:${execution.id}:${item.caseId}`; const categoryId = `category:${item.category}`;
          nodes.push({ id: caseId, kind: "case", label: item.caseId, status: item.passed ? "passed" : "failed", score: item.score, metadata: { durationMs: item.durationMs, evidence: item.evidence } }); if (!nodes.some((node) => node.id === categoryId)) nodes.push({ id: categoryId, kind: "category", label: item.category, status: "unknown" }); edges.push({ source: executionId, target: caseId, relation: "contains-case" }, { source: caseId, target: categoryId, relation: "in-category" });
          const modelValues = modelCases.get(execution.model) ?? []; modelValues.push({ passed: item.passed, score: item.score, duration: item.durationMs }); modelCases.set(execution.model, modelValues); const categoryValues = categoryCases.get(item.category) ?? []; categoryValues.push({ passed: item.passed, score: item.score }); categoryCases.set(item.category, categoryValues);
          weakestCases.push({ prompt: history.name, versionId: version.id, executionId: execution.id, caseId: item.caseId, model: execution.model, score: item.score, evidence: item.evidence });
        }
      }
    }
  }
  const modelAnalytics = [...modelCases].map(([model, values]) => ({ model, executions: new Set(nodes.filter((item) => item.kind === "execution" && edges.some((edge) => edge.source === item.id && edge.target === `model:${model}`)).map((item) => item.id)).size, cases: values.length, passRate: Math.round(values.filter((item) => item.passed).length / Math.max(1, values.length) * 1_000) / 10, averageScore: Math.round(values.reduce((sum, item) => sum + item.score, 0) / Math.max(1, values.length) * 10) / 10, averageLatencyMs: Math.round(values.reduce((sum, item) => sum + item.duration, 0) / Math.max(1, values.length)) })).sort((left, right) => right.averageScore - left.averageScore);
  const categoryAnalytics = [...categoryCases].map(([category, values]) => ({ category, cases: values.length, passRate: Math.round(values.filter((item) => item.passed).length / Math.max(1, values.length) * 1_000) / 10, averageScore: Math.round(values.reduce((sum, item) => sum + item.score, 0) / Math.max(1, values.length) * 10) / 10 })).sort((left, right) => left.averageScore - right.averageScore); const totalCases = [...modelCases.values()].flat();
  const report: AiEvaluationGraph = { generatedAt: new Date().toISOString(), repositoryFingerprint: graph.repository.fingerprint, nodes: [...new Map(nodes.map((item) => [item.id, item])).values()], edges: [...new Map(edges.map((item) => [`${item.source}:${item.relation}:${item.target}`, item])).values()], modelAnalytics, categoryAnalytics, regressions, weakestCases: weakestCases.sort((left, right) => left.score - right.score).slice(0, 50), summary: { prompts: histories.length, versions: histories.reduce((sum, item) => sum + item.versions.length, 0), executions: nodes.filter((item) => item.kind === "execution").length, cases: totalCases.length, models: modelCases.size, passRate: Math.round(totalCases.filter((item) => item.passed).length / Math.max(1, totalCases.length) * 1_000) / 10, regressions: regressions.length } };
  await atomicJson(path.join(graph.repository.root, ".fehm", "ai-evaluations", "latest.json"), report); return report;
}
