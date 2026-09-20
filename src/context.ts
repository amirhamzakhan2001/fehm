import { fileFirstRoundRobin } from "./context-selection.js";
import { splitCodeIdentifier, rankContextMemory } from "./upstream-adaptations.js";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { mapConcurrent } from "./concurrency.js";
import { inferArchitecture, readArchitectureState } from "./architecture.js";
import { buildEngineeringIntelligence } from "./intelligence.js";
import type {
  CodeGraph,
  ContextExcerpt,
  ContextPacket,
  ContextQuality,
  GraphEdge,
  GraphNode,
  RetrievalHit,
  RetrievalIntent,
  RetrievalScores,
} from "./model.js";

export interface RetrievalOptions {
  depth?: number;
  limit?: number;
}

export interface ContextOptions extends RetrievalOptions {
  budgetTokens?: number;
  excerptRadius?: number;
}

interface FileSearchData {
  content: string;
  lines: string[];
  normalized: string;
}

interface MutableHit {
  node: GraphNode;
  lexical: number;
  symbol: number;
  semantic: number;
  graph: number;
  intent: number;
  reasons: Set<string>;
  graphDistance?: number;
  matchedLines?: number[];
}

const CONTEXT_SCHEMA_VERSION = "0.1.0";
const SYMBOL_KINDS = new Set(["class", "interface", "function", "method", "variable", "type"]);

function clamp(value: number, minimum = 0, maximum = 1): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

const SEMANTIC_CONCEPTS: string[][] = [
  ["auth", "authentication", "authorize", "authorization", "login", "signin", "identity", "session", "credential"],
  ["payment", "billing", "charge", "refund", "invoice", "checkout", "stripe"],
  ["database", "db", "storage", "persistence", "repository", "query", "sql"],
  ["api", "route", "endpoint", "controller", "handler", "request", "response"],
  ["test", "spec", "verify", "verification", "assert", "coverage", "quality"],
  ["security", "vulnerability", "secret", "permission", "injection", "leakage", "unsafe"],
  ["architecture", "design", "layer", "module", "boundary", "dependency", "coupling"],
  ["prompt", "instruction", "agent", "model", "evaluation", "behavior"],
  ["performance", "latency", "slow", "bottleneck", "runtime", "trace"],
  ["history", "git", "commit", "change", "author", "ownership", "archaeology"],
];

function semanticTokens(value: string): Set<string> {
  const base = new Set(tokenize(value));
  for (const concept of SEMANTIC_CONCEPTS) {
    if (!concept.some((token) => base.has(token))) continue;
    for (const token of concept) base.add(token);
  }
  return base;
}

function semanticScore(value: string, queryTokens: Set<string>): number {
  const valueTokens = semanticTokens(value);
  const intersection = [...queryTokens].filter((token) => valueTokens.has(token)).length;
  if (!intersection) return 0;
  const cosine = intersection / Math.sqrt(Math.max(1, queryTokens.size * valueTokens.size));
  return clamp(cosine * 1.8);
}

export function tokenize(value: string): string[] {
  return splitCodeIdentifier(value)
    .toLowerCase()
    .split(/[^a-z0-9_$@.-]+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 1);
}

export function classifyIntent(query: string): RetrievalIntent {
  const normalized = query.toLowerCase();
  if (/\b(tests?|specs?|coverage|assert(?:ion)?s?|verify|verification)\b/.test(normalized)) return "test";
  if (/\b(debug|bug|error|fail|broken|crash|fix)\b/.test(normalized)) return "debug";
  if (/\b(architecture|module|layer|dependency|circular|design)\b/.test(normalized)) return "architecture";
  if (/\b(add|change|remove|update|implement|refactor|rename|migrate)\b/.test(normalized)) return "change";
  if (/\b(find|locate|where|which file|search)\b/.test(normalized)) return "locate";
  return "explain";
}

