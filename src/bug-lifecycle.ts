import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { buildHistoricalBugIntelligence } from "./code-risk-intelligence.js";
import type { BugCommandRun, BugFixVerificationReport, BugReproductionReport, CodeGraph } from "./model.js";
import { runMutationTesting } from "./mutation-testing.js";
import { runVerification } from "./verification.js";
import { atomicWriteJson } from "./persistence.js";

const execFileAsync = promisify(execFile);

export interface BugReproductionOptions { commit?: string; timeoutMs?: number }
export interface BugFixVerificationOptions extends BugReproductionOptions { mutationLimit?: number; runMutations?: boolean }

async function exists(candidate: string): Promise<boolean> {
  try { await readFile(candidate); return true; } catch { return false; }
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

async function execute(command: string[] | undefined, root: string, timeoutMs: number): Promise<BugCommandRun> {
  if (!command) return { status: "unavailable", durationMs: 0, output: "No supported test script was detected." };
  const started = Date.now(); const environment: NodeJS.ProcessEnv = { ...process.env, CI: "1" }; delete environment.NODE_TEST_CONTEXT;
  try {
    const value = await execFileAsync(command[0] as string, command.slice(1), { cwd: root, timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024, env: environment });
    return { status: "passed", durationMs: Date.now() - started, exitCode: 0, output: `${value.stdout}${value.stderr}`.slice(-40_000) };
  } catch (error) {
    const value = error as Error & { code?: number | string; stdout?: string; stderr?: string; killed?: boolean; signal?: string };
    const output = `${value.stdout ?? ""}${value.stderr ?? ""}${value.message}`.slice(-40_000);
    if (value.killed || value.signal === "SIGTERM") return { status: "timeout", durationMs: Date.now() - started, output };
    if (typeof value.code === "number") return { status: "failed", durationMs: Date.now() - started, exitCode: value.code, output };
    return { status: "error", durationMs: Date.now() - started, output };
  }
}

function signature(output: string): string[] {
  return [...new Set(output.replace(/\x1b\[[0-9;]*m/g, "").split(/\r?\n/).map((line) => line.trim())
    .filter((line) => /(?:AssertionError|Error:|not ok|FAIL|failed|Expected|actual|expected)/i.test(line) && line.length >= 4)
    .map((line) => line.replace(/\/[^\s:]+\/fehm-bug-[^\s:]+/g, "<workspace>").replace(/\b\d+(?:\.\d+)?ms\b/g, "<duration>").slice(0, 300))).values()].slice(0, 12);
}

async function git(root: string, args: string[]): Promise<string> {
  return (await execFileAsync("git", args, { cwd: root, maxBuffer: 10 * 1024 * 1024 })).stdout.trim();
}

async function persistReproduction(graph: CodeGraph, report: BugReproductionReport): Promise<void> {
  const safe = report.fixCommit.replace(/[^A-Za-z0-9_.-]/g, "-"); const destination = path.join(graph.repository.root, ".fehm", "bugs", "reproductions", `${safe}.json`);
  await atomicWriteJson(destination, report);
}

async function unavailable(graph: CodeGraph, commit: string, reason: string): Promise<BugReproductionReport> {
  const report: BugReproductionReport = { generatedAt: new Date().toISOString(), repositoryFingerprint: graph.repository.fingerprint, fixCommit: commit, changedFiles: [], suspectedNodeIds: [], buggyRun: { status: "unavailable", durationMs: 0, output: reason }, fixedRun: { status: "unavailable", durationMs: 0, output: reason }, status: "unavailable", failureSignature: [], evidence: [reason] };
  await persistReproduction(graph, report); return report;
}

export async function reproduceHistoricalBug(graph: CodeGraph, options: BugReproductionOptions = {}): Promise<BugReproductionReport> {
  const history = await buildHistoricalBugIntelligence(graph);
  const selected = options.commit ? history.commits.find((item) => item.hash === options.commit || item.hash.startsWith(options.commit as string)) : history.commits[0];
  const fixCommit = selected?.hash ?? options.commit ?? "unavailable";
  if (!history.historyAvailable) return unavailable(graph, fixCommit, history.error ?? "Git history is unavailable.");
  if (!selected && !options.commit) return unavailable(graph, fixCommit, "No bug-fix commit was discovered in Git history.");
  let parentCommit: string; let subject = selected?.subject; let changedFiles = selected?.files ?? [];
  try {
    parentCommit = await git(graph.repository.root, ["rev-parse", `${fixCommit}^`]);
    if (!subject) subject = await git(graph.repository.root, ["show", "-s", "--format=%s", fixCommit]);
    if (!changedFiles.length) changedFiles = (await git(graph.repository.root, ["diff", "--name-only", parentCommit, fixCommit])).split(/\r?\n/).filter(Boolean);
  } catch (error) { return unavailable(graph, fixCommit, `Unable to resolve fix commit and parent: ${error instanceof Error ? error.message : String(error)}`); }
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "fehm-bug-")); const workspace = path.join(temporaryRoot, "repository"); const timeoutMs = Math.max(1_000, options.timeoutMs ?? 120_000);
  try {
    await execFileAsync("git", ["clone", "--quiet", "--no-hardlinks", "--local", graph.repository.root, workspace], { maxBuffer: 10 * 1024 * 1024 });
    const modules = path.join(graph.repository.root, "node_modules");
    if (await exists(path.join(modules, ".package-lock.json")) || await exists(path.join(modules, "typescript", "package.json"))) await symlink(modules, path.join(workspace, "node_modules"), "dir");
    await git(workspace, ["checkout", "--quiet", "--detach", fixCommit]);
    const command = await testCommand(workspace);
    if (!command) return unavailable(graph, fixCommit, "The fix commit has no supported test script.");
    await git(workspace, ["checkout", "--quiet", "--detach", parentCommit]); const buggyRun = await execute(command, workspace, timeoutMs);
    await git(workspace, ["checkout", "--quiet", "--detach", fixCommit]); const fixedRun = await execute(command, workspace, timeoutMs);
    const status: BugReproductionReport["status"] = buggyRun.status === "failed" && fixedRun.status === "passed" ? "reproduced"
      : buggyRun.status === "passed" && fixedRun.status === "passed" ? "not-reproduced" : "inconclusive";
    const report: BugReproductionReport = {
      generatedAt: new Date().toISOString(), repositoryFingerprint: graph.repository.fingerprint, fixCommit, parentCommit, ...(subject ? { subject } : {}), changedFiles,
      suspectedNodeIds: graph.nodes.filter((node) => node.path && changedFiles.includes(node.path)).map((node) => node.id), testCommand: command, buggyRun, fixedRun, status,
      failureSignature: signature(buggyRun.output), evidence: [`parent ${parentCommit}: ${buggyRun.status}`, `fix ${fixCommit}: ${fixedRun.status}`, `${changedFiles.length} changed file(s) mapped to ${graph.nodes.filter((node) => node.path && changedFiles.includes(node.path)).length} graph node(s)`],
    };
    await persistReproduction(graph, report); return report;
  } catch (error) { return unavailable(graph, fixCommit, `Bug reproduction failed to prepare the isolated checkout: ${error instanceof Error ? error.message : String(error)}`); }
  finally { await rm(temporaryRoot, { recursive: true, force: true }); }
}

