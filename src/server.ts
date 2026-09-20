import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { approveArchitecture, readArchitectureState, writeArchitectureProposal } from "./architecture.js";
import { buildContextPacket } from "./context.js";
import { focusGraph } from "./graph.js";
import { exploreRelationships } from "./graph.js";
import { readIndex, writeIndex } from "./indexer.js";
import { buildEngineeringIntelligence } from "./intelligence.js";
import type { CodeGraph, GraphNode } from "./model.js";
import { GRAPH_SCHEMA_VERSION } from "./model.js";
import { runVerification } from "./verification.js";
import { buildSystemMap, explainLikeSenior, exploreExecutionFlow } from "./system-map.js";
import { analyzePrompt, comparePrompts, listPromptEvolutions, readPromptEvolution, savePromptExecution, savePromptVersion } from "./prompt-engine.js";
import { runAgentPreflight } from "./agent-control.js";
import { buildCoverageIntelligence, buildTestQuality } from "./testing-intelligence.js";
import { buildChangeDigest, buildTeamKnowledgeGraph, maintainAdrDrafts, readArchitectureTimeline, saveDeveloperCheckpoint } from "./history-intelligence.js";
import { buildUnifiedHealth, detectProject, searchEverything } from "./project-intelligence.js";
import { buildAiSystemGraph, buildPromptToolContracts, executePromptAcrossModels, executePromptSuite } from "./prompt-runtime.js";
import { refreshSemanticSummaries } from "./semantic-summary.js";
import { buildApiContractIntelligence, buildInfrastructureGraph } from "./contract-intelligence.js";
import { buildSecurityGraph } from "./security-graph.js";
import { buildDeadCodeIntelligence, buildDependencyRiskIntelligence, buildHistoricalBugIntelligence } from "./code-risk-intelligence.js";
import { buildCrossRepositoryGraph } from "./cross-repository.js";
import { readLatestMutationReport, runMutationTesting } from "./mutation-testing.js";
import { reproduceHistoricalBug, verifyBugFix } from "./bug-lifecycle.js";
import { analyzeGraphConnectivity, assessEngineeringCapabilities, auditArchitectureIntent, auditProductionReadiness, buildOnboardingDocument } from "./project-readiness.js";
import { buildAgentAnalytics, buildAiEvaluationGraph, recordAgentMistake, recordAgentRun, verifyHallucinations } from "./ai-governance.js";
import { auditEngineeringPractices } from "./engineering-practices.js";
import { optimizePromptWithHeldOutValidation } from "./prompt-optimizer.js";

const PUBLIC_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../public");

export interface CockpitProject {
  id: string;
  graphPath: string;
}

export interface CockpitServerOptions {
  graphPath?: string;
  projects?: CockpitProject[];
  authToken?: string;
  maxBodyBytes?: number;
  maxConcurrentJobs?: number;
  onError?: (error: Error, requestId: string) => void;
}

class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = "HttpError";
  }
}

function securityHeaders(response: ServerResponse, requestId: string): void {
  response.setHeader("x-request-id", requestId);
  response.setHeader("x-content-type-options", "nosniff");
  response.setHeader("x-frame-options", "DENY");
  response.setHeader("referrer-policy", "no-referrer");
  response.setHeader("permissions-policy", "camera=(), microphone=(), geolocation=()");
  response.setHeader("cross-origin-resource-policy", "same-origin");
  response.setHeader("content-security-policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
}

function json(response: ServerResponse, value: unknown, status = 200): void {
  response.statusCode = status;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.setHeader("cache-control", "no-store");
  response.end(JSON.stringify(value));
}

async function body(request: IncomingMessage, maxBodyBytes: number): Promise<unknown> {
  const declaredSize = Number(request.headers["content-length"]);
  if (Number.isFinite(declaredSize) && declaredSize > maxBodyBytes) throw new HttpError(413, "request body is too large");
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const value = Buffer.from(chunk);
    size += value.length;
    if (size > maxBodyBytes) throw new HttpError(413, "request body is too large");
    chunks.push(value);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  } catch {
    throw new HttpError(400, "request body must be valid JSON");
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) throw new HttpError(400, "request body must be a JSON object");
  const input = parsed as Record<string, unknown>;
  for (const key of ["query", "prompt", "previousPrompt", "model", "endpoint", "apiKeyEnv", "name", "reason", "understandingQuery", "commit"]) {
    if (input[key] !== undefined && typeof input[key] !== "string") throw new HttpError(400, `${key} must be a string`);
  }
  return parsed;
}

