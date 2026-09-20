#!/usr/bin/env node
import { configureReviewEngine, resolveReviewEngine } from "./review-engine.js";
import { reviewPlan, runOpenCodeReview } from "./open-code-review.js";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { approveArchitecture, formatArchitectureProposal, readArchitectureState, writeArchitectureProposal } from "./architecture.js";
import {
  analyzeChangeImpact,
  collectGitDiff,
  formatImpactReport,
  formatVerificationReport,
  readDiffFile,
  verifyChange,
} from "./change.js";
import { createConfig } from "./config.js";
import { buildContextPacket, formatContextPacket, retrieveContext } from "./context.js";
import { focusGraph } from "./graph.js";
import { exploreRelationships } from "./graph.js";
import { buildIndex, readIndex, writeIndex } from "./indexer.js";
import {
  buildCodeArchaeology,
  buildEngineeringIntelligence,
  compareArchitectureDrift,
  formatEngineeringIntelligence,
} from "./intelligence.js";
import type { GraphStats } from "./model.js";
import { formatVerification, runVerification } from "./verification.js";
import { createCockpitServer } from "./server.js";
import { startProjectSynchronizer } from "./synchronizer.js";
import { buildSystemMap, explainLikeSenior, exploreExecutionFlow, formatExecutionFlow, formatSeniorExplanation, formatSystemMap } from "./system-map.js";
import { analyzePrompt, comparePrompts, formatPromptAnalysis, formatPromptDiff, listPromptEvolutions, readPromptEvolution, savePromptExecution, savePromptVersion } from "./prompt-engine.js";
import { runAgentPreflight, runFixTestVerify, whatBreaks } from "./agent-control.js";
import { buildCoverageIntelligence, buildTestQuality } from "./testing-intelligence.js";
import { buildChangeDigest, buildTeamKnowledgeGraph, generateAdr, maintainAdrDrafts, readArchitectureTimeline, saveDeveloperCheckpoint } from "./history-intelligence.js";
import { analyzeRuntimeTrace } from "./runtime-intelligence.js";
import { buildUnifiedHealth, detectProject, searchEverything } from "./project-intelligence.js";
import { buildAiSystemGraph, buildPromptToolContracts, executePromptAcrossModels, executePromptSuite } from "./prompt-runtime.js";
import { refreshSemanticSummaries } from "./semantic-summary.js";
import { buildApiContractIntelligence, buildInfrastructureGraph } from "./contract-intelligence.js";
import { buildSecurityGraph } from "./security-graph.js";
import { buildDeadCodeIntelligence, buildDependencyRiskIntelligence, buildHistoricalBugIntelligence } from "./code-risk-intelligence.js";
import { buildCrossRepositoryGraph } from "./cross-repository.js";
import { runMutationTesting } from "./mutation-testing.js";
import { reproduceHistoricalBug, verifyBugFix } from "./bug-lifecycle.js";
import { buildAgentAnalytics, buildAiEvaluationGraph, recordAgentMistake, recordAgentRun, verifyHallucinations } from "./ai-governance.js";
import { optimizePromptWithHeldOutValidation } from "./prompt-optimizer.js";
import type { PromptProviderConfig } from "./model.js";
import { runMcpServer } from "./mcp.js";
import { auditEngineeringPractices, proposePracticesPolicy, approvePracticesPolicy, savePracticesBaseline, formatPracticesReport, type PracticeProfile } from "./engineering-practices.js";
import { backgroundServiceStatus, installBackgroundService, uninstallBackgroundService } from "./service-manager.js";
import { manageIntegration, integrationPlatforms } from "./integrations.js";
import {
  analyzeGraphConnectivity,
  assessEngineeringCapabilities,
  auditArchitectureIntent,
  auditProductionReadiness,
  exportObsidianVault,
  formatArchitectureIntent,
  formatCapabilities,
  formatProductionReadiness,
  writeOnboardingDocument,
} from "./project-readiness.js";

