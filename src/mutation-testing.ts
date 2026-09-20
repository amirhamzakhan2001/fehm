import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { access, cp, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import ts from "typescript";
import type { CodeGraph, MutationCandidate, MutationResult, MutationTestingReport } from "./model.js";
import { atomicWriteJson } from "./persistence.js";

const execFileAsync = promisify(execFile);

export interface MutationTestingOptions {
  limit?: number;
  timeoutMs?: number;
}

export async function readLatestMutationReport(graph: CodeGraph): Promise<MutationTestingReport | undefined> {
  try { return JSON.parse(await readFile(path.join(graph.repository.root, ".fehm", "mutations", "latest.json"), "utf8")) as MutationTestingReport; }
  catch { return undefined; }
}

function lineAndColumn(source: ts.SourceFile, offset: number): { line: number; column: number } {
  const value = source.getLineAndCharacterOfPosition(offset);
  return { line: value.line + 1, column: value.character + 1 };
}

function ownerNode(graph: CodeGraph, filePath: string, line: number): string | undefined {
  return graph.nodes.filter((node) => node.path === filePath && node.location && node.location.line <= line && (node.location.endLine ?? node.location.line) >= line)
    .sort((left, right) => ((left.location?.endLine ?? 0) - (left.location?.line ?? 0)) - ((right.location?.endLine ?? 0) - (right.location?.line ?? 0)))[0]?.id;
}

function candidate(graph: CodeGraph, source: ts.SourceFile, filePath: string, node: ts.Node, operator: MutationCandidate["operator"], replacement: string, description: string): MutationCandidate {
  const start = node.getStart(source); const end = node.getEnd(); const location = lineAndColumn(source, start); const original = source.text.slice(start, end);
  const id = createHash("sha256").update(`${filePath}:${start}:${original}:${replacement}`).digest("hex").slice(0, 16);
  const nodeId = ownerNode(graph, filePath, location.line);
  return { id, path: filePath, line: location.line, column: location.column, start, end, operator, original, replacement, description, ...(nodeId ? { nodeId } : {}) };
}

function obviouslyStringLike(node: ts.Expression): boolean {
  return ts.isStringLiteralLike(node) || ts.isTemplateExpression(node)
    || ts.isNoSubstitutionTemplateLiteral(node)
    || ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken && (obviouslyStringLike(node.left) || obviouslyStringLike(node.right));
}

function syntaxErrors(filePath: string, content: string): string[] {
  const result = ts.transpileModule(content, {
    fileName: filePath,
    reportDiagnostics: true,
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX },
  });
  return (result.diagnostics ?? []).filter((item) => item.category === ts.DiagnosticCategory.Error).map((item) => ts.flattenDiagnosticMessageText(item.messageText, "\n"));
}

