import { existsSync } from "node:fs";
import { join, posix } from "node:path";
import type { BriefingFacts } from "../codebase-briefing/facts.js";
import { qualitySignals, type CodeSignal as DriftFinding, type SignalKind } from "../drift/signals.js";
import type { FehmEngine } from "../engine.js";
import type { Finding, FindingEvidence, Severity } from "../findings/model.js";
import type { Thresholds } from "./config.js";
import { makeFinding, rule } from "./rules.js";
import type { ClassMetrics, FileAnalysisResult, FunctionMetrics, PatternHit, QualityReport } from "./types.js";

/**
 * Code quality, maintainability, reliability and AI-code defect findings,
 * from the per-file analysis (metrics.ts), the graph, and 3.4's
 * engineering-quality signals, which are reused rather than re-implemented.
 */

// ─── complexity ─────────────────────────────────────────────────────

const band = (value: number, steps: [number, Severity][], fallback: Severity): Severity => steps.find(([max]) => value <= max)?.[1] ?? fallback;

export function complexityFindings(functions: FunctionMetrics[], t: Thresholds): Finding[] {
  const out: Finding[] = [];
  for (const fn of functions) {
    const where = { file: fn.path, line: fn.line, symbol: fn.name, ...(fn.nodeId ? { nodeId: fn.nodeId } : {}) };
    const ev = (detail: string): FindingEvidence[] => [{ type: "metric", path: fn.path, line: fn.line, ...(fn.nodeId ? { nodeId: fn.nodeId } : {}), detail, confidence: fn.resolution === "ast" ? "verified" : "inferred" }];
    const conf = fn.resolution === "ast" ? "verified" : "inferred";
    const approx = fn.resolution === "heuristic" ? " (estimated from source lines)" : "";
    if (fn.cyclomatic > t.cyclomatic) {
      out.push(makeFinding("quality/cyclomatic-complexity", { id: `quality:cyclomatic:${fn.path}:${fn.name}`, ...where, severity: band(fn.cyclomatic, [[15, "low"], [25, "medium"]], "high"), title: `${fn.name}: cyclomatic complexity ${fn.cyclomatic}`, message: `${fn.cyclomatic} independent paths${approx}; the limit is ${t.cyclomatic}.`, why: "Each path needs its own test; past about ten, functions are hard to test fully and easy to break.", action: "Split independent branches into functions, or replace condition chains with a lookup table or polymorphism.", confidence: conf, metric: { name: "cyclomatic", value: fn.cyclomatic, threshold: t.cyclomatic }, evidence: ev(`${fn.lines} lines, ${fn.cyclomatic} paths${fn.cognitive !== undefined ? `, cognitive ${fn.cognitive}` : ""}`) }));
    }
    if (fn.cognitive !== undefined && fn.cognitive > t.cognitive) {
      out.push(makeFinding("quality/cognitive-complexity", { id: `quality:cognitive:${fn.path}:${fn.name}`, ...where, severity: band(fn.cognitive, [[30, "low"], [50, "medium"]], "high"), title: `${fn.name}: cognitive complexity ${fn.cognitive}`, message: `Nested and interrupted control flow scores ${fn.cognitive}; the limit is ${t.cognitive}.`, why: "Cognitive complexity measures how hard the function is to follow, weighting nesting heavily.", action: "Flatten with early returns and extract nested blocks into named functions.", confidence: conf, metric: { name: "cognitive", value: fn.cognitive, threshold: t.cognitive }, evidence: ev(`nesting depth ${fn.nesting}, ${fn.lines} lines`) }));
    }
    if (fn.nesting > t.nesting) {
      out.push(makeFinding("quality/deep-nesting", { id: `quality:nesting:${fn.path}:${fn.name}`, ...where, severity: band(fn.nesting, [[t.nesting + 2, "low"], [t.nesting + 5, "medium"]], "high"), title: `${fn.name}: nested ${fn.nesting} levels deep`, message: `Control flow nests ${fn.nesting} levels${approx}; the limit is ${t.nesting}.`, why: "Deeply nested code hides which conditions apply to which statement.", action: "Use guard clauses (early return/continue) and extract inner blocks.", confidence: conf, metric: { name: "nesting", value: fn.nesting, threshold: t.nesting }, evidence: ev(`max depth ${fn.nesting}`) }));
    }
    if (fn.lines > t.functionLines) {
      out.push(makeFinding("quality/long-function", { id: `quality:length:${fn.path}:${fn.name}`, ...where, severity: fn.lines > 4 * t.functionLines ? "medium" : "low", title: `${fn.name}: ${fn.lines} lines`, message: `The function spans ${fn.lines} lines; the limit is ${t.functionLines}.`, why: "Long functions usually do several things and are hard to name, test and review.", action: "Extract the steps into well-named functions.", confidence: "verified", metric: { name: "lines", value: fn.lines, threshold: t.functionLines }, evidence: ev(`lines ${fn.line}–${fn.endLine}`) }));
    }
    if (fn.params > t.params) {
      out.push(makeFinding("quality/too-many-params", { id: `quality:params:${fn.path}:${fn.name}`, ...where, severity: fn.params > t.params + 3 ? "medium" : "low", title: `${fn.name}: ${fn.params} parameters`, message: `${fn.params} parameters; the limit is ${t.params}.`, why: "Long parameter lists are easy to call in the wrong order and usually mean a missing object.", action: "Group related parameters into an options object or type.", confidence: conf, metric: { name: "params", value: fn.params, threshold: t.params }, evidence: ev(`${fn.params} parameters`) }));
    }
  }
  return out;
}