function usage(exitCode = 1): never {
  const message = `fehm — local-first codebase intelligence

Usage:
  fehm install --platform claude|cursor|codex|gemini|copilot|vscode|generic [--project] [--dry-run] [--force]
  fehm uninstall --platform <platform> [--project] [--dry-run] [--force]
  fehm review [--repo directory] [--from ref --to ref | --commit sha | --scan [--path directory]] [--allow-provider] [--context question] [--profile code-review] [--graph-report] [--timeout ms]
  fehm review configure provider|model
  fehm review engine-version
  fehm integrations [--platform <platform>] [--project] [--json]
  fehm query <question> [graph.json] [--budget tokens] [--json]
  fehm scan [repository] [--out directory] [--json]
  fehm stats [graph.json] [--json]
  fehm focus <symbol-or-query> [graph.json] [--depth number] [--json]
  fehm relationships <symbol> [graph.json] [--direction callers|dependencies|both] [--depth number] [--json]
  fehm what-breaks <symbol> [graph.json] [--depth number] [--json]
  fehm search <query> [graph.json] [--depth number] [--limit number] [--json]
  fehm context <query> [graph.json] [--budget tokens] [--depth number] [--json]
  fehm impact [graph.json] [--diff patch | --base ref | --staged] [--depth number] [--json]
  fehm preflight [graph.json] [--diff patch | --base ref | --staged] [--depth number] [--json]
  fehm fix-verify [graph.json] [--diff patch | --base ref | --staged] --understand query [--approve] [--json]
  fehm verify-change <before-graph.json> <after-graph.json> [--diff patch | --base ref] [--json]
  fehm verify [graph.json] [--no-commands] [--architecture config.json] [--timeout ms] [--json]
  fehm intelligence [graph.json] [--json]
  fehm coverage [graph.json] [--coverage path] [--json]
  fehm test-quality [graph.json] [--json]
  fehm summaries [graph.json] [--endpoint url --model name --api-key-env name] [--limit number] [--json]
  fehm api-contract [graph.json] [--json]
  fehm infrastructure [graph.json] [--json]
  fehm security-graph [graph.json] [--json]
  fehm dependency-risk [graph.json] [--json]
  fehm dead-code [graph.json] [--json]
  fehm bug-history [graph.json] [--json]
  fehm cross-repo <graph-a.json> <graph-b.json> [more graphs...] [--json]
  fehm mutation-test [graph.json] [--limit number] [--timeout ms] [--json]
  fehm bug-reproduce [graph.json] [--commit hash] [--timeout ms] [--json]
  fehm bug-fix-verify [graph.json] [--commit hash] [--limit number] [--timeout ms] [--json]
  fehm hallucination-verify <claims.txt|claims.json> [graph.json] [--json]
  fehm agent <analytics | record | mistake> [input.json] [graph.json] [--json]
  fehm ai-evaluations [graph.json] [--json]
  fehm health [graph.json] [--json]
  fehm practices <audit | propose | approve | baseline> [graph.json] [--profile auto|library|service|ai-service] [--json]
  fehm detect [graph.json] [--json]
  fehm search-all <query> [graph.json] [--limit number] [--json]
  fehm archaeology <symbol-or-file> [graph.json] [--json]
  fehm drift <before-graph.json> <after-graph.json> --architecture config.json [--json]
  fehm architecture <propose | approve | status> [graph.json] [--json]
  fehm timeline [graph.json] [--json]
  fehm adr <create | maintain> [graph.json] [--title text --decision text] [--context text] [--consequences text]
  fehm team [graph.json] [--json]
  fehm checkpoint <save | digest> [graph.json] --name name [--json]
  fehm runtime <trace.json> [graph.json] [--json]
  fehm system-map [graph.json] [--json]
  fehm onboarding [graph.json] [--out file] [--json]
  fehm architecture-audit [graph.json] [--json]
  fehm capabilities [graph.json] [--json]
  fehm production-audit [graph.json] [--json]
  fehm connectivity [graph.json] [--json]
  fehm export-obsidian [graph.json] --out directory [--json]
  fehm flow <entry-point-or-symbol> [graph.json] [--json]
  fehm explain [symbol-or-file] [graph.json] [--json]
  fehm prompt analyze <prompt.txt> [graph.json] [--json]
  fehm prompt diff <before.txt> <after.txt> [graph.json] [--json]
  fehm prompt save <prompt.txt> [graph.json] --name name [--reason text] [--json]
  fehm prompt history [graph.json] [--name name] [--json]
  fehm prompt <run | security> <prompt.txt> [graph.json] --endpoint url --model name [--api-key-env name] [--json]
  fehm prompt multi-run <prompt.txt> [graph.json] --providers providers.json [--name name] [--json]
  fehm prompt optimize <prompt.txt> [graph.json] --endpoint url --model name [--name name] [--json]
  fehm prompt <contracts | system-graph> <prompt.txt> [graph.json] [--model name] [--json]
  fehm mcp [graph.json]
  fehm service <install | uninstall | status> [repository] [--interval ms] [--json]
  fehm watch [repository] [--interval ms]
  fehm serve [graph.json ...] [--port number] [--host address] [--watch] [--interval ms] [--token-env name] [--allow-unauthenticated]

Examples:
  fehm scan .
  fehm focus processPayment .fehm/graph.json --depth 2
  fehm context "add Google login" .fehm/graph.json --budget 8000
  fehm preflight .fehm/graph.json --base HEAD~1
  fehm verify .fehm/graph.json --architecture .fehm/architecture.json
  fehm archaeology processPayment .fehm/graph.json
  fehm architecture propose .fehm/graph.json
  fehm system-map .fehm/graph.json
  fehm flow "CLI fehm" .fehm/graph.json
  fehm explain buildIndex .fehm/graph.json
  fehm prompt analyze examples/support-agent.prompt.txt .fehm/graph.json
  fehm prompt diff prompt-v1.txt prompt-v2.txt .fehm/graph.json
  fehm prompt save examples/support-agent.prompt.txt .fehm/graph.json --name support-agent
  fehm watch . --interval 1500
  fehm serve .fehm/graph.json --watch --port 7331
`;
  if (exitCode === 0) console.log(message);
  else console.error(message);
  process.exit(exitCode);
}