export async function buildMutationPlan(graph: CodeGraph): Promise<MutationCandidate[]> {
  const result: MutationCandidate[] = [];
  const binaryReplacements = new Map<ts.SyntaxKind, { replacement: string; operator: MutationCandidate["operator"]; description: string }>([
    [ts.SyntaxKind.GreaterThanToken, { replacement: ">=", operator: "conditional-boundary", description: "include the greater-than boundary" }],
    [ts.SyntaxKind.GreaterThanEqualsToken, { replacement: ">", operator: "conditional-boundary", description: "exclude the greater-than boundary" }],
    [ts.SyntaxKind.LessThanToken, { replacement: "<=", operator: "conditional-boundary", description: "include the less-than boundary" }],
    [ts.SyntaxKind.LessThanEqualsToken, { replacement: "<", operator: "conditional-boundary", description: "exclude the less-than boundary" }],
    [ts.SyntaxKind.EqualsEqualsEqualsToken, { replacement: "!==", operator: "equality", description: "invert strict equality" }],
    [ts.SyntaxKind.ExclamationEqualsEqualsToken, { replacement: "===", operator: "equality", description: "invert strict inequality" }],
    [ts.SyntaxKind.EqualsEqualsToken, { replacement: "!=", operator: "equality", description: "invert equality" }],
    [ts.SyntaxKind.ExclamationEqualsToken, { replacement: "==", operator: "equality", description: "invert inequality" }],
    [ts.SyntaxKind.AmpersandAmpersandToken, { replacement: "||", operator: "logical", description: "replace logical AND with OR" }],
    [ts.SyntaxKind.BarBarToken, { replacement: "&&", operator: "logical", description: "replace logical OR with AND" }],
    [ts.SyntaxKind.PlusToken, { replacement: "-", operator: "arithmetic", description: "replace addition with subtraction" }],
    [ts.SyntaxKind.MinusToken, { replacement: "+", operator: "arithmetic", description: "replace subtraction with addition" }],
    [ts.SyntaxKind.AsteriskToken, { replacement: "/", operator: "arithmetic", description: "replace multiplication with division" }],
    [ts.SyntaxKind.SlashToken, { replacement: "*", operator: "arithmetic", description: "replace division with multiplication" }],
  ]);
  for (const file of graph.nodes.filter((node) => node.kind === "file" && node.path && !node.test)) {
    let content: string; try { content = await readFile(path.join(graph.repository.root, file.path as string), "utf8"); } catch { continue; }
    const kind = /\.[cm]?tsx?$/.test(file.path as string) ? ts.ScriptKind.TSX : /\.jsx?$/.test(file.path as string) ? ts.ScriptKind.JSX : ts.ScriptKind.Unknown;
    const source = ts.createSourceFile(file.path as string, content, ts.ScriptTarget.Latest, true, kind);
    const visit = (node: ts.Node): void => {
      if (ts.isBinaryExpression(node)) {
        const replacement = binaryReplacements.get(node.operatorToken.kind);
        const invalidArithmetic = node.operatorToken.kind === ts.SyntaxKind.PlusToken && (obviouslyStringLike(node.left) || obviouslyStringLike(node.right));
        if (replacement && !invalidArithmetic) result.push(candidate(graph, source, file.path as string, node.operatorToken, replacement.operator, replacement.replacement, replacement.description));
      } else if (node.kind === ts.SyntaxKind.TrueKeyword || node.kind === ts.SyntaxKind.FalseKeyword) {
        result.push(candidate(graph, source, file.path as string, node, "boolean-literal", node.kind === ts.SyntaxKind.TrueKeyword ? "false" : "true", "invert boolean literal"));
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return [...new Map(result.map((item) => [item.id, item])).values()].sort((left, right) => left.path.localeCompare(right.path) || left.start - right.start);
}

async function exists(candidatePath: string): Promise<boolean> {
  try { await access(candidatePath); return true; } catch { return false; }
}

async function testCommand(root: string): Promise<string[] | undefined> {
  let scripts: Record<string, string> | undefined;
  try { scripts = (JSON.parse(await readFile(path.join(root, "package.json"), "utf8")) as { scripts?: Record<string, string> }).scripts; } catch { return undefined; }
  if (!scripts?.test) return undefined;
  if (await exists(path.join(root, "pnpm-lock.yaml"))) return ["pnpm", "run", "test"];
  if (await exists(path.join(root, "yarn.lock"))) return ["yarn", "run", "test"];
  if (await exists(path.join(root, "bun.lock")) || await exists(path.join(root, "bun.lockb"))) return ["bun", "run", "test"];
  return ["npm", "run", "test"];
}

async function execute(command: string[], root: string, timeoutMs: number): Promise<{ status: "passed" | "failed" | "timeout" | "error"; durationMs: number; exitCode?: number; output: string }> {
  const started = Date.now();
  const environment: NodeJS.ProcessEnv = { ...process.env, CI: "1" };
  delete environment.NODE_TEST_CONTEXT;
  try {
    const value = await execFileAsync(command[0] as string, command.slice(1), { cwd: root, timeout: timeoutMs, maxBuffer: 2 * 1024 * 1024, env: environment });
    return { status: "passed", durationMs: Date.now() - started, exitCode: 0, output: `${value.stdout}${value.stderr}`.slice(-20_000) };
  } catch (error) {
    const value = error as Error & { code?: number | string; stdout?: string; stderr?: string; killed?: boolean; signal?: string };
    const output = `${value.stdout ?? ""}${value.stderr ?? ""}${value.message}`.slice(-20_000);
    if (value.killed || value.signal === "SIGTERM") return { status: "timeout", durationMs: Date.now() - started, output };
    if (typeof value.code === "number") return { status: "failed", durationMs: Date.now() - started, exitCode: value.code, output };
    return { status: "error", durationMs: Date.now() - started, output };
  }
}

async function persist(graph: CodeGraph, report: MutationTestingReport): Promise<void> {
  await atomicWriteJson(path.join(graph.repository.root, ".fehm", "mutations", "latest.json"), report);
}

export async function runMutationTesting(graph: CodeGraph, options: MutationTestingOptions = {}): Promise<MutationTestingReport> {
  const plan = await buildMutationPlan(graph); const limit = Math.max(1, Math.min(500, options.limit ?? 25)); const selected = plan.slice(0, limit); const command = await testCommand(graph.repository.root);
  if (!command) {
    const report: MutationTestingReport = { generatedAt: new Date().toISOString(), repositoryFingerprint: graph.repository.fingerprint, baseline: { status: "unavailable", durationMs: 0, output: "No supported test script was detected." }, candidates: plan.length, executed: 0, killed: 0, survived: 0, timedOut: 0, errors: 0, score: 0, results: [], unexecuted: plan };
    await persist(graph, report); return report;
  }
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "fehm-mutation-")); const workspace = path.join(temporaryRoot, "repository"); const timeoutMs = Math.max(1_000, options.timeoutMs ?? 120_000);
  try {
    const excluded = new Set([".git", ".fehm", "node_modules", "coverage", "dist", "build"]);
    await cp(graph.repository.root, workspace, { recursive: true, filter: (source) => !path.relative(graph.repository.root, source).split(path.sep).some((segment) => excluded.has(segment)) });
    const modules = path.join(graph.repository.root, "node_modules"); if (await exists(modules)) await symlink(modules, path.join(workspace, "node_modules"), "dir");
    const baselineRun = await execute(command, workspace, timeoutMs);
    const baseline: MutationTestingReport["baseline"] = { status: baselineRun.status === "error" ? "failed" : baselineRun.status, durationMs: baselineRun.durationMs, ...(baselineRun.exitCode !== undefined ? { exitCode: baselineRun.exitCode } : {}), output: baselineRun.output };
    if (baseline.status !== "passed") {
      const report: MutationTestingReport = { generatedAt: new Date().toISOString(), repositoryFingerprint: graph.repository.fingerprint, testCommand: command, baseline, candidates: plan.length, executed: 0, killed: 0, survived: 0, timedOut: 0, errors: 0, score: 0, results: [], unexecuted: plan };
      await persist(graph, report); return report;
    }
    const results: MutationResult[] = [];
    for (const mutation of selected) {
      const target = path.join(workspace, mutation.path); const originalContent = await readFile(target, "utf8");
      const mutated = `${originalContent.slice(0, mutation.start)}${mutation.replacement}${originalContent.slice(mutation.end)}`;
      const diagnostics = syntaxErrors(mutation.path, mutated);
      if (diagnostics.length) {
        results.push({ ...mutation, status: "error", durationMs: 0, output: `Invalid mutant: ${diagnostics.join("; ")}`.slice(0, 20_000) });
        continue;
      }
      await writeFile(target, mutated, "utf8");
      const run = await execute(command, workspace, timeoutMs);
      await writeFile(target, originalContent, "utf8");
      const status: MutationResult["status"] = run.status === "passed" ? "survived" : run.status === "failed" ? "killed" : run.status;
      results.push({ ...mutation, status, durationMs: run.durationMs, ...(run.exitCode !== undefined ? { exitCode: run.exitCode } : {}), output: run.output });
    }
    const killed = results.filter((item) => item.status === "killed").length; const survived = results.filter((item) => item.status === "survived").length; const denominator = killed + survived;
    const report: MutationTestingReport = {
      generatedAt: new Date().toISOString(), repositoryFingerprint: graph.repository.fingerprint, testCommand: command, baseline, candidates: plan.length, executed: results.length,
      killed, survived, timedOut: results.filter((item) => item.status === "timeout").length, errors: results.filter((item) => item.status === "error").length,
      score: denominator ? Math.round(killed / denominator * 1_000) / 10 : 0, results, unexecuted: plan.slice(selected.length),
    };
    await persist(graph, report); return report;
  } finally { await rm(temporaryRoot, { recursive: true, force: true }); }
}
