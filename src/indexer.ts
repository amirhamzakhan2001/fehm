import { readFileSync } from "node:fs";
import { join, posix } from "node:path";
import { analyzeConfigFile, isConfigAnalyzable } from "./analyzer-config.js";
import { analyzeHeuristicFile, HEURISTIC_LANGUAGES } from "./analyzer-heuristic.js";
import { analyzeMarkdownFile } from "./analyzer-markdown.js";
import { analyzeTypeScriptFiles } from "./analyzer-typescript.js";
import { CodeGraph } from "./graph.js";
import { directoryId, fileId, repositoryId } from "./ids.js";
import { linkPending } from "./linker.js";
import {
  ANALYSIS_VERSION,
  GRAPH_SCHEMA_VERSION,
  type FileAnalysis,
  type ScanResult,
  type ScannedFile,
  type SerializedGraph,
  type SyncReport,
} from "./model.js";
import { readJson, stateDir, writeJsonAtomic } from "./persistence.js";
import { diffScan, scanRepository, type ScanOptions } from "./scanner.js";
import { staleSummaryNodes } from "./semantic-summary.js";

const TS_LANGUAGES = new Set(["typescript", "javascript"]);

interface CachedFile {
  hash: string;
  analysis: FileAnalysis;
}

export interface IndexCache {
  schemaVersion: string;
  analysisVersion: string;
  root: string;
  files: Record<string, CachedFile>;
}

export interface IndexOptions extends ScanOptions {
  /** Ignore the cache and re-analyze everything. */
  force?: boolean;
  /** Override the `.fehm` state directory. */
  stateDirectory?: string;
  /** Do not write cache/graph to disk. */
  dryRun?: boolean;
}

export interface IndexResult {
  graph: CodeGraph;
  scan: ScanResult;
  report: SyncReport;
  /** Current content hash per indexed file. */
  hashes: Map<string, string>;
}

export const cachePath = (root: string, dir?: string): string => join(stateDir(root, dir), "index.json");
export const graphPath = (root: string, dir?: string): string => join(stateDir(root, dir), "graph.json");

/**
 * Scan → diff against cache → (re)analyze only what changed plus dependents →
 * link heuristic references → build graph → persist.
 */
