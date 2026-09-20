import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { analyzeChangeImpact } from "./change.js";
import { buildContextPacket } from "./context.js";
import { exploreRelationships } from "./graph.js";
import type {
  AgentPolicy,
  AgentPreflightReport,
  ChangeRisk,
  CodeGraph,
  DiffProjection,
  FixVerifyReport,
  GraphNode,
  HiddenDependency,
  RelationshipExplorerReport,
  RiskLevel,
} from "./model.js";
import { buildCoverageIntelligence, runSelectedTests, selectAffectedTests } from "./testing-intelligence.js";
import { checkArchitecture, runVerification } from "./verification.js";
import { auditEngineeringPractices } from "./engineering-practices.js";

const DEFAULT_POLICY: AgentPolicy = {
  version: 1,
  requireUnderstanding: true,
  maxRiskWithoutApproval: 54,
  blockArchitectureViolations: true,
  protectedZones: [
    { pattern: ".env*", reason: "secrets and runtime configuration", approvalRequired: true },
    { pattern: "**/migrations/**", reason: "persistent data migration", approvalRequired: true },
    { pattern: "**/auth/**", reason: "authentication boundary", approvalRequired: true },
    { pattern: "**/security/**", reason: "security control", approvalRequired: true },
    { pattern: "**/billing/**", reason: "financial operation", approvalRequired: true },
    { pattern: "**/package-lock.json", reason: "dependency lockfile", approvalRequired: false },
  ],
  requiredChecks: ["architecture", "security", "tests", "coverage"],
};

async function exists(candidate: string): Promise<boolean> {
  try { await access(candidate); return true; } catch { return false; }
}

export async function readAgentPolicy(graph: CodeGraph, explicitPath?: string): Promise<{ policy: AgentPolicy; source: "default" | "file"; path?: string }> {
  const candidate = explicitPath ? path.resolve(explicitPath) : path.join(graph.repository.root, ".fehm", "agent-policy.json");
  if (!(await exists(candidate))) return { policy: DEFAULT_POLICY, source: "default" };
  const policy = JSON.parse(await readFile(candidate, "utf8")) as AgentPolicy;
  if (policy.version !== 1 || !Array.isArray(policy.protectedZones) || !Array.isArray(policy.requiredChecks)) throw new Error(`invalid agent policy: ${candidate}`);
  return { policy, source: "file", path: candidate };
}

function globRegex(pattern: string): RegExp {
  const token = "__GLOBSTAR__";
  const escaped = pattern.replace(/\*\*/g, token).replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*").replace(new RegExp(token, "g"), ".*");
  return new RegExp(`^${escaped}$`);
}

function matchingProtectedZones(projection: DiffProjection, policy: AgentPolicy): AgentPreflightReport["protectedZoneHits"] {
  return projection.files.flatMap((file) => policy.protectedZones
    .filter((zone) => globRegex(zone.pattern).test(file.path) || (!zone.pattern.includes("/") && globRegex(`**/${zone.pattern}`).test(file.path)))
    .map((zone) => ({ path: file.path, zone })));
}

function fileNode(graph: CodeGraph, filePath: string): GraphNode | undefined {
  return graph.nodes.find((node) => node.kind === "file" && node.path === filePath);
}

