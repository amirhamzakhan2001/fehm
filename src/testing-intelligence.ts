import { execFile } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { analyzeChangeImpact } from "./change.js";
import type { CodeGraph, CoverageFileRecord, CoverageIntelligenceReport, DiffProjection, GraphNode, SelectedTestRun, TestQualityReport } from "./model.js";

const execFileAsync = promisify(execFile);

async function exists(filePath: string): Promise<boolean> {
  try { await access(filePath); return true; } catch { return false; }
}

function testProtectedIds(graph: CodeGraph): Set<string> {
  const testIds = new Set(graph.nodes.filter((node) => node.test).map((node) => node.id));
  let frontier = new Set(testIds);
  const protectedIds = new Set(testIds);
  for (let depth = 0; depth < 6; depth += 1) {
    const next = new Set<string>();
    for (const edge of graph.edges) {
      if (!frontier.has(edge.source) || !["calls", "imports", "references", "uses", "defines"].includes(edge.kind)) continue;
      if (!protectedIds.has(edge.target)) next.add(edge.target);
      protectedIds.add(edge.target);
    }
    frontier = next;
  }
  return protectedIds;
}

function percentage(value: unknown): number {
  if (typeof value === "number") return Math.max(0, Math.min(100, value));
  if (value && typeof value === "object" && "pct" in value && typeof value.pct === "number") return Math.max(0, Math.min(100, value.pct));
  return 0;
}

export async function buildCoverageIntelligence(graph: CodeGraph, explicitPath?: string): Promise<CoverageIntelligenceReport> {
  const root = path.resolve(graph.repository.root);
  const candidates = explicitPath ? [path.resolve(explicitPath)] : [path.join(root, "coverage", "coverage-summary.json"), path.join(root, "coverage-summary.json")];
  const source = await Promise.all(candidates.map(async (candidate) => await exists(candidate) ? candidate : undefined)).then((items) => items.find(Boolean));
  const protectedIds = testProtectedIds(graph);
  const symbols = graph.nodes.filter((node) => ["function", "method", "class"].includes(node.kind));
  const unprotectedSymbols = symbols.filter((node) => !protectedIds.has(node.id));
  const files: CoverageFileRecord[] = [];
  let overall = { statements: 0, branches: 0, functions: 0, lines: 0 };
  if (source) {
    const raw = JSON.parse(await readFile(source, "utf8")) as Record<string, Record<string, unknown>>;
    for (const [filePath, metrics] of Object.entries(raw)) {
      const record = {
        path: filePath === "total" ? "total" : path.relative(root, filePath).split(path.sep).join("/"),
        statements: percentage(metrics.statements), branches: percentage(metrics.branches), functions: percentage(metrics.functions), lines: percentage(metrics.lines),
        source: "coverage-artifact" as const,
      };
      if (filePath === "total") overall = { statements: record.statements, branches: record.branches, functions: record.functions, lines: record.lines };
      else files.push(record);
    }
  } else {
    const byFile = new Map<string, GraphNode[]>();
    for (const node of symbols) if (node.path) byFile.set(node.path, [...(byFile.get(node.path) ?? []), node]);
    for (const [filePath, nodes] of byFile) {
      const covered = nodes.filter((node) => protectedIds.has(node.id)).length / Math.max(1, nodes.length) * 100;
      files.push({ path: filePath, statements: Math.round(covered), branches: 0, functions: Math.round(covered), lines: 0, source: "static-test-graph" });
    }
    const protectedSymbolCount = symbols.filter((node) => protectedIds.has(node.id)).length;
    overall = { statements: 0, branches: 0, functions: Math.round(protectedSymbolCount / Math.max(1, symbols.length) * 100), lines: 0 };
  }
  const fanIn = new Map<string, number>();
  for (const edge of graph.edges) fanIn.set(edge.target, (fanIn.get(edge.target) ?? 0) + 1);
  const criticalGaps = unprotectedSymbols.filter((node) => node.exported || (fanIn.get(node.id) ?? 0) >= 3).sort((a, b) => (fanIn.get(b.id) ?? 0) - (fanIn.get(a.id) ?? 0)).slice(0, 50).map((node) => ({ node, reason: `${node.exported ? "exported" : "high fan-in"} symbol has no reachable test relationship` }));
  return {
    available: Boolean(source),
    ...(source ? { source } : {}),
    overall,
    files: files.sort((a, b) => a.path.localeCompare(b.path)),
    protectedSymbols: symbols.length - unprotectedSymbols.length,
    unprotectedSymbols,
    criticalGaps,
    confidence: source ? 98 : 68,
  };
}

export function selectAffectedTests(graph: CodeGraph, projection: DiffProjection): string[] {
  return analyzeChangeImpact(graph, projection, { depth: 8 }).affectedTests;
}

async function packageRunner(root: string): Promise<{ executable: string; args: string[] } | undefined> {
  let manifest: { scripts?: Record<string, string> };
  try { manifest = JSON.parse(await readFile(path.join(root, "package.json"), "utf8")) as { scripts?: Record<string, string> }; } catch { return undefined; }
  if (!manifest.scripts?.test) return undefined;
  if (await exists(path.join(root, "pnpm-lock.yaml"))) return { executable: "pnpm", args: ["test", "--"] };
  if (await exists(path.join(root, "yarn.lock"))) return { executable: "yarn", args: ["test"] };
  if (await exists(path.join(root, "bun.lockb")) || await exists(path.join(root, "bun.lock"))) return { executable: "bun", args: ["test", "--"] };
  return { executable: "npm", args: ["test", "--"] };
}

