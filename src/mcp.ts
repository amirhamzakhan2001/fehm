import { createInterface } from "node:readline";
import { buildContextPacket, retrieveContext } from "./context.js";
import { exploreRelationships, focusGraph } from "./graph.js";
import { readIndex } from "./indexer.js";
import { analyzePrompt } from "./prompt-engine.js";
import { buildSystemMap } from "./system-map.js";
import { buildDeadCodeIntelligence, buildDependencyRiskIntelligence, buildHistoricalBugIntelligence } from "./code-risk-intelligence.js";
import { buildCrossRepositoryGraph } from "./cross-repository.js";
import { runMutationTesting } from "./mutation-testing.js";
import { reproduceHistoricalBug, verifyBugFix } from "./bug-lifecycle.js";
import { buildAgentAnalytics, buildAiEvaluationGraph, recordAgentMistake, recordAgentRun, verifyHallucinations } from "./ai-governance.js";
import { optimizePromptWithHeldOutValidation } from "./prompt-optimizer.js";
import { auditEngineeringPractices } from "./engineering-practices.js";
import { analyzeGraphConnectivity, assessEngineeringCapabilities, auditArchitectureIntent, auditProductionReadiness, buildOnboardingDocument } from "./project-readiness.js";

interface RpcRequest {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
}

function result(id: RpcRequest["id"], value: unknown): string {
  return JSON.stringify({ jsonrpc: "2.0", id: id ?? null, result: value });
}

