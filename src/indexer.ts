import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { maintainAdrDrafts, recordArchitectureSnapshot } from "./history-intelligence.js";
import { analyzeTypeScript } from "./analyzer.js";
import type { FehmConfig } from "./config.js";
import { calculateStats } from "./graph.js";
import { atomicWriteJson } from "./persistence.js";
import {
  GRAPH_SCHEMA_VERSION,
  type CodeGraph,
  type GraphEdge,
  type GraphNode,
  type IndexSynchronization,
  type RepositoryChanges,
} from "./model.js";
import { scanRepository } from "./scanner.js";

interface CachedFileUnit {
  hash: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
  unresolvedCalls: number;
}

interface AnalysisCache {
  version: 2;
  repositoryFingerprint: string;
  units: Record<string, CachedFileUnit>;
}

async function loadPreviousGraph(outputDirectory: string): Promise<CodeGraph | undefined> {
  try {
    return JSON.parse(await readFile(path.join(outputDirectory, "graph.json"), "utf8")) as CodeGraph;
  } catch {
    return undefined;
  }
}

async function loadAnalysisCache(outputDirectory: string): Promise<AnalysisCache | undefined> {
  try {
    const value = JSON.parse(await readFile(path.join(outputDirectory, "analysis-cache.json"), "utf8")) as AnalysisCache;
    return value.version === 2 && value.units && typeof value.units === "object" ? value : undefined;
  } catch {
    return undefined;
  }
}

function changesFor(current: Record<string, string>, previous: Record<string, string> = {}): RepositoryChanges {
  const currentPaths = new Set(Object.keys(current));
  const previousPaths = new Set(Object.keys(previous));
  return {
    added: [...currentPaths].filter((name) => !(name in previous)).sort(),
    changed: [...currentPaths].filter((name) => name in previous && current[name] !== previous[name]).sort(),
    removed: [...previousPaths].filter((name) => !currentPaths.has(name)).sort(),
    unchanged: [...currentPaths].filter((name) => current[name] === previous[name]).sort(),
  };
}

function fingerprintFor(fileHashes: Record<string, string>): string {
  return createHash("sha256")
    .update(Object.entries(fileHashes).sort().map(([name, hash]) => `${name}:${hash}`).join("\n"))
    .digest("hex");
}

function nodePaths(graph: CodeGraph): Map<string, string> {
  return new Map(graph.nodes.flatMap((node) => node.path ? [[node.id, node.path] as const] : []));
}

function affectedFiles(previous: CodeGraph | undefined, changes: RepositoryChanges): Set<string> {
  const affected = new Set([...changes.added, ...changes.changed, ...changes.removed]);
  if (!previous) return affected;
  const paths = nodePaths(previous);
  let expanded = true;
  while (expanded) {
    expanded = false;
    for (const edge of previous.edges) {
      if (!["imports", "calls", "references", "uses", "extends", "implements"].includes(edge.kind)) continue;
      const targetPath = paths.get(edge.target);
      const sourcePath = paths.get(edge.source);
      if (!targetPath || !sourcePath || !affected.has(targetPath) || affected.has(sourcePath)) continue;
      affected.add(sourcePath);
      expanded = true;
    }
  }
  return affected;
}

function mergeUnique<T extends { id: string }>(groups: T[][]): T[] {
  const values = new Map<string, T>();
  for (const group of groups) for (const value of group) values.set(value.id, value);
  return [...values.values()].sort((left, right) => left.id.localeCompare(right.id));
}

function summaryFreshness(nodes: GraphNode[]): IndexSynchronization["summaryFreshness"] {
  const summarized = nodes.filter((node) => node.summary);
  const fresh = summarized.filter((node) => node.summaryStatus === "fresh").length;
  const stale = summarized.filter((node) => node.summaryStatus === "stale").length;
  const notGenerated = summarized.filter((node) => node.summaryStatus === "not-generated").length;
  const failed = summarized.filter((node) => node.summaryStatus === "failed").length;
  return {
    fresh,
    stale,
    notGenerated,
    failed,
    percent: summarized.length ? Math.round((fresh / summarized.length) * 1_000) / 10 : 100,
  };
}