export async function runSelectedTests(graph: CodeGraph, projection: DiffProjection, timeoutMs = 120_000): Promise<SelectedTestRun> {
  const selectedTests = selectAffectedTests(graph, projection);
  const runner = await packageRunner(graph.repository.root);
  if (!selectedTests.length || !runner) return { selectedTests, status: "skipped", durationMs: 0, output: selectedTests.length ? "No supported test script was detected." : "No affected tests were discovered." };
  const started = Date.now();
  const args = [...runner.args, ...selectedTests];
  try {
    const value = await execFileAsync(runner.executable, args, { cwd: graph.repository.root, timeout: timeoutMs, maxBuffer: 2 * 1024 * 1024, env: { ...process.env, CI: "1" } });
    return { selectedTests, command: `${runner.executable} ${args.join(" ")}`, status: "passed", exitCode: 0, durationMs: Date.now() - started, output: `${value.stdout}${value.stderr}`.slice(-20_000) };
  } catch (error) {
    const value = error as Error & { code?: number; stdout?: string; stderr?: string };
    return { selectedTests, command: `${runner.executable} ${args.join(" ")}`, status: "failed", exitCode: typeof value.code === "number" ? value.code : 1, durationMs: Date.now() - started, output: `${value.stdout ?? ""}${value.stderr ?? ""}${value.message}`.slice(-20_000) };
  }
}

export async function buildTestQuality(graph: CodeGraph): Promise<TestQualityReport> {
  const coverage = await buildCoverageIntelligence(graph);
  const files: TestQualityReport["files"] = [];
  for (const node of graph.nodes.filter((item) => item.kind === "file" && item.test && item.path)) {
    let content: string; try { content = await readFile(path.join(graph.repository.root, node.path as string), "utf8"); } catch { continue; }
    const tests = (content.match(/\b(?:it|test)\s*\(/g) ?? []).length;
    const assertions = (content.match(/\b(?:expect|assert(?:\.|\()|should\.)/g) ?? []).length;
    const skipped = (content.match(/\b(?:it|test|describe)\.(?:skip|todo)\s*\(/g) ?? []).length;
    const focused = (content.match(/\b(?:it|test|describe)\.only\s*\(/g) ?? []).length;
    const mocks = (content.match(/\b(?:mock|stub|spyOn|vi\.fn|jest\.fn)\s*\(/g) ?? []).length;
    const isolation = /\b(?:beforeEach|afterEach)\s*\(/.test(content);
    const importedProduction = graph.edges.filter((edge) => edge.source === node.id && edge.kind === "imports").map((edge) => graph.nodes.find((item) => item.id === edge.target)).filter((item) => item && !item.test).length;
    const assertionScore = Math.min(100, assertions / Math.max(1, tests) * 70 + (tests ? 30 : 0));
    const score = Math.round(Math.max(0, Math.min(100, assertionScore * 0.45 + Math.min(100, importedProduction * 25) * 0.25 + (isolation ? 85 : 45) * 0.15 + (focused ? 0 : 100) * 0.1 + (skipped ? Math.max(0, 100 - skipped * 20) : 100) * 0.05)));
    const strengths = [assertions >= tests && tests ? "at least one assertion per detected test" : "", isolation ? "explicit per-test isolation hooks" : "", importedProduction ? `covers ${importedProduction} production module(s)` : "", mocks ? "dependency boundaries are controlled with mocks/spies" : ""].filter(Boolean);
    const weaknesses = [!tests ? "no explicit test cases detected" : "", assertions < tests ? "some tests may have no assertion" : "", focused ? `${focused} focused test marker(s) can hide the rest of the suite` : "", skipped ? `${skipped} skipped/todo test(s)` : "", !importedProduction ? "no production module relationship detected" : ""].filter(Boolean);
    files.push({ path: node.path as string, score, tests, assertions, skipped, focused, mocks, productionSymbols: importedProduction, strengths, weaknesses });
  }
  const average = (selector: (file: TestQualityReport["files"][number]) => number): number => files.length ? Math.round(files.reduce((sum, file) => sum + selector(file), 0) / files.length) : 0;
  const dimensions = {
    assertions: average((file) => Math.min(100, file.assertions / Math.max(1, file.tests) * 100)),
    coverage: coverage.available ? Math.round((coverage.overall.functions + coverage.overall.branches) / 2) : Math.max(0, 100 - coverage.criticalGaps.length * 4),
    isolation: average((file) => file.strengths.some((item) => item.includes("isolation")) ? 100 : 45),
    reliability: average((file) => Math.max(0, 100 - file.skipped * 15 - file.focused * 40)),
    maintainability: average((file) => file.tests ? Math.min(100, 55 + file.mocks * 5 + file.productionSymbols * 8) : 20),
  };
  const score = Math.round(Object.values(dimensions).reduce((sum, value) => sum + value, 0) / Object.values(dimensions).length);
  const recommendations = [...new Set(files.flatMap((file) => file.weaknesses.map((item) => `${file.path}: ${item}`)))].slice(0, 50);
  return { score, files: files.sort((a, b) => a.score - b.score), dimensions, recommendations };
}
