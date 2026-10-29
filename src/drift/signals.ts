import { createHash } from "node:crypto";
import type { BriefingFacts } from "../codebase-briefing/facts.js";
import type { FehmEngine } from "../engine.js";
import type { EdgeKind, GraphNode } from "../model.js";
import type { Signal } from "./signal.js";
import type { Confidence as DriftConfidence, Evidence } from "./types.js";

/** Evidence with Fehm's evidence vocabulary (as in 3.3). */
export type CodeEvidence = Evidence & { confidence: "verified" | "strong" | "inferred" };
type DriftEvidence = CodeEvidence;

/** The code-pattern kinds. 3.4 lists them as AI-associated signals; 3.5 reuses them as maintainability findings. */
export type SignalKind = "duplicate-implementation" | "similar-implementation" | "placeholder" | "pass-through-wrapper" | "unused-export" | "unused-dependency" | "large-file" | "todo-markers";

/**
 * A code-pattern detection, independent of how a feature presents it
 * (3.4: AI-associated structural signal; 3.5: health finding).
 */
export interface CodeSignal {
  id: string;
  signal: SignalKind;
  title: string;
  expected: string;
  observed: string;
  why: string;
  action: string;
  verification: string[];
  evidence: CodeEvidence[];
  more: number;
  confidence: "verified" | "strong" | "inferred";
}

const MIN_DUP_LINES = 6;
const LARGE_FILE_LINES = 1000;
const MIN_SIMILAR_LINES = 8;
const MIN_SIMILAR_TOKENS = 40;
const MAX_GROUPS = 25;
const EVIDENCE_SAMPLE = 12;
const FUNCTION_KINDS = new Set(["function", "method"]);
const EXPORT_KINDS = new Set(["function", "class", "interface", "type", "enum"]);
const STRUCTURAL = new Set<EdgeKind>(["contains", "defines"]);
const BARREL = /(^|\/)(index\.[cm]?[jt]sx?|__init__\.py|mod\.rs|lib\.rs)$/;