function symbolScore(node: GraphNode, query: string, queryTokens: string[]): { score: number; reasons: string[] } {
  const name = node.name.toLowerCase();
  const qualifiedName = node.qualifiedName.toLowerCase();
  const normalizedQuery = query.toLowerCase().trim();
  const reasons: string[] = [];
  let score = 0;
  if (node.id === query || name === normalizedQuery || qualifiedName === normalizedQuery) {
    score = 1;
    reasons.push("exact symbol match");
  } else if (name.includes(normalizedQuery) || qualifiedName.includes(normalizedQuery)) {
    score = 0.82;
    reasons.push("partial symbol match");
  }
  const nodeTokens = new Set(tokenize(`${node.name} ${node.qualifiedName} ${node.summary ?? ""}`));
  const overlap = queryTokens.filter((token) => nodeTokens.has(token)).length / Math.max(1, queryTokens.length);
  if (overlap > 0) {
    score = Math.max(score, 0.25 + overlap * 0.65);
    reasons.push(`symbol token overlap ${Math.round(overlap * 100)}%`);
  }
  return { score: clamp(score), reasons };
}

function lexicalScore(content: string, query: string, queryTokens: string[]): { score: number; lines: number[] } {
  const normalized = content.toLowerCase();
  const exact = normalized.includes(query.toLowerCase().trim());
  let matched = 0;
  for (const token of queryTokens) if (normalized.includes(token)) matched += 1;
  const coverage = matched / Math.max(1, queryTokens.length);
  const score = clamp(coverage * 0.72 + (exact ? 0.28 : 0));
  const lines = content.split(/\r?\n/);
  const matchedLines: number[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]?.toLowerCase() ?? "";
    if (queryTokens.some((token) => line.includes(token))) matchedLines.push(index + 1);
  }
  return { score, lines: matchedLines.slice(0, 20) };
}

function intentScore(node: GraphNode, intent: RetrievalIntent): { score: number; reason?: string } {
  if (intent === "test" && node.test) return { score: 1, reason: "test intent" };
  if (intent === "architecture" && (node.kind === "directory" || node.kind === "file" || node.kind === "package")) {
    return { score: 0.8, reason: "architecture-level node" };
  }
  if ((intent === "change" || intent === "debug") && SYMBOL_KINDS.has(node.kind)) {
    return { score: 0.55, reason: `${intent} intent favors executable symbols` };
  }
  if (intent === "locate" && (node.kind === "file" || SYMBOL_KINDS.has(node.kind))) {
    return { score: 0.5, reason: "locate intent" };
  }
  return { score: 0 };
}

async function loadFiles(graph: CodeGraph): Promise<Map<string, FileSearchData>> {
  const result = new Map<string, FileSearchData>();
  const root = path.resolve(graph.repository.root);
  const nodes = graph.nodes.filter(node => node.kind === "file" && node.path);
  const entries = await mapConcurrent(nodes, 8, async node => {
    const absolute = path.resolve(root, node.path!);
    if (absolute !== root && !absolute.startsWith(`${root}${path.sep}`)) return undefined;
    try {
      const content = await readFile(absolute, "utf8");
      return [node.path!, { content, lines: content.split(/\r?\n/), normalized: content.toLowerCase() }] as const;
    } catch {
      // Preserve stale/deleted file handling without changing result order.
      return undefined;
    }
  });
  for (const entry of entries) if (entry) result.set(entry[0], entry[1]);
  return result;
}

function edgeWeight(edge: GraphEdge): number {
  if (edge.kind === "calls") return 1;
  if (edge.kind === "references" || edge.kind === "uses") return 0.82;
  if (edge.kind === "imports" || edge.kind === "extends" || edge.kind === "implements") return 0.88;
  if (edge.kind === "defines") return 0.72;
  return 0.58;
}