export function classMetrics(engine: FehmEngine, sources: Set<string>): ClassMetrics[] {
  const out: ClassMetrics[] = [];
  const members = new Map<string, { kind: string; line: number }[]>();
  for (const n of engine.graph.nodes()) {
    if ((n.kind === "method" || n.kind === "field") && n.path && n.location && sources.has(n.path)) members.set(n.path, [...(members.get(n.path) ?? []), { kind: n.kind, line: n.location.line }]);
  }
  for (const n of engine.graph.nodes()) {
    if (n.kind !== "class" || !n.path || !sources.has(n.path) || !n.location?.endLine) continue;
    const { line, endLine } = n.location;
    const inside = (members.get(n.path) ?? []).filter((m) => m.line > line && m.line <= endLine);
    out.push({ name: n.name, path: n.path, line, nodeId: n.id, methods: inside.filter((m) => m.kind === "method").length, fields: inside.filter((m) => m.kind === "field").length, lines: endLine - line + 1 });
  }
  return out;
}

export function classFindings(classes: ClassMetrics[], t: Thresholds): Finding[] {
  const out: Finding[] = [];
  for (const c of classes) {
    const over: [string, number, number][] = [];
    if (c.lines > t.classLines) over.push(["lines", c.lines, t.classLines]);
    if (c.methods > t.classMethods) over.push(["methods", c.methods, t.classMethods]);
    if (c.fields > t.classFields) over.push(["fields", c.fields, t.classFields]);
    if (!over.length) continue;
    const worst = over.reduce((a, b) => (b[1] / b[2] > a[1] / a[2] ? b : a));
    out.push(
      makeFinding("maintainability/large-class", {
        id: `maintainability:class:${c.path}:${c.name}`,
        severity: worst[1] / worst[2] >= 1.5 || over.length >= 2 ? "high" : "medium",
        title: `${c.name}: ${over.map(([k, v]) => `${v} ${k}`).join(", ")}`,
        message: `Over the limit for ${over.map(([k, , lim]) => `${k} (${lim})`).join(" and ")}.`,
        why: "A class this size usually holds several responsibilities, so unrelated changes collide in it.",
        action: "Split it along the groups of methods that use the same fields.",
        confidence: "strong",
        file: c.path,
        line: c.line,
        symbol: c.name,
        ...(c.nodeId ? { nodeId: c.nodeId } : {}),
        metric: { name: worst[0], value: worst[1], threshold: worst[2] },
        evidence: [{ type: "metric", path: c.path, line: c.line, ...(c.nodeId ? { nodeId: c.nodeId } : {}), detail: `${c.methods} methods, ${c.fields} fields, ${c.lines} lines` }],
      }),
    );
  }
  return out;
}