function symmetricDifferenceCount(left: string[], right: string[]): number {
  const a = new Set(left);
  const b = new Set(right);
  let count = 0;
  for (const value of a) if (!b.has(value)) count += 1;
  for (const value of b) if (!a.has(value)) count += 1;
  return count;
}

function cacheFromGraph(graph: CodeGraph, unresolvedByFile: Record<string, number> = {}): AnalysisCache {
  const nodesById = new Map(graph.nodes.map((node) => [node.id, node]));
  const nodesByPath = new Map<string, GraphNode[]>();
  const edgesByPath = new Map<string, GraphEdge[]>();
  for (const node of graph.nodes) {
    if (!node.path) continue;
    const owned = nodesByPath.get(node.path);
    if (owned) owned.push(node);
    else nodesByPath.set(node.path, [node]);
  }
  for (const edge of graph.edges) {
    const sourcePath = nodesById.get(edge.source)?.path;
    if (!sourcePath) continue;
    const owned = edgesByPath.get(sourcePath);
    if (owned) owned.push(edge);
    else edgesByPath.set(sourcePath, [edge]);
  }
  const units: Record<string, CachedFileUnit> = {};
  for (const [filePath, hash] of Object.entries(graph.fileHashes)) {
    const ownedNodes = nodesByPath.get(filePath) ?? [];
    const edges = edgesByPath.get(filePath) ?? [];
    const dependencyNodes = edges
      .map((edge) => nodesById.get(edge.target))
      .filter((node): node is GraphNode => Boolean(node && !node.path));
    units[filePath] = {
      hash,
      nodes: mergeUnique([ownedNodes, dependencyNodes]),
      edges,
      unresolvedCalls: unresolvedByFile[filePath] ?? 0,
    };
  }
  return { version: 2, repositoryFingerprint: graph.repository.fingerprint, units };
}