function toRetrievalHit(hit: MutableHit): RetrievalHit {
  const final = clamp(hit.symbol * 0.32 + hit.lexical * 0.24 + hit.semantic * 0.22 + hit.graph * 0.16 + hit.intent * 0.06);
  const scores: RetrievalScores = {
    lexical: round(hit.lexical),
    symbol: round(hit.symbol),
    semantic: round(hit.semantic),
    graph: round(hit.graph),
    intent: round(hit.intent),
    final: round(final),
  };
  const result: RetrievalHit = { node: hit.node, scores, reasons: [...hit.reasons].sort() };
  if (hit.graphDistance !== undefined) result.graphDistance = hit.graphDistance;
  if (hit.matchedLines?.length) result.matchedLines = hit.matchedLines;
  return result;
}

export async function retrieveContext(
  graph: CodeGraph,
  query: string,
  options: RetrievalOptions = {},
): Promise<RetrievalHit[]> {
  if (!query.trim()) return [];
  return retrieveFromFiles(graph, query, options, await loadFiles(graph));
}

function retrieveFromFiles(graph: CodeGraph, query: string, options: RetrievalOptions, files: Map<string, FileSearchData>): RetrievalHit[] {
  if (!query.trim()) return [];
  const depth = Math.max(0, options.depth ?? 2);
  const limit = Math.max(1, options.limit ?? 50);
  const intent = classifyIntent(query);
  const queryTokens = [...new Set(tokenize(query))];
  const concepts = semanticTokens(query);
  const hits = new Map<string, MutableHit>();

  for (const node of graph.nodes) {
    const symbol = symbolScore(node, query, queryTokens);
    const file = node.path ? files.get(node.path) : undefined;
    let lexical = { score: 0, lines: [] as number[] };
    if (file) {
      if (node.location) {
        const start = Math.max(0, node.location.line - 1);
        const end = Math.min(file.lines.length, node.location.endLine ?? node.location.line + 20);
        lexical = lexicalScore(file.lines.slice(start, end).join("\n"), query, queryTokens);
        lexical.lines = lexical.lines.map((line) => line + start);
      } else if (node.kind === "file") {
        lexical = lexicalScore(file.content, query, queryTokens);
      }
    }
    const intentMatch = intentScore(node, intent);
    const semantic = semanticScore(`${node.name} ${node.qualifiedName} ${node.summary ?? ""} ${file?.content.slice(0, 4_000) ?? ""}`, concepts);
    if (symbol.score === 0 && lexical.score === 0 && semantic === 0) continue;
    const reasons = new Set([...symbol.reasons]);
    if (lexical.score > 0) reasons.add(`lexical query coverage ${Math.round(lexical.score * 100)}%`);
    if (semantic > 0) reasons.add(`semantic concept similarity ${Math.round(semantic * 100)}%`);
    if (intentMatch.reason) reasons.add(intentMatch.reason);
    hits.set(node.id, {
      node,
      lexical: lexical.score,
      symbol: symbol.score,
      semantic,
      graph: 0,
      intent: intentMatch.score,
      reasons,
      matchedLines: lexical.lines,
    });
  }

  const seeds = [...hits.values()]
    .sort((a, b) => Math.max(b.symbol, b.lexical, b.semantic) - Math.max(a.symbol, a.lexical, a.semantic))
    .slice(0, 20);
  let frontier = new Map(seeds.map((hit) => [hit.node.id, Math.max(hit.symbol, hit.lexical, hit.semantic)]));
  const nodesById = new Map(graph.nodes.map((node) => [node.id, node]));

  for (let distance = 1; distance <= depth && frontier.size; distance += 1) {
    const next = new Map<string, number>();
    for (const edge of graph.edges) {
      for (const [from, to] of [[edge.source, edge.target], [edge.target, edge.source]] as const) {
        const sourceScore = frontier.get(from);
        if (sourceScore === undefined) continue;
        const propagated = sourceScore * edgeWeight(edge) * edge.evidence.confidence * 0.72;
        if (propagated < 0.08 || propagated <= (next.get(to) ?? 0)) continue;
        next.set(to, propagated);
      }
    }
    frontier = next;
    for (const [id, propagated] of next) {
      const node = nodesById.get(id);
      if (!node) continue;
      const existing = hits.get(id);
      const intentMatch = intentScore(node, intent);
      const hit: MutableHit = existing ?? {
        node,
        lexical: 0,
        symbol: 0,
        semantic: 0,
        graph: 0,
        intent: intentMatch.score,
        reasons: new Set<string>(),
      };
      if (propagated > hit.graph) {
        hit.graph = propagated;
        hit.graphDistance = distance;
        hit.reasons.add(`graph neighbor at distance ${distance}`);
      }
      if (intentMatch.reason) hit.reasons.add(intentMatch.reason);
      hits.set(id, hit);
    }
  }

  return [...hits.values()]
    .map(toRetrievalHit)
    .filter((hit) => hit.scores.final > 0)
    .sort((a, b) => b.scores.final - a.scores.final || a.node.id.localeCompare(b.node.id))
    .slice(0, limit);
}