function option(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function positionalArgs(): string[] {
  const result: string[] = [];
  for (let index = 3; index < process.argv.length; index += 1) {
    const value = process.argv[index];
    if (!value) continue;
    if (value.startsWith("--")) {
      if (["--out", "--depth", "--limit", "--budget", "--diff", "--base", "--architecture", "--timeout", "--port", "--host", "--interval", "--name", "--reason", "--understand", "--policy", "--coverage", "--direction", "--title", "--decision", "--context", "--consequences", "--endpoint", "--model", "--api-key-env", "--providers", "--commit", "--token-env", "--profile"].includes(value)) index += 1;
      continue;
    }
    result.push(value);
  }
  return result;
}

function printStats(stats: GraphStats): void {
  for (const [name, value] of Object.entries(stats)) console.log(`${name.padEnd(18)} ${value}`);
}

async function main(): Promise<void> {
  const command = process.argv[2];
  const json = process.argv.includes("--json");
  const args = positionalArgs();

  if (command === "--help" || command === "-h" || command === "help") usage(0);

  if (command === "--version" || command === "-v") {
    const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
    console.log(pkg.version);
    return;
  }

  if (command === "review") {
    if (process.argv[3] === "configure") { await configureReviewEngine(process.argv.slice(4)); return; }
    if (process.argv[3] === "engine-version") {
      if (process.argv.length !== 4) throw new Error("engine-version takes no arguments");
      const engine = await resolveReviewEngine();
      console.log(await runOpenCodeReview({ ...reviewPlan(["--allow-provider"]), executable: engine.executable, args: ["version"] }));
      return;
    }
    console.log(await runOpenCodeReview(reviewPlan(process.argv.slice(3))));
    return;
  }

  if (command === "install" || command === "uninstall" || command === "integrations") {
    const platform = option("--platform");
    const allowed = new Set(["--platform", "--project", "--dry-run", "--force", "--json"]);
    for (let i = 3; i < process.argv.length; i++) {
      const arg = process.argv[i]!;
      if (!allowed.has(arg)) throw new Error(`Unknown integration argument: ${arg}`);
      if (arg === "--platform") {
        if (!process.argv[i + 1] || process.argv[i + 1]!.startsWith("--")) throw new Error("--platform requires a value");
        i++;
      }
    }
    if (!platform && command !== "integrations") throw new Error("Choose --platform claude|cursor|codex|gemini|copilot|vscode|generic");
    const platforms = platform ? [platform] : Object.keys(integrationPlatforms);
    const results = [];
    for (const selected of platforms) {
      results.push(await manageIntegration(command === "integrations" ? "status" : command, {
        platform: selected, project: process.argv.includes("--project"),
        dryRun: process.argv.includes("--dry-run"), force: process.argv.includes("--force"),
      }));
    }
    console.log(json ? JSON.stringify(results, null, 2) : results.map(r => `${r.label} (${r.scope}): ${r.dryRun ? "would " + r.action : r.state}\n  ${r.path}`).join("\n"));
    if (command === "install" && !json) console.log("Reload your assistant, then ask it to use Fehm to map the current repository. The fehm CLI must be on its terminal PATH.");
    return;
  }

  if (command === "practices") {
    const action = args[0] ?? "audit";
    if (!["audit", "propose", "approve", "baseline"].includes(action)) usage();
    const graph = await readIndex(path.resolve(args[1] ?? ".fehm/graph.json"));
    if (action === "propose") {
      const profile = option("--profile") ?? "auto";
      if (!["auto", "library", "service", "ai-service"].includes(profile)) throw new Error("unknown practices profile");
      const result = await proposePracticesPolicy(graph, profile as PracticeProfile);
      console.log(json ? JSON.stringify(result, null, 2) : `Review and edit ${result.path}, then run fehm practices approve. No policy has been enforced.`);
    } else if (action === "approve") {
      const result = await approvePracticesPolicy(graph);
      console.log(json ? JSON.stringify(result, null, 2) : `Approved engineering practices: ${result.path}`);
    } else if (action === "baseline") {
      const result = await savePracticesBaseline(graph);
      console.log(json ? JSON.stringify(result, null, 2) : `Saved practice evidence baseline: ${result.path}`);
    } else {
      const report = await auditEngineeringPractices(graph);
      console.log(json ? JSON.stringify(report, null, 2) : formatPracticesReport(report));
      if (!report.passed || report.drift.status === "degraded") process.exitCode = 2;
    }
    return;
  }

  if (command === "scan") {
    const root = args[0] ?? process.cwd();
    const config = createConfig(root, option("--out"));
    const graph = await buildIndex(config);
    const destination = await writeIndex(graph, config.outputDirectory);
    if (json) console.log(JSON.stringify(graph));
    else {
      console.log(`Indexed ${graph.repository.name}`);
      printStats(graph.stats);
      console.log(`added             ${graph.changes.added.length}`);
      console.log(`changed           ${graph.changes.changed.length}`);
      console.log(`removed           ${graph.changes.removed.length}`);
      console.log(`unchanged         ${graph.changes.unchanged.length}`);
      console.log(`graph             ${destination}`);
    }
    return;
  }

  if (command === "stats") {
    const graph = await readIndex(path.resolve(args[0] ?? ".fehm/graph.json"));
    if (json) console.log(JSON.stringify(graph.stats));
    else printStats(graph.stats);
    return;
  }

  if (command === "focus") {
    const query = args[0];
    if (!query) usage();
    const graph = await readIndex(path.resolve(args[1] ?? ".fehm/graph.json"));
    const depth = Number(option("--depth") ?? "1");
    const result = focusGraph(graph, query, Number.isFinite(depth) ? Math.max(0, depth) : 1);
    if (json) console.log(JSON.stringify(result, null, 2));
    else {
      console.log(`Matches: ${result.matches.length}; focused nodes: ${result.nodes.length}; edges: ${result.edges.length}`);
      for (const node of result.nodes) console.log(`${node.kind.padEnd(12)} ${node.qualifiedName}`);
      if (result.truncated) console.log("Result truncated; refine the query or reduce depth.");
    }
    return;
  }

  if (command === "relationships" || command === "what-breaks") {
    const query = args[0];
    if (!query) usage();
    const graph = await readIndex(path.resolve(args[1] ?? ".fehm/graph.json"));
    const depth = Math.max(1, Number(option("--depth") ?? "6") || 6);
    const directionValue = option("--direction") ?? "both";
    if (!(["callers", "dependencies", "both"] as string[]).includes(directionValue)) throw new Error("direction must be callers, dependencies, or both");
    const report = command === "what-breaks" ? whatBreaks(graph, query, depth) : exploreRelationships(graph, query, directionValue as "callers" | "dependencies" | "both", depth);
    if (json) console.log(JSON.stringify(report, null, 2));
    else {
      console.log(`# ${command === "what-breaks" ? "What Breaks" : "Relationship Explorer"}\n`);
      console.log(`Root: ${report.root?.qualifiedName ?? "not found"}; related: ${report.related.length}`);
      for (const item of report.related) console.log(`- ${item.distance} hop(s) · ${item.via} · ${item.node.qualifiedName} · ${Math.round(item.confidence * 100)}%`);
    }
    return;
  }

  if (command === "search") {
    const query = args[0];
    if (!query) usage();
    const graph = await readIndex(path.resolve(args[1] ?? ".fehm/graph.json"));
    const depth = Number(option("--depth") ?? "2");
    const limit = Number(option("--limit") ?? "25");
    const hits = await retrieveContext(graph, query, {
      depth: Number.isFinite(depth) ? Math.max(0, depth) : 2,
      limit: Number.isFinite(limit) ? Math.max(1, limit) : 25,
    });
    if (json) console.log(JSON.stringify(hits, null, 2));
    else {
      console.log(`Ranked results: ${hits.length}`);
      for (const hit of hits) {
        console.log(`${hit.scores.final.toFixed(3)}  ${hit.node.kind.padEnd(12)} ${hit.node.qualifiedName}`);
        console.log(`       ${hit.reasons.join(", ")}`);
      }
    }
    return;
  }

  if (command === "context" || command === "query") {
    const query = args[0];
    if (!query) usage();
    const graph = await readIndex(path.resolve(args[1] ?? ".fehm/graph.json"));
    const depth = Number(option("--depth") ?? "2");
    const budget = Number(option("--budget") ?? "4000");
    const packet = await buildContextPacket(graph, query, {
      depth: Number.isFinite(depth) ? Math.max(0, depth) : 2,
      budgetTokens: Number.isFinite(budget) ? Math.max(64, budget) : 4000,
    });
    if (json) console.log(JSON.stringify(packet, null, 2));
    else console.log(formatContextPacket(packet));
    return;
  }

  if (command === "impact" || command === "preflight" || command === "fix-verify") {
    const graph = await readIndex(path.resolve(args[0] ?? ".fehm/graph.json"));
    const diffPath = option("--diff");
    const base = option("--base");
    const projection = diffPath
      ? await readDiffFile(diffPath)
      : await collectGitDiff(graph.repository.root, {
          ...(base ? { base } : {}),
          staged: process.argv.includes("--staged"),
        });
    const depth = Number(option("--depth") ?? "4");
    if (command === "impact") {
      const report = analyzeChangeImpact(graph, projection, { depth: Number.isFinite(depth) ? Math.max(0, depth) : 4 });
      if (json) console.log(JSON.stringify(report, null, 2));
      else console.log(formatImpactReport(report));
      return;
    }
    const understandingQuery = option("--understand");
    const policyPath = option("--policy");
    const common = { ...(understandingQuery ? { understandingQuery } : {}), ...(policyPath ? { policyPath } : {}), approval: process.argv.includes("--approve") };
    if (command === "preflight") {
      const report = await runAgentPreflight(graph, projection, { ...common, depth });
      if (json) console.log(JSON.stringify(report, null, 2));
      else {
        console.log(`# Agent Preflight\n\nResult: ${report.passed ? "PASS" : "BLOCKED"}\nRisk: ${report.risk.score}/100 (${report.risk.level})\nUnderstanding: ${report.understood ? "satisfied" : "required"}\nApproval: ${report.requiresApproval ? "required" : "not required"}`);
        for (const step of report.seniorPlan) console.log(`- ${step}`);
      }
      if (!report.passed) process.exitCode = 2;
      return;
    }
    const report = await runFixTestVerify(graph, projection, common);
    if (json) console.log(JSON.stringify(report, null, 2));
    else console.log(`# Fix-Test-Verify\n\nResult: ${report.passed ? "PASS" : "FAILED"}\nTests: ${report.tests.status}\nVerification: ${report.verification?.summary.passed ? "passed" : report.verification ? "failed" : "blocked"}`);
    if (!report.passed) process.exitCode = 2;
    return;
  }

  if (command === "verify-change") {
    if (!args[0] || !args[1]) usage();
    const before = await readIndex(path.resolve(args[0]));
    const after = await readIndex(path.resolve(args[1]));
    const diffPath = option("--diff");
    const base = option("--base");
    const projection = diffPath
      ? await readDiffFile(diffPath)
      : await collectGitDiff(after.repository.root, {
          ...(base ? { base } : {}),
          staged: process.argv.includes("--staged"),
        });
    const depth = Number(option("--depth") ?? "4");
    const report = verifyChange(before, after, projection, {
      depth: Number.isFinite(depth) ? Math.max(0, depth) : 4,
    });
    if (json) console.log(JSON.stringify(report, null, 2));
    else console.log(formatVerificationReport(report));
    if (!report.passed) process.exitCode = 2;
    return;
  }

  if (command === "verify") {
    const graph = await readIndex(path.resolve(args[0] ?? ".fehm/graph.json"));
    const architectureConfigPath = option("--architecture");
    const timeout = Number(option("--timeout") ?? "120000");
    const report = await runVerification(graph, {
      runCommands: !process.argv.includes("--no-commands"),
      ...(architectureConfigPath ? { architectureConfigPath } : {}),
      commandTimeoutMs: Number.isFinite(timeout) ? Math.max(1_000, timeout) : 120_000,
    });
    if (json) console.log(JSON.stringify(report, null, 2));
    else console.log(formatVerification(report));
    if (!report.summary.passed) process.exitCode = 2;
    return;
  }

  if (command === "intelligence") {
    const graph = await readIndex(path.resolve(args[0] ?? ".fehm/graph.json"));
    const report = await buildEngineeringIntelligence(graph);
    if (json) console.log(JSON.stringify(report, null, 2));
    else console.log(formatEngineeringIntelligence(report));
    return;
  }

  if (command === "coverage") {
    const graph = await readIndex(path.resolve(args[0] ?? ".fehm/graph.json"));
    const report = await buildCoverageIntelligence(graph, option("--coverage"));
    if (json) console.log(JSON.stringify(report, null, 2));
    else console.log(`# Coverage Intelligence\n\nSource: ${report.available ? report.source : "static test graph"}\nFunctions: ${report.overall.functions}%\nCritical gaps: ${report.criticalGaps.length}\nProtected symbols: ${report.protectedSymbols}`);
    return;
  }

  if (["test-quality", "api-contract", "infrastructure", "security-graph"].includes(command ?? "")) {
    const graph = await readIndex(path.resolve(args[0] ?? ".fehm/graph.json"));
    const report = command === "test-quality" ? await buildTestQuality(graph)
      : command === "api-contract" ? await buildApiContractIntelligence(graph)
        : command === "infrastructure" ? await buildInfrastructureGraph(graph) : await buildSecurityGraph(graph);
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  if (["dependency-risk", "dead-code", "bug-history"].includes(command ?? "")) {
    const graph = await readIndex(path.resolve(args[0] ?? ".fehm/graph.json"));
    const report = command === "dependency-risk" ? await buildDependencyRiskIntelligence(graph)
      : command === "dead-code" ? await buildDeadCodeIntelligence(graph) : await buildHistoricalBugIntelligence(graph);
    if (json) console.log(JSON.stringify(report, null, 2));
    else if (command === "dependency-risk") {
      const value = report as import("./model.js").DependencyRiskReport;
      console.log(`# Dependency Risk\n\nDependencies: ${value.summary.total}; high/critical: ${value.summary.highRisk + value.summary.criticalRisk}; undeclared: ${value.summary.undeclared}; unused: ${value.summary.unused}`);
      for (const item of value.dependencies.filter((entry) => entry.riskScore > 0).slice(0, 30)) console.log(`- ${item.severity.toUpperCase()} ${item.riskScore}/100 ${item.name}@${item.requestedVersion} — ${item.reasons.join("; ")}`);
    } else if (command === "dead-code") {
      const value = report as import("./model.js").DeadCodeReport;
      console.log(`# Dead Code Intelligence\n\nFindings: ${value.findings.length}; high-confidence: ${value.summary.highConfidence}; unreachable files: ${value.summary.unreachableFiles}`);
      for (const item of value.findings.slice(0, 50)) console.log(`- ${Math.round(item.confidence * 100)}% ${item.kind} ${item.node.qualifiedName}`);
    } else {
      const value = report as import("./model.js").HistoricalBugReport;
      console.log(`# Historical Bug Intelligence\n\nBug-fix commits: ${value.summary.bugFixCommits}; affected files: ${value.summary.affectedFiles}; high-risk hotspots: ${value.summary.highRiskHotspots}`);
      for (const item of value.hotspots.slice(0, 30)) console.log(`- ${item.severity.toUpperCase()} ${item.score}/100 ${item.path} — ${item.reasons.join("; ")}`);
    }
    return;
  }

  if (command === "cross-repo") {
    if (args.length < 2) usage();
    const graphs = await Promise.all(args.map((candidate) => readIndex(path.resolve(candidate))));
    const report = await buildCrossRepositoryGraph(graphs);
    if (json) console.log(JSON.stringify(report, null, 2));
    else {
      console.log(`# Cross-Repository Graph\n\nRepositories: ${report.summary.repositories}; package dependencies: ${report.summary.packageDependencies}; API connections: ${report.summary.apiConnections}; conflicts: ${report.summary.conflicts}`);
      for (const edge of report.edges.filter((item) => item.relation !== "contains")) console.log(`- ${edge.relation}: ${edge.source} -> ${edge.target}`);
      for (const conflict of report.conflicts) console.log(`- ${conflict.severity.toUpperCase()} ${conflict.kind}: ${conflict.detail}`);
    }
    return;
  }

  if (command === "mutation-test") {
    const graph = await readIndex(path.resolve(args[0] ?? ".fehm/graph.json"));
    const report = await runMutationTesting(graph, { limit: Math.max(1, Number(option("--limit") ?? "25") || 25), timeoutMs: Math.max(1_000, Number(option("--timeout") ?? "120000") || 120_000) });
    if (json) console.log(JSON.stringify(report, null, 2));
    else {
      console.log(`# Mutation Testing\n\nBaseline: ${report.baseline.status}; candidates: ${report.candidates}; executed: ${report.executed}; killed: ${report.killed}; survived: ${report.survived}; score: ${report.score}%`);
      for (const item of report.results.filter((result) => result.status !== "killed")) console.log(`- ${item.status.toUpperCase()} ${item.path}:${item.line} ${item.description}`);
    }
    if (report.baseline.status !== "passed" || report.survived > 0) process.exitCode = 2;
    return;
  }

  if (command === "bug-reproduce" || command === "bug-fix-verify") {
    const graph = await readIndex(path.resolve(args[0] ?? ".fehm/graph.json")); const commit = option("--commit"); const timeoutMs = Math.max(1_000, Number(option("--timeout") ?? "120000") || 120_000);
    const report = command === "bug-reproduce"
      ? await reproduceHistoricalBug(graph, { ...(commit ? { commit } : {}), timeoutMs })
      : await verifyBugFix(graph, { ...(commit ? { commit } : {}), timeoutMs, mutationLimit: Math.max(1, Number(option("--limit") ?? "10") || 10) });
    if (json) console.log(JSON.stringify(report, null, 2));
    else if (command === "bug-reproduce") {
      const value = report as import("./model.js").BugReproductionReport;
      console.log(`# Bug Reproduction\n\nStatus: ${value.status}; fix: ${value.fixCommit}; parent: ${value.parentCommit ?? "unknown"}; buggy tests: ${value.buggyRun.status}; fixed tests: ${value.fixedRun.status}`);
      for (const item of value.failureSignature) console.log(`- ${item}`);
    } else {
      const value = report as import("./model.js").BugFixVerificationReport;
      console.log(`# Bug-Fix Verification\n\nResult: ${value.passed ? "PASS" : "FAIL"}; reproduction: ${value.reproduction.status}; regression tests: ${value.regressionTests.length}; mutation score: ${value.mutation?.score ?? "not run"}%`);
      for (const [criterion, passed] of Object.entries(value.criteria)) console.log(`- ${passed ? "PASS" : "FAIL"} ${criterion}`);
    }
    if (("passed" in report && !report.passed) || ("status" in report && report.status !== "reproduced")) process.exitCode = 2;
    return;
  }

  if (command === "hallucination-verify") {
    if (!args[0]) usage(); const raw = await readFile(path.resolve(args[0]), "utf8"); const graph = await readIndex(path.resolve(args[1] ?? ".fehm/graph.json"));
    let claims: string | Array<string | { id?: string; statement: string }> = raw; if (args[0].endsWith(".json")) claims = JSON.parse(raw) as Array<string | { id?: string; statement: string }>;
    const report = await verifyHallucinations(graph, claims); console.log(json ? JSON.stringify(report, null, 2) : `Claim verification: ${report.summary.verified} verified, ${report.summary.contradicted} contradicted, ${report.summary.unverifiable} unverifiable\n${report.claims.map((item) => `- ${item.status.toUpperCase()} ${item.statement}${item.correction ? ` — ${item.correction}` : ""}`).join("\n")}`);
    if (report.summary.contradicted) process.exitCode = 2; return;
  }

  if (command === "agent") {
    const action = args[0]; if (!action || !["analytics", "record", "mistake"].includes(action)) usage();
    if (action === "analytics") { const graph = await readIndex(path.resolve(args[1] ?? ".fehm/graph.json")); const report = await buildAgentAnalytics(graph); console.log(json ? JSON.stringify(report, null, 2) : `Agent analytics: ${report.summary.runs} run(s), ${report.summary.successRate}% success, ${report.summary.openMistakes} open mistake(s)`); return; }
    if (!args[1]) usage(); const input = JSON.parse(await readFile(path.resolve(args[1]), "utf8")); const graph = await readIndex(path.resolve(args[2] ?? ".fehm/graph.json")); const value = action === "record" ? await recordAgentRun(graph, input as import("./ai-governance.js").AgentRunInput) : await recordAgentMistake(graph, input as import("./ai-governance.js").AgentMistakeInput); console.log(JSON.stringify(value, null, 2)); return;
  }

  if (command === "ai-evaluations") {
    const graph = await readIndex(path.resolve(args[0] ?? ".fehm/graph.json")); const report = await buildAiEvaluationGraph(graph); console.log(json ? JSON.stringify(report, null, 2) : `AI evaluation graph: ${report.summary.prompts} prompt(s), ${report.summary.executions} execution(s), ${report.summary.cases} case(s), ${report.summary.passRate}% pass rate, ${report.summary.regressions} regression(s)`); return;
  }

  if (command === "summaries") {
    const graphPath = path.resolve(args[0] ?? ".fehm/graph.json"); const graph = await readIndex(graphPath);
    const endpoint = option("--endpoint"); const model = option("--model"); const apiKeyEnv = option("--api-key-env");
    if ((endpoint && !model) || (!endpoint && model)) throw new Error("--endpoint and --model must be supplied together");
    const result = await refreshSemanticSummaries(graph, { ...(endpoint && model ? { provider: { endpoint, model, ...(apiKeyEnv ? { apiKeyEnv } : {}) } } : {}), limit: Math.max(1, Number(option("--limit") ?? "200") || 200) });
    await writeIndex(result.graph, path.dirname(graphPath));
    console.log(json ? JSON.stringify(result, null, 2) : `Semantic summaries: ${result.updated} updated, ${result.failed.length} failed${result.model ? ` via ${result.model}` : " deterministically"}`);
    return;
  }

  if (command === "health") {
    const graph = await readIndex(path.resolve(args[0] ?? ".fehm/graph.json"));
    const report = await buildUnifiedHealth(graph);
    console.log(json ? JSON.stringify(report, null, 2) : `Project health: ${report.score}/100 (${report.status})\n${report.priorities.map((item) => `- ${item}`).join("\n")}`);
    return;
  }

  if (command === "detect") {
    const graph = await readIndex(path.resolve(args[0] ?? ".fehm/graph.json"));
    const report = await detectProject(graph);
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  if (command === "search-all") {
    if (!args[0]) usage();
    const graph = await readIndex(path.resolve(args[1] ?? ".fehm/graph.json"));
    const report = await searchEverything(graph, args[0], Math.max(1, Number(option("--limit") ?? "50") || 50));
    if (json) console.log(JSON.stringify(report, null, 2));
    else for (const item of report) console.log(`${String(item.score).padStart(3)}  ${item.kind.padEnd(12)} ${item.title}${item.path ? ` · ${item.path}` : ""}`);
    return;
  }

  if (command === "archaeology") {
    const query = args[0];
    if (!query) usage();
    const graph = await readIndex(path.resolve(args[1] ?? ".fehm/graph.json"));
    const report = await buildCodeArchaeology(graph, query);
    if (json) console.log(JSON.stringify(report, null, 2));
    else {
      console.log("# Code Archaeology\n");
      console.log(`Query: ${report.query}`);
      console.log(`Match: ${report.node?.qualifiedName ?? "none"}`);
      console.log(`Confidence: ${report.confidence}%`);
      console.log(`Authors: ${report.authors.join(", ") || "unknown"}\n`);
      console.log(report.explanation);
      if (report.recentChanges.length) {
        console.log("\n## Recent changes");
        for (const commit of report.recentChanges) console.log(`- ${commit.hash.slice(0, 8)} ${commit.date} ${commit.subject}`);
      }
      if (report.relatedMemory.length) {
        console.log("\n## Related memory");
        for (const memory of report.relatedMemory) console.log(`- ${memory.path}:${memory.line} ${memory.title}`);
      }
    }
    return;
  }

  if (command === "drift") {
    if (!args[0] || !args[1]) usage();
    const architectureConfigPath = option("--architecture");
    if (!architectureConfigPath) usage();
    const before = await readIndex(path.resolve(args[0]));
    const after = await readIndex(path.resolve(args[1]));
    const report = await compareArchitectureDrift(before, after, architectureConfigPath);
    if (json) console.log(JSON.stringify(report, null, 2));
    else {
      console.log("# Architecture Drift\n");
      console.log(`Status: ${report.status.toUpperCase()}`);
      console.log(`Added violations: ${report.addedViolations.length}`);
      console.log(`Resolved violations: ${report.resolvedViolations.length}`);
      console.log(`Unchanged violations: ${report.unchangedViolations.length}`);
      for (const violation of report.addedViolations) console.log(`- NEW: ${violation.source} -> ${violation.target}: ${violation.reason}`);
    }
    if (report.status === "degraded") process.exitCode = 2;
    return;
  }

  if (command === "architecture") {
    const action = args[0];
    if (!action || !["propose", "approve", "status"].includes(action)) usage();
    const graph = await readIndex(path.resolve(args[1] ?? ".fehm/graph.json"));
    if (action === "propose") {
      const result = await writeArchitectureProposal(graph);
      if (json) console.log(JSON.stringify(result, null, 2));
      else {
        console.log(formatArchitectureProposal(result.proposal));
        console.log(`proposal          ${result.path}`);
      }
    } else if (action === "approve") {
      const result = await approveArchitecture(graph);
      if (json) console.log(JSON.stringify(result, null, 2));
      else console.log(`Approved architecture contract\ncontract          ${result.path}`);
    } else {
      const state = await readArchitectureState(graph);
      if (json) console.log(JSON.stringify(state, null, 2));
      else console.log(state.contract ? "Architecture: APPROVED" : state.proposal ? "Architecture: PROPOSED — approval required" : "Architecture: NOT CONFIGURED");
    }
    return;
  }

  if (command === "timeline") {
    const graph = await readIndex(path.resolve(args[0] ?? ".fehm/graph.json"));
    const report = await readArchitectureTimeline(graph);
    if (json) console.log(JSON.stringify(report, null, 2));
    else { console.log(`# Architecture Timeline\n\nSnapshots: ${report.snapshots.length}`); for (const event of report.events) console.log(`- ${event.at} · ${event.kind} · ${event.detail}`); }
    return;
  }

  if (command === "adr") {
    if (!args[0] || !["create", "maintain"].includes(args[0])) usage();
    const graph = await readIndex(path.resolve(args[1] ?? ".fehm/graph.json"));
    if (args[0] === "maintain") {
      const report = await maintainAdrDrafts(graph);
      console.log(json ? JSON.stringify(report, null, 2) : `ADR maintenance: ${report.drafts.length} draft(s), ${report.stale.length} stale, ${report.current.length} current`);
      return;
    }
    const title = option("--title"); const decision = option("--decision");
    if (!title || !decision) usage();
    const context = option("--context"); const consequences = option("--consequences");
    const destination = await generateAdr(graph, title, decision, { ...(context ? { context } : {}), ...(consequences ? { consequences } : {}) });
    console.log(json ? JSON.stringify({ path: destination }) : `ADR created: ${destination}`);
    return;
  }

  if (command === "team") {
    const graph = await readIndex(path.resolve(args[0] ?? ".fehm/graph.json"));
    const report = await buildTeamKnowledgeGraph(graph);
    if (json) console.log(JSON.stringify(report, null, 2));
    else { console.log(`# Team Knowledge Graph\n\nAuthors: ${report.authors.length}; ownership risks: ${report.sharedKnowledgeRisks.length}; branches: ${report.branches.length}`); for (const item of report.authors) console.log(`- ${item.name}: ${item.commits} commits · ${item.files} files · ${item.expertise.map((area) => area.area).join(", ")}`); }
    return;
  }

  if (command === "checkpoint") {
    if (!args[0] || !["save", "digest"].includes(args[0])) usage();
    const name = option("--name"); if (!name) usage();
    const graph = await readIndex(path.resolve(args[1] ?? ".fehm/graph.json"));
    const report = args[0] === "save" ? await saveDeveloperCheckpoint(graph, name) : await buildChangeDigest(graph, name);
    console.log(json ? JSON.stringify(report, null, 2) : args[0] === "save" ? `Checkpoint '${name}' saved.` : (report as import("./model.js").ChangeDigest).summary.map((item) => `- ${item}`).join("\n"));
    return;
  }

  if (command === "runtime") {
    if (!args[0]) usage();
    const graph = await readIndex(path.resolve(args[1] ?? ".fehm/graph.json"));
    const report = await analyzeRuntimeTrace(graph, args[0]);
    if (json) console.log(JSON.stringify(report, null, 2));
    else { console.log(`# Runtime Bottlenecks\n\nSpans: ${report.spans.length}; unmapped: ${report.unmappedSpans}; confidence: ${report.confidence}%`); for (const item of report.bottlenecks.slice(0, 30)) console.log(`- ${item.totalMs}ms total · ${item.calls} calls · ${item.name}`); }
    return;
  }

  if (command === "system-map") {
    const graph = await readIndex(path.resolve(args[0] ?? ".fehm/graph.json"));
    const report = await buildSystemMap(graph);
    if (json) console.log(JSON.stringify(report, null, 2));
    else console.log(formatSystemMap(report));
    return;
  }

  if (["onboarding", "architecture-audit", "capabilities", "production-audit", "connectivity", "export-obsidian"].includes(command ?? "")) {
    const graph = await readIndex(path.resolve(args[0] ?? ".fehm/graph.json"));
    if (command === "onboarding") {
      const report = await writeOnboardingDocument(graph, option("--out"));
      console.log(json ? JSON.stringify(report, null, 2) : `Onboarding document: ${report.path}`);
    } else if (command === "architecture-audit") {
      const report = await auditArchitectureIntent(graph);
      console.log(json ? JSON.stringify(report, null, 2) : formatArchitectureIntent(report));
    } else if (command === "capabilities") {
      const report = await assessEngineeringCapabilities(graph);
      console.log(json ? JSON.stringify(report, null, 2) : formatCapabilities(report));
    } else if (command === "production-audit") {
      const report = await auditProductionReadiness(graph);
      console.log(json ? JSON.stringify(report, null, 2) : formatProductionReadiness(report));
    } else if (command === "connectivity") {
      const report = analyzeGraphConnectivity(graph);
      console.log(json ? JSON.stringify(report, null, 2) : `# Graph Connectivity\n\nComponents: ${report.components}\nLargest: ${report.largestComponentPercent}% (${report.largestComponentNodes} nodes)\nIsolated nodes: ${report.isolatedNodes}\n\n${report.note}`);
    } else {
      const destination = option("--out");
      if (!destination) throw new Error("export-obsidian requires --out directory");
      const report = await exportObsidianVault(graph, destination);
      console.log(json ? JSON.stringify(report, null, 2) : `Obsidian vault: ${report.path} (${report.notes} notes)`);
    }
    return;
  }

  if (command === "flow") {
    const query = args[0];
    if (!query) usage();
    const graph = await readIndex(path.resolve(args[1] ?? ".fehm/graph.json"));
    const flow = await exploreExecutionFlow(graph, query);
    if (json) console.log(JSON.stringify(flow, null, 2));
    else console.log(formatExecutionFlow(flow));
    return;
  }

  if (command === "explain") {
    const query = args[0] ?? "project";
    const graph = await readIndex(path.resolve(args[1] ?? ".fehm/graph.json"));
    const explanation = await explainLikeSenior(graph, query);
    if (json) console.log(JSON.stringify(explanation, null, 2));
    else console.log(formatSeniorExplanation(explanation));
    return;
  }

  if (command === "prompt") {
    const action = args[0];
    if (!action || !["analyze", "diff", "save", "history", "run", "security", "multi-run", "contracts", "system-graph", "optimize"].includes(action)) usage();
    if (action === "analyze") {
      if (!args[1]) usage();
      const prompt = await readFile(path.resolve(args[1]), "utf8");
      const graph = await readIndex(path.resolve(args[2] ?? ".fehm/graph.json"));
      const report = analyzePrompt(prompt, graph);
      if (json) console.log(JSON.stringify(report, null, 2));
      else console.log(formatPromptAnalysis(report));
      return;
    }
    if (action === "diff") {
      if (!args[1] || !args[2]) usage();
      const [before, after] = await Promise.all([readFile(path.resolve(args[1]), "utf8"), readFile(path.resolve(args[2]), "utf8")]);
      const graph = await readIndex(path.resolve(args[3] ?? ".fehm/graph.json"));
      const report = comparePrompts(before, after, graph);
      if (json) console.log(JSON.stringify(report, null, 2));
      else console.log(formatPromptDiff(report));
      if (!report.passed) process.exitCode = 2;
      return;
    }
    if (action === "save") {
      if (!args[1]) usage();
      const name = option("--name");
      if (!name) usage();
      const prompt = await readFile(path.resolve(args[1]), "utf8");
      const graph = await readIndex(path.resolve(args[2] ?? ".fehm/graph.json"));
      const history = await savePromptVersion(graph, name, prompt, option("--reason") ?? "");
      if (json) console.log(JSON.stringify(history, null, 2));
      else console.log(`Saved ${history.name} version ${history.versions.length} · score ${history.versions.at(-1)?.scorecard.overall ?? 0}/100`);
      return;
    }
    if (action === "run" || action === "security" || action === "multi-run" || action === "contracts" || action === "system-graph" || action === "optimize") {
      if (!args[1]) usage();
      const prompt = await readFile(path.resolve(args[1]), "utf8");
      const graph = await readIndex(path.resolve(args[2] ?? ".fehm/graph.json"));
      if (action === "contracts") {
        const report = await buildPromptToolContracts(prompt, graph);
        console.log(json ? JSON.stringify(report, null, 2) : report.map((item) => `${item.status.toUpperCase()} ${item.reference} · ${item.authorization} · ${item.signature ?? "signature unavailable"}`).join("\n"));
        return;
      }
      if (action === "system-graph") {
        const report = await buildAiSystemGraph(prompt, graph, option("--model") ?? "unconfigured-model");
        console.log(json ? JSON.stringify(report, null, 2) : `AI system graph: ${report.nodes.length} nodes, ${report.edges.length} edges, ${report.risks.length} risk(s)`);
        return;
      }
      if (action === "optimize") {
        const endpoint = option("--endpoint"); const model = option("--model"); if (!endpoint || !model) throw new Error("--endpoint and --model are required for prompt optimization"); const apiKeyEnv = option("--api-key-env");
        const report = await optimizePromptWithHeldOutValidation(prompt, { endpoint, model, ...(apiKeyEnv ? { apiKeyEnv } : {}) }, graph, { ...(option("--name") ? { name: option("--name") as string } : {}) });
        console.log(json ? JSON.stringify(report, null, 2) : `Prompt optimization: ${report.promoted ? `PROMOTED ${report.selectedCandidateId}` : "baseline retained"}\n${report.evidence.map((item) => `- ${item}`).join("\n")}`); return;
      }
      if (action === "multi-run") {
        const providersPath = option("--providers"); if (!providersPath) throw new Error("--providers is required for multi-run");
        const configs = JSON.parse(await readFile(path.resolve(providersPath), "utf8")) as PromptProviderConfig[];
        const report = await executePromptAcrossModels(prompt, configs, graph);
        const name = option("--name"); if (name) for (const run of report.runs) await savePromptExecution(graph, name, prompt, run, option("--reason") ?? "multi-model evaluation");
        console.log(json ? JSON.stringify(report, null, 2) : `Multi-model evaluation: winner ${report.winner ?? "none"}; consistency ${report.consistency.score}%\n${report.ranking.map((item, index) => `${index + 1}. ${item.model}: ${item.score}/100`).join("\n")}`);
        return;
      }
      const endpoint = option("--endpoint"); const model = option("--model");
      if (!endpoint || !model) throw new Error("--endpoint and --model are required for live prompt execution");
      const apiKeyEnv = option("--api-key-env");
      const report = await executePromptSuite(prompt, { endpoint, model, ...(apiKeyEnv ? { apiKeyEnv } : {}) }, graph, action === "security" ? ["injection", "extraction", "sensitive-data"] : undefined);
      const name = option("--name"); if (name) await savePromptExecution(graph, name, prompt, report, option("--reason") ?? `${action} evaluation`);
      console.log(json ? JSON.stringify(report, null, 2) : `Prompt execution: ${report.passed ? "PASS" : "FAIL"} · ${report.behavior.score}/100 · ${report.behavior.passed}/${report.cases.length} passed`);
      if (!report.passed) process.exitCode = 2;
      return;
    }
    const graph = await readIndex(path.resolve(args[1] ?? ".fehm/graph.json"));
    const name = option("--name");
    const history = name ? await readPromptEvolution(graph, name) : await listPromptEvolutions(graph);
    if (json) console.log(JSON.stringify(history, null, 2));
    else if (Array.isArray(history)) {
      console.log("# Prompt Evolution\n");
      for (const item of history) console.log(`- ${item.name}: ${item.versions.length} version(s), latest score ${item.versions.at(-1)?.scorecard.overall ?? 0}/100`);
    } else {
      console.log(`# Prompt Evolution: ${history.name}\n`);
      for (const [index, version] of history.versions.entries()) {
        console.log(`${index + 1}. ${version.createdAt} · ${version.scorecard.overall}/100 · ${version.findings} finding(s) · ${version.reason || "no reason recorded"}`);
        for (const execution of version.executions ?? []) console.log(`   - ${execution.model}: ${execution.passed ? "PASS" : "FAIL"} ${execution.score}/100 · ${execution.passedCases} passed · ${execution.failedCases} failed · ${execution.cases.length} archived response(s)`);
      }
    }
    return;
  }

  if (command === "watch") {
    const root = args[0] ?? process.cwd();
    const config = createConfig(root, option("--out"));
    const interval = Number(option("--interval") ?? "1500");
    const synchronizer = startProjectSynchronizer(config, {
      intervalMs: Number.isFinite(interval) ? interval : 1500,
      onSync(graph) {
        const sync = graph.synchronization;
        console.log(`[${sync?.lastSyncAt ?? graph.generatedAt}] ${sync?.mode ?? "full"}: ${sync?.analyzedFiles.length ?? graph.stats.files} analyzed, ${sync?.reusedFiles.length ?? 0} reused, freshness ${sync?.summaryFreshness.percent ?? 100}%`);
      },
      onError(error) { console.error(`Synchronization failed: ${error.message}`); },
    });
    await synchronizer.runNow();
    console.log(`Watching ${config.root} every ${Math.max(250, Number.isFinite(interval) ? interval : 1500)}ms`);
    return;
  }

  if (command === "mcp") {
    await runMcpServer(path.resolve(args[0] ?? ".fehm/graph.json"));
    return;
  }

  if (command === "service") {
    const action = args[0];
    if (!action || !["install", "uninstall", "status"].includes(action)) usage();
    const root = path.resolve(args[1] ?? process.cwd());
    const report = action === "install"
      ? await installBackgroundService(root, fileURLToPath(import.meta.url), Math.max(250, Number(option("--interval") ?? "2000") || 2000))
      : action === "uninstall" ? await uninstallBackgroundService(root) : await backgroundServiceStatus(root);
    console.log(json ? JSON.stringify(report, null, 2) : `${report.installed ? "installed" : "not installed"}; ${report.running ? "running" : "stopped"} · ${report.detail}`);
    return;
  }

  if (command === "serve") {
    const graphPaths = (args.length ? args : [".fehm/graph.json"]).map((value) => path.resolve(value));
    const graphs = await Promise.all(graphPaths.map(readIndex));
    const ids = new Map<string, number>();
    const projects = graphs.map((graph, index) => {
      const base = graph.repository.name.toLowerCase().replace(/[^a-z0-9_-]+/g, "-") || "project";
      const count = (ids.get(base) ?? 0) + 1;
      ids.set(base, count);
      return { id: count === 1 ? base : `${base}-${count}`, graphPath: graphPaths[index] as string };
    });
    const portValue = Number(option("--port") ?? process.env.PORT ?? "7331");
    if (!Number.isInteger(portValue) || portValue < 0 || portValue > 65_535) throw new Error("port must be an integer from 0 to 65535");
    const port = portValue;
    const legacyHost = process.env.REPOMIND_HOST;
    const host = option("--host") ?? process.env.FEHM_HOST ?? legacyHost ?? "127.0.0.1";
    const explicitTokenEnvironment = option("--token-env");
    const tokenEnvironment = explicitTokenEnvironment ?? "FEHM_AUTH_TOKEN";
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(tokenEnvironment)) throw new Error("token environment variable name is invalid");
    const legacyToken = explicitTokenEnvironment ? undefined : process.env.REPOMIND_AUTH_TOKEN;
    const authToken = (process.env[tokenEnvironment] ?? legacyToken)?.trim();
    if (!process.env.FEHM_HOST && legacyHost) console.error("REPOMIND_HOST is deprecated; use FEHM_HOST");
    if (!process.env[tokenEnvironment] && legacyToken) console.error("REPOMIND_AUTH_TOKEN is deprecated; use FEHM_AUTH_TOKEN");
    if (authToken && authToken.length < 32) throw new Error(`${tokenEnvironment} must contain at least 32 characters`);
    const loopback = new Set(["127.0.0.1", "::1", "localhost"]);
    if (!loopback.has(host) && !authToken && !process.argv.includes("--allow-unauthenticated")) {
      throw new Error(`refusing to expose an unauthenticated cockpit on ${host}; set ${tokenEnvironment} or pass --allow-unauthenticated explicitly`);
    }
    const synchronizers: ReturnType<typeof startProjectSynchronizer>[] = [];
    if (process.argv.includes("--watch")) {
      const interval = Number(option("--interval") ?? "1500");
      for (const [index, graph] of graphs.entries()) {
        synchronizers.push(startProjectSynchronizer(createConfig(graph.repository.root, path.dirname(graphPaths[index] as string)), {
          intervalMs: Number.isFinite(interval) ? interval : 1500,
          onError(error) { console.error(`Synchronization failed for ${graph.repository.name}: ${error.message}`); },
        }));
      }
    }
    const server = createCockpitServer({
      projects,
      ...(authToken ? { authToken } : {}),
      onError(error, requestId) { console.error(`[${requestId}] ${error.message}`); },
    });
    server.requestTimeout = 300_000;
    server.headersTimeout = 15_000;
    server.keepAliveTimeout = 5_000;
    server.maxRequestsPerSocket = 1_000;
    let shuttingDown = false;
    const shutdown = (signal: NodeJS.Signals): void => {
      if (shuttingDown) return;
      shuttingDown = true;
      console.error(`fehm received ${signal}; closing cleanly`);
      for (const synchronizer of synchronizers) synchronizer.stop();
      server.close((error) => {
        if (error) { console.error(error.message); process.exitCode = 1; }
      });
      setTimeout(() => server.closeAllConnections(), 10_000).unref();
    };
    process.once("SIGTERM", shutdown);
    process.once("SIGINT", shutdown);
    server.on("error", (error) => { for (const synchronizer of synchronizers) synchronizer.stop(); console.error(`fehm server error: ${error.message}`); process.exitCode = 1; });
    server.listen(port, host, () => {
      const address = server.address();
      const actualPort = typeof address === "object" && address ? address.port : port;
      const displayHost = host.includes(":") ? `[${host}]` : host;
      console.log(`fehm cockpit: http://${displayHost}:${actualPort}${authToken ? " (bearer token required)" : ""}`);
    });
    return;
  }

  usage();
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