function failure(id: RpcRequest["id"], code: number, message: string): string {
  return JSON.stringify({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

const TOOLS = [
  { name: "fehm_practices", description: "Audit engineering practices, approved policy gaps, and evidence drift across architecture, development, testing, security, AI, and operations.", inputSchema: { type: "object", properties: {} } },
  { name: "fehm_search", description: "Semantic, lexical, symbol, and graph search over the indexed repository.", inputSchema: { type: "object", properties: { query: { type: "string" }, limit: { type: "number" } }, required: ["query"] } },
  { name: "fehm_context", description: "Build an architecture-, history-, test-, and evidence-aware context packet under a hard token budget.", inputSchema: { type: "object", properties: { query: { type: "string" }, budget: { type: "number" } }, required: ["query"] } },
  { name: "fehm_focus", description: "Return the bounded graph neighborhood for a symbol, file, or module.", inputSchema: { type: "object", properties: { query: { type: "string" }, depth: { type: "number" } }, required: ["query"] } },
  { name: "fehm_relationships", description: "Explore callers, dependencies, or both with paths and confidence.", inputSchema: { type: "object", properties: { query: { type: "string" }, direction: { enum: ["callers", "dependencies", "both"] }, depth: { type: "number" } }, required: ["query"] } },
  { name: "fehm_system_map", description: "Return Codebase DNA, entry points, prophecy, onboarding, and explicit unknowns.", inputSchema: { type: "object", properties: {} } },
  { name: "fehm_onboarding", description: "Generate a durable, evidence-backed newcomer briefing with architecture, entry points, risks, unknowns, and agent safety guidance.", inputSchema: { type: "object", properties: {} } },
  { name: "fehm_architecture_audit", description: "Audit the eight architecture-intent questions that source code alone cannot answer reliably.", inputSchema: { type: "object", properties: {} } },
  { name: "fehm_capabilities", description: "Detect project-specific engineering capability signals without assuming every project needs every capability.", inputSchema: { type: "object", properties: {} } },
  { name: "fehm_production_audit", description: "Audit evidence of production hardening; reports readiness clusters without claiming that AI authored the project.", inputSchema: { type: "object", properties: {} } },
  { name: "fehm_connectivity", description: "Measure graph components and isolated nodes without fabricating relationships.", inputSchema: { type: "object", properties: {} } },
  { name: "fehm_prompt_analyze", description: "Analyze a system prompt against deterministic quality, security, and repository tool contracts.", inputSchema: { type: "object", properties: { prompt: { type: "string" } }, required: ["prompt"] } },
  { name: "fehm_dependency_risk", description: "Analyze declared, locked, imported, unused, and undeclared external dependency risk.", inputSchema: { type: "object", properties: {} } },
  { name: "fehm_dead_code", description: "Find unreachable files, unused exports/private symbols, and test-only production code with confidence evidence.", inputSchema: { type: "object", properties: {} } },
  { name: "fehm_bug_history", description: "Mine Git bug, regression, and security fixes into file and symbol hotspots.", inputSchema: { type: "object", properties: {} } },
  { name: "fehm_cross_repository", description: "Connect package and API contracts across two or more indexed repositories.", inputSchema: { type: "object", properties: { graphPaths: { type: "array", items: { type: "string" }, minItems: 1 } }, required: ["graphPaths"] } },
  { name: "fehm_mutation_test", description: "Run bounded AST mutation testing in an isolated repository copy and report killed/surviving mutants.", inputSchema: { type: "object", properties: { limit: { type: "number" }, timeoutMs: { type: "number" } } } },
  { name: "fehm_bug_reproduce", description: "Replay a historical bug-fix commit and its parent in an isolated clone to prove the failure-to-pass transition.", inputSchema: { type: "object", properties: { commit: { type: "string" }, timeoutMs: { type: "number" } } } },
  { name: "fehm_bug_fix_verify", description: "Verify a bug fix with historical reproduction, current tests, regression evidence, static checks, and mutation resistance.", inputSchema: { type: "object", properties: { commit: { type: "string" }, timeoutMs: { type: "number" }, mutationLimit: { type: "number" }, runMutations: { type: "boolean" } } } },
  { name: "fehm_verify_claims", description: "Verify concrete AI claims against indexed files, symbols, relationships, and API contracts.", inputSchema: { type: "object", properties: { claims: { type: "array", items: { type: "string" } } }, required: ["claims"] } },
  { name: "fehm_agent_analytics", description: "Aggregate persisted agent runs, outcomes, verification failures, token use, trends, and repeated mistakes.", inputSchema: { type: "object", properties: {} } },
  { name: "fehm_agent_record", description: "Persist one agent run and automatically learn from its failures.", inputSchema: { type: "object", properties: { run: { type: "object" } }, required: ["run"] } },
  { name: "fehm_agent_mistake", description: "Persist or deduplicate an agent mistake with prevention and resolution memory.", inputSchema: { type: "object", properties: { mistake: { type: "object" } }, required: ["mistake"] } },
  { name: "fehm_ai_evaluations", description: "Build model/category prompt-evaluation graph analytics, regressions, and weakest cases.", inputSchema: { type: "object", properties: {} } },
  { name: "fehm_prompt_optimize", description: "Generate prompt candidates, select on training cases, and promote only after a disjoint held-out validation gate.", inputSchema: { type: "object", properties: { prompt: { type: "string" }, endpoint: { type: "string" }, model: { type: "string" }, apiKeyEnv: { type: "string" }, name: { type: "string" }, maximumCandidates: { type: "number" } }, required: ["prompt", "endpoint", "model"] } },
];

async function callTool(graphPath: string, name: string, args: Record<string, unknown>): Promise<unknown> {
  const graph = await readIndex(graphPath);
  if (name === "fehm_practices") return auditEngineeringPractices(graph);
  const query = typeof args.query === "string" ? args.query : "";
  if (name === "fehm_search") return retrieveContext(graph, query, { limit: Number(args.limit) || 25 });
  if (name === "fehm_context") return buildContextPacket(graph, query, { budgetTokens: Number(args.budget) || 4_000, depth: 2 });
  if (name === "fehm_focus") return focusGraph(graph, query, typeof args.depth === "number" ? args.depth : 2);
  if (name === "fehm_relationships") {
    const direction = args.direction === "callers" || args.direction === "dependencies" ? args.direction : "both";
    return exploreRelationships(graph, query, direction, typeof args.depth === "number" ? args.depth : 4);
  }
  if (name === "fehm_system_map") return buildSystemMap(graph);
  if (name === "fehm_onboarding") return buildOnboardingDocument(graph);
  if (name === "fehm_architecture_audit") return auditArchitectureIntent(graph);
  if (name === "fehm_capabilities") return assessEngineeringCapabilities(graph);
  if (name === "fehm_production_audit") return auditProductionReadiness(graph);
  if (name === "fehm_connectivity") return analyzeGraphConnectivity(graph);
  if (name === "fehm_prompt_analyze") return analyzePrompt(typeof args.prompt === "string" ? args.prompt : "", graph);
  if (name === "fehm_dependency_risk") return buildDependencyRiskIntelligence(graph);
  if (name === "fehm_dead_code") return buildDeadCodeIntelligence(graph);
  if (name === "fehm_bug_history") return buildHistoricalBugIntelligence(graph);
  if (name === "fehm_cross_repository") {
    const graphPaths = Array.isArray(args.graphPaths) ? args.graphPaths.filter((value): value is string => typeof value === "string") : [];
    return buildCrossRepositoryGraph([graph, ...await Promise.all(graphPaths.map((candidate) => readIndex(candidate)))]);
  }
  if (name === "fehm_mutation_test") return runMutationTesting(graph, { limit: Math.max(1, Math.min(500, Number(args.limit) || 25)), timeoutMs: Math.max(1_000, Number(args.timeoutMs) || 120_000) });
  if (name === "fehm_bug_reproduce") return reproduceHistoricalBug(graph, { ...(typeof args.commit === "string" ? { commit: args.commit } : {}), timeoutMs: Math.max(1_000, Number(args.timeoutMs) || 120_000) });
  if (name === "fehm_bug_fix_verify") return verifyBugFix(graph, { ...(typeof args.commit === "string" ? { commit: args.commit } : {}), timeoutMs: Math.max(1_000, Number(args.timeoutMs) || 120_000), mutationLimit: Math.max(1, Math.min(100, Number(args.mutationLimit) || 10)), runMutations: args.runMutations !== false });
  if (name === "fehm_verify_claims") return verifyHallucinations(graph, Array.isArray(args.claims) ? args.claims.filter((item): item is string => typeof item === "string") : []);
  if (name === "fehm_agent_analytics") return buildAgentAnalytics(graph);
  if (name === "fehm_agent_record") return recordAgentRun(graph, args.run as import("./ai-governance.js").AgentRunInput);
  if (name === "fehm_agent_mistake") return recordAgentMistake(graph, args.mistake as import("./ai-governance.js").AgentMistakeInput);
  if (name === "fehm_ai_evaluations") return buildAiEvaluationGraph(graph);
  if (name === "fehm_prompt_optimize") return optimizePromptWithHeldOutValidation(String(args.prompt ?? ""), { endpoint: String(args.endpoint ?? ""), model: String(args.model ?? ""), ...(typeof args.apiKeyEnv === "string" ? { apiKeyEnv: args.apiKeyEnv } : {}) }, graph, { ...(typeof args.name === "string" ? { name: args.name } : {}), maximumCandidates: Math.max(1, Math.min(3, Number(args.maximumCandidates) || 3)) });
  throw new Error(`unknown tool: ${name}`);
}

export async function runMcpServer(graphPath: string): Promise<void> {
  const input = createInterface({ input: process.stdin, crlfDelay: Infinity, terminal: false });
  const write = (value: string): void => { process.stdout.write(`${value}\n`); };
  for await (const line of input) {
    if (!line.trim()) continue;
    let parsed: unknown;
    try { parsed = JSON.parse(line); } catch { write(failure(null, -32700, "parse error")); continue; }
    if (!isObject(parsed) || parsed.jsonrpc !== "2.0" || typeof parsed.method !== "string"
      || (parsed.id !== undefined && parsed.id !== null && typeof parsed.id !== "string" && typeof parsed.id !== "number")
      || (parsed.params !== undefined && !isObject(parsed.params))) {
      write(failure(null, -32600, "invalid request"));
      continue;
    }
    const request = parsed as RpcRequest;
    if (request.id === undefined) continue;
    try {
      if (request.method === "initialize") {
        const requestedVersion = typeof request.params?.protocolVersion === "string" ? request.params.protocolVersion : "2024-11-05";
        write(result(request.id, { protocolVersion: requestedVersion, capabilities: { tools: { listChanged: false }, resources: { subscribe: false, listChanged: false } }, serverInfo: { name: "fehm", version: "1.4.0" } }));
      } else if (request.method === "ping") write(result(request.id, {}));
      else if (request.method === "tools/list") write(result(request.id, { tools: TOOLS }));
      else if (request.method === "tools/call") {
        if (!isObject(request.params) || typeof request.params.name !== "string"
          || (request.params.arguments !== undefined && !isObject(request.params.arguments))) {
          write(failure(request.id, -32602, "tool name and object arguments are required"));
          continue;
        }
        const name = String(request.params?.name ?? "");
        const args = (request.params?.arguments ?? {}) as Record<string, unknown>;
        const value = await callTool(graphPath, name, args);
        write(result(request.id, { content: [{ type: "text", text: JSON.stringify(value, null, 2) }], structuredContent: value }));
      } else if (request.method === "resources/list") {
        write(result(request.id, { resources: [{ uri: "fehm://graph", name: "fehm graph", description: "Current evidence-backed repository graph", mimeType: "application/json" }] }));
      } else if (request.method === "resources/read") {
        if (request.params?.uri !== "fehm://graph") throw new Error("unknown resource URI");
        const graph = await readIndex(graphPath);
        write(result(request.id, { contents: [{ uri: "fehm://graph", mimeType: "application/json", text: JSON.stringify(graph) }] }));
      } else if (!request.method?.startsWith("notifications/")) write(failure(request.id, -32601, `method not found: ${request.method ?? ""}`));
    } catch (error) {
      write(failure(request.id, -32000, error instanceof Error ? error.message : String(error)));
    }
  }
}
