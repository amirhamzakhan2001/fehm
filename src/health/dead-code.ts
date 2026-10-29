import { posix } from "node:path";
import type { BriefingFacts } from "../codebase-briefing/facts.js";
import type { FehmEngine } from "../engine.js";
import type { Finding } from "../findings/model.js";
import type { GraphNode } from "../model.js";
import { makeFinding } from "./rules.js";
import type { DeadCodeItem, DeadCodeReport, DeadCodeState, FileAnalysisResult } from "./types.js";

/**
 * Dead-code candidates, with the evidence behind each verdict. Following
 * Skylos, "no references" alone is not enough: a symbol is only reported
 * after the checks that could keep it alive have failed: framework
 * conventions and decorators, package exports, string or configuration
 * references, and plain textual mentions the graph could not resolve.
 * Whatever keeps a symbol alive is recorded as its state instead of being
 * dropped silently.
 */

const CANDIDATE_KINDS = new Set(["function", "method", "class", "interface", "type", "enum", "variable"]);
const STRUCTURAL = new Set(["contains", "defines"]);
const BARREL = /(^|\/)(index\.[cm]?[jt]sx?|__init__\.py|mod\.rs|lib\.rs)$/;
const CONVENTION = new Set(
  (
    "main init constructor render setup teardown setUp tearDown setUpClass tearDownClass setUpModule tearDownModule " +
    "componentDidMount componentWillUnmount componentDidUpdate shouldComponentUpdate getDerivedStateFromProps getSnapshotBeforeUpdate componentDidCatch " +
    "ngOnInit ngOnDestroy ngOnChanges ngAfterViewInit connectedCallback disconnectedCallback attributeChangedCallback adoptedCallback " +
    "toJSON toString valueOf equals hashCode compareTo clone finalize run call apply String Error ServeHTTP MarshalJSON UnmarshalJSON Len Less Swap Close Read Write " +
    "getServerSideProps getStaticProps getStaticPaths generateMetadata generateStaticParams middleware loader action default handler " +
    "GET POST PUT PATCH DELETE HEAD OPTIONS get post put patch delete head options dispatch get_queryset get_context_data save clean " +
    "fmt Display Drop Default drop"
  ).split(" "),
);
const MAX_ITEMS = 300;

interface TokenIndex {
  /** Identifier occurrences in code (strings and comments excluded), across source and test files. */
  code: Map<string, number>;
  /** Identifier-like words inside string literals, or anywhere in configuration and manifests. */
  strings: Set<string>;
}