export function indexRepository(root: string, options: IndexOptions = {}): IndexResult {
  const started = performance.now();
  const scan = scanRepository(root, options);
  const hashes = new Map(scan.files.map((f) => [f.path, f.hash]));
  const dir = options.stateDirectory;

  let cache: IndexCache | undefined;
  let reason: string | undefined;
  if (options.force) reason = "forced";
  else {
    const read = readJson<IndexCache>(cachePath(scan.root, dir));
    if (!read.ok) reason = read.reason === "missing" ? "no cache" : `cache unreadable (${read.detail}); rebuilt`;
    else if (!isValidCache(read.value)) reason = "cache schema/analysis version changed or cache malformed; rebuilt";
    else cache = read.value;
  }

  const previous = new Map(Object.entries(cache?.files ?? {}).map(([p, c]) => [p, c.hash]));
  const changes = diffScan(previous, scan.files);
  const changed = new Set([...changes.added, ...changes.modified]);
  const removed = new Set(changes.deleted);

  // Unchanged TS/JS files whose resolved relationships point into changed or
  // deleted files must be re-resolved by the type checker. Files with
  // unresolved imports are retried when new files appear.
  const invalidated = new Set<string>();
  if (cache) {
    for (const path of changes.unchanged) {
      const cached = cache.files[path]!.analysis;
      if (!TS_LANGUAGES.has(cached.language)) continue;
      const touchesChange = cached.dependsOn.some((d) => changed.has(d) || removed.has(d));
      const mayNowResolve = changes.added.length > 0 && cached.unresolved.some((u) => u.kind === "import");
      if (touchesChange || mayNowResolve) invalidated.add(path);
    }
  }

  const toAnalyze = cache ? new Set([...changed, ...invalidated]) : new Set(scan.files.map((f) => f.path));
  const analyses = new Map<string, FileAnalysis>();
  for (const file of scan.files) {
    if (!toAnalyze.has(file.path)) analyses.set(file.path, cache!.files[file.path]!.analysis);
  }
  for (const [path, analysis] of analyzeFiles(scan, toAnalyze)) analyses.set(path, analysis);

  const graph = buildGraph(scan, analyses);

  // Change accounting against the previous graph.
  const prevGraph = cache ? readJson<SerializedGraph>(graphPath(scan.root, dir)) : undefined;
  const prevSymbols = new Set<string>();
  const prevEdges = new Set<string>();
  if (cache) for (const c of Object.values(cache.files)) for (const n of c.analysis.nodes) if (n.kind !== "package") prevSymbols.add(n.id);
  if (prevGraph?.ok) for (const e of prevGraph.value.edges ?? []) prevEdges.add(e.id);
  const nextSymbols = new Set<string>();
  for (const a of analyses.values()) for (const n of a.nodes) if (n.kind !== "package") nextSymbols.add(n.id);
  const nextEdges = new Set(graph.edges().map((e) => e.id));

  const mode: SyncReport["mode"] = !cache ? "full" : toAnalyze.size === 0 && removed.size === 0 ? "cache-hit" : "incremental";
  const report: SyncReport = {
    mode,
    ...(reason ? { reason } : {}),
    analyzedFiles: [...toAnalyze].filter((p) => !invalidated.has(p)).sort(),
    reusedFiles: [...analyses.keys()].filter((p) => !toAnalyze.has(p)).sort(),
    invalidatedFiles: [...invalidated].sort(),
    removedFiles: [...removed].sort(),
    changedSymbols: {
      added: cache ? [...nextSymbols].filter((s) => !prevSymbols.has(s)).sort() : [],
      removed: [...prevSymbols].filter((s) => !nextSymbols.has(s)).sort(),
    },
    changedRelationships: {
      added: prevGraph?.ok ? [...nextEdges].filter((e) => !prevEdges.has(e)).length : cache ? nextEdges.size : 0,
      removed: [...prevEdges].filter((e) => !nextEdges.has(e)).length,
    },
    staleSummaries: staleSummaryNodes(scan.root, graph, hashes, dir),
    scanErrors: scan.errors,
    durationMs: Math.round(performance.now() - started),
  };

  if (!options.dryRun) {
    const files: Record<string, CachedFile> = {};
    for (const file of scan.files) files[file.path] = { hash: file.hash, analysis: analyses.get(file.path)! };
    writeJsonAtomic(cachePath(scan.root, dir), {
      schemaVersion: GRAPH_SCHEMA_VERSION,
      analysisVersion: ANALYSIS_VERSION,
      root: scan.root,
      files,
    } satisfies IndexCache);
    writeJsonAtomic(graphPath(scan.root, dir), graph.toJSON());
  }
  return { graph, scan, report, hashes };
}

function isValidCache(value: unknown): value is IndexCache {
  const c = value as IndexCache | null;
  if (!c || typeof c !== "object" || c.schemaVersion !== GRAPH_SCHEMA_VERSION || c.analysisVersion !== ANALYSIS_VERSION) return false;
  if (!c.files || typeof c.files !== "object") return false;
  return Object.values(c.files).every(
    (f) => f && typeof f.hash === "string" && f.analysis && Array.isArray(f.analysis.nodes) && Array.isArray(f.analysis.edges) && Array.isArray(f.analysis.dependsOn) && Array.isArray(f.analysis.pending),
  );
}

function analyzeFiles(scan: ScanResult, targets: ReadonlySet<string>): Map<string, FileAnalysis> {
  const out = new Map<string, FileAnalysis>();
  const tsTargets = new Set<string>();
  for (const file of scan.files) {
    if (!targets.has(file.path)) continue;
    if (file.skipped) out.set(file.path, emptyAnalysis(file, `not analyzed: ${file.skipped}`));
    else if (TS_LANGUAGES.has(file.language) && file.role !== "manifest") tsTargets.add(file.path);
    else {
      const analyzer =
        HEURISTIC_LANGUAGES.has(file.language) && file.role !== "manifest" ? analyzeHeuristicFile
        : file.language === "markdown" ? analyzeMarkdownFile
        : isConfigAnalyzable(file.path) ? analyzeConfigFile
        : undefined;
      if (!analyzer) {
        out.set(file.path, emptyAnalysis(file, file.language === "other" ? "unsupported language" : undefined));
        continue;
      }
      let text: string;
      try {
        text = readFileSync(file.absolutePath, "utf8");
      } catch (error) {
        out.set(file.path, emptyAnalysis(file, `unreadable: ${(error as Error).message}`));
        continue;
      }
      out.set(file.path, analyzer(file, text));
    }
  }
  if (tsTargets.size > 0) {
    const programFiles = scan.files.filter((f) => TS_LANGUAGES.has(f.language) && !f.skipped);
    const results = analyzeTypeScriptFiles(scan.root, programFiles, tsTargets);
    for (const path of tsTargets) {
      const file = scan.files.find((f) => f.path === path)!;
      out.set(path, results.get(path) ?? emptyAnalysis(file, "TypeScript program did not include file"));
    }
  }
  return out;
}

