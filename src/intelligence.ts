import { execFile } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type {
  ArchitectureDriftReport,
  ArchitectureViolation,
  CodeArchaeologyReport,
  CodeGraph,
  EngineeringIntelligenceReport,
  GitCommitRecord,
  GitHistorySummary,
  GraphNode,
  MemoryRecord,
  PerformanceFinding,
  RefactoringOpportunity,
  RiskHotspot,
  RiskLevel,
} from "./model.js";
import { checkArchitecture, scanSecurity } from "./verification.js";

const execFileAsync = promisify(execFile);
const INTELLIGENCE_SCHEMA_VERSION = "0.1.0";

function riskLevel(score: number): RiskLevel {
  if (score >= 75) return "critical";
  if (score >= 50) return "high";
  if (score >= 25) return "medium";
  return "low";
}

function lineAt(content: string, offset: number): number {
  return content.slice(0, offset).split(/\r?\n/).length;
}

async function documentationFiles(root: string): Promise<string[]> {
  const result: string[] = [];
  const excluded = new Set([".git", ".fehm", "node_modules", "dist", "build", "coverage"]);
  const walk = async (directory: string, depth: number): Promise<void> => {
    if (depth > 5) return;
    let entries;
    try { entries = await readdir(directory, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (excluded.has(entry.name)) continue;
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) await walk(absolute, depth + 1);
      else if (entry.isFile() && /\.(md|mdx|txt)$/i.test(entry.name)
        && /(adr|decision|architecture|design|readme)/i.test(`${directory}/${entry.name}`)) result.push(absolute);
    }
  };
  await walk(root, 0);
  return result.sort();
}