function tokenIndex(facts: BriefingFacts): TokenIndex {
  const code = new Map<string, number>();
  const strings = new Set<string>();
  const words = (s: string, into: (w: string) => void): void => {
    for (const m of s.matchAll(/[A-Za-z_$][\w$]*/g)) into(m[0]);
  };
  for (const f of facts.files) {
    const lines = facts.lines(f.path);
    if (f.role === "config" || f.role === "manifest" || /\.html?$/.test(f.path)) {
      for (const l of lines.slice(0, 20_000)) words(l, (w) => strings.add(w));
      continue;
    }
    if (f.role !== "source" && f.role !== "test") continue;
    for (const l of lines.slice(0, 20_000)) {
      if (l.length > 4000) continue;
      const bare = l.replace(/(["'`])((?:\\.|(?!\1)[^\\])*)\1/g, (_m, _q, inner: string) => {
        words(inner, (w) => strings.add(w));
        return " ";
      });
      const noComment = bare.replace(/\/\/.*$|#(?![[!]).*$/, "");
      words(noComment, (w) => code.set(w, (code.get(w) ?? 0) + 1));
    }
  }
  return { code, strings };
}

export interface DeadCodeInputs {
  engine: FehmEngine;
  facts: BriefingFacts;
  results: Map<string, FileAnalysisResult>;
  skip: (path: string) => boolean;
}

export function analyzeDeadCode({ engine, facts, results, skip }: DeadCodeInputs): { report: DeadCodeReport; findings: Finding[] } {
  const graph = engine.graph;
  const sources = new Set(facts.sourceFiles.filter((p) => !skip(p) && !/\.d\.[cm]?ts$/.test(p)));
  const tokens = tokenIndex(facts);
  const entries = new Set(facts.entryFiles.map((e) => e.path));
  const published = new Set<string>();
  for (const f of sources) {
    if (!BARREL.test(f) && !entries.has(f)) continue;
    for (const e of graph.edgesOf(`file:${f}`, "out", ["imports"])) {
      const t = facts.fileOf(e.target);
      if (t) published.add(t);
    }
  }
  const handlers = new Set<string>();
  for (const r of facts.signals.routes) if (r.handler) handlers.add(r.handler.id);
  for (const c of facts.signals.cli) if (c.handler) handlers.add(c.handler.id);
  const declared = new Map<string, number>();
  for (const n of graph.nodes()) if (CANDIDATE_KINDS.has(n.kind) || n.kind === "field") declared.set(short(n), (declared.get(short(n)) ?? 0) + 1);

  const counts: Record<DeadCodeState, number> = { "definitely-unused": 0, "likely-unused": 0, "possibly-unused": 0, "external-api": 0, "framework-entrypoint": 0, "dynamic-reference": 0 };
  const items: DeadCodeItem[] = [];
  const kept: DeadCodeItem[] = [];
  for (const n of graph.nodes()) {
    if (!CANDIDATE_KINDS.has(n.kind) || !n.path || !sources.has(n.path) || n.isTest) continue;
    if (n.kind === "variable" && !isModuleLevel(graph, n)) continue;
    const inbound = graph.edgesOf(n.id, "in").filter((e) => !STRUCTURAL.has(e.kind));
    if (inbound.length) continue;
    const item = judge(n);
    counts[item.state] += 1;
    if (item.state.endsWith("-unused")) items.push(item);
    else if (kept.length < 60) kept.push(item);
  }

  function judge(n: GraphNode): DeadCodeItem {
    const name = short(n);
    const evidence: DeadCodeItem["evidence"] = [{ check: "no call, reference or import site in the code graph", passed: true }];
    const base = { id: `dead:${n.id}`, kind: n.kind, name: n.name, path: n.path!, ...(n.location ? { line: n.location.line } : {}), nodeId: n.id };
    const decorator = decoratorOf(facts, n);
    const framework = handlers.has(n.id) ? "handles a route or CLI command" : decorator ? `registered by decorator ${decorator}` : CONVENTION.has(name) || /^__\w+__$/.test(name) || /^(?:test|Test)[A-Z_]/.test(name) ? `framework or language convention (${name})` : overrides(graph, n) ? "overrides or implements a base type's member" : undefined;
    evidence.push({ check: framework ? `framework entry point: ${framework}` : "not a framework entry point, decorator registration or convention name", passed: !framework });
    if (framework) return { ...base, state: "framework-entrypoint", evidence };
    const isPublic = n.exported && (published.has(n.path!) || entries.has(n.path!) || BARREL.test(n.path!));
    evidence.push({ check: isPublic ? "exported from a package entry or barrel (public API)" : n.exported ? "exported, but not re-exported by a package entry or barrel" : "not exported", passed: !isPublic });
    if (isPublic) return { ...base, state: "external-api", evidence };
    const inString = tokens.strings.has(name);
    evidence.push({ check: inString ? `name "${name}" appears in a string or configuration (dynamic lookup possible)` : "name appears in no string literal or configuration file", passed: !inString });
    if (inString) return { ...base, state: "dynamic-reference", evidence };
    const mentions = (tokens.code.get(name) ?? 0) - (declared.get(name) ?? 1);
    evidence.push({ check: mentions > 0 ? `name "${name}" occurs ${mentions} more ${mentions === 1 ? "time" : "times"} in code the graph did not resolve` : "name occurs nowhere else in code", passed: mentions <= 0 });
    if (mentions > 0) return { ...base, state: "possibly-unused", evidence };
    const resolution = results.get(n.path!)?.resolution ?? "heuristic";
    const strongGraph = n.evidence.provenance === "type-checker" || n.evidence.provenance === "ast" || resolution === "ast";
    if (n.exported) evidence.push({ check: "exported: another program could still import it", passed: false });
    return { ...base, state: !n.exported && strongGraph ? "definitely-unused" : "likely-unused", evidence };
  }

  // Unused files: no source or test file depends on them and nothing names them.
  const unusedFiles: DeadCodeItem[] = [];
  for (const path of sources) {
    if (entries.has(path) || BARREL.test(path) || (facts.fileDeps.in.get(path)?.size ?? 0) > 0) continue;
    const stem = posix.basename(path).replace(/\.[^.]+$/, "");
    const named = tokens.strings.has(stem) || tokens.strings.has(posix.basename(path));
    const evidence = [
      { check: "no file imports, calls or references it", passed: true },
      { check: "not an entry point (bin, main, CLI, server, route registration, conventional name)", passed: true },
      { check: named ? `its name "${stem}" appears in a string or configuration` : "its name appears in no string or configuration", passed: !named },
    ];
    if (named) continue;
    unusedFiles.push({ id: `dead:file:${path}`, kind: "file", name: posix.basename(path), path, nodeId: `file:${path}`, state: "likely-unused", evidence });
  }

  const hits = [...results.values()].flatMap((r) => r.hits.filter((h) => h.rule === "dead-code/unused-import" || h.rule === "dead-code/unreachable").map((h) => ({ ...h, path: r.path })));
  const imports = hits.filter((h) => h.rule === "dead-code/unused-import" && sources.has(h.path));
  const unreachable = hits.filter((h) => h.rule === "dead-code/unreachable" && sources.has(h.path));
  items.sort((a, b) => order(a.state) - order(b.state) || a.path.localeCompare(b.path) || (a.line ?? 0) - (b.line ?? 0));

  const findings: Finding[] = [];
  for (const it of items.filter((i) => i.state !== "possibly-unused").slice(0, 100)) {
    findings.push(
      makeFinding("dead-code/unused-symbol", {
        id: it.id,
        title: `Unused ${it.kind} ${it.name}`,
        message: `${it.state === "definitely-unused" ? "Definitely unused" : "Likely unused"}: ${it.evidence.filter((e) => e.passed).length} of ${it.evidence.length} checks found nothing that uses it.`,
        why: "Unused code still has to be read, compiled, reviewed and kept consistent with everything around it.",
        action: it.state === "definitely-unused" ? `Delete ${it.name}.` : `Confirm nothing outside this repository uses ${it.name}, then delete it or stop exporting it.`,
        confidence: it.state === "definitely-unused" ? "strong" : "inferred",
        file: it.path,
        ...(it.line ? { line: it.line } : {}),
        symbol: it.name,
        nodeId: it.nodeId!,
        evidence: it.evidence.map((e) => ({ type: e.passed ? ("absence" as const) : ("package-export" as const), path: it.path, ...(it.line ? { line: it.line } : {}), nodeId: it.nodeId!, detail: `${e.passed ? "✓" : "✗"} ${e.check}` })),
        missing: ["Runtime traces: reflection, dependency injection and plugin loading are invisible to static analysis."],
      }),
    );
  }
  const possibly = items.filter((i) => i.state === "possibly-unused");
  if (possibly.length) findings.push(makeFinding("dead-code/unused-symbol", { id: "dead:possibly-unused", severity: "info", title: `${possibly.length} possibly unused ${possibly.length === 1 ? "symbol" : "symbols"}`, message: "No graph reference, but the name occurs elsewhere in code. Often a method called through a receiver the analyzer could not resolve.", why: "Worth a look during cleanup; not strong enough to act on alone.", action: "Search for the name before deleting anything.", confidence: "inferred", evidence: possibly.map((i) => ({ type: "call-site" as const, path: i.path, ...(i.line ? { line: i.line } : {}), nodeId: i.nodeId!, detail: `${i.kind} ${i.name}: ${i.evidence.at(-1)!.check}` })) }));
  if (unusedFiles.length) findings.push(makeFinding("dead-code/unused-file", { id: "dead:unused-files", title: `${unusedFiles.length} source ${unusedFiles.length === 1 ? "file is" : "files are"} used by nothing`, message: "No file depends on them, they are not entry points, and no string or configuration names them.", why: "Orphaned files are usually leftovers from a refactor, and keep being maintained by accident.", action: "Delete them, or wire them in if they were meant to be used.", confidence: "inferred", evidence: unusedFiles.map((f) => ({ type: "absence" as const, path: f.path, nodeId: f.nodeId!, detail: "no inbound dependency from any file" })) }));
  if (imports.length) findings.push(makeFinding("dead-code/unused-import", { id: "dead:unused-imports", title: `${imports.length} unused ${imports.length === 1 ? "import" : "imports"}`, message: `In ${new Set(imports.map((i) => i.path)).size} files.`, why: "Unused imports slow builds, can pull in side effects, and hide real dependencies.", action: "Remove them (most editors and linters can do it automatically).", confidence: "strong", evidence: imports.map((i) => ({ type: "import" as const, path: i.path, line: i.line, detail: i.detail })) }));
  if (unreachable.length) findings.push(makeFinding("dead-code/unreachable", { id: "dead:unreachable", title: `${unreachable.length} unreachable ${unreachable.length === 1 ? "statement" : "statements"}`, message: "Statements after return, throw, break or continue in the same block.", why: "Unreachable code usually means a logic slip: the author expected it to run.", action: "Delete it, or fix the control flow if it was meant to run.", confidence: "verified", evidence: unreachable.map((u) => ({ type: "ast" as const, path: u.path, line: u.line, detail: u.detail })) }));

  const report: DeadCodeReport = { counts, items: items.slice(0, MAX_ITEMS), kept, unusedFiles, unusedImports: imports.length, unreachable: unreachable.length };
  return { report, findings };
}

const order = (s: DeadCodeState): number => ["definitely-unused", "likely-unused", "possibly-unused"].indexOf(s);

function short(n: GraphNode): string {
  return n.name.split(".").pop()!.replace(/^#/, "");
}

function isModuleLevel(graph: FehmEngine["graph"], n: GraphNode): boolean {
  return graph.edgesOf(n.id, "in", ["defines"]).some((e) => graph.node(e.source)?.kind === "file");
}

function decoratorOf(facts: BriefingFacts, n: GraphNode): string | undefined {
  if (!n.path || !n.location) return undefined;
  const lines = facts.lines(n.path);
  for (let i = n.location.line - 2; i >= Math.max(0, n.location.line - 6); i -= 1) {
    const l = lines[i]?.trim() ?? "";
    if (!l) continue;
    const m = /^@([\w.]+)/.exec(l);
    if (m) return `@${m[1]}`;
    if (/^#\[/.test(l)) return l.slice(0, 40);
    break;
  }
  const own = lines[n.location.line - 1] ?? "";
  if (/\boverride\b|@Override/.test(own)) return "override";
  return undefined;
}

function overrides(graph: FehmEngine["graph"], n: GraphNode): boolean {
  if (n.kind !== "method") return false;
  const cls = graph.edgesOf(n.id, "in", ["defines"]).map((e) => graph.node(e.source)).find((x) => x?.kind === "class");
  return Boolean(cls && graph.edgesOf(cls.id, "out", ["extends", "implements"]).length);
}