export async function buildIndex(config: FehmConfig): Promise<CodeGraph> {
  const scan = await scanRepository(config);
  const previous = await loadPreviousGraph(config.outputDirectory);
  const savedCache = await loadAnalysisCache(config.outputDirectory);
  // Graph and cache are separately atomic files; an interrupted write may leave
  // them from different scans. Never merge units from another snapshot or root.
  const cache = previous?.repository.root === config.root && previous.schemaVersion === GRAPH_SCHEMA_VERSION
    && savedCache?.repositoryFingerprint === previous.repository.fingerprint ? savedCache : undefined;
  const fileHashes = Object.fromEntries(scan.files.map((file) => [file.relativePath, file.hash]));
  const changes = changesFor(fileHashes, previous?.fileHashes);
  const fingerprint = fingerprintFor(fileHashes);
  const noChanges = previous && cache && previous.schemaVersion === GRAPH_SCHEMA_VERSION
    && changes.added.length === 0
    && changes.changed.length === 0
    && changes.removed.length === 0;

  if (noChanges) {
    const nodes = previous.nodes.map((node) => node.summary && !node.summaryStatus
      ? { ...node, summaryStatus: "fresh" as const, summarySource: "deterministic" as const }
      : node);
    const graph: CodeGraph = {
      ...previous,
      generatedAt: new Date().toISOString(),
      changes,
      nodes,
      synchronization: {
        mode: "cache-hit",
        lastSyncAt: new Date().toISOString(),
        analyzedFiles: [],
        reusedFiles: changes.unchanged,
        invalidatedFiles: [],
        changedSymbols: 0,
        changedRelationships: 0,
        summaryFreshness: summaryFreshness(nodes),
      },
    };
    Object.defineProperty(graph, "__unresolvedCallsByFile", {
      value: Object.fromEntries(Object.entries(cache?.units ?? {}).map(([filePath, unit]) => [filePath, unit.unresolvedCalls])),
      enumerable: false,
    });
    return graph;
  }

  const invalidated = previous ? affectedFiles(previous, changes) : new Set(Object.keys(fileHashes));
  const canIncrement = Boolean(previous && cache);
  const analyzedFiles = canIncrement
    ? new Set([...invalidated].filter((filePath) => filePath in fileHashes))
    : new Set(Object.keys(fileHashes));
  const analysis = analyzeTypeScript(config, scan.files, canIncrement ? { includePaths: analyzedFiles } : {});
  const freshNodes = analysis.graph.getNodes();
  const freshEdges = analysis.graph.getEdges();
  const structuralNodes = freshNodes.filter((node) => node.kind === "repository" || node.kind === "directory" || node.kind === "file");
  const structuralEdges = freshEdges.filter((edge) => edge.kind === "contains");
  const reusedEntries = canIncrement
    ? Object.entries(cache?.units ?? {})
      .filter(([filePath, unit]) => fileHashes[filePath] === unit.hash && !invalidated.has(filePath))
    : [];
  const reusedUnits = reusedEntries.map(([, unit]) => unit);
  const nodes = canIncrement
    ? mergeUnique([structuralNodes, freshNodes.filter((node) => !["repository", "directory", "file"].includes(node.kind)), ...reusedUnits.map((unit) => unit.nodes)])
    : freshNodes;
  const nodeIds = new Set(nodes.map((node) => node.id));
  const edges = (canIncrement
    ? mergeUnique([structuralEdges, freshEdges.filter((edge) => edge.kind !== "contains"), ...reusedUnits.map((unit) => unit.edges)])
    : freshEdges).filter((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target));
  const unresolvedCalls = analysis.unresolvedCalls + reusedUnits.reduce((total, unit) => total + unit.unresolvedCalls, 0);
  const previousSymbolIds = previous?.nodes.filter((node) => !["repository", "directory", "file", "package"].includes(node.kind)).map((node) => node.id) ?? [];
  const symbolIds = nodes.filter((node) => !["repository", "directory", "file", "package"].includes(node.kind)).map((node) => node.id);
  const previousEdgeIds = previous?.edges.map((edge) => edge.id) ?? [];
  const graph: CodeGraph = {
    schemaVersion: GRAPH_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    repository: { name: path.basename(config.root), root: config.root, fingerprint },
    changes,
    stats: calculateStats(nodes, edges, unresolvedCalls),
    nodes,
    edges,
    fileHashes,
    synchronization: {
      mode: canIncrement ? "incremental" : "full",
      lastSyncAt: new Date().toISOString(),
      analyzedFiles: [...analyzedFiles].sort(),
      reusedFiles: canIncrement ? changes.unchanged.filter((filePath) => !invalidated.has(filePath)) : [],
      invalidatedFiles: [...invalidated].sort(),
      changedSymbols: symmetricDifferenceCount(previousSymbolIds, symbolIds),
      changedRelationships: symmetricDifferenceCount(previousEdgeIds, edges.map((edge) => edge.id)),
      summaryFreshness: summaryFreshness(nodes),
    },
  };
  Object.defineProperty(graph, "__unresolvedCallsByFile", {
    value: {
      ...Object.fromEntries(reusedEntries.map(([filePath, unit]) => [filePath, unit.unresolvedCalls])),
      ...analysis.unresolvedCallsByFile,
    },
    enumerable: false,
  });
  return graph;
}

export async function writeIndex(graph: CodeGraph, outputDirectory: string): Promise<string> {
  const destination = path.join(outputDirectory, "graph.json");
  await atomicWriteJson(destination, graph);

  const unresolvedByFile = (graph as CodeGraph & { __unresolvedCallsByFile?: Record<string, number> }).__unresolvedCallsByFile ?? {};
  const cache = cacheFromGraph(graph, unresolvedByFile);
  const cacheDestination = path.join(outputDirectory, "analysis-cache.json");
  await atomicWriteJson(cacheDestination, cache);
  await recordArchitectureSnapshot(graph);
  await maintainAdrDrafts(graph);
  return destination;
}

export async function readIndex(indexPath: string): Promise<CodeGraph> {
  return JSON.parse(await readFile(indexPath, "utf8")) as CodeGraph;
}