export async function verifyBugFix(graph: CodeGraph, options: BugFixVerificationOptions = {}): Promise<BugFixVerificationReport> {
  const reproduction = await reproduceHistoricalBug(graph, options); const timeoutMs = Math.max(1_000, options.timeoutMs ?? 120_000); const command = await testCommand(graph.repository.root);
  const [currentRun, verification] = await Promise.all([execute(command, graph.repository.root, timeoutMs), runVerification(graph, { runCommands: false })]);
  let changedFiles = reproduction.changedFiles;
  if (reproduction.parentCommit) try { changedFiles = (await git(graph.repository.root, ["diff", "--name-only", reproduction.parentCommit])).split(/\r?\n/).filter(Boolean); } catch { /* detached or shallow history */ }
  const regressionTests = changedFiles.filter((file) => /(?:^|\/)(?:test|tests|__tests__)(?:\/|$)|\.(?:test|spec)\.[cm]?[jt]sx?$/.test(file));
  const mutation = options.runMutations === false ? undefined : await runMutationTesting(graph, { limit: Math.max(1, Math.min(100, options.mutationLimit ?? 10)), timeoutMs });
  const criteria: BugFixVerificationReport["criteria"] = {
    reproducedBeforeFix: reproduction.status === "reproduced",
    currentTestsPass: currentRun.status === "passed",
    failureSignatureCleared: currentRun.status === "passed" && reproduction.failureSignature.every((item) => !currentRun.output.includes(item)),
    regressionTestEvidence: regressionTests.length > 0,
    staticVerificationPasses: verification.summary.passed,
    mutationGuardPasses: !mutation || mutation.baseline.status === "passed" && mutation.survived === 0 && mutation.timedOut === 0 && mutation.errors === 0,
  };
  const failures = Object.entries(criteria).filter(([, passed]) => !passed).map(([name]) => name.replace(/([A-Z])/g, " $1").toLowerCase());
  const report: BugFixVerificationReport = { generatedAt: new Date().toISOString(), repositoryFingerprint: graph.repository.fingerprint, reproduction, currentRun, regressionTests, changedFiles, verification, ...(mutation ? { mutation } : {}), criteria, passed: failures.length === 0, failures };
  await atomicWriteJson(path.join(graph.repository.root, ".fehm", "bugs", "latest-verification.json"), report);
  return report;
}
