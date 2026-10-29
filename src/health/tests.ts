import type { BriefingFacts } from "../codebase-briefing/facts.js";
import type { FehmEngine } from "../engine.js";
import type { Finding, FindingEvidence } from "../findings/model.js";
import type { EdgeKind, GraphNode } from "../model.js";
import type { Thresholds } from "./config.js";
import { makeFinding } from "./rules.js";
import type { CriticalPath, CriticalPathStep, FileAnalysisResult, FileHistory, FunctionMetrics, Protection, TestCategory, TestFileFacts, TestGap, TestReport } from "./types.js";

/**
 * Test health: the test inventory, how production symbols are protected, and
 * the gaps that matter. Protection comes from runtime coverage when an
 * artifact has line data for the file; otherwise from the code graph
 * (a test calls or references the symbol, directly or through calls), which
 * is a relationship, not proof of execution, and is labelled so.
 */

const SYMBOL_KINDS = new Set(["function", "method", "class"]);
const REACH_KINDS: readonly EdgeKind[] = ["calls", "references", "uses", "extends", "implements", "handles"];
const TRANSITIVE_DEPTH = 4;
export const SENSITIVE = /(auth|login|logout|passw|credential|secret|jwt|oauth|csrf|session|permission|privilege|admin|payment|charge|billing|invoice|refund|encrypt|decrypt|signature|saniti[sz]|(?:access|refresh|api|bearer|id)_?token)/i;
const RECENT_DAYS = 30;
const GAP_THRESHOLD = 6;
const MAX_GAPS = 200;
const MAX_PATHS = 40;

export interface TestInputs {
  engine: FehmEngine;
  facts: BriefingFacts;
  results: Map<string, FileAnalysisResult>;
  /** Runtime line hits per file, when a coverage artifact has line data. */
  runtimeLines: Map<string, Map<number, number>>;
  history: Record<string, FileHistory>;
  functionMetrics: Map<string, FunctionMetrics>;
  thresholds: Thresholds;
  skip: (path: string) => boolean;
  now?: number;
}

export interface TestAnalysis {
  report: TestReport;
  findings: Finding[];
  protection: Map<string, Protection>;
  symbols: GraphNode[];
}

