import { readFile } from "node:fs/promises";
import path from "node:path";
import ts from "typescript";
import { inferArchitecture, readArchitectureState } from "./architecture.js";
import { focusGraph } from "./graph.js";
import { buildEngineeringIntelligence } from "./intelligence.js";
import type {
  CodeGraph,
  CodeProphecy,
  CodebaseDNA,
  EdgeKind,
  EngineeringIntelligenceReport,
  ExecutionFlow,
  GraphNode,
  SeniorExplanation,
  SystemEntryPoint,
  SystemMapReport,
  SystemUnknown,
} from "./model.js";

const SYSTEM_MAP_SCHEMA_VERSION = "0.1.0";

interface SourceRange { start: number; end: number }

function nonCodeRanges(content: string, filePath: string): SourceRange[] {
  const scriptKind = /\.tsx$/i.test(filePath) ? ts.ScriptKind.TSX
    : /\.jsx$/i.test(filePath) ? ts.ScriptKind.JSX
      : /\.[cm]?js$/i.test(filePath) ? ts.ScriptKind.JS
        : ts.ScriptKind.TS;
  const sourceFile = ts.createSourceFile(filePath, content, ts.ScriptTarget.Latest, true, scriptKind);
  const ranges: SourceRange[] = [];
  const excluded = new Set<ts.SyntaxKind>([
    ts.SyntaxKind.StringLiteral,
    ts.SyntaxKind.NoSubstitutionTemplateLiteral,
    ts.SyntaxKind.TemplateHead,
    ts.SyntaxKind.TemplateMiddle,
    ts.SyntaxKind.TemplateTail,
    ts.SyntaxKind.RegularExpressionLiteral,
    ts.SyntaxKind.JsxText,
  ]);
  const addComments = (items: ts.CommentRange[] | undefined): void => {
    for (const item of items ?? []) ranges.push({ start: item.pos, end: item.end });
  };
  const visit = (node: ts.Node): void => {
    if (excluded.has(node.kind)) ranges.push({ start: node.getStart(sourceFile), end: node.end });
    addComments(ts.getLeadingCommentRanges(content, node.pos));
    addComments(ts.getTrailingCommentRanges(content, node.end));
    for (const child of node.getChildren(sourceFile)) visit(child);
  };
  visit(sourceFile);
  return ranges;
}

function isCodeOffset(offset: number, ranges: SourceRange[]): boolean {
  return !ranges.some((range) => offset >= range.start && offset < range.end);
}

function lineAt(content: string, offset: number): number {
  return content.slice(0, offset).split(/\r?\n/).length;
}

function ownerAt(graph: CodeGraph, filePath: string, line: number): GraphNode | undefined {
  const symbols = graph.nodes.filter((node) => node.path === filePath && node.location
    && node.location.line <= line && (node.location.endLine ?? node.location.line) >= line);
  symbols.sort((left, right) => ((left.location?.endLine ?? 0) - (left.location?.line ?? 0))
    - ((right.location?.endLine ?? 0) - (right.location?.line ?? 0)));
  return symbols[0] ?? graph.nodes.find((node) => node.kind === "file" && node.path === filePath);
}