export function cycleFindings(facts: BriefingFacts, skip: (p: string) => boolean): Finding[] {
  return facts.cycles
    .filter((c) => c.some((p) => !skip(p)))
    .slice(0, 20)
    .map((cycle) =>
      makeFinding("maintainability/import-cycle", {
        id: `maintainability:cycle:${[...cycle].sort().join("|")}`,
        title: `Dependency cycle between ${cycle.length} files`,
        message: `${cycle.slice(0, 4).join(" → ")}${cycle.length > 4 ? " → …" : ""} depend on each other in a loop.`,
        why: "Files in a cycle cannot be understood, tested or reused on their own, and module initialisation order becomes fragile.",
        action: "Move what both sides need into a third module, or invert one dependency.",
        confidence: "strong",
        file: cycle[0]!,
        evidence: cycle.map((p) => ({ type: "import" as const, path: p, nodeId: `file:${p}`, detail: `depends on ${[...(facts.fileDeps.out.get(p) ?? [])].filter((q) => cycle.includes(q)).join(", ")}` })),
      }),
    );
}

export function qualityReport(functions: FunctionMetrics[], classes: number, t: Thresholds): QualityReport {
  const named = functions.filter((f) => f.kind !== "anonymous" || f.lines >= 5);
  const distribution = { low: 0, medium: 0, high: 0, critical: 0 };
  let within = 0;
  for (const f of named) {
    if (f.cyclomatic <= 5) distribution.low += 1;
    else if (f.cyclomatic <= t.cyclomatic) distribution.medium += 1;
    else if (f.cyclomatic <= 2 * t.cyclomatic) distribution.high += 1;
    else distribution.critical += 1;
    if (f.cyclomatic <= t.cyclomatic && (f.cognitive ?? 0) <= t.cognitive && f.nesting <= t.nesting && f.lines <= t.functionLines && f.params <= t.params) within += 1;
  }
  const byFile = new Map<string, QualityReport["files"][number]>();
  for (const f of named) {
    const r = byFile.get(f.path) ?? { path: f.path, functions: 0, maxCyclomatic: 0, totalCyclomatic: 0, lines: 0 };
    r.functions += 1;
    r.maxCyclomatic = Math.max(r.maxCyclomatic, f.cyclomatic);
    r.totalCyclomatic += f.cyclomatic;
    r.lines += f.lines;
    byFile.set(f.path, r);
  }
  return {
    functions: named.length,
    classes,
    distribution,
    withinLimits: within,
    top: [...named].sort((a, b) => b.cyclomatic - a.cyclomatic || (b.cognitive ?? 0) - (a.cognitive ?? 0) || a.path.localeCompare(b.path)).slice(0, 40),
    files: [...byFile.values()].sort((a, b) => b.totalCyclomatic - a.totalCyclomatic || a.path.localeCompare(b.path)),
  };
}

// ─── 3.4 signals, reused ────────────────────────────────────────────

const SIGNAL_RULE: Partial<Record<SignalKind, string>> = {
  "duplicate-implementation": "maintainability/duplicate-implementation",
  "similar-implementation": "maintainability/similar-implementation",
  placeholder: "ai-code/placeholder",
  "pass-through-wrapper": "maintainability/pass-through-wrapper",
  "unused-dependency": "dead-code/unused-dependency",
  "large-file": "maintainability/large-file",
  "todo-markers": "maintainability/todo-markers",
  // unused-export is covered, with more evidence, by the dead-code analyzer.
};

export function signalFindings(engine: FehmEngine, facts: BriefingFacts, skip: (p: string) => boolean): { findings: Finding[]; unusedDependencies: string[] } {
  const findings: Finding[] = [];
  let unusedDependencies: string[] = [];
  for (const s of qualitySignals(engine, facts, skip)) {
    const ruleId = s.signal ? SIGNAL_RULE[s.signal] : undefined;
    if (!ruleId) continue;
    if (s.signal === "unused-dependency") unusedDependencies = s.evidence.map((e) => e.detail!.split(" ")[0]!);
    findings.push(fromDrift(s, ruleId));
  }
  return { findings, unusedDependencies };
}