export function analyzeTests(input: TestInputs): TestAnalysis {
  const { engine, facts, results } = input;
  const graph = engine.graph;
  const testFiles = facts.testFiles.filter((p) => !input.skip(p));
  const testSet = new Set(testFiles);
  const sources = new Set(facts.sourceFiles.filter((p) => !input.skip(p) && !/\.d\.[cm]?ts$/.test(p)));

  // Inventory.
  const files: TestFileFacts[] = [];
  for (const path of testFiles) {
    const r = results.get(path)?.test;
    if (!r) continue;
    const productionFiles = [...(facts.fileDeps.out.get(path) ?? [])].filter((p) => sources.has(p)).length;
    files.push({ ...r, productionFiles });
  }
  const categories: Partial<Record<TestCategory, number>> = {};
  for (const f of files) categories[f.category] = (categories[f.category] ?? 0) + f.cases;
  const sum = (k: keyof TestReport["totals"]): number => files.reduce((s, f) => s + (f[k as keyof TestFileFacts] as number), 0);
  const totals = { files: files.length, cases: sum("cases"), assertions: sum("assertions"), skipped: sum("skipped"), focused: sum("focused"), empty: sum("empty"), assertionless: sum("assertionless"), tautologies: sum("tautologies"), mocks: sum("mocks") };

  // Protection: runtime line data wins; otherwise graph reachability from test code.
  const symbols = graph.nodes().filter((n) => SYMBOL_KINDS.has(n.kind) && n.path && sources.has(n.path));
  const direct = new Set<string>();
  for (const n of graph.nodes()) {
    if (!n.path || !testSet.has(n.path)) continue;
    for (const e of graph.edgesOf(n.id, "out", REACH_KINDS)) {
      const t = graph.node(e.target);
      if (t?.path && sources.has(t.path)) direct.add(t.id);
    }
  }
  const transitive = new Set<string>();
  let frontier = [...direct];
  for (let d = 0; d < TRANSITIVE_DEPTH && frontier.length; d += 1) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const e of graph.edgesOf(id, "out", REACH_KINDS)) {
        if (direct.has(e.target) || transitive.has(e.target)) continue;
        const t = graph.node(e.target);
        if (!t?.path || !sources.has(t.path)) continue;
        transitive.add(t.id);
        next.push(t.id);
      }
      // A class is exercised through its methods; a method through its class's use.
      const n = graph.node(id);
      if (n?.kind === "method") for (const e of graph.edgesOf(id, "in", ["defines"])) if (graph.node(e.source)?.kind === "class" && !direct.has(e.source)) transitive.add(e.source);
    }
    frontier = next;
  }
  const protection = new Map<string, Protection>();
  for (const s of symbols) {
    const lines = s.path ? input.runtimeLines.get(s.path) : undefined;
    const runtime = lines && s.location ? runtimeState(lines, s.location.line, s.location.endLine ?? s.location.line) : undefined;
    if (runtime === "covered") protection.set(s.id, "runtime");
    else if (runtime === "uncovered") protection.set(s.id, "none");
    else protection.set(s.id, direct.has(s.id) ? "direct" : transitive.has(s.id) ? "transitive" : "none");
  }

  // Risk-ranked gaps.
  const handlers = new Set<string>();
  for (const r of facts.signals.routes) if (r.handler) handlers.add(r.handler.id);
  for (const c of facts.signals.cli) if (c.handler) handlers.add(c.handler.id);
  const sinks = facts.signals.sinks;
  const now = input.now ?? Date.now();
  const gaps: TestGap[] = [];
  for (const s of symbols) {
    if (protection.get(s.id) !== "none" || !s.path) continue;
    const fanIn = new Set(graph.edgesOf(s.id, "in", ["calls", "references", "uses", "extends", "implements"]).map((e) => graph.node(e.source)?.path).filter((p): p is string => Boolean(p) && p !== s.path)).size;
    const m = input.functionMetrics.get(s.id);
    const entryReach = facts.metrics.get(s.path)?.entryReach ?? 0;
    const security = SENSITIVE.test(s.name) || SENSITIVE.test(s.path);
    const last = input.history[s.path]?.last;
    const changedRecently = Boolean(last && now - Date.parse(last) < RECENT_DAYS * 86_400_000);
    const end = s.location?.endLine ?? s.location?.line ?? 0;
    const sink = sinks.find((x) => x.path === s.path && s.location && x.line >= s.location.line && x.line <= end);
    const reasons: string[] = [];
    let risk = 0;
    if (fanIn) {
      risk += Math.min(fanIn, 10);
      reasons.push(`used from ${fanIn} other ${fanIn === 1 ? "file" : "files"}`);
    }
    if (handlers.has(s.id)) {
      risk += 4;
      reasons.push("handles a route or CLI command");
    }
    if (security) {
      risk += 4;
      reasons.push("security-sensitive name or path");
    }
    if (sink) {
      risk += 3;
      reasons.push(`contains ${sink.kind} (line ${sink.line})`);
    }
    if (entryReach) {
      risk += 2;
      reasons.push(`reachable from ${entryReach} entry ${entryReach === 1 ? "point" : "points"}`);
    }
    if (s.exported) {
      risk += 1;
      reasons.push("exported");
    }
    if (m && m.cyclomatic > input.thresholds.cyclomatic) {
      risk += m.cyclomatic > 2 * input.thresholds.cyclomatic ? 3 : 2;
      reasons.push(`cyclomatic complexity ${m.cyclomatic}`);
    }
    if (changedRecently) {
      risk += 2;
      reasons.push(`file changed in the last ${RECENT_DAYS} days`);
    }
    if (risk < GAP_THRESHOLD) continue;
    gaps.push({ nodeId: s.id, name: s.name, kind: s.kind, path: s.path, ...(s.location ? { line: s.location.line } : {}), risk, reasons, fanIn, exported: Boolean(s.exported), entryReach, security, changedRecently, ...(m ? { cyclomatic: m.cyclomatic } : {}) });
  }
  gaps.sort((a, b) => b.risk - a.risk || a.path.localeCompare(b.path) || (a.line ?? 0) - (b.line ?? 0));

  const paths = criticalPaths(engine, facts, protection);
  const report: TestReport = { files: files.sort((a, b) => a.path.localeCompare(b.path)), categories, totals, gaps: gaps.slice(0, MAX_GAPS), paths };
  const hasRuntime = input.runtimeLines.size > 0;
  return { report, findings: testFindings(report, facts, sources, protection, direct, hasRuntime), protection, symbols };
}

function runtimeState(lines: Map<number, number>, from: number, to: number): "covered" | "uncovered" | undefined {
  let instrumented = false;
  for (let l = from; l <= to; l += 1) {
    const h = lines.get(l);
    if (h === undefined) continue;
    instrumented = true;
    if (h > 0) return "covered";
  }
  return instrumented ? "uncovered" : undefined;
}