function entryId(kind: SystemEntryPoint["kind"], filePath: string, line: number, label: string): string {
  return `entry:${kind}:${filePath}:${line}:${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
}

function addEntry(
  entries: Map<string, SystemEntryPoint>,
  graph: CodeGraph,
  kind: SystemEntryPoint["kind"],
  filePath: string,
  content: string,
  offset: number,
  label: string,
  confidence: number,
  evidence: string[],
): SystemEntryPoint | undefined {
  const line = lineAt(content, offset);
  const owner = ownerAt(graph, filePath, line);
  if (!owner) return undefined;
  const entry: SystemEntryPoint = {
    id: entryId(kind, filePath, line, label),
    kind,
    label,
    path: filePath,
    line,
    nodeId: owner.id,
    confidence,
    evidence,
  };
  entries.set(entry.id, entry);
  return entry;
}

export async function detectEntryPoints(graph: CodeGraph): Promise<SystemEntryPoint[]> {
  const entries = new Map<string, SystemEntryPoint>();
  const root = path.resolve(graph.repository.root);
  const fileNodes = graph.nodes.filter((node) => node.kind === "file" && node.path);
  let bins: Record<string, string> = {};
  try {
    const manifest = JSON.parse(await readFile(path.join(root, "package.json"), "utf8")) as { bin?: string | Record<string, string> };
    bins = typeof manifest.bin === "string" ? { [graph.repository.name]: manifest.bin } : manifest.bin ?? {};
  } catch { /* package metadata is optional */ }

  for (const fileNode of fileNodes) {
    const filePath = fileNode.path as string;
    let content: string;
    try { content = await readFile(path.join(root, filePath), "utf8"); } catch { continue; }
    const excludedRanges = nonCodeRanges(content, filePath);

    const http = /\b(?:app|router|server)\.(get|post|put|patch|delete|options|head)\s*\(\s*["'`]([^"'`]+)["'`]/gi;
    for (const match of content.matchAll(http)) {
      if (!isCodeOffset(match.index ?? 0, excludedRanges)) continue;
      const method = match[1]?.toUpperCase() ?? "HTTP";
      const route = match[2] ?? "/";
      const kind = /webhook/i.test(route) ? "webhook" : "http-route";
      const entry = addEntry(entries, graph, kind, filePath, content, match.index ?? 0, `${method} ${route}`, 0.96, ["static route registration", `${filePath}:${lineAt(content, match.index ?? 0)}`]);
      const remainder = content.slice((match.index ?? 0) + match[0].length);
      const handlerName = /^\s*,\s*([A-Za-z_$][\w$]*)/.exec(remainder)?.[1];
      const handler = handlerName
        ? graph.nodes.find((node) => node.name === handlerName && (node.kind === "function" || node.kind === "method"))
        : undefined;
      if (entry && handler) {
        entry.nodeId = handler.id;
        entry.evidence.push(`registered handler ${handler.qualifiedName}`);
      }
    }
    const pathnameChecks = /\burl\.pathname\s*===\s*["'`]([^"'`]+)["'`]/g;
    for (const match of content.matchAll(pathnameChecks)) {
      if (!isCodeOffset(match.index ?? 0, excludedRanges)) continue;
      const route = match[1] ?? "/";
      const nearby = content.slice(match.index ?? 0, (match.index ?? 0) + 180);
      const method = /request\.method\s*===\s*["'`]([A-Z]+)["'`]/.exec(nearby)?.[1] ?? "HTTP";
      const kind = /webhook/i.test(route) ? "webhook" : "http-route";
      addEntry(entries, graph, kind, filePath, content, match.index ?? 0, `${method} ${route}`, 0.91, ["static URL pathname comparison"]);
    }

    const cron = /\b(?:cron\.schedule|scheduleJob|setInterval)\s*\(/g;
    for (const match of content.matchAll(cron)) {
      if (isCodeOffset(match.index ?? 0, excludedRanges)) addEntry(entries, graph, "cron", filePath, content, match.index ?? 0, `Scheduled job in ${fileNode.name}`, 0.82, ["scheduler API call"]);
    }

    const queue = /\.\s*(?:consume|process)\s*\(\s*["'`]?([^,"'`)]+)/g;
    for (const match of content.matchAll(queue)) {
      if (isCodeOffset(match.index ?? 0, excludedRanges)) addEntry(entries, graph, "queue-consumer", filePath, content, match.index ?? 0, `Queue consumer ${match[1]?.trim() || fileNode.name}`, 0.78, ["queue consumer API pattern"]);
    }

    const events = /\.on\s*\(\s*["'`]([^"'`]+)["'`]/g;
    for (const match of content.matchAll(events)) {
      if (isCodeOffset(match.index ?? 0, excludedRanges)) addEntry(entries, graph, "event-handler", filePath, content, match.index ?? 0, `Event ${match[1]}`, 0.72, ["event subscription pattern"]);
    }

    const serverless = /export\s+(?:async\s+)?(?:function|const)\s+handler\b/g;
    for (const match of content.matchAll(serverless)) {
      if (isCodeOffset(match.index ?? 0, excludedRanges)) addEntry(entries, graph, "serverless", filePath, content, match.index ?? 0, `Serverless handler ${fileNode.name}`, 0.9, ["exported handler convention"]);
    }

    if (/(^|\/)pages\/.*\.[cm]?[jt]sx?$|(^|\/)app\/.*(?:page|route)\.[cm]?[jt]sx?$/.test(filePath)) {
      addEntry(entries, graph, "frontend-route", filePath, content, 0, `Frontend route ${filePath}`, 0.86, ["framework file-system routing convention"]);
    }

    for (const [name, binPath] of Object.entries(bins)) {
      const normalizedBin = binPath.replace(/^\.\//, "");
      const sameBuiltSource = path.basename(normalizedBin).replace(/\.[^.]+$/, "") === path.basename(filePath).replace(/\.[^.]+$/, "")
        && normalizedBin.startsWith("dist/") && filePath.startsWith("src/");
      if (normalizedBin !== filePath && !sameBuiltSource) continue;
      addEntry(entries, graph, "cli", filePath, content, 0, `CLI ${name}`, 1, ["package.json bin declaration"]);
    }
  }
  return [...entries.values()].sort((left, right) => left.kind.localeCompare(right.kind) || left.label.localeCompare(right.label));
}

function flowEdges(graph: CodeGraph, source: string): CodeGraph["edges"] {
  const kinds = new Set<EdgeKind>(["calls", "imports", "references", "uses", "defines"]);
  return graph.edges.filter((edge) => edge.source === source && kinds.has(edge.kind));
}

export async function exploreExecutionFlow(graph: CodeGraph, query: string, maxDepth = 6, maxSteps = 40): Promise<ExecutionFlow> {
  const entries = await detectEntryPoints(graph);
  const normalized = query.toLowerCase();
  const entryPoint = entries.find((entry) => entry.id === query || entry.label.toLowerCase() === normalized)
    ?? entries.find((entry) => `${entry.kind} ${entry.label} ${entry.path}`.toLowerCase().includes(normalized));
  const fallback = graph.nodes.find((node) => node.id === query || node.qualifiedName.toLowerCase() === normalized)
    ?? graph.nodes.find((node) => node.name.toLowerCase() === normalized)
    ?? graph.nodes.find((node) => node.qualifiedName.toLowerCase().includes(normalized));
  const startId = entryPoint?.nodeId ?? fallback?.id;
  if (!startId) return { query, steps: [], edges: [], truncated: false, confidence: 0, unknowns: ["No entry point or indexed node matched the query."] };
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  const visited = new Set<string>();
  const queue: Array<{ id: string; depth: number; via?: CodeGraph["edges"][number] }> = [{ id: startId, depth: 0 }];
  const steps: ExecutionFlow["steps"] = [];
  const edges: CodeGraph["edges"] = [];
  const unknowns: string[] = [];
  while (queue.length && steps.length < maxSteps) {
    const current = queue.shift();
    if (!current || visited.has(current.id)) continue;
    visited.add(current.id);
    const node = nodes.get(current.id);
    if (!node) continue;
    steps.push({
      order: steps.length + 1,
      node,
      ...(current.via ? { via: current.via.kind } : {}),
      confidence: current.via?.evidence.confidence ?? entryPoint?.confidence ?? 1,
      evidence: current.via ? `${current.via.evidence.provenance}: ${current.via.kind}` : entryPoint?.evidence.join("; ") ?? "direct graph match",
    });
    if (node.kind === "package") {
      unknowns.push(`Execution leaves the repository at external package ${node.name}.`);
      continue;
    }
    if (current.depth >= maxDepth) continue;
    for (const edge of flowEdges(graph, current.id)) {
      edges.push(edge);
      if (!visited.has(edge.target)) queue.push({ id: edge.target, depth: current.depth + 1, via: edge });
    }
  }
  const truncated = queue.length > 0;
  if (steps.length === 1) unknowns.push("No statically verified downstream execution steps were found.");
  const confidence = steps.length
    ? Math.round((steps.reduce((total, step) => total + step.confidence, 0) / steps.length) * 100)
    : 0;
  return { query, ...(entryPoint ? { entryPoint } : {}), steps, edges, truncated, confidence, unknowns: [...new Set(unknowns)] };
}

function hasTestProtection(graph: CodeGraph, nodeId: string): boolean {
  const nodeMap = new Map(graph.nodes.map((node) => [node.id, node]));
  const seen = new Set([nodeId]);
  let frontier = new Set([nodeId]);
  for (let depth = 0; depth < 4; depth += 1) {
    const next = new Set<string>();
    for (const edge of graph.edges) {
      if (edge.kind !== "calls" || !frontier.has(edge.target) || seen.has(edge.source)) continue;
      const source = nodeMap.get(edge.source);
      if (source?.test) return true;
      seen.add(edge.source);
      next.add(edge.source);
    }
    frontier = next;
  }
  return false;
}

export function buildProphecies(graph: CodeGraph, intelligence: EngineeringIntelligenceReport): CodeProphecy[] {
  return intelligence.hotspots.map((hotspot) => {
    const protectedByTests = hasTestProtection(graph, hotspot.node.id);
    const factors: CodeProphecy["factors"] = [];
    const add = (name: string, contribution: number, evidence: string): void => { if (contribution > 0) factors.push({ name, contribution, evidence }); };
    add("complexity", Math.min(24, hotspot.metrics.complexity * 2), `complexity proxy ${hotspot.metrics.complexity}`);
    add("coupling", Math.min(24, (hotspot.metrics.fanIn + hotspot.metrics.fanOut) * 2), `${hotspot.metrics.fanIn} callers and ${hotspot.metrics.fanOut} downstream calls`);
    add("change frequency", Math.min(18, hotspot.metrics.fileChurn * 2), `${hotspot.metrics.fileChurn} recent file changes`);
    add("missing test protection", protectedByTests ? 0 : 18, protectedByTests ? "reachable from tests" : "no test caller found within four graph hops");
    add("security/performance", Math.min(20, hotspot.metrics.securityFindings * 12 + hotspot.metrics.performanceFindings * 8), `${hotspot.metrics.securityFindings} security and ${hotspot.metrics.performanceFindings} performance findings`);
    const score = Math.min(100, Math.round(factors.reduce((total, factor) => total + factor.contribution, 0)));
    const level: CodeProphecy["level"] = score >= 75 ? "critical" : score >= 50 ? "high" : score >= 25 ? "medium" : "low";
    const confidence = Math.min(96, 58 + factors.length * 7 + (intelligence.history.available ? 8 : 0));
    const leading = factors.sort((left, right) => right.contribution - left.contribution)[0]?.name ?? "limited static evidence";
    return {
      node: hotspot.node,
      score,
      level,
      confidence,
      prediction: `${hotspot.node.qualifiedName} is a ${level}-likelihood future failure hotspot; the strongest signal is ${leading}.`,
      factors,
    };
  }).sort((left, right) => right.score - left.score || left.node.id.localeCompare(right.node.id)).slice(0, 50);
}

function level(value: number, medium: number, high: number): "low" | "medium" | "high" {
  return value >= high ? "high" : value >= medium ? "medium" : "low";
}

async function buildDNA(
  graph: CodeGraph,
  intelligence: EngineeringIntelligenceReport,
  entryPoints: SystemEntryPoint[],
): Promise<CodebaseDNA> {
  const [proposal, architecture] = await Promise.all([inferArchitecture(graph), readArchitectureState(graph)]);
  const hotspots = intelligence.hotspots;
  const averageComplexity = hotspots.length ? hotspots.reduce((total, item) => total + item.metrics.complexity, 0) / hotspots.length : 0;
  const averageCoupling = hotspots.length ? hotspots.reduce((total, item) => total + item.metrics.fanIn + item.metrics.fanOut, 0) / hotspots.length : 0;
  const highRiskHotspots = hotspots.filter((item) => item.level === "high" || item.level === "critical").length;
  const technicalDebtPercent = Math.min(100, Math.round(
    (hotspots.length ? highRiskHotspots / hotspots.length : 0) * 45
    + Math.min(30, intelligence.refactoring.length * 2)
    + Math.min(25, (intelligence.security.length + intelligence.performance.length) * 4),
  ));
  const resolvedTotal = graph.stats.calls + graph.stats.unresolvedCalls;
  const resolution = resolvedTotal ? graph.stats.calls / resolvedTotal : 1;
  const freshness = (graph.synchronization?.summaryFreshness.percent ?? 100) / 100;
  const aiReadiness = Math.min(100, Math.round(
    15
    + freshness * 20
    + resolution * 20
    + (graph.stats.tests ? 15 : 0)
    + (architecture.contract ? 20 : architecture.proposal ? 12 : 0)
    + Math.min(10, intelligence.memory.length * 2),
  ));
  const testingStrategy = [
    graph.nodes.some((node) => node.test && /unit/i.test(node.path ?? "")) ? "Unit" : undefined,
    graph.nodes.some((node) => node.test && /integration/i.test(node.path ?? "")) ? "Integration" : undefined,
    graph.nodes.some((node) => node.test && /e2e|playwright|cypress/i.test(node.path ?? "")) ? "End-to-end" : undefined,
    graph.stats.tests ? "Automated tests" : undefined,
  ].filter((value): value is string => Boolean(value));
  const names = new Set(proposal.config.layers.map((layer) => layer.name));
  const architectureStyle = names.has("frontend") && names.has("services") && names.has("database")
    ? "Layered modular architecture"
    : proposal.config.layers.length > 1 ? "Modular repository" : "Single-module repository";
  return {
    architectureStyle,
    technologies: proposal.detectedTechnologies,
    testingStrategy: [...new Set(testingStrategy)],
    complexity: level(averageComplexity, 5, 10),
    coupling: level(averageCoupling, 5, 12),
    technicalDebtPercent,
    aiReadiness,
    metrics: {
      layers: proposal.config.layers.length,
      entryPoints: entryPoints.length,
      averageComplexity: Math.round(averageComplexity * 10) / 10,
      averageCoupling: Math.round(averageCoupling * 10) / 10,
      highRiskHotspots,
      memoryRecords: intelligence.memory.length,
    },
    evidence: [
      `${graph.stats.nodes} typed graph nodes and ${graph.stats.edges} evidence-backed relationships`,
      `${proposal.config.layers.length} inferred architecture layers`,
      `${entryPoints.length} statically detected entry points`,
      `${graph.stats.calls} resolved and ${graph.stats.unresolvedCalls} unresolved calls`,
      architecture.contract ? "developer-approved architecture contract" : architecture.proposal ? "architecture proposal awaiting approval" : "architecture intent not configured",
    ],
  };
}

export async function findSystemUnknowns(graph: CodeGraph, entryPoints?: SystemEntryPoint[]): Promise<SystemUnknown[]> {
  const unknowns: SystemUnknown[] = [];
  if (graph.stats.unresolvedCalls) unknowns.push({
    id: "unresolved-calls",
    kind: "unresolved-call",
    severity: graph.stats.unresolvedCalls > graph.stats.calls ? "high" : "warning",
    count: graph.stats.unresolvedCalls,
    detail: "Call expressions could not be resolved to indexed declarations; runtime dispatch or external APIs may be involved.",
    paths: [],
    confidence: 1,
  });
  const dynamicPaths: string[] = [];
  for (const node of graph.nodes) {
    if (node.kind !== "file" || !node.path) continue;
    try {
      const content = await readFile(path.join(graph.repository.root, node.path), "utf8");
      if (/\bimport\s*\(\s*(?!["'`])|\brequire\s*\(\s*(?!["'`])/.test(content)) dynamicPaths.push(node.path);
    } catch { /* stale files are reported elsewhere */ }
  }
  if (dynamicPaths.length) unknowns.push({ id: "dynamic-imports", kind: "dynamic-import", severity: "warning", count: dynamicPaths.length, detail: "Runtime-computed module targets cannot be proven statically.", paths: dynamicPaths, confidence: 0.9 });
  const lowConfidence = graph.edges.filter((edge) => edge.evidence.confidence < 0.8);
  if (lowConfidence.length) unknowns.push({ id: "low-confidence-edges", kind: "low-confidence-edge", severity: "warning", count: lowConfidence.length, detail: "Relationships below 80% confidence need corroboration before high-risk edits.", paths: [...new Set(lowConfidence.map((edge) => edge.evidence.location?.path).filter((value): value is string => Boolean(value)))], confidence: 1 });
  const stale = graph.nodes.filter((node) => node.summary && node.summaryStatus !== "fresh");
  if (stale.length) unknowns.push({ id: "stale-summaries", kind: "stale-summary", severity: "warning", count: stale.length, detail: "Semantic or deterministic summaries are not fresh.", paths: [...new Set(stale.map((node) => node.path).filter((value): value is string => Boolean(value)))], confidence: 1 });
  const architecture = await readArchitectureState(graph);
  if (!architecture.contract) unknowns.push({ id: "architecture-intent", kind: "architecture-intent", severity: "warning", count: 1, detail: architecture.proposal ? "Architecture is inferred but still awaits developer approval." : "No developer-approved architecture intent is available.", paths: [".fehm/architecture.proposed.json"], confidence: 1 });
  const entries = entryPoints ?? await detectEntryPoints(graph);
  const untraced = entries.filter((entry) => flowEdges(graph, entry.nodeId).length === 0);
  if (untraced.length) unknowns.push({ id: "untraced-entry-points", kind: "untraced-entry-point", severity: "info", count: untraced.length, detail: "Entry points have no statically verified downstream graph edge.", paths: [...new Set(untraced.map((entry) => entry.path))], confidence: 0.88 });
  return unknowns;
}

function projectExplanation(
  graph: CodeGraph,
  dna: CodebaseDNA,
  entryPoints: SystemEntryPoint[],
  prophecies: CodeProphecy[],
  unknowns: SystemUnknown[],
  intelligence: EngineeringIntelligenceReport,
): SeniorExplanation {
  return {
    query: "project",
    title: `Senior engineer briefing: ${graph.repository.name}`,
    summary: `${graph.repository.name} is a ${dna.architectureStyle.toLowerCase()} built with ${dna.technologies.join(", ") || "indexed source code"}. It exposes ${entryPoints.length} detected entry point(s), contains ${graph.stats.symbols} symbols, and has an AI-readiness score of ${dna.aiReadiness}/100.`,
    facts: [
      `${dna.metrics.layers} architecture layer(s)`,
      `${graph.stats.files} source file(s) and ${graph.stats.tests} test file(s)`,
      `${graph.stats.calls} resolved call relationships`,
      `${intelligence.memory.length} WHY/decision memory record(s)`,
      ...entryPoints.slice(0, 5).map((entry) => `${entry.kind}: ${entry.label}`),
    ],
    risks: [
      ...prophecies.slice(0, 5).map((item) => `${item.score}/100: ${item.prediction}`),
      ...unknowns.filter((item) => item.severity !== "info").slice(0, 5).map((item) => `${item.count} × ${item.detail}`),
    ],
    constraints: intelligence.memory.filter((item) => item.kind === "warning" || item.kind === "decision").slice(0, 8).map((item) => `${item.path}:${item.line} — ${item.content}`),
    relatedTests: graph.nodes.filter((node) => node.kind === "file" && node.test).slice(0, 12).map((node) => node.path as string),
    confidence: Math.min(98, 65 + (dna.metrics.layers ? 8 : 0) + (entryPoints.length ? 8 : 0) + (intelligence.memory.length ? 8 : 0) + (graph.stats.tests ? 8 : 0)),
  };
}

export async function explainLikeSenior(graph: CodeGraph, query = "project"): Promise<SeniorExplanation> {
  if (!query.trim() || query.toLowerCase() === "project") {
    const report = await buildSystemMap(graph);
    return report.onboarding;
  }
  const normalized = query.toLowerCase();
  const node = graph.nodes.find((item) => item.id === query || item.qualifiedName.toLowerCase() === normalized)
    ?? graph.nodes.find((item) => item.name.toLowerCase() === normalized)
    ?? graph.nodes.find((item) => item.qualifiedName.toLowerCase().includes(normalized));
  if (!node) return { query, title: "No trustworthy explanation available", summary: "No indexed node matched the query.", facts: [], risks: [], constraints: [], relatedTests: [], confidence: 0 };
  const [intelligence, architecture] = await Promise.all([buildEngineeringIntelligence(graph), readArchitectureState(graph)]);
  const focus = focusGraph(graph, node.id, 2, 120);
  const hotspot = intelligence.hotspots.find((item) => item.node.id === node.id);
  const incoming = graph.edges.filter((edge) => edge.target === node.id);
  const outgoing = graph.edges.filter((edge) => edge.source === node.id);
  const tests = focus.nodes.filter((item) => item.test && item.path).map((item) => item.path as string);
  const memories = intelligence.memory.filter((item) => item.path === node.path);
  return {
    query,
    title: `Senior engineer explanation: ${node.qualifiedName}`,
    summary: `${node.summary ?? node.kind} at ${node.path ?? "the repository graph"}. It has ${incoming.length} incoming and ${outgoing.length} outgoing relationship(s), so changes should be evaluated across its ${focus.nodes.length}-node dependency neighborhood.`,
    facts: [
      `Kind: ${node.kind}`,
      `Fan-in: ${incoming.length}; fan-out: ${outgoing.length}`,
      `Evidence neighborhood: ${focus.nodes.length} nodes / ${focus.edges.length} edges`,
      ...memories.slice(0, 4).map((item) => `${item.kind.toUpperCase()}: ${item.content}`),
    ],
    risks: hotspot ? [`${hotspot.level.toUpperCase()} ${hotspot.score}/100 — ${hotspot.reasons.join(", ") || "composite structural risk"}`] : [],
    constraints: [
      ...(architecture.contract ? ["A developer-approved architecture contract is enforced."] : ["Architecture intent is not yet developer-approved."]),
      ...memories.filter((item) => item.kind === "warning" || item.kind === "decision").map((item) => item.content),
    ],
    relatedTests: [...new Set(tests)],
    confidence: Math.min(98, 60 + (node.location ? 12 : 0) + (incoming.length + outgoing.length ? 12 : 0) + (tests.length ? 8 : 0) + (memories.length ? 8 : 0)),
  };
}

export async function buildSystemMap(graph: CodeGraph): Promise<SystemMapReport> {
  const [intelligence, entryPoints] = await Promise.all([buildEngineeringIntelligence(graph), detectEntryPoints(graph)]);
  const [dna, unknowns] = await Promise.all([buildDNA(graph, intelligence, entryPoints), findSystemUnknowns(graph, entryPoints)]);
  const prophecies = buildProphecies(graph, intelligence);
  return {
    schemaVersion: SYSTEM_MAP_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    repositoryFingerprint: graph.repository.fingerprint,
    dna,
    entryPoints,
    prophecies,
    unknowns,
    onboarding: projectExplanation(graph, dna, entryPoints, prophecies, unknowns, intelligence),
  };
}

export function formatSystemMap(report: SystemMapReport): string {
  const lines = [
    "# AI-Native System Map",
    "",
    `Architecture: ${report.dna.architectureStyle}`,
    `Technologies: ${report.dna.technologies.join(", ") || "unknown"}`,
    `AI readiness: ${report.dna.aiReadiness}/100`,
    `Technical debt: ${report.dna.technicalDebtPercent}%`,
    `Complexity: ${report.dna.complexity}; coupling: ${report.dna.coupling}`,
    "",
    "## Entry points",
    ...report.entryPoints.slice(0, 20).map((entry) => `- ${entry.kind}: ${entry.label} (${entry.path}:${entry.line}, confidence ${Math.round(entry.confidence * 100)}%)`),
    "",
    "## Code prophecy",
    ...report.prophecies.slice(0, 15).map((item) => `- ${item.level.toUpperCase()} ${item.score}/100: ${item.prediction} (confidence ${item.confidence}%)`),
    "",
    "## Unknowns",
    ...report.unknowns.map((item) => `- ${item.severity.toUpperCase()}: ${item.count} × ${item.detail}`),
  ];
  return `${lines.join("\n")}\n`;
}

export function formatExecutionFlow(flow: ExecutionFlow): string {
  const lines = [
    `# Execution Flow: ${flow.query}`,
    "",
    `Confidence: ${flow.confidence}%`,
    ...(flow.entryPoint ? [`Entry point: ${flow.entryPoint.kind} ${flow.entryPoint.label}`, ""] : []),
    ...flow.steps.map((step) => `${step.order}. ${step.via ? `${step.via} → ` : ""}${step.node.qualifiedName} [${Math.round(step.confidence * 100)}%]`),
    ...(flow.unknowns.length ? ["", "## Unknowns", ...flow.unknowns.map((item) => `- ${item}`)] : []),
  ];
  return `${lines.join("\n")}\n`;
}

export function formatSeniorExplanation(explanation: SeniorExplanation): string {
  return `# ${explanation.title}\n\nConfidence: ${explanation.confidence}%\n\n${explanation.summary}\n\n## Facts\n${explanation.facts.map((item) => `- ${item}`).join("\n")}\n\n## Risks\n${explanation.risks.map((item) => `- ${item}`).join("\n") || "- None identified"}\n\n## Constraints\n${explanation.constraints.map((item) => `- ${item}`).join("\n") || "- None recorded"}\n\n## Related tests\n${explanation.relatedTests.map((item) => `- ${item}`).join("\n") || "- None found"}\n`;
}