export function estimateTokens(value: string): number {
  return Math.max(1, Math.ceil(value.length / 4));
}

function formatHitLine(hit: RetrievalHit): string {
  return `- ${hit.node.kind} ${hit.node.qualifiedName} — ${hit.scores.final.toFixed(3)} (${hit.reasons.join(", ")})`;
}

function formatRelationshipLine(edge: GraphEdge): string {
  return `- ${edge.source} --${edge.kind}--> ${edge.target} [${edge.evidence.provenance}, ${edge.evidence.confidence}]`;
}

function formatExcerptBlock(excerpt: Pick<ContextExcerpt, "path" | "startLine" | "content">): string {
  return `### ${excerpt.path}:${excerpt.startLine}\n\`\`\`\n${excerpt.content}\n\`\`\``;
}

function excerptFor(hit: RetrievalHit, file: FileSearchData, radius: number): Omit<ContextExcerpt, "estimatedTokens"> {
  const anchor = hit.node.location?.line ?? hit.matchedLines?.[0] ?? 1;
  const startLine = Math.max(1, anchor - radius);
  const endHint = hit.node.location?.endLine ?? anchor;
  const endLine = Math.min(file.lines.length, Math.max(endHint, anchor + radius));
  return {
    path: hit.node.path ?? "",
    startLine,
    endLine,
    content: file.lines.slice(startLine - 1, endLine).join("\n"),
    nodeIds: [hit.node.id],
    score: hit.scores.final,
  };
}

function qualityFor(query: string, hits: RetrievalHit[], excerpts: ContextExcerpt[], relationships: GraphEdge[], packetEvidence: { architecture: number; tests: number; history: number }): ContextQuality {
  const queryTokens = [...new Set(tokenize(query))];
  const selectedText = `${hits.map((hit) => `${hit.node.name} ${hit.node.qualifiedName}`).join(" ")} ${excerpts.map((item) => item.content).join(" ")}`.toLowerCase();
  const covered = queryTokens.filter((token) => selectedText.includes(token)).length;
  const queryCoverage = covered / Math.max(1, queryTokens.length);
  const exactSymbolMatch = hits.some((hit) => hit.reasons.includes("exact symbol match"));
  const evidenceConfidence = relationships.length
    ? relationships.reduce((sum, edge) => sum + edge.evidence.confidence, 0) / relationships.length
    : 0;
  const graphConnectivity = hits.length > 1 ? clamp(relationships.length / (hits.length - 1)) : hits.length === 1 ? 1 : 0;
  const architectureCoverage = clamp(packetEvidence.architecture / 2);
  const dependencyCoverage = clamp(relationships.length / Math.max(1, Math.min(8, hits.length)));
  const testCoverage = clamp(packetEvidence.tests / 2);
  const historyCoverage = clamp(packetEvidence.history / 2);
  const score = queryCoverage * 28 + (exactSymbolMatch ? 12 : 0) + evidenceConfidence * 12 + graphConnectivity * 10
    + architectureCoverage * 10 + dependencyCoverage * 10 + testCoverage * 9 + historyCoverage * 9;
  return {
    score: Math.round(clamp(score / 100) * 100),
    queryCoverage: round(queryCoverage),
    exactSymbolMatch,
    evidenceConfidence: round(evidenceConfidence),
    graphConnectivity: round(graphConnectivity),
    architectureCoverage: round(architectureCoverage),
    dependencyCoverage: round(dependencyCoverage),
    testCoverage: round(testCoverage),
    historyCoverage: round(historyCoverage),
  };
}