export async function collectArchitectureMemory(graph: CodeGraph): Promise<MemoryRecord[]> {
  const records: MemoryRecord[] = [];
  const root = path.resolve(graph.repository.root);
  for (const absolute of await documentationFiles(root)) {
    const content = await readFile(absolute, "utf8");
    const relative = path.relative(root, absolute).split(path.sep).join("/");
    const title = /^#\s+(.+)$/m.exec(content)?.[1]?.trim() ?? path.basename(relative);
    const sections = [...content.matchAll(/^##?\s+(Decision|Context|Rationale|Consequences|Status)\s*$([\s\S]*?)(?=^##?\s|\Z)/gim)];
    const body = sections.length
      ? sections.map((match) => `${match[1]}: ${match[2]?.trim()}`).join("\n\n")
      : content.slice(0, 2_000).trim();
    if (!body) continue;
    const kind: MemoryRecord["kind"] = /(^|[/_.-])adr([/_.-]|$)/i.test(relative) ? "adr" : "decision";
    records.push({
      id: `${kind}:${relative}`,
      kind,
      title,
      content: body.slice(0, 4_000),
      path: relative,
      line: 1,
      source: "documentation",
      confidence: sections.length ? 0.98 : 0.78,
    });
  }

  const tagPattern = /(?:\/\/|\/\*+|#)\s*(WHY|DECISION|DO NOT|WARNING|HACK|NOTE)\s*:\s*([^\n*]+)/gi;
  for (const node of graph.nodes) {
    if (node.kind !== "file" || !node.path || node.test) continue;
    let content: string;
    try { content = await readFile(path.join(root, node.path), "utf8"); } catch { continue; }
    for (const match of content.matchAll(tagPattern)) {
      const tag = match[1]?.toUpperCase() ?? "NOTE";
      const kind: MemoryRecord["kind"] = tag === "WHY" || tag === "NOTE" ? "why"
        : tag === "DECISION" ? "decision"
          : tag === "HACK" ? "hack" : "warning";
      const line = lineAt(content, match.index ?? 0);
      records.push({
        id: `${kind}:${node.path}:${line}`,
        kind,
        title: `${tag} in ${node.name}`,
        content: match[2]?.trim() ?? "",
        path: node.path,
        line,
        source: "code-comment",
        confidence: 1,
      });
    }
  }
  return records.sort((a, b) => a.path.localeCompare(b.path) || a.line - b.line);
}

function parseGitLog(output: string): GitCommitRecord[] {
  const commits: GitCommitRecord[] = [];
  let current: GitCommitRecord | undefined;
  for (const line of output.split(/\r?\n/)) {
    if (line.startsWith("@@@")) {
      if (current) commits.push(current);
      const [hash = "", author = "", date = "", subject = ""] = line.slice(3).split("\x1f");
      current = { hash, author, date, subject, files: [] };
    } else if (current && line.trim()) current.files.push(line.trim().split(path.sep).join("/"));
  }
  if (current) commits.push(current);
  return commits;
}

export async function collectGitHistory(root: string, limit = 200, filePath?: string): Promise<GitHistorySummary> {
  const args = ["log", `-n${Math.max(1, limit)}`, "--date=iso-strict", "--format=@@@%H%x1f%an%x1f%aI%x1f%s", "--name-only"];
  if (filePath) args.push("--", filePath);
  try {
    const { stdout } = await execFileAsync("git", args, { cwd: root, maxBuffer: 20 * 1024 * 1024 });
    const commits = parseGitLog(stdout);
    const churn: Record<string, number> = {};
    for (const commit of commits) for (const file of new Set(commit.files)) churn[file] = (churn[file] ?? 0) + 1;
    return {
      available: true,
      commits: commits.length,
      authors: [...new Set(commits.map((commit) => commit.author).filter(Boolean))].sort(),
      fileChurn: churn,
      recentCommits: commits,
    };
  } catch (error) {
    return {
      available: false,
      commits: 0,
      authors: [],
      fileChurn: {},
      recentCommits: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function detectPerformanceFindings(graph: CodeGraph): Promise<PerformanceFinding[]> {
  const rules = [
    { rule: "sync-io", severity: "medium" as const, title: "Synchronous I/O", detail: "Synchronous filesystem or process I/O can block the event loop.", pattern: /\b(?:readFileSync|writeFileSync|execFileSync|execSync)\s*\(/g, confidence: 0.9 },
    { rule: "await-in-loop", severity: "medium" as const, title: "Sequential await inside loop", detail: "Consider bounded concurrency when iterations are independent.", pattern: /\b(?:for|while)\s*\([^)]*\)[\s\S]{0,300}?\bawait\b/g, confidence: 0.72 },
    { rule: "json-deep-clone", severity: "low" as const, title: "JSON deep clone", detail: "JSON serialization cloning can be slow and loses non-JSON values.", pattern: /JSON\.parse\s*\(\s*JSON\.stringify\s*\(/g, confidence: 0.95 },
  ];
  const root = path.resolve(graph.repository.root);
  const findings: PerformanceFinding[] = [];
  for (const node of graph.nodes) {
    if (node.kind !== "file" || !node.path || node.test) continue;
    let content: string;
    try { content = await readFile(path.join(root, node.path), "utf8"); } catch { continue; }
    for (const rule of rules) {
      for (const match of content.matchAll(new RegExp(rule.pattern.source, rule.pattern.flags))) {
        findings.push({ ...rule, path: node.path, line: lineAt(content, match.index ?? 0) });
      }
    }
  }
  return findings;
}

function functionMetrics(graph: CodeGraph, node: GraphNode, content: string, churn: number, security: number, performance: number): RiskHotspot {
  const start = node.location?.line ?? 1;
  const end = node.location?.endLine ?? start;
  const source = content.split(/\r?\n/).slice(start - 1, end).join("\n");
  const complexity = 1 + (source.match(/\b(if|else if|for|while|case|catch)\b|&&|\|\||\?(?![?.])/g)?.length ?? 0);
  const fanIn = graph.edges.filter((edge) => edge.kind === "calls" && edge.target === node.id).length;
  const fanOut = graph.edges.filter((edge) => edge.kind === "calls" && edge.source === node.id).length;
  const warningMarkers = source.match(/\/\/[^\n]*(?:TODO|FIXME|HACK|XXX)|\/\*[\s\S]*?(?:TODO|FIXME|HACK|XXX)[\s\S]*?\*\//g)?.length ?? 0;
  const lines = Math.max(1, end - start + 1);
  // Score excess complexity instead of charging every ordinary line/branch.
  // This keeps small orchestration functions from being labeled high-risk while
  // still allowing genuinely large, coupled, or security-sensitive code to
  // saturate the scale.
  const score = Math.min(100, Math.round(
    5
    + Math.max(0, complexity - 5) * 1.5
    + Math.max(0, lines - 25) * 0.2
    + Math.max(0, fanIn - 3) * 1.5
    + Math.max(0, fanOut - 3) * 1.5
    + Math.max(0, churn - 2)
    + warningMarkers * 6
    + security * 15
    + performance * 5,
  ));
  const reasons: string[] = [];
  if (lines >= 60) reasons.push(`${lines} lines`);
  if (complexity >= 10) reasons.push(`complexity ${complexity}`);
  if (fanIn >= 8) reasons.push(`${fanIn} callers`);
  if (fanOut >= 8) reasons.push(`${fanOut} downstream calls`);
  if (churn >= 10) reasons.push(`${churn} recent commits touched the file`);
  if (warningMarkers) reasons.push(`${warningMarkers} warning marker(s)`);
  if (security) reasons.push(`${security} security finding(s)`);
  if (performance) reasons.push(`${performance} performance finding(s)`);
  return { node, score, level: riskLevel(score), metrics: { lines, complexity, fanIn, fanOut, fileChurn: churn, warningMarkers, securityFindings: security, performanceFindings: performance }, reasons };
}

function refactoringOpportunities(graph: CodeGraph, hotspots: RiskHotspot[], performance: PerformanceFinding[]): RefactoringOpportunity[] {
  const result: RefactoringOpportunity[] = [];
  for (const hotspot of hotspots) {
    const common = { target: hotspot.node.qualifiedName, ...(hotspot.node.path ? { path: hotspot.node.path } : {}), priority: hotspot.level };
    if (hotspot.metrics.lines >= 60) result.push({ ...common, kind: "large-function", reason: `${hotspot.metrics.lines} line function`, suggestion: "Extract cohesive responsibilities into smaller functions.", evidence: hotspot.reasons });
    if (hotspot.metrics.complexity >= 10) result.push({ ...common, kind: "high-complexity", reason: `cyclomatic proxy ${hotspot.metrics.complexity}`, suggestion: "Simplify branching and extract decision logic.", evidence: hotspot.reasons });
    if (hotspot.metrics.fanIn + hotspot.metrics.fanOut >= 15) result.push({ ...common, kind: "high-coupling", reason: `${hotspot.metrics.fanIn} callers and ${hotspot.metrics.fanOut} callees`, suggestion: "Introduce a narrower interface or split orchestration from domain logic.", evidence: hotspot.reasons });
    if (hotspot.metrics.fileChurn >= 10 && hotspot.score >= 50) result.push({ ...common, kind: "churn-hotspot", reason: "high churn combined with high risk", suggestion: "Add characterization tests before refactoring this hotspot.", evidence: hotspot.reasons });
  }
  const fileSymbols = new Map<string, number>();
  for (const node of graph.nodes) if (node.path && !["file", "directory", "repository", "package"].includes(node.kind)) fileSymbols.set(node.path, (fileSymbols.get(node.path) ?? 0) + 1);
  for (const [file, count] of fileSymbols) if (count >= 40) result.push({ kind: "god-module", target: file, path: file, priority: "high", reason: `${count} symbols in one file`, suggestion: "Split the module along cohesive domain boundaries.", evidence: [`symbol count ${count}`] });
  for (const finding of performance) result.push({ kind: "performance", target: `${finding.path}:${finding.line}`, path: finding.path, priority: finding.severity === "high" ? "high" : "medium", reason: finding.title, suggestion: finding.detail, evidence: [`${finding.rule} confidence ${finding.confidence}`] });
  return result;
}

export async function buildEngineeringIntelligence(graph: CodeGraph): Promise<EngineeringIntelligenceReport> {
  const [memory, history, performance, security] = await Promise.all([
    collectArchitectureMemory(graph),
    collectGitHistory(graph.repository.root),
    detectPerformanceFindings(graph),
    scanSecurity(graph),
  ]);
  const root = path.resolve(graph.repository.root);
  const contentCache = new Map<string, string>();
  const hotspots: RiskHotspot[] = [];
  for (const node of graph.nodes) {
    if (!node.path || (node.kind !== "function" && node.kind !== "method")) continue;
    let content = contentCache.get(node.path);
    if (content === undefined) {
      try { content = await readFile(path.join(root, node.path), "utf8"); } catch { content = ""; }
      contentCache.set(node.path, content);
    }
    hotspots.push(functionMetrics(
      graph,
      node,
      content,
      history.fileChurn[node.path] ?? 0,
      security.findings.filter((finding) => finding.path === node.path && finding.line >= (node.location?.line ?? 0) && finding.line <= (node.location?.endLine ?? Infinity)).length,
      performance.filter((finding) => finding.path === node.path && finding.line >= (node.location?.line ?? 0) && finding.line <= (node.location?.endLine ?? Infinity)).length,
    ));
  }
  hotspots.sort((a, b) => b.score - a.score || a.node.id.localeCompare(b.node.id));
  const refactoring = refactoringOpportunities(graph, hotspots, performance);
  return {
    schemaVersion: INTELLIGENCE_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    repositoryFingerprint: graph.repository.fingerprint,
    memory,
    history,
    hotspots: hotspots.slice(0, 100),
    refactoring,
    performance,
    security: security.findings,
    summary: {
      memoryRecords: memory.length,
      commitsAnalyzed: history.commits,
      highRiskHotspots: hotspots.filter((item) => item.level === "high" || item.level === "critical").length,
      refactoringOpportunities: refactoring.length,
      performanceFindings: performance.length,
      securityFindings: security.findings.length,
    },
  };
}

export async function buildCodeArchaeology(graph: CodeGraph, query: string): Promise<CodeArchaeologyReport> {
  const normalized = query.toLowerCase();
  const node = graph.nodes.find((item) => item.id === query || item.qualifiedName.toLowerCase() === normalized)
    ?? graph.nodes.find((item) => item.name.toLowerCase() === normalized)
    ?? graph.nodes.find((item) => item.qualifiedName.toLowerCase().includes(normalized));
  if (!node?.path) return { query, recentChanges: [], relatedMemory: [], authors: [], confidence: 0, explanation: "No indexed symbol or file matched the query." };
  const [history, memory] = await Promise.all([collectGitHistory(graph.repository.root, 100, node.path), collectArchitectureMemory(graph)]);
  const tokens = new Set(`${node.name} ${node.path}`.toLowerCase().split(/[^a-z0-9]+/).filter((value) => value.length > 2));
  const relatedMemory = memory.filter((record) => record.path === node.path || [...tokens].some((token) => `${record.title} ${record.content} ${record.path}`.toLowerCase().includes(token))).slice(0, 20);
  const origin = history.recentCommits.at(-1);
  const confidence = Math.min(100, (history.available ? 55 : 0) + (origin ? 20 : 0) + (relatedMemory.length ? 25 : 0));
  const reason = origin ? `It first appears in commit ${origin.hash.slice(0, 8)} (${origin.subject}) by ${origin.author}.` : "Its introducing commit could not be determined.";
  const memoryReason = relatedMemory.length ? ` ${relatedMemory.length} related decision/WHY record(s) provide design context.` : " No related architecture memory was found.";
  return { query, node, ...(origin ? { origin } : {}), recentChanges: history.recentCommits.slice(0, 10), relatedMemory, authors: history.authors, confidence, explanation: `${reason}${memoryReason}` };
}

function violationKey(violation: ArchitectureViolation): string {
  return `${violation.rule}:${violation.source}->${violation.target}:${violation.reason}`;
}

export async function compareArchitectureDrift(before: CodeGraph, after: CodeGraph, configPath: string): Promise<ArchitectureDriftReport> {
  const [beforeResult, afterResult] = await Promise.all([checkArchitecture(before, configPath), checkArchitecture(after, configPath)]);
  if (beforeResult.error) throw new Error(beforeResult.error);
  if (afterResult.error) throw new Error(afterResult.error);
  const beforeMap = new Map(beforeResult.violations.map((item) => [violationKey(item), item]));
  const afterMap = new Map(afterResult.violations.map((item) => [violationKey(item), item]));
  const addedViolations = [...afterMap].filter(([key]) => !beforeMap.has(key)).map(([, item]) => item);
  const resolvedViolations = [...beforeMap].filter(([key]) => !afterMap.has(key)).map(([, item]) => item);
  const unchangedViolations = [...afterMap].filter(([key]) => beforeMap.has(key)).map(([, item]) => item);
  const status = addedViolations.length ? "degraded"
    : resolvedViolations.length ? "improved" : "stable";
  return { beforeFingerprint: before.repository.fingerprint, afterFingerprint: after.repository.fingerprint, addedViolations, resolvedViolations, unchangedViolations, status };
}

export function formatEngineeringIntelligence(report: EngineeringIntelligenceReport): string {
  const lines = ["# Engineering Intelligence", "", `Memory records: ${report.summary.memoryRecords}`, `Commits analyzed: ${report.summary.commitsAnalyzed}`, `High-risk hotspots: ${report.summary.highRiskHotspots}`, `Refactoring opportunities: ${report.summary.refactoringOpportunities}`, `Performance findings: ${report.summary.performanceFindings}`, `Security findings: ${report.summary.securityFindings}`, "", "## Top hotspots"];
  for (const item of report.hotspots.slice(0, 15)) lines.push(`- ${item.level.toUpperCase()} ${item.score}/100 ${item.node.qualifiedName}${item.reasons.length ? ` — ${item.reasons.join(", ")}` : ""}`);
  lines.push("", "## Refactoring opportunities");
  for (const item of report.refactoring.slice(0, 20)) lines.push(`- ${item.priority.toUpperCase()} ${item.target}: ${item.suggestion}`);
  lines.push("", "## Architecture memory");
  for (const item of report.memory.slice(0, 20)) lines.push(`- ${item.kind.toUpperCase()} ${item.path}:${item.line} — ${item.title}`);
  return `${lines.join("\n")}\n`;
}