function emptyAnalysis(file: ScannedFile, diagnostic?: string): FileAnalysis {
  return {
    path: file.path,
    hash: file.hash,
    analysisVersion: ANALYSIS_VERSION,
    language: file.language,
    resolution: "none",
    nodes: [],
    edges: [],
    unresolved: [],
    pending: [],
    dependsOn: [],
    diagnostics: diagnostic ? [diagnostic] : [],
  };
}

/** Assemble the graph from structure (scan) + per-file analyses + global link pass. */
export function buildGraph(scan: ScanResult, analyses: ReadonlyMap<string, FileAnalysis>): CodeGraph {
  const graph = new CodeGraph(scan.root);
  const fs = { provenance: "filesystem" as const, confidence: 1 };
  const rootName = posix.basename(scan.root.split("\\").join("/")) || ".";
  graph.addNode({ id: repositoryId(), kind: "repository", name: rootName, path: ".", evidence: fs });

  const dirs = new Set(scan.directories);
  for (const file of scan.files) {
    for (let d = posix.dirname(file.path); d !== "."; d = posix.dirname(d)) dirs.add(d);
  }
  for (const d of [...dirs].sort()) graph.addNode({ id: directoryId(d), kind: "directory", name: posix.basename(d), path: d, evidence: fs });
  for (const d of [...dirs].sort()) {
    const parent = posix.dirname(d);
    graph.addEdge("contains", parent === "." ? repositoryId() : directoryId(parent), directoryId(d), fs);
  }
  for (const file of scan.files) {
    graph.addNode({
      id: fileId(file.path),
      kind: "file",
      name: posix.basename(file.path),
      path: file.path,
      language: file.language,
      isTest: file.isTest,
      evidence: { ...fs, detail: file.skipped ? `role=${file.role}; not analyzed: ${file.skipped}` : `role=${file.role}` },
    });
    const parent = posix.dirname(file.path);
    graph.addEdge("contains", parent === "." ? repositoryId() : directoryId(parent), fileId(file.path), fs);
  }

  const list = [...analyses.values()].sort((a, b) => (a.path < b.path ? -1 : 1));
  for (const a of list) for (const n of a.nodes) graph.addNode(n);
  const goModules: { dir: string; module: string }[] = [];
  for (const f of scan.files) {
    if (posix.basename(f.path) !== "go.mod") continue;
    try {
      const module = /^module\s+(\S+)/m.exec(readFileSync(f.absolutePath, "utf8"))?.[1];
      if (module) goModules.push({ dir: posix.dirname(f.path), module });
    } catch {
      // unreadable go.mod: Go imports stay external/unresolved
    }
  }
  const linked = linkPending(list, { files: new Set(scan.files.map((f) => f.path)), goModules });
  for (const n of linked.nodes) graph.addNode(n);
  for (const a of list) for (const e of a.edges) graph.addEdge(e.kind, e.source, e.target, e.evidence);
  for (const e of linked.edges) graph.addEdge(e.kind, e.source, e.target, e.evidence);
  graph.unresolved = [...list.flatMap((a) => a.unresolved), ...linked.unresolved];
  return graph;
}

/** Load the persisted graph without rescanning. */
export function loadGraph(root: string, dir?: string): CodeGraph | undefined {
  const read = readJson<SerializedGraph>(graphPath(root, dir));
  if (!read.ok) return undefined;
  try {
    return CodeGraph.fromJSON(read.value);
  } catch {
    return undefined;
  }
}
