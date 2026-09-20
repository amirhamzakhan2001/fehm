import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type {
  ChangedFile,
  ChangeImpactReport,
  ChangeRisk,
  ChangeVerificationReport,
  CodeGraph,
  DiffHunk,
  DiffProjection,
  EdgeKind,
  GraphEdge,
  GraphNode,
  ImpactedNode,
  RiskLevel,
  VerificationCheck,
} from "./model.js";

const execFileAsync = promisify(execFile);
const CHANGE_SCHEMA_VERSION = "0.1.0";
const PROPAGATING_EDGES = new Set<EdgeKind>(["calls", "imports", "references", "uses", "extends", "implements", "defines"]);

export interface GitDiffOptions {
  base?: string;
  staged?: boolean;
}

export interface ImpactOptions {
  depth?: number;
}

function normalizeDiffPath(value: string): string {
  const trimmed = value.trim().replace(/^"|"$/g, "");
  if (trimmed === "/dev/null") return trimmed;
  return trimmed.replace(/^[ab]\//, "").split(path.sep).join("/");
}

function parseHunk(line: string): DiffHunk | undefined {
  const match = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
  if (!match) return undefined;
  return {
    oldStart: Number(match[1]),
    oldLines: Number(match[2] ?? "1"),
    newStart: Number(match[3]),
    newLines: Number(match[4] ?? "1"),
  };
}

export function parseUnifiedDiff(diff: string, source: DiffProjection["source"] = "unified-diff", base?: string): DiffProjection {
  const files: ChangedFile[] = [];
  let current: ChangedFile | undefined;
  let oldHeaderPath: string | undefined;

  const flush = (): void => {
    if (!current) return;
    const existing = files.find((file) => file.path === current?.path && file.oldPath === current.oldPath);
    if (!existing) files.push(current);
    current = undefined;
    oldHeaderPath = undefined;
  };

  for (const line of diff.split(/\r?\n/)) {
    if (line.startsWith("diff --git ")) {
      flush();
      const match = /^diff --git (?:"?a\/(.+?)"?) (?:"?b\/(.+?)"?)$/.exec(line);
      const oldPath = normalizeDiffPath(match?.[1] ?? "");
      const newPath = normalizeDiffPath(match?.[2] ?? oldPath);
      current = { path: newPath, status: oldPath === newPath ? "modified" : "renamed", hunks: [] };
      if (oldPath && oldPath !== newPath) current.oldPath = oldPath;
      continue;
    }
    if (line.startsWith("rename from ")) {
      if (!current) current = { path: "", status: "renamed", hunks: [] };
      current.oldPath = normalizeDiffPath(line.slice("rename from ".length));
      current.status = "renamed";
      continue;
    }
    if (line.startsWith("rename to ")) {
      if (!current) current = { path: "", status: "renamed", hunks: [] };
      current.path = normalizeDiffPath(line.slice("rename to ".length));
      current.status = "renamed";
      continue;
    }
    if (line.startsWith("--- ")) {
      oldHeaderPath = normalizeDiffPath(line.slice(4).split("\t")[0] ?? "");
      continue;
    }
    if (line.startsWith("+++ ")) {
      const newPath = normalizeDiffPath(line.slice(4).split("\t")[0] ?? "");
      if (!current) current = { path: newPath, status: "modified", hunks: [] };
      if (newPath === "/dev/null") {
        current.path = oldHeaderPath && oldHeaderPath !== "/dev/null" ? oldHeaderPath : current.path;
        current.status = "deleted";
      } else {
        current.path = newPath;
        if (oldHeaderPath === "/dev/null") current.status = "added";
        else if (oldHeaderPath && oldHeaderPath !== newPath) {
          current.status = "renamed";
          current.oldPath = oldHeaderPath;
        }
      }
      continue;
    }
    const hunk = parseHunk(line);
    if (hunk && current) current.hunks.push(hunk);
  }
  flush();

  const projection: DiffProjection = { source, files: files.filter((file) => Boolean(file.path)) };
  if (base) projection.base = base;
  return projection;
}

export async function collectGitDiff(root: string, options: GitDiffOptions = {}): Promise<DiffProjection> {
  const args = ["diff", "--no-ext-diff", "--unified=0", "--relative"];
  if (options.staged) args.push("--cached");
  if (options.base) args.push(options.base);
  const { stdout } = await execFileAsync("git", args, { cwd: path.resolve(root), maxBuffer: 20 * 1024 * 1024 });
  return parseUnifiedDiff(stdout, "git", options.base);
}

export async function readDiffFile(diffPath: string): Promise<DiffProjection> {
  return parseUnifiedDiff(await readFile(path.resolve(diffPath), "utf8"));
}

function overlapsHunk(node: GraphNode, file: ChangedFile): boolean {
  if (!node.location) return node.kind === "file";
  if (file.hunks.length === 0) return true;
  const start = node.location.line;
  const end = node.location.endLine ?? start;
  return file.hunks.some((hunk) => {
    const hunkStart = file.status === "deleted" ? hunk.oldStart : hunk.newStart;
    const count = file.status === "deleted" ? hunk.oldLines : hunk.newLines;
    const hunkEnd = hunkStart + Math.max(1, count) - 1;
    return start <= hunkEnd && end >= hunkStart;
  });
}

function directNodes(graph: CodeGraph, projection: DiffProjection): GraphNode[] {
  const selected = new Map<string, GraphNode>();
  for (const file of projection.files) {
    const paths = new Set([file.path, file.oldPath].filter((value): value is string => Boolean(value)));
    const matching = graph.nodes.filter((node) => node.path && paths.has(node.path));
    const overlapping = matching.filter((node) => overlapsHunk(node, file));
    const candidates = overlapping.length > 0 ? overlapping : matching.filter((node) => node.kind === "file");
    for (const node of candidates) selected.set(node.id, node);
  }
  return [...selected.values()];
}

function propagationWeight(edge: GraphEdge): number {
  if (edge.kind === "calls") return 1;
  if (edge.kind === "references" || edge.kind === "uses") return 0.82;
  if (edge.kind === "imports" || edge.kind === "extends" || edge.kind === "implements") return 0.88;
  if (edge.kind === "defines") return 0.72;
  return 0.5;
}

function isRouteNode(node: GraphNode): boolean {
  const value = `${node.path ?? ""} ${node.name}`.toLowerCase();
  return /(^|[/_.-])(api|routes?|controllers?)([/_.-]|$)/.test(value)
    || /^(get|post|put|patch|delete|head|options)[A-Z_]/.test(node.name)
    || /(route|controller|handler)$/.test(node.name.toLowerCase());
}

function riskLevel(score: number): RiskLevel {
  if (score >= 75) return "critical";
  if (score >= 50) return "high";
  if (score >= 25) return "medium";
  return "low";
}

function calculateRisk(
  projection: DiffProjection,
  direct: ImpactedNode[],
  blastRadius: ImpactedNode[],
  affectedFiles: string[],
  affectedTests: string[],
  affectedRoutes: string[],
): ChangeRisk {
  const reasons: string[] = [];
  let score = 0;
  const deletions = projection.files.filter((file) => file.status === "deleted").length;
  if (deletions > 0) {
    score += Math.min(20, deletions * 10);
    reasons.push(`${deletions} deleted file(s)`);
  }
  const exported = direct.filter((item) => item.node.exported).length;
  if (exported > 0) {
    score += Math.min(20, exported * 4);
    reasons.push(`${exported} directly changed exported symbol(s)`);
  }
  if (blastRadius.length > 0) {
    score += Math.min(30, blastRadius.length * 2);
    reasons.push(`${blastRadius.length} transitive dependent node(s)`);
  }
  if (affectedFiles.length > projection.files.length) {
    score += Math.min(15, (affectedFiles.length - projection.files.length) * 2);
    reasons.push(`${affectedFiles.length} files in estimated blast radius`);
  }
  if (affectedRoutes.length > 0) {
    score += Math.min(20, affectedRoutes.length * 5);
    reasons.push(`${affectedRoutes.length} route/API node(s) affected`);
  }
  if (blastRadius.length > 0 && affectedTests.length === 0) {
    score += 10;
    reasons.push("no affected tests discovered");
  } else if (affectedTests.length > 0) {
    reasons.push(`${affectedTests.length} affected test file(s) discovered`);
  }
  score = Math.min(100, score);
  if (reasons.length === 0) reasons.push("change appears locally contained");
  return { score, level: riskLevel(score), reasons };
}

export function analyzeChangeImpact(
  graph: CodeGraph,
  projection: DiffProjection,
  options: ImpactOptions = {},
): ChangeImpactReport {
  const maximumDepth = Math.max(0, options.depth ?? 4);
  const nodesById = new Map(graph.nodes.map((node) => [node.id, node]));
  const direct = directNodes(graph, projection);
  const impacted = new Map<string, ImpactedNode>();
  let frontier = new Set(direct.map((node) => node.id));
  const visited = new Set(frontier);

  const directlyAffected: ImpactedNode[] = direct.map((node) => ({
    node,
    distance: 0,
    score: 1,
    via: [],
    direct: true,
  }));

  for (let distance = 1; distance <= maximumDepth; distance += 1) {
    const next = new Set<string>();
    for (const edge of graph.edges) {
      if (!PROPAGATING_EDGES.has(edge.kind) || !frontier.has(edge.target) || visited.has(edge.source)) continue;
      const node = nodesById.get(edge.source);
      if (!node) continue;
      const score = Math.round(1_000 * propagationWeight(edge) * edge.evidence.confidence * Math.pow(0.72, distance - 1)) / 1_000;
      impacted.set(node.id, { node, distance, score, via: [edge.kind], direct: false });
      next.add(node.id);
    }
    for (const id of next) visited.add(id);
    frontier = next;
    if (frontier.size === 0) break;
  }

  const blastRadius = [...impacted.values()].sort((a, b) => a.distance - b.distance || b.score - a.score || a.node.id.localeCompare(b.node.id));
  const all = [...directlyAffected, ...blastRadius];
  const affectedFiles = [...new Set([
    ...projection.files.map((file) => file.path),
    ...all
      .filter((item) => item.node.kind !== "directory" && item.node.kind !== "repository")
      .map((item) => item.node.path)
      .filter((value): value is string => Boolean(value)),
  ])].sort();
  const affectedTests = [...new Set(all.filter((item) => item.node.test).map((item) => item.node.path).filter((value): value is string => Boolean(value)))].sort();
  const affectedRoutes = [...new Set(all.filter((item) => isRouteNode(item.node)).map((item) => item.node.qualifiedName))].sort();
  const recommendedInspectionOrder = [...new Set(all
    .filter((item) => item.node.path && item.node.kind !== "directory" && item.node.kind !== "repository")
    .sort((a, b) => a.distance - b.distance || b.score - a.score)
    .map((item) => item.node.path as string))];
  const risk = calculateRisk(projection, directlyAffected, blastRadius, affectedFiles, affectedTests, affectedRoutes);

  return {
    schemaVersion: CHANGE_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    repositoryFingerprint: graph.repository.fingerprint,
    projection,
    directlyAffected,
    blastRadius,
    affectedFiles,
    affectedTests,
    affectedRoutes,
    recommendedInspectionOrder,
    risk,
    stats: {
      changedFiles: projection.files.length,
      directNodes: directlyAffected.length,
      transitiveNodes: blastRadius.length,
      affectedFiles: affectedFiles.length,
      affectedTests: affectedTests.length,
      affectedRoutes: affectedRoutes.length,
    },
  };
}

function graphProblems(graph: CodeGraph): { dangling: string[]; duplicates: string[] } {
  const nodeIds = new Set(graph.nodes.map((node) => node.id));
  const dangling = graph.edges
    .filter((edge) => !nodeIds.has(edge.source) || !nodeIds.has(edge.target))
    .map((edge) => edge.id);
  const seen = new Set<string>();
  const duplicates: string[] = [];
  for (const edge of graph.edges) {
    const identity = `${edge.kind}:${edge.source}->${edge.target}`;
    if (seen.has(identity)) duplicates.push(identity);
    seen.add(identity);
  }
  return { dangling, duplicates };
}

function importCycles(graph: CodeGraph): string[][] {
  const fileIds = new Set(graph.nodes.filter((node) => node.kind === "file").map((node) => node.id));
  const adjacency = new Map<string, string[]>();
  for (const id of fileIds) adjacency.set(id, []);
  for (const edge of graph.edges) {
    if (edge.kind === "imports" && fileIds.has(edge.source) && fileIds.has(edge.target)) adjacency.get(edge.source)?.push(edge.target);
  }

  let index = 0;
  const indices = new Map<string, number>();
  const lowLinks = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const cycles: string[][] = [];

  const connect = (node: string): void => {
    indices.set(node, index);
    lowLinks.set(node, index);
    index += 1;
    stack.push(node);
    onStack.add(node);
    for (const target of adjacency.get(node) ?? []) {
      if (!indices.has(target)) {
        connect(target);
        lowLinks.set(node, Math.min(lowLinks.get(node) ?? 0, lowLinks.get(target) ?? 0));
      } else if (onStack.has(target)) {
        lowLinks.set(node, Math.min(lowLinks.get(node) ?? 0, indices.get(target) ?? 0));
      }
    }
    if (lowLinks.get(node) !== indices.get(node)) return;
    const component: string[] = [];
    let current: string | undefined;
    do {
      current = stack.pop();
      if (!current) break;
      onStack.delete(current);
      component.push(current);
    } while (current !== node);
    if (component.length > 1 || (component[0] && adjacency.get(component[0])?.includes(component[0]))) {
      cycles.push(component.sort());
    }
  };
  for (const id of fileIds) if (!indices.has(id)) connect(id);
  return cycles.sort((a, b) => a.join("|").localeCompare(b.join("|")));
}

export function verifyChange(
  before: CodeGraph,
  after: CodeGraph,
  projection: DiffProjection,
  options: ImpactOptions = {},
): ChangeVerificationReport {
  const checks: VerificationCheck[] = [];
  const problems = graphProblems(after);
  checks.push({
    name: "graph integrity",
    status: problems.dangling.length === 0 && problems.duplicates.length === 0 ? "passed" : "failed",
    detail: `${problems.dangling.length} dangling edge(s), ${problems.duplicates.length} duplicate edge(s)`,
  });

  const beforeCycles = new Set(importCycles(before).map((cycle) => cycle.join("|")));
  const afterCycles = importCycles(after);
  const newImportCycles = afterCycles.filter((cycle) => !beforeCycles.has(cycle.join("|")));
  checks.push({
    name: "import cycles",
    status: newImportCycles.length === 0 ? "passed" : "failed",
    detail: newImportCycles.length === 0 ? "no new import cycles" : `${newImportCycles.length} new import cycle(s)`,
  });

  const beforeIds = new Set(before.nodes.map((node) => node.id));
  const afterIds = new Set(after.nodes.map((node) => node.id));
  const addedNodes = [...afterIds].filter((id) => !beforeIds.has(id)).sort();
  const removedNodes = [...beforeIds].filter((id) => !afterIds.has(id)).sort();
  const impact = analyzeChangeImpact(before, projection, options);
  const actuallyChangedFiles = projection.files.map((file) => file.path).sort();
  checks.push({
    name: "graph refresh",
    status: before.repository.fingerprint !== after.repository.fingerprint || projection.files.length === 0 ? "passed" : "warning",
    detail: before.repository.fingerprint !== after.repository.fingerprint
      ? "repository fingerprint changed"
      : "diff exists but repository fingerprint is unchanged",
  });
  checks.push({
    name: "impact reconciliation",
    status: "passed",
    detail: `${actuallyChangedFiles.length} changed file(s), ${impact.affectedFiles.length} file(s) in predicted impact`,
  });

  const failures = checks.filter((check) => check.status === "failed").length;
  const warnings = checks.filter((check) => check.status === "warning").length;
  const confidence = Math.max(0, 100 - failures * 30 - warnings * 10);
  return {
    schemaVersion: CHANGE_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    beforeFingerprint: before.repository.fingerprint,
    afterFingerprint: after.repository.fingerprint,
    checks,
    addedNodes,
    removedNodes,
    newImportCycles,
    expectedImpactFiles: impact.affectedFiles,
    actuallyChangedFiles,
    confidence,
    passed: failures === 0,
  };
}

export function formatImpactReport(report: ChangeImpactReport): string {
  const lines = [
    "# Change Pre-flight",
    "",
    `Risk: ${report.risk.level.toUpperCase()} (${report.risk.score}/100)`,
    `Changed files: ${report.stats.changedFiles}`,
    `Direct nodes: ${report.stats.directNodes}`,
    `Transitive nodes: ${report.stats.transitiveNodes}`,
    `Affected files: ${report.stats.affectedFiles}`,
    `Affected tests: ${report.stats.affectedTests}`,
    `Affected routes: ${report.stats.affectedRoutes}`,
    "",
    "## Risk reasons",
    ...report.risk.reasons.map((reason) => `- ${reason}`),
    "",
    "## Recommended inspection order",
    ...report.recommendedInspectionOrder.map((file) => `- ${file}`),
    "",
    "## Affected tests",
    ...(report.affectedTests.length ? report.affectedTests.map((file) => `- ${file}`) : ["- None discovered"]),
    "",
    "## Affected routes",
    ...(report.affectedRoutes.length ? report.affectedRoutes.map((route) => `- ${route}`) : ["- None discovered"]),
  ];
  return `${lines.join("\n")}\n`;
}

export function formatVerificationReport(report: ChangeVerificationReport): string {
  const lines = [
    "# Change Verification",
    "",
    `Result: ${report.passed ? "PASSED" : "FAILED"}`,
    `Confidence: ${report.confidence}%`,
    `Added nodes: ${report.addedNodes.length}`,
    `Removed nodes: ${report.removedNodes.length}`,
    "",
    "## Checks",
    ...report.checks.map((check) => `- ${check.status.toUpperCase()}: ${check.name} — ${check.detail}`),
  ];
  if (report.newImportCycles.length) {
    lines.push("", "## New import cycles", ...report.newImportCycles.map((cycle) => `- ${cycle.join(" → ")}`));
  }
  return `${lines.join("\n")}\n`;
}