function authenticated(request: IncomingMessage, expectedToken: string | undefined): boolean {
  if (!expectedToken) return true;
  const supplied = request.headers.authorization?.replace(/^Bearer\s+/i, "") ?? "";
  const expected = Buffer.from(expectedToken);
  const actual = Buffer.from(supplied);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function sliceGraph(graph: CodeGraph, level: string, query?: string): { nodes: GraphNode[]; edges: CodeGraph["edges"]; truncated: boolean } {
  if (query) {
    const focused = focusGraph(graph, query, level === "symbols" ? 2 : 1, 350);
    return { nodes: focused.nodes, edges: focused.edges, truncated: focused.truncated };
  }
  const allowed = level === "system" ? new Set(["repository", "directory"])
    : level === "modules" ? new Set(["repository", "directory", "file"])
      : level === "files" ? new Set(["file", "package"])
        : undefined;
  const candidates = allowed ? graph.nodes.filter((node) => allowed.has(node.kind)) : graph.nodes;
  const nodes = candidates.slice(0, 350);
  const ids = new Set(nodes.map((node) => node.id));
  const edges = graph.edges.filter((edge) => ids.has(edge.source) && ids.has(edge.target));
  return { nodes, edges: edges.slice(0, 700), truncated: nodes.length < candidates.length || edges.length > 700 };
}

async function sourceTokens(graph: CodeGraph): Promise<number> {
  let characters = 0;
  const files = graph.nodes.filter((node) => node.kind === "file" && node.path);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(32, files.length) }, async () => {
    while (cursor < files.length) {
      const node = files[cursor++];
      if (!node?.path) continue;
      try { characters += (await stat(path.join(graph.repository.root, node.path))).size; } catch { /* stale file */ }
    }
  });
  await Promise.all(workers);
  return Math.max(1, Math.ceil(characters / 4));
}

async function staticFile(requestPath: string, response: ServerResponse): Promise<void> {
  const isProjectRoute = /^\/projects\/[^/]+\/?$/.test(requestPath);
  const relative = requestPath === "/" || isProjectRoute ? "index.html" : requestPath.replace(/^\//, "");
  const absolute = path.resolve(PUBLIC_ROOT, relative);
  if (!absolute.startsWith(`${PUBLIC_ROOT}${path.sep}`)) return json(response, { error: "not found" }, 404);
  try {
    const content = await readFile(absolute);
    const extension = path.extname(absolute);
    const type = extension === ".html" ? "text/html; charset=utf-8" : extension === ".css" ? "text/css; charset=utf-8" : extension === ".js" ? "text/javascript; charset=utf-8" : "application/octet-stream";
    response.writeHead(200, { "content-type": type, "cache-control": "no-cache" });
    response.end(content);
  } catch { json(response, { error: "not found" }, 404); }
}

function projectId(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-|-$/g, "") || "project";
}

function configuredProjects(options: CockpitServerOptions): CockpitProject[] {
  if (options.projects?.length) {
    const projects = options.projects.map((project) => ({ id: projectId(project.id), graphPath: path.resolve(project.graphPath) }));
    if (new Set(projects.map((project) => project.id)).size !== projects.length) throw new Error("project IDs must be unique after normalization");
    return projects;
  }
  if (options.graphPath) {
    const graphPath = path.resolve(options.graphPath);
    return [{ id: projectId(path.basename(path.dirname(path.dirname(graphPath)))), graphPath }];
  }
  throw new Error("at least one graph path is required");
}

function selectProject(url: URL, projects: CockpitProject[]): CockpitProject {
  const routeProject = /^\/projects\/([^/]+)/.exec(url.pathname)?.[1];
  const requested = url.searchParams.get("project") ?? routeProject;
  if (!requested) return projects[0] as CockpitProject;
  let requestedId: string;
  try { requestedId = projectId(decodeURIComponent(requested)); } catch { throw new HttpError(400, "project ID is malformed"); }
  const project = projects.find((candidate) => candidate.id === requestedId);
  if (!project) throw new HttpError(404, "unknown project");
  return project;
}