export async function buildContextPacket(
  graph: CodeGraph,
  query: string,
  options: ContextOptions = {},
): Promise<ContextPacket> {
  const maximumTokens = Number.isFinite(options.budgetTokens ?? 4_000) ? Math.max(128, Math.floor(options.budgetTokens ?? 4_000)) : 4_000;
  const radius = Math.max(1, options.excerptRadius ?? 5);
  const retrievalOptions: RetrievalOptions = { limit: options.limit ?? 50 };
  if (options.depth !== undefined) retrievalOptions.depth = options.depth;
  const files = await loadFiles(graph);
  const hits = retrieveFromFiles(graph, query, retrievalOptions, files);
  const [architectureProposal, architectureState, intelligence] = await Promise.all([
    inferArchitecture(graph),
    readArchitectureState(graph),
    buildEngineeringIntelligence(graph),
  ]);
  const rankedMemory = rankContextMemory(intelligence.memory, query, architectureProposal.detectedTechnologies);
  const architecture = {
    layers: architectureProposal.config.layers.map((layer) => layer.name),
    technologies: architectureProposal.detectedTechnologies,
    constraints: rankedMemory.filter((item) => item.kind === "decision" || item.kind === "warning").slice(0, 8).map((item) => `${item.path}:${item.line} ${item.content}`),
    approved: Boolean(architectureState.contract),
  };
  const history = {
    commitsAnalyzed: intelligence.history.commits,
    recentChanges: intelligence.history.recentCommits.slice(0, 6).map((item) => `${item.hash.slice(0, 8)} ${item.subject}`),
    memory: rankedMemory.slice(0, 8).map((item) => `${item.kind}: ${item.title}`),
  };
  const seedIds = new Set(hits.slice(0, 20).map((hit) => hit.node.id));
  const relatedTestIds = new Set(graph.edges.filter((edge) => edge.kind === "calls" && seedIds.has(edge.target)).map((edge) => edge.source));
  const relatedTests = graph.nodes.filter((node) => node.test && node.path && (relatedTestIds.has(node.id) || seedIds.has(node.id))).map((node) => node.path as string);
  const tests = [...new Set((relatedTests.length ? relatedTests : graph.nodes.filter((node) => node.test && node.path).map((node) => node.path as string)).slice(0, 12))];
  const baseText = [
    "# fehm Context Packet",
    "",
    `Query: ${displayQuery(query, maximumTokens)}`,
    `Intent: ${classifyIntent(query)}`,
    "Quality: 100/100",
    `Budget: ${maximumTokens}/${maximumTokens} estimated tokens (truncated)`,
    "",
    "## Architecture",
    `Layers: ${architecture.layers.join(", ") || "unknown"}`,
    `Technologies: ${architecture.technologies.join(", ") || "unknown"}`,
    `Approval: ${architecture.approved ? "developer-approved" : "inferred"}`,
    ...architecture.constraints.map((item) => `- ${item}`),
    "",
    "## History and memory",
    `Commits analyzed: ${history.commitsAnalyzed}`,
    ...history.recentChanges.map((item) => `- ${item}`),
    ...history.memory.map((item) => `- ${item}`),
    "",
    "## Relevant tests",
    ...tests.map((item) => `- ${item}`),
    "",
    "## Recommended nodes",
    "",
    "## Relationships",
    "",
    "## Source excerpts",
  ].join("\n");
  let usedTokens = Math.min(maximumTokens, estimateTokens(baseText));

  const recommendedNodes: RetrievalHit[] = [];
  const nodeAllowance = Math.max(1, Math.floor(maximumTokens * 0.25));
  let nodeTokens = 0;
  // Keep the strongest three anchors, then diversify the remaining budget by file.
  const packetHits = [...hits.slice(0, 3), ...fileFirstRoundRobin(hits.slice(3).map(hit => ({
    group: hit.node.path ? `file:${hit.node.path}` : `node:${hit.node.id}`,
    value: hit,
  })), 22)];
  for (const hit of packetHits) {
    const cost = estimateTokens(formatHitLine(hit));
    if (nodeTokens + cost > nodeAllowance || usedTokens + cost > maximumTokens) break;
    recommendedNodes.push(hit);
    nodeTokens += cost;
    usedTokens += cost;
  }
  if (recommendedNodes.length === 0 && hits[0]) {
    const cost = estimateTokens(formatHitLine(hits[0]));
    if (usedTokens + cost <= maximumTokens) {
      recommendedNodes.push(hits[0]);
      nodeTokens += cost;
      usedTokens += cost;
    }
  }

  const selectedNodeIds = new Set(recommendedNodes.map((hit) => hit.node.id));
  const relationshipCandidates = graph.edges.filter(
    (edge) => selectedNodeIds.has(edge.source) && selectedNodeIds.has(edge.target),
  );
  const relationships: GraphEdge[] = [];
  const relationshipAllowance = Math.max(1, Math.floor(maximumTokens * 0.2));
  let relationshipTokens = 0;
  for (const edge of relationshipCandidates.slice(0, 30)) {
    const cost = estimateTokens(formatRelationshipLine(edge));
    if (relationshipTokens + cost > relationshipAllowance || usedTokens + cost > maximumTokens) break;
    relationships.push(edge);
    relationshipTokens += cost;
    usedTokens += cost;
  }

  const excerpts: ContextExcerpt[] = [];
  const coveredPaths = new Set<string>();
  let truncated = query.length > maximumTokens || recommendedNodes.length < hits.length || relationships.length < relationshipCandidates.length;

  for (const hit of recommendedNodes) {
    const file = hit.node.path ? files.get(hit.node.path) : undefined;
    if (!file || !hit.node.path || coveredPaths.has(hit.node.path)) continue;
    const candidate = excerptFor(hit, file, radius);
    const remaining = maximumTokens - usedTokens;
    if (remaining <= 0) {
      truncated = true;
      break;
    }
    const wrapperTokens = estimateTokens(formatExcerptBlock({ ...candidate, content: "" }));
    if (wrapperTokens >= remaining) {
      truncated = true;
      break;
    }
    let content = candidate.content;
    let tokens = estimateTokens(formatExcerptBlock({ ...candidate, content }));
    if (tokens > remaining) {
      const maximumCharacters = Math.max(0, (remaining - wrapperTokens) * 4);
      content = content.slice(0, maximumCharacters);
      tokens = estimateTokens(formatExcerptBlock({ ...candidate, content }));
      truncated = true;
    }
    if (!content) continue;
    excerpts.push({ ...candidate, content, estimatedTokens: tokens });
    coveredPaths.add(hit.node.path);
    usedTokens += tokens;
  }

  if (excerpts.length < new Set(recommendedNodes.map((hit) => hit.node.path).filter(Boolean)).size) truncated = true;
  const packet: ContextPacket = {
    schemaVersion: CONTEXT_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    query,
    intent: classifyIntent(query),
    budget: {
      maximumTokens,
      usedTokens,
      remainingTokens: maximumTokens - usedTokens,
      truncated,
    },
    quality: qualityFor(query, recommendedNodes, excerpts, relationships, {
      architecture: architecture.layers.length + architecture.constraints.length,
      tests: tests.length,
      history: history.recentChanges.length + history.memory.length,
    }),
    architecture,
    history,
    tests,
    recommendedNodes,
    relationships,
    excerpts,
  };
  const removable: Array<() => boolean> = [
    () => Boolean(packet.excerpts.pop()),
    () => Boolean(packet.relationships.pop()),
    () => Boolean(packet.recommendedNodes.pop()),
    () => Boolean(packet.history.memory.pop()),
    () => Boolean(packet.history.recentChanges.pop()),
    () => Boolean(packet.architecture.constraints.pop()),
    () => Boolean(packet.tests.pop()),
    () => Boolean(packet.architecture.technologies.pop()),
    () => Boolean(packet.architecture.layers.pop()),
  ];
  let formattedTokens = estimateTokens(formatContextPacket(packet));
  for (const remove of removable) {
    while (formattedTokens > maximumTokens && remove()) {
      packet.budget.truncated = true;
      formattedTokens = estimateTokens(formatContextPacket(packet));
    }
  }
  packet.quality = qualityFor(query, packet.recommendedNodes, packet.excerpts, packet.relationships, {
    architecture: packet.architecture.layers.length + packet.architecture.constraints.length,
    tests: packet.tests.length,
    history: packet.history.recentChanges.length + packet.history.memory.length,
  });
  // Account for the final quality score and the budget line's own digit count.
  for (let iteration = 0; iteration < 8; iteration += 1) {
    formattedTokens = estimateTokens(formatContextPacket(packet));
    if (packet.budget.usedTokens === formattedTokens) break;
    packet.budget.usedTokens = formattedTokens;
  }
  packet.budget.remainingTokens = maximumTokens - packet.budget.usedTokens;
  return packet;
}