function fromDrift(s: DriftFinding, ruleId: string): Finding {
  const f = makeFinding(ruleId, {
    id: s.id.replace(/^quality:/, "health:"),
    title: s.title,
    message: s.observed,
    why: s.why ?? "",
    action: s.action ?? "",
    confidence: s.confidence,
    evidence: s.evidence.map((e) => ({ type: "pattern" as const, path: e.path, ...(e.line ? { line: e.line } : {}), ...(e.nodeId ? { nodeId: e.nodeId } : {}), detail: e.detail ?? "", confidence: e.confidence })),
    verification: s.verification,
    total: s.evidence.length + s.more,
  });
  if (s.evidence.length === 1 && s.evidence[0]!.path) {
    f.file = s.evidence[0]!.path;
    if (s.evidence[0]!.line) f.line = s.evidence[0]!.line;
  }
  return f;
}

// ─── pattern hits ───────────────────────────────────────────────────

const HIT_TEXT: Record<string, { title: (n: number) => string; why: string; action: string; confidence: Finding["confidence"] }> = {
  "quality/compiler-suppression": { title: (n) => `${n} compiler ${n === 1 ? "suppression" : "suppressions"} (@ts-ignore, @ts-nocheck, bare type: ignore)`, why: "A suppression hides every error on the line or file, including ones introduced later.", action: "Fix the underlying type error, or use @ts-expect-error with a reason so the suppression fails once it is no longer needed.", confidence: "verified" },
  "quality/blanket-lint-disable": { title: (n) => `${n} blanket lint ${n === 1 ? "disable" : "disables"}`, why: "Disabling every rule at once removes all the linter's protection for that code.", action: "Disable only the specific rules that need it, with a reason.", confidence: "verified" },
  "quality/debug-leftover": { title: (n) => `${n} debug ${n === 1 ? "leftover" : "leftovers"}`, why: "A debugger statement or breakpoint left in shipped code stops execution when a debugger is attached, or hangs a process waiting for input.", action: "Remove it.", confidence: "verified" },
  "quality/duplicate-branches": { title: (n) => `${n} ${n === 1 ? "condition has" : "conditions have"} identical branches`, why: "Two branches doing the same thing usually means one was copied and not changed, or the condition is unnecessary.", action: "Merge the branches, or fix the one that was meant to differ.", confidence: "verified" },
  "reliability/empty-catch": { title: (n) => `${n} empty error ${n === 1 ? "handler" : "handlers"}`, why: "An empty catch swallows the error: the failure is invisible and the program continues in an unknown state.", action: "Handle the error, log it, or rethrow. If ignoring is deliberate, say why in a comment.", confidence: "verified" },
  "reliability/bare-except": { title: (n) => `${n} bare except ${n === 1 ? "clause" : "clauses"}`, why: "A bare except also catches KeyboardInterrupt and SystemExit, so the program cannot be stopped cleanly.", action: "Catch the specific exceptions you expect (at most Exception).", confidence: "strong" },
  "reliability/swallowed-exception": { title: (n) => `${n} ${n === 1 ? "exception handler ignores" : "exception handlers ignore"} every error`, why: "Catching Exception and passing hides real failures.", action: "Log or handle the error, and narrow the exception type.", confidence: "strong" },
  "reliability/missing-timeout": { title: (n) => `${n} network ${n === 1 ? "call has" : "calls have"} no timeout`, why: "Without a timeout, a slow or unresponsive server blocks the caller indefinitely.", action: "Pass an explicit timeout (requests: timeout=…; Go: an http.Client with Timeout).", confidence: "strong" },
  "reliability/async-foreach": { title: (n) => `${n} async ${n === 1 ? "callback" : "callbacks"} passed to forEach`, why: "forEach ignores the returned promises: the loop does not wait, and rejections are unhandled.", action: "Use for…of with await, or await Promise.all(items.map(…)).", confidence: "verified" },
  "reliability/async-promise-executor": { title: (n) => `${n} async Promise ${n === 1 ? "executor" : "executors"}`, why: "An exception thrown in an async executor is lost instead of rejecting the promise.", action: "Make the executor synchronous, or drop the new Promise wrapper and use the async function directly.", confidence: "verified" },
  "reliability/discarded-async-map": { title: (n) => `${n} discarded map(async …) ${n === 1 ? "result" : "results"}`, why: "The promises are never awaited: work may not finish and failures go unhandled.", action: "await Promise.all(items.map(async …)).", confidence: "verified" },
  "reliability/await-in-loop": { title: (n) => `${n} ${n === 1 ? "function awaits" : "functions await"} inside a loop`, why: "Awaiting in a loop runs the operations one after another. Fine when order matters; slow when it does not.", action: "If the iterations are independent, run them together with Promise.all.", confidence: "verified" },
  "reliability/missing-cleanup": { title: (n) => `${n} ${n === 1 ? "file is" : "files are"} opened without being closed`, why: "Open handles leak until garbage collection, and writes may not be flushed.", action: "Use a with block.", confidence: "inferred" },
  "ai-code/weakened-test": { title: (n) => `${n} always-true ${n === 1 ? "assertion" : "assertions"}`, why: "expect(true).toBe(true) and assert True always pass; they often replace an assertion that was failing.", action: "Assert on the behaviour under test, or delete the test.", confidence: "verified" },
  "ai-code/disabled-control": { title: (n) => `${n} disabled safety ${n === 1 ? "control" : "controls"}`, why: "Turning off TLS verification or CSRF protection to make something work removes the protection in production too.", action: "Restore the control; fix the certificate or configuration that made it fail.", confidence: "strong" },
  "ai-code/placeholder-data": { title: (n) => `${n} placeholder ${n === 1 ? "value" : "values"} in source`, why: "Filler text, example e-mail addresses and API-key placeholders in shipped code mean something was never finished.", action: "Replace with real configuration or remove.", confidence: "strong" },
};