function criticalPaths(engine: FehmEngine, facts: BriefingFacts, protection: Map<string, Protection>): CriticalPath[] {
  const entries: { kind: "route" | "cli"; label: string; path: string; line: number; handler: GraphNode }[] = [];
  for (const r of facts.signals.routes) if (r.handler) entries.push({ kind: "route", label: `${r.method.toUpperCase()} ${r.route}`, path: r.path, line: r.line, handler: r.handler });
  for (const c of facts.signals.cli) if (c.handler) entries.push({ kind: "cli", label: `${c.group === "main" ? "" : `${c.group} `}${c.name}`.trim(), path: c.path, line: c.line, handler: c.handler });
  const seen = new Set<string>();
  const out: CriticalPath[] = [];
  for (const e of entries) {
    const key = `${e.kind}:${e.label}:${e.handler.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const flow = engine.flow(e.handler.id, 3);
    if (flow.status !== "found") continue;
    const steps: CriticalPathStep[] = [];
    const walk = (s: typeof flow.result): void => {
      if (steps.length >= 25 || s.repeated) return;
      const p = protection.get(s.id);
      if (p !== undefined) steps.push({ nodeId: s.id, name: s.name, ...(s.path ? { path: s.path } : {}), depth: s.depth, protection: p });
      for (const c of s.children) walk(c);
    };
    walk(flow.result);
    if (!steps.length) continue;
    out.push({ id: key, kind: e.kind, label: e.label, path: e.path, line: e.line, steps, unprotected: steps.filter((s) => s.protection === "none").length });
    if (out.length >= MAX_PATHS) break;
  }
  return out.sort((a, b) => b.unprotected - a.unprotected || a.label.localeCompare(b.label));
}

function fileEvidence(files: TestFileFacts[], detail: (f: TestFileFacts) => string): FindingEvidence[] {
  return files.map((f) => ({ type: "test", path: f.path, detail: detail(f), confidence: "strong" }));
}

function testFindings(report: TestReport, facts: BriefingFacts, sources: Set<string>, protection: Map<string, Protection>, direct: Set<string>, hasRuntime: boolean): Finding[] {
  const out: Finding[] = [];
  const { files } = report;
  if (!files.length && sources.size) {
    out.push(
      makeFinding("test/no-tests", {
        id: "test:no-tests",
        title: "No tests were found",
        message: `${sources.size} source files and no test files (by name or location convention).`,
        why: "Without tests, every change relies on manual checking, and refactoring is unsafe.",
        action: "Add tests for the entry points and the most-used modules first (see Critical test gaps once tests exist).",
        confidence: "strong",
        evidence: [{ type: "absence", detail: "No file is classified as a test by the repository scanner (test/ folders, *.test.*, *_test.*, test_*.py …)." }],
        missing: ["Test files named or located by a recognised convention."],
      }),
    );
    return out;
  }
  const agg = (rule: string, id: string, list: TestFileFacts[], count: (f: TestFileFacts) => number, title: (n: number) => string, message: string, why: string, action: string, confidence: Finding["confidence"]): void => {
    const hit = list.filter((f) => count(f) > 0);
    if (!hit.length) return;
    const n = hit.reduce((s, f) => s + count(f), 0);
    out.push(makeFinding(rule, { id, title: title(n), message: message.replace("{n}", String(n)).replace("{files}", String(hit.length)), why, action, confidence, evidence: fileEvidence(hit, (f) => `${count(f)} in ${f.cases} test cases`) }));
  };
  agg("test/focused-test", "test:focused", files, (f) => f.focused, (n) => `${n} focused ${n === 1 ? "test" : "tests"} (.only / fit)`, "{n} focused markers in {files} files.", "A focused test makes the runner skip every other test, so the suite passes without running.", "Remove `.only` / `fit` / `fdescribe` before committing.", "verified");
  agg("test/skipped-test", "test:skipped", files, (f) => f.skipped, (n) => `${n} skipped ${n === 1 ? "test" : "tests"}`, "{n} skipped or todo tests in {files} files.", "Skipped tests protect nothing and are often forgotten.", "Fix and re-enable them, or delete them and track the gap in an issue.", "verified");
  agg("test/empty-test", "test:empty", files, (f) => f.empty, (n) => `${n} empty ${n === 1 ? "test" : "tests"}`, "{n} test cases have an empty body in {files} files.", "An empty test always passes and reports protection that does not exist.", "Write the test or delete it.", "verified");
  agg("test/assertionless-test", "test:assertionless", files, (f) => f.assertionless, (n) => `${n} ${n === 1 ? "test has" : "tests have"} no recognised assertion`, "{n} test cases in {files} files call no assertion, expect, verify or local helper.", "A test that asserts nothing passes whenever the code does not throw, which is rarely what it is meant to check.", "Add an assertion on the result. If a custom helper asserts, name it assert…/expect…/verify… so it is recognised.", "inferred");
  const heavy = files.filter((f) => f.mocks >= 10 && f.mocks > 2 * Math.max(1, f.assertions));
  if (heavy.length) out.push(makeFinding("test/mock-heavy", { id: "test:mock-heavy", title: `${heavy.length} mock-heavy test ${heavy.length === 1 ? "file" : "files"}`, message: "These files set up more than twice as many mocks as they make assertions (and at least 10).", why: "Tests that mostly verify mocks check how the code is wired, not what it does, and break on every refactor.", action: "Test through real collaborators where they are cheap; keep mocks for slow or external boundaries.", confidence: "inferred", evidence: fileEvidence(heavy, (f) => `${f.mocks} mocks, ${f.assertions} assertions`) }));

  // Critical gaps.
  const protectedBy = hasRuntime ? "runtime coverage or a test relationship" : "a test relationship";
  for (const g of report.gaps.slice(0, 30)) {
    out.push(
      makeFinding("test/critical-gap", {
        id: `test:gap:${g.nodeId}`,
        title: `${g.name} has no test protection`,
        message: `${g.kind} ${g.name} is not reached by ${protectedBy}, and ${g.reasons.slice(0, 3).join(", ")}.`,
        severity: g.risk >= 10 ? "high" : "medium",
        why: "Untested code that many callers depend on, or that handles input or security, is where regressions do the most damage.",
        action: `Add a test that exercises ${g.name}${g.security ? ", including its failure paths (invalid input, missing permission)" : ""}.`,
        confidence: hasRuntime ? "strong" : "inferred",
        file: g.path,
        ...(g.line ? { line: g.line } : {}),
        symbol: g.name,
        nodeId: g.nodeId,
        metric: { name: "risk", value: g.risk, threshold: GAP_THRESHOLD },
        evidence: [{ type: hasRuntime ? "coverage" : "test", path: g.path, ...(g.line ? { line: g.line } : {}), nodeId: g.nodeId, detail: g.reasons.join(" · "), confidence: hasRuntime ? "strong" : "inferred" }],
        missing: [hasRuntime ? "An executed line in a runtime coverage artifact, or a call or reference from a test." : "A call or reference from test code (runtime coverage would settle it)."],
        verification: ["Add the test, re-run Fehm health: the gap disappears once a test reaches the symbol."],
      }),
    );
  }
  for (const p of report.paths.filter((x) => x.unprotected && (x.steps[0]?.protection === "none" || x.unprotected * 2 >= x.steps.length)).slice(0, 15)) {
    out.push(
      makeFinding("test/critical-path-gap", {
        id: `test:path:${p.id}`,
        title: `${p.kind === "route" ? "Route" : "Command"} ${p.label}: ${p.unprotected} of ${p.steps.length} steps untested`,
        message: `Following calls from the handler, ${p.unprotected} of ${p.steps.length} steps have no test protection.`,
        why: "An entry point is where real input arrives; untested steps behind it are reached in production first.",
        action: "Add a test that drives this entry point end to end, or tests for the untested steps.",
        confidence: "inferred",
        file: p.path,
        line: p.line,
        evidence: p.steps.filter((s) => s.protection === "none").map((s) => ({ type: "test" as const, ...(s.path ? { path: s.path } : {}), nodeId: s.nodeId, detail: `${"  ".repeat(s.depth)}${s.name}: untested`, confidence: "inferred" as const })),
      }),
    );
  }
  // Sensitive symbols tested only on the happy path.
  const failureFiles = new Set(files.filter((f) => f.failurePath > 0).map((f) => f.path));
  const noFailure: FindingEvidence[] = [];
  const graph = facts.graph;
  for (const id of direct) {
    const n = graph.node(id);
    if (!n?.path || (n.kind !== "function" && n.kind !== "method") || !(SENSITIVE.test(n.name) || SENSITIVE.test(n.path))) continue;
    const testers = new Set(graph.edgesOf(id, "in", REACH_KINDS).map((e) => graph.node(e.source)?.path).filter((p): p is string => Boolean(p) && facts.roleByPath.get(p!) === "test"));
    if (!testers.size || [...testers].some((t) => failureFiles.has(t))) continue;
    noFailure.push({ type: "test", path: n.path, ...(n.location ? { line: n.location.line } : {}), nodeId: id, detail: `${n.name}: tested by ${[...testers].slice(0, 2).join(", ")}, none of which checks a failure`, confidence: "inferred" });
  }
  if (noFailure.length) out.push(makeFinding("test/no-failure-path", { id: "test:no-failure-path", title: `${noFailure.length} sensitive ${noFailure.length === 1 ? "symbol is" : "symbols are"} tested only on the success path`, message: "Their test files contain no expectation of a thrown error, a rejection or an error status (4xx).", why: "Authentication, validation and payment code fail in interesting ways; a test that only checks success cannot catch a check that lets bad input through.", action: "Add negative tests: invalid input, missing or expired credentials, insufficient permission.", confidence: "inferred", evidence: noFailure }));
  void protection;
  return out;
}