function projectHealth(graph: CodeGraph): { score: number; warnings: number } {
  const synchronization = graph.synchronization;
  const freshness = synchronization?.summaryFreshness.percent ?? 100;
  const warnings = (synchronization?.summaryFreshness.stale ?? 0) + graph.changes.changed.length + graph.changes.removed.length;
  return { score: Math.max(0, Math.round(freshness - Math.min(30, warnings * 3))), warnings };
}

export function createCockpitServer(options: CockpitServerOptions): Server {
  const projects = configuredProjects(options);
  const maxBodyBytes = Math.max(1_024, Math.min(10_000_000, options.maxBodyBytes ?? 1_000_000));
  const maxConcurrentJobs = Math.max(1, Math.min(32, options.maxConcurrentJobs ?? 4));
  const activeJobs = new Set<string>();
  const boundedJobRoutes = new Set([
    "/api/mutation-testing", "/api/bug-reproduce", "/api/bug-fix-verify", "/api/summaries",
    "/api/prompt/run", "/api/prompt/multi-run", "/api/prompt/optimize",
  ]);
  const cache = new Map<string, { key: string; graph: CodeGraph }>();
  const readGraph = async (project: CockpitProject): Promise<CodeGraph> => {
    const metadata = await stat(project.graphPath);
    const key = `${metadata.mtimeMs}:${metadata.size}`;
    const cached = cache.get(project.graphPath);
    const graph = cached?.key === key ? cached.graph : await readIndex(project.graphPath);
    if (graph.schemaVersion !== GRAPH_SCHEMA_VERSION || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges)
      || !graph.repository || typeof graph.repository.root !== "string" || !graph.stats || !Number.isFinite(graph.stats.nodes)
      || !graph.changes || !Array.isArray(graph.changes.changed) || !Array.isArray(graph.changes.removed)) throw new Error("invalid graph artifact; rescan the repository");
    if (!(await stat(graph.repository.root)).isDirectory()) throw new Error("repository root is unavailable; rescan at its current location");
    cache.set(project.graphPath, { key, graph });
    return graph;
  };
  return createServer(async (request, response) => {
    const suppliedRequestId = request.headers["x-request-id"]?.toString();
    const requestId = suppliedRequestId && /^[A-Za-z0-9._:-]{1,128}$/.test(suppliedRequestId) ? suppliedRequestId : randomUUID();
    securityHeaders(response, requestId);
    try {
      // Reject rebound hostnames on unauthenticated loopback sockets.
      // Authenticated reverse proxies may use their own hostname.
      const localAddress = request.socket.localAddress;
      if (!options.authToken && ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(localAddress ?? "")) {
        let hostname = "";
        try { hostname = new URL(`http://${request.headers.host ?? ""}`).hostname; } catch { /* rejected below */ }
        if (!["localhost", "127.0.0.1", "[::1]"].includes(hostname)) return json(response, { error: "invalid host for localhost cockpit", requestId }, 403);
      }
      const url = new URL(request.url ?? "/", "http://localhost");
      if (url.pathname === "/api/live") return json(response, { status: "ok" });
      if (url.pathname === "/api/ready") {
        const readiness = await Promise.all(projects.map(async (project) => {
          try {
            const value = await readGraph(project);
            return { id: project.id, ready: true, generatedAt: value.generatedAt };
          } catch {
            return { id: project.id, ready: false };
          }
        }));
        const ready = readiness.every((item) => item.ready);
        return json(response, { status: ready ? "ready" : "not-ready", projects: readiness }, ready ? 200 : 503);
      }
      if (url.pathname.startsWith("/api/") && !authenticated(request, options.authToken)) {
        response.setHeader("www-authenticate", "Bearer");
        return json(response, { error: "unauthorized", requestId }, 401);
      }
      if (!["GET", "HEAD", "POST"].includes(request.method ?? "GET")) {
        response.setHeader("allow", "GET, HEAD, POST");
        return json(response, { error: "method not allowed", requestId }, 405);
      }
      if (url.pathname.startsWith("/api/") && request.method === "POST" && !request.headers["content-type"]?.startsWith("application/json")) {
        return json(response, { error: "application/json is required", requestId }, 415);
      }
      if (url.pathname === "/api/projects") {
        const values = await Promise.all(projects.map(async (project) => {
          const graph = await readGraph(project);
          const architecture = await readArchitectureState(graph);
          return {
            id: project.id,
            name: graph.repository.name,
            root: graph.repository.root,
            stats: graph.stats,
            health: projectHealth(graph),
            synchronization: graph.synchronization,
            architecture: architecture.contract ? "approved" : architecture.proposal ? "proposed" : "not-configured",
          };
        }));
        return json(response, { projects: values });
      }
      if (url.pathname === "/api/cross-repository") {
        if (projects.length < 2) return json(response, { error: "at least two configured projects are required" }, 400);
        return json(response, await buildCrossRepositoryGraph(await Promise.all(projects.map(readGraph))));
      }
      const project = selectProject(url, projects);
      if (request.method === "POST" && boundedJobRoutes.has(url.pathname)) {
        const jobKey = `${project.id}:${url.pathname}`;
        if (activeJobs.has(jobKey)) return json(response, { error: "this operation is already running", requestId }, 409);
        if (activeJobs.size >= maxConcurrentJobs) {
          response.setHeader("retry-after", "5");
          return json(response, { error: "too many long-running operations", requestId }, 503);
        }
        activeJobs.add(jobKey);
        const release = (): void => { activeJobs.delete(jobKey); };
        response.once("finish", release);
        response.once("close", release);
      }
      const graph = async (): Promise<CodeGraph> => readGraph(project);
      if (url.pathname === "/api/overview") {
        const value = await graph();
        const architecture = await readArchitectureState(value);
        return json(response, {
          projectId: project.id,
          repository: value.repository,
          stats: value.stats,
          changes: value.changes,
          synchronization: value.synchronization,
          health: projectHealth(value),
          architecture: architecture.contract ? "approved" : architecture.proposal ? "proposed" : "not-configured",
          truth: { facts: value.nodes.length + value.edges.length, inferences: architecture.proposal ? architecture.proposal.config.layers.length : 0, hypotheses: 0 },
        });
      }
      if (url.pathname === "/api/graph") {
        return json(response, sliceGraph(await graph(), url.searchParams.get("level") ?? "modules", url.searchParams.get("q") ?? undefined));
      }
      if (url.pathname === "/api/relationships") {
        const query = url.searchParams.get("q")?.trim();
        if (!query) return json(response, { error: "q is required" }, 400);
        const direction = url.searchParams.get("direction") ?? "both";
        if (!["callers", "dependencies", "both"].includes(direction)) return json(response, { error: "invalid direction" }, 400);
        return json(response, exploreRelationships(await graph(), query, direction as "callers" | "dependencies" | "both", Math.max(1, Number(url.searchParams.get("depth")) || 6)));
      }
      if (url.pathname === "/api/search") {
        const query = url.searchParams.get("q")?.trim();
        if (!query) return json(response, { error: "q is required" }, 400);
        return json(response, await searchEverything(await graph(), query, Math.max(1, Math.min(100, Number(url.searchParams.get("limit")) || 50))));
      }
      if (url.pathname === "/api/context" && request.method === "POST") {
        const input = await body(request, maxBodyBytes) as { query?: string; budget?: number };
        if (typeof input.query !== "string" || !input.query.trim()) return json(response, { error: "query must be a non-empty string" }, 400);
        const value = await graph();
        const packet = await buildContextPacket(value, input.query.trim(), { budgetTokens: Math.max(128, Math.min(50_000, Number(input.budget) || 4_000)), depth: 2 });
        const beforeTokens = await sourceTokens(value);
        return json(response, { packet, simulation: { beforeTokens, afterTokens: packet.budget.usedTokens, reductionPercent: beforeTokens ? Math.max(0, Math.round((1 - packet.budget.usedTokens / beforeTokens) * 100)) : 0, selectedFiles: packet.excerpts.map((item) => item.path), excludedFiles: Math.max(0, value.stats.files - packet.excerpts.length) } });
      }
      if (url.pathname === "/api/verification") return json(response, await runVerification(await graph(), { runCommands: false }));
      if (url.pathname === "/api/intelligence") return json(response, await buildEngineeringIntelligence(await graph()));
      if (url.pathname === "/api/coverage") return json(response, await buildCoverageIntelligence(await graph()));
      if (url.pathname === "/api/test-quality") return json(response, await buildTestQuality(await graph()));
      if (url.pathname === "/api/api-contract") return json(response, await buildApiContractIntelligence(await graph()));
      if (url.pathname === "/api/infrastructure") return json(response, await buildInfrastructureGraph(await graph()));
      if (url.pathname === "/api/security-graph") return json(response, await buildSecurityGraph(await graph()));
      if (url.pathname === "/api/dependency-risk") return json(response, await buildDependencyRiskIntelligence(await graph()));
      if (url.pathname === "/api/dead-code") return json(response, await buildDeadCodeIntelligence(await graph()));
      if (url.pathname === "/api/bug-history") return json(response, await buildHistoricalBugIntelligence(await graph()));
      if (url.pathname === "/api/mutation-testing" && request.method === "GET") {
        const report = await readLatestMutationReport(await graph()); return report ? json(response, report) : json(response, { error: "no mutation report exists" }, 404);
      }
      if (url.pathname === "/api/mutation-testing" && request.method === "POST") {
        const input = await body(request, maxBodyBytes) as { limit?: number; timeoutMs?: number };
        return json(response, await runMutationTesting(await graph(), { limit: Math.max(1, Math.min(500, Number(input.limit) || 25)), timeoutMs: Math.max(1_000, Number(input.timeoutMs) || 120_000) }));
      }
      if ((url.pathname === "/api/bug-reproduce" || url.pathname === "/api/bug-fix-verify") && request.method === "POST") {
        const input = await body(request, maxBodyBytes) as { commit?: string; timeoutMs?: number; mutationLimit?: number; runMutations?: boolean };
        const options = { ...(input.commit?.trim() ? { commit: input.commit.trim() } : {}), timeoutMs: Math.max(1_000, Number(input.timeoutMs) || 120_000) };
        return json(response, url.pathname === "/api/bug-reproduce" ? await reproduceHistoricalBug(await graph(), options) : await verifyBugFix(await graph(), { ...options, mutationLimit: Math.max(1, Math.min(100, Number(input.mutationLimit) || 10)), runMutations: input.runMutations !== false }));
      }
      if (url.pathname === "/api/hallucination-verify" && request.method === "POST") {
        const input = await body(request, maxBodyBytes) as { claims?: string | Array<string | { id?: string; statement: string }> }; if (!input.claims) return json(response, { error: "claims are required" }, 400); return json(response, await verifyHallucinations(await graph(), input.claims));
      }
      if (url.pathname === "/api/agent/analytics" && request.method === "GET") return json(response, await buildAgentAnalytics(await graph()));
      if (url.pathname === "/api/agent/runs" && request.method === "POST") return json(response, await recordAgentRun(await graph(), await body(request, maxBodyBytes) as import("./ai-governance.js").AgentRunInput), 201);
      if (url.pathname === "/api/agent/mistakes" && request.method === "POST") return json(response, await recordAgentMistake(await graph(), await body(request, maxBodyBytes) as import("./ai-governance.js").AgentMistakeInput), 201);
      if (url.pathname === "/api/ai-evaluations" && request.method === "GET") return json(response, await buildAiEvaluationGraph(await graph()));
      if (url.pathname === "/api/health") return json(response, await buildUnifiedHealth(await graph()));
      if (url.pathname === "/api/detection") return json(response, await detectProject(await graph()));
      if (url.pathname === "/api/timeline") return json(response, await readArchitectureTimeline(await graph()));
      if (url.pathname === "/api/team") return json(response, await buildTeamKnowledgeGraph(await graph()));
      if (url.pathname === "/api/adr-maintenance") return json(response, await maintainAdrDrafts(await graph()));
      if (url.pathname === "/api/change-digest") {
        const name = url.searchParams.get("name")?.trim(); if (!name) return json(response, { error: "name is required" }, 400);
        return json(response, await buildChangeDigest(await graph(), name));
      }
      if (url.pathname === "/api/checkpoint" && request.method === "POST") {
        const input = await body(request, maxBodyBytes) as { name?: string }; if (!input.name?.trim()) return json(response, { error: "name is required" }, 400);
        return json(response, await saveDeveloperCheckpoint(await graph(), input.name.trim()), 201);
      }
      if (url.pathname === "/api/summaries" && request.method === "POST") {
        const input = await body(request, maxBodyBytes) as { endpoint?: string; model?: string; apiKeyEnv?: string; limit?: number };
        if ((input.endpoint && !input.model) || (!input.endpoint && input.model)) return json(response, { error: "endpoint and model must be supplied together" }, 400);
        const value = await graph();
        const result = await refreshSemanticSummaries(value, { ...(input.endpoint && input.model ? { provider: { endpoint: input.endpoint, model: input.model, ...(input.apiKeyEnv ? { apiKeyEnv: input.apiKeyEnv } : {}) } } : {}), limit: Math.max(1, Math.min(2_000, Number(input.limit) || 200)) });
        await writeIndex(result.graph, path.dirname(project.graphPath));
        cache.delete(project.graphPath);
        return json(response, result);
      }
      if (url.pathname === "/api/preflight" && request.method === "POST") {
        const input = await body(request, maxBodyBytes) as { projection?: import("./model.js").DiffProjection; understandingQuery?: string; approval?: boolean };
        if (!input.projection?.files) return json(response, { error: "projection is required" }, 400);
        return json(response, await runAgentPreflight(await graph(), input.projection, { ...(input.understandingQuery?.trim() ? { understandingQuery: input.understandingQuery.trim() } : {}), approval: input.approval === true }));
      }
      if (url.pathname === "/api/system-map") return json(response, await buildSystemMap(await graph()));
      if (url.pathname === "/api/onboarding") return json(response, await buildOnboardingDocument(await graph()));
      if (url.pathname === "/api/architecture-audit") return json(response, await auditArchitectureIntent(await graph()));
      if (url.pathname === "/api/capabilities") return json(response, await assessEngineeringCapabilities(await graph()));
      if (url.pathname === "/api/production-audit") return json(response, await auditProductionReadiness(await graph()));
      if (url.pathname === "/api/practices" && request.method === "GET") return json(response, await auditEngineeringPractices(await graph()));
      if (url.pathname === "/api/connectivity") return json(response, analyzeGraphConnectivity(await graph()));
      if (url.pathname === "/api/flow") {
        const query = url.searchParams.get("q")?.trim();
        if (!query) return json(response, { error: "q is required" }, 400);
        return json(response, await exploreExecutionFlow(await graph(), query));
      }
      if (url.pathname === "/api/explain") return json(response, await explainLikeSenior(await graph(), url.searchParams.get("q")?.trim() || "project"));
      if (url.pathname === "/api/prompt/analyze" && request.method === "POST") {
        const input = await body(request, maxBodyBytes) as { prompt?: string; previousPrompt?: string; model?: string; observations?: import("./model.js").PromptBehaviorObservation[] };
        if (!input.prompt?.trim()) return json(response, { error: "prompt is required" }, 400);
        const value = await graph();
        return json(response, {
          report: analyzePrompt(input.prompt, value, input.observations, input.model),
          ...(input.previousPrompt?.trim() ? { diff: comparePrompts(input.previousPrompt, input.prompt, value) } : {}),
        });
      }
      if (url.pathname === "/api/prompt/contracts" && request.method === "POST") {
        const input = await body(request, maxBodyBytes) as { prompt?: string };
        if (!input.prompt?.trim()) return json(response, { error: "prompt is required" }, 400);
        return json(response, await buildPromptToolContracts(input.prompt, await graph()));
      }
      if (url.pathname === "/api/prompt/system-graph" && request.method === "POST") {
        const input = await body(request, maxBodyBytes) as { prompt?: string; model?: string };
        if (!input.prompt?.trim()) return json(response, { error: "prompt is required" }, 400);
        return json(response, await buildAiSystemGraph(input.prompt, await graph(), input.model?.trim() || "unconfigured-model"));
      }
      if (url.pathname === "/api/prompt/run" && request.method === "POST") {
        const input = await body(request, maxBodyBytes) as { prompt?: string; endpoint?: string; model?: string; apiKeyEnv?: string; securityOnly?: boolean; name?: string; reason?: string };
        if (!input.prompt?.trim() || !input.endpoint?.trim() || !input.model?.trim()) return json(response, { error: "prompt, endpoint, and model are required" }, 400);
        const value = await graph(); const report = await executePromptSuite(input.prompt, { endpoint: input.endpoint, model: input.model, ...(input.apiKeyEnv?.trim() ? { apiKeyEnv: input.apiKeyEnv.trim() } : {}) }, value, input.securityOnly ? ["injection", "extraction", "sensitive-data"] : undefined);
        if (input.name?.trim()) await savePromptExecution(value, input.name.trim(), input.prompt, report, input.reason?.trim());
        return json(response, report);
      }
      if (url.pathname === "/api/prompt/multi-run" && request.method === "POST") {
        const input = await body(request, maxBodyBytes) as { prompt?: string; providers?: import("./model.js").PromptProviderConfig[]; categories?: import("./model.js").PromptEvaluationCategory[]; name?: string; reason?: string };
        if (!input.prompt?.trim() || !Array.isArray(input.providers) || input.providers.length < 2) return json(response, { error: "prompt and at least two providers are required" }, 400);
        const value = await graph(); const report = await executePromptAcrossModels(input.prompt, input.providers, value, input.categories);
        if (input.name?.trim()) for (const run of report.runs) await savePromptExecution(value, input.name.trim(), input.prompt, run, input.reason?.trim() ?? "multi-model evaluation");
        return json(response, report);
      }
      if (url.pathname === "/api/prompt/optimize" && request.method === "POST") {
        const input = await body(request, maxBodyBytes) as { prompt?: string; endpoint?: string; model?: string; apiKeyEnv?: string; name?: string; maximumCandidates?: number };
        if (!input.prompt?.trim() || !input.endpoint?.trim() || !input.model?.trim()) return json(response, { error: "prompt, endpoint, and model are required" }, 400);
        return json(response, await optimizePromptWithHeldOutValidation(input.prompt, { endpoint: input.endpoint, model: input.model, ...(input.apiKeyEnv?.trim() ? { apiKeyEnv: input.apiKeyEnv.trim() } : {}) }, await graph(), { ...(input.name?.trim() ? { name: input.name.trim() } : {}), maximumCandidates: Math.max(1, Math.min(3, Number(input.maximumCandidates) || 3)) }));
      }
      if (url.pathname === "/api/prompt/save" && request.method === "POST") {
        const input = await body(request, maxBodyBytes) as { name?: string; prompt?: string; reason?: string };
        if (!input.name?.trim() || !input.prompt?.trim()) return json(response, { error: "name and prompt are required" }, 400);
        return json(response, await savePromptVersion(await graph(), input.name.trim(), input.prompt, input.reason?.trim() ?? ""), 201);
      }
      if (url.pathname === "/api/prompt/history" && request.method === "GET") {
        const value = await graph();
        const name = url.searchParams.get("name")?.trim();
        return json(response, name ? await readPromptEvolution(value, name) : await listPromptEvolutions(value));
      }
      if (url.pathname === "/api/architecture" && request.method === "GET") {
        const value = await graph();
        return json(response, await readArchitectureState(value));
      }
      if (url.pathname === "/api/architecture/propose" && request.method === "POST") {
        if (!request.headers["content-type"]?.startsWith("application/json")) return json(response, { error: "application/json is required" }, 415);
        return json(response, await writeArchitectureProposal(await graph()), 201);
      }
      if (url.pathname === "/api/architecture/approve" && request.method === "POST") {
        if (!request.headers["content-type"]?.startsWith("application/json")) return json(response, { error: "application/json is required" }, 415);
        return json(response, await approveArchitecture(await graph()));
      }
      if (url.pathname.startsWith("/api/")) return json(response, { error: "not found" }, 404);
      await staticFile(url.pathname, response);
    } catch (error) {
      const normalized = error instanceof Error ? error : new Error(String(error));
      const status = error instanceof HttpError ? error.status : 500;
      if (status === 500) {
        try { options.onError?.(normalized, requestId); } catch { /* error reporting must not break the response */ }
      }
      json(response, { error: status === 500 ? "internal server error" : normalized.message, requestId }, status);
    }
  });
}