export function hitFindings(results: Map<string, FileAnalysisResult>, skip: (p: string) => boolean): Finding[] {
  const by = new Map<string, (PatternHit & { path: string })[]>();
  for (const r of results.values()) {
    if (skip(r.path)) continue;
    for (const h of r.hits) if (HIT_TEXT[h.rule]) by.set(h.rule, [...(by.get(h.rule) ?? []), { ...h, path: r.path }]);
  }
  const out: Finding[] = [];
  for (const [ruleId, hits] of by) {
    const t = HIT_TEXT[ruleId]!;
    const r = rule(ruleId);
    out.push(
      makeFinding(ruleId, {
        id: `${ruleId.replace("/", ":")}`,
        title: t.title(hits.length),
        message: `${hits.length} ${hits.length === 1 ? "occurrence" : "occurrences"} in ${new Set(hits.map((h) => h.path)).size} ${new Set(hits.map((h) => h.path)).size === 1 ? "file" : "files"}.`,
        why: t.why,
        action: t.action,
        confidence: t.confidence,
        severity: r.severity,
        ...(hits.length === 1 ? { file: hits[0]!.path, line: hits[0]!.line } : {}),
        evidence: hits.map((h) => ({ type: ruleId.startsWith("ai-code/weakened") ? ("test" as const) : ("ast" as const), path: h.path, line: h.line, detail: h.detail })),
      }),
    );
  }
  return out;
}

// ─── AI-code defect indicators from the graph ───────────────────────