export async function detectHiddenDependencies(graph: CodeGraph, paths?: string[]): Promise<HiddenDependency[]> {
  const selected = new Set(paths ?? Object.keys(graph.fileHashes));
  const findings: HiddenDependency[] = [];
  for (const filePath of selected) {
    const source = fileNode(graph, filePath);
    if (!source) continue;
    let content: string;
    try { content = await readFile(path.join(graph.repository.root, filePath), "utf8"); } catch { continue; }
    for (const match of content.matchAll(/import\s*\(\s*([^)'"`][^)]+|[`'"][^`'"]*\$\{[^}]+\}[^`'"]*[`'"])\s*\)/g)) {
      findings.push({ source, kind: "dynamic-import", evidence: match[0].slice(0, 180), confidence: 88 });
    }
    for (const match of content.matchAll(/(?:process\.env|import\.meta\.env)\.([A-Z][A-Z0-9_]*)/g)) {
      findings.push({ source, kind: "environment", evidence: match[0], confidence: 96 });
    }
    for (const match of content.matchAll(/(?:readFile|writeFile|open|access)\s*\([^\n]{0,100}['"]([^'"]+)['"]/g)) {
      const reference = match[1] as string;
      const target = graph.nodes.find((node) => node.kind === "file" && node.path?.endsWith(reference.replace(/^\.\//, "")));
      findings.push({ source, ...(target ? { target } : {}), kind: "string-reference", evidence: match[0].slice(0, 180), confidence: target ? 90 : 64 });
    }
  }
  const unresolved = graph.nodes.filter((node) => selected.has(node.path ?? "") && Number(node.metadata?.unresolvedCalls ?? 0) > 0);
  for (const source of unresolved) findings.push({ source, kind: "unresolved-call", evidence: `${source.metadata?.unresolvedCalls} unresolved call(s) recorded by the index`, confidence: 62 });
  return findings.slice(0, 200);
}

export function whatBreaks(graph: CodeGraph, query: string, depth = 8): RelationshipExplorerReport {
  return exploreRelationships(graph, query, "callers", depth, 500);
}

function riskLevel(score: number): RiskLevel {
  return score >= 80 ? "critical" : score >= 55 ? "high" : score >= 25 ? "medium" : "low";
}

function enrichRisk(base: ChangeRisk, protectedHits: number, architectureViolations: number, hidden: HiddenDependency[], coverageGaps: number): ChangeRisk {
  let score = base.score;
  const reasons = [...base.reasons];
  if (protectedHits) { score += Math.min(30, protectedHits * 12); reasons.push(`${protectedHits} protected-zone match(es)`); }
  if (architectureViolations) { score += Math.min(35, architectureViolations * 15); reasons.push(`${architectureViolations} architecture violation(s)`); }
  const riskyHidden = hidden.filter((item) => item.kind === "dynamic-import" || item.kind === "environment").length;
  if (riskyHidden) { score += Math.min(18, riskyHidden * 3); reasons.push(`${riskyHidden} implicit runtime dependency signal(s)`); }
  if (coverageGaps) { score += Math.min(20, coverageGaps * 4); reasons.push(`${coverageGaps} critical coverage gap(s) in affected code`); }
  score = Math.min(100, score);
  return { score, level: riskLevel(score), reasons: [...new Set(reasons)] };
}

export async function runAgentPreflight(
  graph: CodeGraph,
  projection: DiffProjection,
  options: { understandingQuery?: string; policyPath?: string; approval?: boolean; depth?: number } = {},
): Promise<AgentPreflightReport> {
  const policyState = await readAgentPolicy(graph, options.policyPath);
  const policy = policyState.policy;
  const impact = analyzeChangeImpact(graph, projection, { depth: options.depth ?? 8 });
  const protectedZoneHits = matchingProtectedZones(projection, policy);
  const [architecture, hiddenDependencies, coverage, engineeringPractices] = await Promise.all([
    checkArchitecture(graph),
    detectHiddenDependencies(graph, impact.affectedFiles),
    buildCoverageIntelligence(graph),
    auditEngineeringPractices(graph),
  ]);
  const affectedPaths = new Set(impact.affectedFiles);
  const architectureViolations = architecture.violations.filter((item) => affectedPaths.has(item.source) || affectedPaths.has(item.target));
  const affectedNodeIds = new Set([...impact.directlyAffected, ...impact.blastRadius].map((item) => item.node.id));
  const coverageGaps = coverage.criticalGaps.filter((item) => affectedNodeIds.has(item.node.id));
  const selectedTests = selectAffectedTests(graph, projection);
  const understanding = options.understandingQuery?.trim()
    ? await buildContextPacket(graph, options.understandingQuery.trim(), { depth: 3, budgetTokens: 6_000 })
    : undefined;
  const understood = !policy.requireUnderstanding || Boolean(understanding && understanding.quality.score >= 35 && understanding.recommendedNodes.length);
  const risk = enrichRisk(impact.risk, protectedZoneHits.length, architectureViolations.length, hiddenDependencies, coverageGaps.length);
  if (architecture.error) throw new Error(`Cannot evaluate architecture policy: ${architecture.error}`);
  const architectureBlocked = policy.blockArchitectureViolations && architectureViolations.length > 0;
  const requiresApproval = risk.score > policy.maxRiskWithoutApproval || protectedZoneHits.some((item) => item.zone.approvalRequired) || architectureBlocked || !engineeringPractices.passed;
  const approved = options.approval === true;
  const passed = understood && (!requiresApproval || approved) && (!architectureBlocked || approved);
  const seniorPlan = [
    ...engineeringPractices.findings.filter((item) => engineeringPractices.blockers.includes(item.id)).map((item) => `Resolve required engineering practice ${item.id}: ${item.recommendation}`),
    ...impact.recommendedInspectionOrder.slice(0, 8).map((item) => `Inspect ${item} before editing.`),
    ...(hiddenDependencies.length ? [`Validate ${hiddenDependencies.length} implicit dependency signal(s) at runtime.`] : []),
    ...(coverageGaps.length ? [`Add tests for ${coverageGaps.length} affected critical coverage gap(s).`] : []),
    ...(selectedTests.length ? [`Run the ${selectedTests.length} selected affected test file(s).`] : ["Add or identify a focused verification path for this change."]),
    "Run static, security, architecture, and test verification after editing.",
  ];
  const evidence = [
    `policy=${policyState.source}${policyState.path ? `:${policyState.path}` : ""}`,
    `understanding=${understood ? "satisfied" : "missing"}`,
    `risk=${risk.score}/${risk.level}`,
    `blast-radius=${impact.blastRadius.length}`,
    `selected-tests=${selectedTests.length}`,
    `engineering-policy=${engineeringPractices.policySource}; required-gaps=${engineeringPractices.blockers.length}; drift=${engineeringPractices.drift.status}`,
    ...(!engineeringPractices.passed && approved ? ["engineering-practices=explicit approval override for this preflight"] : []),
  ];
  return { generatedAt: new Date().toISOString(), passed, requiresApproval, understood, risk, impact, architectureViolations, protectedZoneHits, hiddenDependencies, selectedTests, coverageGaps, seniorPlan, evidence, engineeringPractices };
}

export async function runFixTestVerify(
  graph: CodeGraph,
  projection: DiffProjection,
  options: { understandingQuery?: string; policyPath?: string; approval?: boolean; timeoutMs?: number } = {},
): Promise<FixVerifyReport> {
  const preflight = await runAgentPreflight(graph, projection, options);
  if (!preflight.passed) return { preflight, tests: { selectedTests: preflight.selectedTests, status: "skipped", durationMs: 0, output: "Preflight blocked execution." }, passed: false };
  const tests = await runSelectedTests(graph, projection, options.timeoutMs);
  const verification = await runVerification(graph, { runCommands: false });
  const passed = tests.status !== "failed" && verification.summary.passed;
  return { preflight, tests, verification, passed };
}