function displayQuery(query: string, maximumTokens: number): string {
  // Preserve the full query in JSON while reserving at most a quarter of the
  // rendered packet's character budget for its query heading.
  return query.length > maximumTokens ? `${query.slice(0, maximumTokens - 1)}…` : query;
}

export function formatContextPacket(packet: ContextPacket): string {
  const lines = [
    `# fehm Context Packet`,
    "",
    `Query: ${displayQuery(packet.query, packet.budget.maximumTokens)}`,
    `Intent: ${packet.intent}`,
    `Quality: ${packet.quality.score}/100`,
    `Budget: ${packet.budget.usedTokens}/${packet.budget.maximumTokens} estimated tokens${packet.budget.truncated ? " (truncated)" : ""}`,
    "",
    "## Architecture",
    `Layers: ${packet.architecture.layers.join(", ") || "unknown"}`,
    `Technologies: ${packet.architecture.technologies.join(", ") || "unknown"}`,
    `Approval: ${packet.architecture.approved ? "developer-approved" : "inferred"}`,
    ...packet.architecture.constraints.map((item) => `- ${item}`),
    "",
    "## History and memory",
    `Commits analyzed: ${packet.history.commitsAnalyzed}`,
    ...packet.history.recentChanges.map((item) => `- ${item}`),
    ...packet.history.memory.map((item) => `- ${item}`),
    "",
    "## Relevant tests",
    ...packet.tests.map((item) => `- ${item}`),
    "",
    "## Recommended nodes",
  ];
  for (const hit of packet.recommendedNodes) {
    lines.push(formatHitLine(hit));
  }
  lines.push("", "## Relationships");
  for (const edge of packet.relationships.slice(0, 30)) {
    lines.push(formatRelationshipLine(edge));
  }
  lines.push("", "## Source excerpts");
  for (const excerpt of packet.excerpts) {
    lines.push("", formatExcerptBlock(excerpt));
  }
  return `${lines.join("\n")}\n`;
}