const ASSET = /\.(?:css|scss|sass|less|svg|png|jpe?g|gif|webp|ico|json|html?|md|txt|wasm|woff2?|ttf|yaml|yml|graphql|gql|vue|svelte)(?:\?.*)?$/i;
const JS_EXT = ["", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts", ".d.ts", "/index.ts", "/index.tsx", "/index.js", "/index.jsx", "/index.mjs"];

export function aiGraphFindings(engine: FehmEngine, facts: BriefingFacts, sources: Set<string>, tsPaths: string[]): Finding[] {
  const out: Finding[] = [];
  // Relative imports of files that exist nowhere on disk (not just outside the index).
  const phantom: FindingEvidence[] = [];
  for (const u of engine.graph.unresolved) {
    if (u.kind !== "import" && u.kind !== "dynamic-import") continue;
    const from = u.location.path;
    if (!sources.has(from) || ASSET.test(u.text)) continue;
    if (/^\.\.?\//.test(u.text)) {
      const base = posix.normalize(posix.join(posix.dirname(from), u.text));
      const stem = base.replace(/\.(?:js|jsx|mjs|cjs)$/, "");
      const exists = [base, stem].some((b) => JS_EXT.some((e) => existsSync(join(engine.root, b + e))));
      if (!exists) phantom.push({ type: "import", path: from, line: u.location.line, detail: `imports "${u.text}", which does not exist`, confidence: "verified" });
    } else if (/^\.+\w/.test(u.text) && /\.py$/.test(from)) {
      const up = u.text.match(/^\.+/)![0].length;
      let dir = posix.dirname(from);
      for (let i = 1; i < up; i += 1) dir = posix.dirname(dir);
      const mod = posix.join(dir, u.text.slice(up).replace(/\./g, "/"));
      if (![".py", "/__init__.py", ""].some((e) => existsSync(join(engine.root, mod + e)))) phantom.push({ type: "import", path: from, line: u.location.line, detail: `imports "${u.text}", which does not exist`, confidence: "strong" });
    }
  }
  if (phantom.length) out.push(makeFinding("ai-code/phantom-import", { id: "ai-code:phantom-import", title: `${phantom.length} ${phantom.length === 1 ? "import points" : "imports point"} at a file that does not exist`, message: "The module path resolves to nothing on disk, so the import fails at build or run time.", why: "Imports of modules that were never written are a common defect in generated code, and in refactors that missed a rename.", action: "Create the module, fix the path, or remove the import.", confidence: "verified", evidence: phantom }));

  // JS/TS packages imported but declared in no manifest.
  const declared = new Set<string>();
  for (const m of facts.manifests) {
    if (m.name) declared.add(m.name);
    for (const d of m.dependencies) declared.add(d.name);
  }
  if (facts.manifests.some((m) => m.kind === "npm")) {
    const undeclared: FindingEvidence[] = [];
    for (const p of facts.packages) {
      if (p.builtin) continue;
      const root = p.name.startsWith("@") ? p.name.split("/").slice(0, 2).join("/") : p.name.split("/")[0]!;
      if (declared.has(root) || declared.has(`@types/${root}`) || tsPaths.some((a) => a === root || (a.endsWith("*") && root.startsWith(a.slice(0, -1)))) || /^[@~#]\/|^[A-Z]:|^\$/.test(p.name)) continue;
      const users = facts.runtimeImporters(p).filter((f) => sources.has(f) && /\.[cm]?[jt]sx?$/.test(f));
      if (!users.length) continue;
      undeclared.push({ type: "import", path: users[0]!, ...(p.line && p.line.path === users[0] ? { line: p.line.line } : {}), nodeId: p.nodeId, detail: `"${root}" is imported by ${users.length} ${users.length === 1 ? "file" : "files"} and declared in no package.json`, confidence: "strong" });
    }
    if (undeclared.length) out.push(makeFinding("ai-code/undeclared-package", { id: "ai-code:undeclared-package", title: `${undeclared.length} imported ${undeclared.length === 1 ? "package is" : "packages are"} not declared`, message: "The code imports packages that no package.json lists. They work only if something else happens to install them, or they do not exist.", why: "An undeclared package breaks on a clean install; a package that does not exist on the registry can be registered by an attacker (slopsquatting).", action: "Add the package to package.json if it is real and intended; otherwise remove the import.", confidence: "strong", evidence: undeclared, missing: ["Registry lookups are not made: whether the package exists on npm is not checked."] }));
  }
  return out;
}