const PLACEHOLDER: [RegExp, string][] = [
  [/^\s*throw new Error\(\s*["'`](?:not (?:yet )?implemented|todo|unimplemented|implement me)/i, "throws \"not implemented\""],
  [/^\s*raise NotImplementedError\b/, "raises NotImplementedError"],
  [/^\s*(?:todo|unimplemented)!\(/, "todo!/unimplemented! macro"],
  [/^\s*panic\(\s*"(?:not implemented|todo|unimplemented)/i, "panics \"not implemented\""],
  [/^\s*throw new NotImplementedException\b/, "throws NotImplementedException"],
  [/^\s*(?:\/\/|#)\s*TODO:?\s*implement\b/i, "\"TODO: implement\" comment"],
];
/** A marker opening a line comment, or a `TODO:` inside a block comment (prose that mentions "TODO" is not a marker). */
const TODO = /^\s*(?:(?:\/\/|#)\s*(TODO|FIXME|HACK|XXX)\b|(?:\*|\/\*+)\s*(TODO|FIXME|HACK|XXX)(?:\([^)]*\))?:)/;
/** Callees that are collection or string accessors: returning `map.get(key)` is not a wrapper. */
const ACCESSORS = new Set(["get", "has", "set", "delete", "add", "push", "includes", "indexOf", "join", "slice", "map", "filter", "find", "toString", "trim", "split", "replace", "test", "exec", "keys", "values", "entries"]);

const KEYWORDS = new Set(
  (
    "if else for while do switch case break continue return function const let var new class extends implements interface type enum " +
    "try catch finally throw async await yield import export from default this super null undefined true false typeof instanceof in of " +
    "def elif lambda pass raise with as is not and or None True False self fn let mut match impl struct pub use func go defer chan " +
    "public private protected static final void int string bool boolean number"
  ).split(" "),
);

interface FunctionBody {
  node: GraphNode;
  path: string;
  line: number;
  lines: string[];
}

/** `skip`: paths the contract ignores (generated code, fixtures). */
export function qualitySignals(engine: FehmEngine, facts: BriefingFacts, skip: (path: string) => boolean = () => false): CodeSignal[] {
  const files = facts.sourceFiles.filter((f) => !skip(f));
  const sources = new Set(files);
  const bodies = functionBodies(engine, facts, sources);
  return [
    ...duplicates(bodies),
    ...placeholders(facts, files),
    ...passThrough(bodies),
    ...unusedExports(engine, facts, sources),
    ...unusedDependencies(facts),
    ...largeFiles(facts, sources),
    ...todoMarkers(facts, files),
  ];
}

function functionBodies(engine: FehmEngine, facts: BriefingFacts, sources: Set<string>): FunctionBody[] {
  const out: FunctionBody[] = [];
  for (const n of engine.graph.nodes()) {
    if (!FUNCTION_KINDS.has(n.kind) || !n.path || !sources.has(n.path) || !n.location?.endLine || /\.d\.ts$/.test(n.path)) continue;
    const { line, endLine } = n.location;
    if (endLine <= line || endLine - line > 400) continue;
    const lines = facts.lines(n.path).slice(line - 1, endLine);
    if (lines.length) out.push({ node: n, path: n.path, line, lines: [...lines] });
  }
  return out.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : a.line - b.line));
}

const stripComment = (l: string): string => l.replace(/\s\/\/.*$|^\s*\/\/.*$|^\s*#.*$|^\s*\*.*$|^\s*\/\*.*$/, "").trim();

function codeLines(lines: string[]): string[] {
  return lines.map(stripComment).filter((l) => l && l !== "}" && l !== "};" && l !== "{");
}

function hash(s: string): string {
  return createHash("sha1").update(s).digest("hex").slice(0, 12);
}

function signalFinding(id: string, signal: SignalKind, title: string, expected: string, observed: string, why: string, action: string, evidence: DriftEvidence[], total: number, confidence: DriftEvidence["confidence"]): CodeSignal {
  const shown = evidence.slice(0, EVIDENCE_SAMPLE);
  return { id, signal, title, expected, observed, why, action, verification: ["Refresh after the change: the signal disappears when the pattern is gone."], evidence: shown, more: Math.max(0, total - shown.length), confidence };
}

const CONF: Record<CodeSignal["confidence"], DriftConfidence> = { verified: "high", strong: "medium", inferred: "low" };

/**
 * 3.4's view of the same detections: AI-associated structural signals.
 * Very large files are left out here — relative granularity drift covers them.
 */
export function aiSignals(engine: FehmEngine, facts: BriefingFacts, skip?: (path: string) => boolean): Signal[] {
  return qualitySignals(engine, facts, skip)
    .filter((c) => c.signal !== "large-file")
    .map((c) => ({
      subject: c.id.replace(/^quality:/, "ai:"),
      category: "ai-associated" as const,
      source: "heuristic" as const,
      basis: "heuristic" as const,
      confidence: CONF[c.confidence],
      attention: c.signal === "todo-markers" || c.signal === "unused-export" ? ("informational" as const) : ("low" as const),
      title: c.title,
      observed: c.observed,
      baseline: c.expected,
      explanation: `Structural signal (${c.signal.replace(/-/g, " ")}). These patterns occur in AI-assisted development and in ordinary engineering alike; they do not establish authorship.`,
      impact: c.why,
      suggestion: { text: `Possible direction: ${c.action}` },
      kind: `ai:${c.signal}`,
      evidence: c.evidence.map(({ confidence: _c, ...e }) => (void _c, e)),
      more: c.more,
      modules: [],
    }));
}

// ─── duplication ────────────────────────────────────────────────────

function duplicates(bodies: FunctionBody[]): CodeSignal[] {
  const exact = new Map<string, FunctionBody[]>();
  const similar = new Map<string, FunctionBody[]>();
  for (const b of bodies) {
    const code = codeLines(b.lines.slice(1));
    if (code.length < MIN_DUP_LINES - 1) continue;
    // The signature line is left out, so a copy under another name still matches.
    const text = code.join("\n").replace(/\s+/g, " ");
    const e = hash(text);
    exact.set(e, [...(exact.get(e) ?? []), b]);
    if (code.length >= MIN_SIMILAR_LINES - 1) {
      const tokens = shape(text);
      if (tokens.length >= MIN_SIMILAR_TOKENS) {
        const s = hash(tokens.join(" "));
        similar.set(s, [...(similar.get(s) ?? []), b]);
      }
    }
  }
  const out: CodeSignal[] = [];
  const inExact = new Set<GraphNode>();
  const groups = [...exact.entries()].filter(([, g]) => g.length > 1).sort((a, b) => b[1].length * b[1][0]!.lines.length - a[1].length * a[1][0]!.lines.length || (a[0] < b[0] ? -1 : 1));
  for (const [h, g] of groups.slice(0, MAX_GROUPS)) {
    for (const b of g) inExact.add(b.node);
    const names = [...new Set(g.map((b) => b.node.name))];
    out.push(
      signalFinding(
        `quality:duplicate:${h}`,
        "duplicate-implementation",
        `${g.length} identical implementations: ${names.slice(0, 3).join(", ")}${names.length > 3 ? " …" : ""}`,
        "Each behaviour is implemented once and reused.",
        `${g.length} functions have the same ${g[0]!.lines.length}-line body (ignoring whitespace, comments and the name) in ${new Set(g.map((b) => b.path)).size} files.`,
        "Copies drift apart: a fix applied to one is easily missed in the others.",
        "Keep one implementation and call it from the other places, unless the copies are meant to evolve separately.",
        g.map((b) => ({ path: b.path, line: b.line, nodeId: b.node.id, detail: `${b.node.name} (${b.lines.length} lines)`, confidence: "verified" })),
        g.length,
        "verified",
      ),
    );
  }
  const near = [...similar.entries()].filter(([, g]) => g.filter((b) => !inExact.has(b.node)).length > 1 && new Set(g.map((b) => hash(codeLines(b.lines.slice(1)).join(" ")))).size > 1);
  near.sort((a, b) => b[1].length - a[1].length || (a[0] < b[0] ? -1 : 1));
  for (const [h, g] of near.slice(0, MAX_GROUPS)) {
    const names = [...new Set(g.map((b) => b.node.name))];
    out.push(
      signalFinding(
        `quality:similar:${h}`,
        "similar-implementation",
        `${g.length} structurally identical implementations: ${names.slice(0, 3).join(", ")}${names.length > 3 ? " …" : ""}`,
        "Similar behaviour shares one parameterized implementation.",
        `${g.length} functions have the same structure and differ only in names and literals.`,
        "Near-copies usually mean one abstraction is missing; each copy has to be changed separately.",
        "Check whether one function with parameters could replace them. Parallel code with different meanings can stay as it is.",
        g.map((b) => ({ path: b.path, line: b.line, nodeId: b.node.id, detail: `${b.node.name} (${b.lines.length} lines)`, confidence: "strong" })),
        g.length,
        "strong",
      ),
    );
  }
  return out;
}

/** Token shape: identifiers → I, strings → S, numbers → N; keywords and punctuation kept. */
function shape(text: string): string[] {
  const out: string[] = [];
  const re = /("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)|(\b\d[\d_.]*\b)|([A-Za-z_$][\w$]*)|([^\s\w])/g;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m[1]) out.push("S");
    else if (m[2]) out.push("N");
    else if (m[3]) out.push(KEYWORDS.has(m[3]) ? m[3] : "I");
    else out.push(m[4]!);
  }
  return out;
}

// ─── placeholders and markers ───────────────────────────────────────

function placeholders(facts: BriefingFacts, files: string[]): CodeSignal[] {
  const hits: DriftEvidence[] = [];
  for (const path of files) {
    const lines = facts.lines(path);
    for (let i = 0; i < Math.min(lines.length, 20000); i += 1) {
      const hit = PLACEHOLDER.find(([re]) => re.test(lines[i]!));
      if (!hit) continue;
      const fn = facts.enclosing(path, i + 1);
      hits.push({ path, line: i + 1, ...(fn ? { nodeId: fn.id } : {}), detail: `${fn ? `${fn.name}: ` : ""}${hit[1]}`, confidence: "strong" });
    }
  }
  if (!hits.length) return [];
  return [
    signalFinding(
      "quality:placeholder",
      "placeholder",
      `${hits.length} placeholder ${hits.length === 1 ? "implementation" : "implementations"}`,
      "Shipped code paths are implemented.",
      `${hits.length} ${hits.length === 1 ? "place throws or is marked" : "places throw or are marked"} "not implemented" in ${new Set(hits.map((h) => h.path)).size} files.`,
      "A placeholder that is reachable fails at runtime. Abstract base methods that raise on purpose are fine.",
      "Implement the path, remove it, or make it unreachable (an abstract method or an explicit unsupported error).",
      hits,
      hits.length,
      "strong",
    ),
  ];
}

function todoMarkers(facts: BriefingFacts, files: string[]): CodeSignal[] {
  const hits: DriftEvidence[] = [];
  const perFile = new Map<string, number>();
  for (const path of files) {
    const lines = facts.lines(path);
    for (let i = 0; i < Math.min(lines.length, 20000); i += 1) {
      const m = TODO.exec(lines[i]!);
      if (!m) continue;
      perFile.set(path, (perFile.get(path) ?? 0) + 1);
      hits.push({ path, line: i + 1, detail: lines[i]!.trim().slice(0, 120), confidence: "verified" });
    }
  }
  if (!hits.length) return [];
  const worst = [...perFile].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
  hits.sort((a, b) => (perFile.get(b.path) ?? 0) - (perFile.get(a.path) ?? 0) || (a.path < b.path ? -1 : 1) || (a.line ?? 0) - (b.line ?? 0));
  return [
    signalFinding(
      "quality:todo-markers",
      "todo-markers",
      `${hits.length} TODO/FIXME ${hits.length === 1 ? "marker" : "markers"}`,
      "Known gaps are tracked where they can be prioritized.",
      `${hits.length} markers in ${perFile.size} files; most in ${worst.slice(0, 3).map(([p, n]) => `${p} (${n})`).join(", ")}.`,
      "Markers record known gaps; a large number means unfinished work is spread through the code.",
      "Resolve them, or move them to the issue tracker and link the issue.",
      hits,
      hits.length,
      "verified",
    ),
  ];
}

function largeFiles(facts: BriefingFacts, sources: Set<string>): CodeSignal[] {
  const big = [...facts.metrics.values()].filter((m) => sources.has(m.path) && m.lines > LARGE_FILE_LINES).sort((a, b) => b.lines - a.lines);
  if (!big.length) return [];
  return [
    signalFinding(
      "quality:large-files",
      "large-file",
      `${big.length} source ${big.length === 1 ? "file has" : "files have"} more than ${LARGE_FILE_LINES} lines`,
      `Source files stay under ${LARGE_FILE_LINES} lines, so each has a clear purpose.`,
      big.slice(0, 5).map((m) => `${m.path} (${m.lines})`).join(", ") + (big.length > 5 ? ", …" : "") + ".",
      "Very large files tend to mix responsibilities and are hard to review. Generated files are an exception and belong under `ignore`.",
      "Split along the responsibilities the file holds, or ignore it if it is generated.",
      big.map((m) => ({ path: m.path, nodeId: `file:${m.path}`, detail: `${m.lines} lines`, confidence: "verified" as const })),
      big.length,
      "verified",
    ),
  ];
}

// ─── wrappers and unused code ───────────────────────────────────────

const RETURN_CALL = /^return\s+(?:await\s+)?([\w$.]+)\(([^()]*)\);?$/;

function params(signature: string | undefined): string[] | undefined {
  if (!signature) return undefined;
  const open = signature.indexOf("(");
  if (open < 0) return undefined;
  let depth = 0;
  let close = -1;
  for (let i = open; i < signature.length; i += 1) {
    if (signature[i] === "(") depth += 1;
    else if (signature[i] === ")" && --depth === 0) {
      close = i;
      break;
    }
  }
  if (close < 0) return undefined;
  const inner = signature.slice(open + 1, close).trim();
  if (!inner) return [];
  if (/[{[<]/.test(inner)) return undefined; // destructuring or generics: not a plain forwarder
  return inner.split(",").map((p) => p.trim().replace(/^\.\.\./, "").split(/[?:=\s]/)[0]!).filter((p) => p && p !== "self" && p !== "this");
}

function passThrough(bodies: FunctionBody[]): CodeSignal[] {
  const hits: DriftEvidence[] = [];
  for (const b of bodies) {
    const code = codeLines(b.lines.slice(1));
    if (code.length !== 1) continue;
    const m = RETURN_CALL.exec(code[0]!);
    if (!m) continue;
    const callee = m[1]!;
    const args = m[2]!.trim() ? m[2]!.split(",").map((a) => a.trim()) : [];
    const ps = params(b.node.signature ?? b.lines[0]);
    const method = callee.split(".").pop()!;
    if (!ps || ps.join(",") !== args.join(",") || method === b.node.name || (callee.includes(".") && ACCESSORS.has(method))) continue;
    hits.push({ path: b.path, line: b.line, nodeId: b.node.id, detail: `${b.node.name}(${ps.join(", ")}) only returns ${callee}(${args.join(", ")})`, confidence: "inferred" });
  }
  if (!hits.length) return [];
  return [
    signalFinding(
      "quality:pass-through",
      "pass-through-wrapper",
      `${hits.length} pass-through ${hits.length === 1 ? "wrapper" : "wrappers"}`,
      "A function adds behaviour, a name that matters, or a boundary.",
      `${hits.length} ${hits.length === 1 ? "function forwards its" : "functions forward their"} arguments unchanged to another function and do nothing else.`,
      "Layers of forwarding add indirection without adding meaning. They are fine when they form a deliberate public API or an interface boundary.",
      "Call the target directly, or keep the wrapper if it is part of a public API.",
      hits,
      hits.length,
      "inferred",
    ),
  ];
}

function unusedExports(engine: FehmEngine, facts: BriefingFacts, sources: Set<string>): CodeSignal[] {
  const graph = engine.graph;
  const entries = new Set(facts.entryFiles.map((e) => e.path));
  // Files re-exported by a barrel or used by an entry file are public API: their exports may be used from outside.
  const published = new Set<string>();
  for (const f of sources) {
    if (!BARREL.test(f) && !entries.has(f)) continue;
    for (const e of graph.edgesOf(`file:${f}`, "out", ["imports"])) {
      const t = facts.fileOf(e.target);
      if (t) published.add(t);
    }
  }
  const hits: DriftEvidence[] = [];
  for (const n of graph.nodes()) {
    if (!n.exported || !EXPORT_KINDS.has(n.kind) || !n.path || !sources.has(n.path) || n.isTest) continue;
    if (entries.has(n.path) || BARREL.test(n.path) || published.has(n.path) || /\.d\.ts$/.test(n.path)) continue;
    const inbound = graph.edgesOf(n.id, "in").filter((e) => !STRUCTURAL.has(e.kind));
    if (inbound.length) continue;
    hits.push({ path: n.path, ...(n.location ? { line: n.location.line } : {}), nodeId: n.id, detail: `${n.kind} ${n.name}: exported, no references found`, confidence: "inferred" });
  }
  if (!hits.length) return [];
  hits.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : (a.line ?? 0) - (b.line ?? 0)));
  return [
    signalFinding(
      "quality:unused-exports",
      "unused-export",
      `${hits.length} exported ${hits.length === 1 ? "symbol has" : "symbols have"} no references`,
      "Exported abstractions are used.",
      `${hits.length} exported functions, classes or types in ${new Set(hits.map((h) => h.path)).size} files are referenced nowhere in the indexed code.`,
      "Unused abstractions add surface to maintain. Static analysis misses dynamic use (reflection, string lookups, framework conventions), so check before deleting.",
      "Delete what is truly unused, or stop exporting it.",
      hits,
      hits.length,
      "inferred",
    ),
  ];
}

function unusedDependencies(facts: BriefingFacts): CodeSignal[] {
  // Declared packages are graph nodes too; only those some file imports count as used.
  const imported = facts.packages.filter((p) => p.importers.length > 0).map((p) => p.name);
  const hits: DriftEvidence[] = [];
  for (const m of facts.manifests) {
    if (m.kind !== "npm") continue;
    const scripts = m.scripts.map((s) => s.command).join("\n");
    for (const d of m.dependencies) {
      if (d.dev || d.name.startsWith("@types/")) continue;
      if (imported.some((p) => p === d.name || p.startsWith(`${d.name}/`))) continue;
      if (new RegExp(`(^|[\\s/"'])${d.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[\\s/"'])`).test(scripts)) continue;
      hits.push({ path: m.path, line: d.line, detail: `${d.name} is declared but never imported`, confidence: "strong" });
    }
  }
  if (!hits.length) return [];
  return [
    signalFinding(
      "quality:unused-dependencies",
      "unused-dependency",
      `${hits.length} declared ${hits.length === 1 ? "dependency is" : "dependencies are"} never imported`,
      "Every runtime dependency in the manifest is used by the code.",
      `${hits.map((h) => h.detail!.split(" ")[0]).slice(0, 6).join(", ")}${hits.length > 6 ? ", …" : ""}.`,
      "Unused dependencies enlarge installs and the supply-chain surface. Plugins loaded by name and CLI tools run by other tools will also appear here.",
      "Remove the dependency, or move it to devDependencies if only tooling uses it.",
      hits,
      hits.length,
      "strong",
    ),
  ];
}
