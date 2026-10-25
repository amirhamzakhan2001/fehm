import { resolve } from "node:path";
import { compressSource, focusedExcerpt } from "./compression.js";
import { buildContextPacket, renderContextPacket, type ContextOptions } from "./context.js";
import type { CodeGraph } from "./graph.js";
import { indexRepository, type IndexOptions } from "./indexer.js";
import type { LexicalIndex } from "./lexical-index.js";
import { loadMemory } from "./memory.js";
import type { ContextPacket, EdgeKind, GraphNode, Provenance, RetrievalHit, ScanChanges, SyncReport, UnresolvedReference } from "./model.js";
import { buildLexicalIndex, retrieve, type RetrievalOptions } from "./retrieval.js";
import {
  commandProvider,
  freshSemanticSummary,
  generateSemanticSummaries,
  loadSummaries,
  summaryPrompt,
  summaryStatus,
  type GenerateResult,
  type SemanticSummary,
  type SummaryProvider,
} from "./semantic-summary.js";
import { diffScan, scanRepository } from "./scanner.js";
import { SourceReader } from "./source.js";
import { deterministicSummary } from "./summary.js";
import { connectivity, systemMap, type ConnectivityReport, type SystemMap } from "./system-map.js";

export interface RelatedNode {
  id: string;
  name: string;
  kind: string;
  path?: string;
  line?: number;
  relation: EdgeKind;
  direction: "out" | "in";
  provenance: Provenance;
  confidence: number;
  detail?: string;
}

export type Resolution<T> =
  | { status: "found"; result: T }
  | { status: "ambiguous"; candidates: { id: string; kind: string; path?: string }[] }
  | { status: "not-found"; query: string };

export interface FocusResult {
  node: GraphNode;
  summary: string;
  related: RelatedNode[];
}

export interface ExplainResult {
  node: GraphNode;
  summary: string;
  semanticSummary?: { text: string; model: string; status: "fresh" };
  semanticStatus: "fresh" | "stale" | "missing";
  excerpt: string[];
  related: RelatedNode[];
  unknowns: UnresolvedReference[];
}

export interface FlowStep {
  id: string;
  name: string;
  path?: string;
  depth: number;
  provenance: Provenance;
  confidence: number;
  /** Already visited on this path or elsewhere in the tree. */
  repeated?: boolean;
  children: FlowStep[];
}

export interface EngineStatus {
  root: string;
  sync: SyncReport;
  stats: ReturnType<CodeGraph["stats"]>;
  summaries: { fresh: number; stale: number };
}

/**
 * The single Feature 1 engine. CLI, HTTP and library consumers all go through
 * this class, so there is exactly one scanner/graph/retrieval/context path.
 */
export class FehmEngine {
  readonly root: string;
  readonly graph: CodeGraph;
  readonly sync: SyncReport;
  private readonly hashes: Map<string, string>;
  private readonly options: IndexOptions;
  private readonly source: SourceReader;
  private lexical: LexicalIndex | undefined;
  private summariesCache: Record<string, SemanticSummary> | undefined;

  private constructor(root: string, graph: CodeGraph, sync: SyncReport, hashes: Map<string, string>, options: IndexOptions) {
    this.root = root;
    this.graph = graph;
    this.sync = sync;
    this.hashes = hashes;
    this.options = options;
    this.source = new SourceReader(root);
  }

  /** Scan + incremental index (cache-hit when nothing changed). */
  static open(root = ".", options: IndexOptions = {}): FehmEngine {
    const abs = resolve(root);
    const { graph, report, hashes } = indexRepository(abs, options);
    return new FehmEngine(abs, graph, report, hashes, options);
  }

  private get summaries(): Record<string, SemanticSummary> {
    this.summariesCache ??= loadSummaries(this.root, this.options.stateDirectory);
    return this.summariesCache;
  }

  private get index(): LexicalIndex {
    this.lexical ??= buildLexicalIndex(this.graph, this.source, (id) => {
      const node = this.graph.node(id);
      return freshSemanticSummary(this.summaries, id, node?.path ? this.hashes.get(node.path) : undefined)?.text;
    });
    return this.lexical;
  }

  status(): EngineStatus {
    let fresh = 0;
    for (const [id, entry] of Object.entries(this.summaries)) {
      const node = this.graph.node(id);
      if (summaryStatus(entry, node?.path ? this.hashes.get(node.path) : undefined) === "fresh") fresh += 1;
    }
    return { root: this.root, sync: this.sync, stats: this.graph.stats(), summaries: { fresh, stale: Object.keys(this.summaries).length - fresh } };
  }

  /**
   * Re-scan file fingerprints (no analysis) and report whether the working
   * tree has moved past this index. Cheap enough for a UI "stale" indicator.
   */
  freshness(): { fresh: boolean; added: number; modified: number; deleted: number } {
    const changes = this.changes();
    const added = changes.added.length;
    const modified = changes.modified.length;
    const deleted = changes.deleted.length;
    return { fresh: added + modified + deleted === 0, added, modified, deleted };
  }

  /** The paths behind `freshness()`: working tree vs this index (hash-only re-scan). */
  changes(): ScanChanges {
    return diffScan(this.hashes, scanRepository(this.root, this.options).files);
  }

  /** Content hashes of every indexed file, as recorded by this index. */
  fileHashes(): ReadonlyMap<string, string> {
    return this.hashes;
  }

  /** Lines of an indexed file (undefined for paths outside the index). */
  sourceLines(path: string): readonly string[] | undefined {
    return this.hashes.has(path) ? this.source.lines(path) : undefined;
  }

  search(query: string, options: RetrievalOptions = {}): RetrievalHit[] {
    return retrieve(this.graph, this.index, query, options);
  }

  context(query: string, options: ContextOptions = {}): ContextPacket {
    return buildContextPacket(
      {
        graph: this.graph,
        index: this.index,
        source: this.source,
        summaries: this.summaries,
        hashes: this.hashes,
        memory: loadMemory(this.root, this.options.stateDirectory),
        fresh: true, // open() always synchronizes before serving queries
      },
      query,
      options,
    );
  }

  renderContext(packet: ContextPacket): string {
    return renderContextPacket(packet);
  }

  /** Resolve a symbol name, qualified name, file path or node id. Reports ambiguity instead of guessing. */
  resolve(target: string): Resolution<GraphNode> {
    const direct = this.graph.node(target) ?? this.graph.node(`file:${target}`);
    if (direct) return { status: "found", result: direct };
    const [name, pathHint] = target.includes("@") ? (target.split("@") as [string, string]) : [target, undefined];
    let matches = this.graph.findByName(name).filter((n) => n.kind !== "directory" && n.kind !== "repository");
    if (pathHint) matches = matches.filter((n) => n.path?.includes(pathHint));
    if (matches.length === 1) return { status: "found", result: matches[0]! };
    if (matches.length === 0) return { status: "not-found", query: target };
    return { status: "ambiguous", candidates: matches.slice(0, 20).map((n) => ({ id: n.id, kind: n.kind, ...(n.path ? { path: n.path } : {}) })) };
  }

  relationships(target: string): Resolution<{ node: GraphNode; related: RelatedNode[] }> {
    const r = this.resolve(target);
    if (r.status !== "found") return r;
    return { status: "found", result: { node: r.result, related: this.related(r.result.id) } };
  }

  focus(target: string): Resolution<FocusResult> {
    const r = this.resolve(target);
    if (r.status !== "found") return r;
    const related = this.related(r.result.id).filter((x) => x.relation !== "contains");
    return { status: "found", result: { node: r.result, summary: deterministicSummary(this.graph, r.result), related } };
  }

  explain(target: string): Resolution<ExplainResult> {
    const r = this.resolve(target);
    if (r.status !== "found") return r;
    const node = r.result;
    const hash = node.path ? this.hashes.get(node.path) : undefined;
    const entry = this.summaries[node.id];
    const status = summaryStatus(entry, hash);
    const raw =
      node.kind === "file" && node.path
        ? this.source.lines(node.path)
        : node.path && node.location?.endLine
          ? this.source.slice(node.path, node.location.line, node.location.endLine)
          : undefined;
    const excerpt = raw ? focusedExcerpt(compressSource(raw, node.language), [node.name.split(".").at(-1)!], 40) : [];
    const result: ExplainResult = {
      node,
      summary: deterministicSummary(this.graph, node),
      semanticStatus: status,
      excerpt,
      related: this.related(node.id).filter((x) => x.relation !== "contains"),
      unknowns: this.graph.unresolved.filter((u) => u.fromNode === node.id || (node.kind === "file" && u.location.path === node.path)),
    };
    if (entry && status === "fresh") result.semanticSummary = { text: entry.text, model: entry.model, status: "fresh" };
    return { status: "found", result };
  }

  /** Outgoing call tree from an entry point, depth-bounded, cycles marked. */
  flow(target: string, depth = 3): Resolution<FlowStep> {
    const r = this.resolve(target);
    if (r.status !== "found") return r;
    const maxDepth = Math.min(Math.max(1, depth), 6);
    const visited = new Set<string>();
    const build = (node: GraphNode, d: number, provenance: Provenance, confidence: number): FlowStep => {
      const step: FlowStep = { id: node.id, name: node.name, depth: d, provenance, confidence, children: [] };
      if (node.path) step.path = node.path;
      if (visited.has(node.id)) {
        step.repeated = true;
        return step;
      }
      visited.add(node.id);
      if (d >= maxDepth) return step;
      // A file's flow starts from its module-level calls and the symbols it defines.
      const edges = this.graph.edgesOf(node.id, "out", node.kind === "file" ? ["calls", "defines"] : ["calls"]);
      for (const edge of edges) {
        const child = this.graph.node(edge.target);
        if (child) step.children.push(build(child, d + 1, edge.evidence.provenance, edge.evidence.confidence));
      }
      return step;
    };
    return { status: "found", result: build(r.result, 0, r.result.evidence.provenance, r.result.evidence.confidence) };
  }

  systemMap(): SystemMap {
    return systemMap(this.graph);
  }

  connectivity(): ConnectivityReport {
    return connectivity(this.graph);
  }

  /**
   * Opt-in semantic summaries for the given targets through an explicit
   * provider. Never called implicitly.
   */
  async summarize(targets: string[], provider: SummaryProvider): Promise<GenerateResult & { unresolvedTargets: string[] }> {
    const requests: { nodeId: string; prompt: string; sourceHash: string }[] = [];
    const unresolvedTargets: string[] = [];
    for (const t of targets) {
      const r = this.explain(t);
      if (r.status !== "found" || !r.result.node.path) {
        unresolvedTargets.push(t);
        continue;
      }
      const hash = this.hashes.get(r.result.node.path);
      if (!hash) {
        unresolvedTargets.push(t);
        continue;
      }
      requests.push({ nodeId: r.result.node.id, prompt: summaryPrompt(r.result.summary, r.result.excerpt.join("\n")), sourceHash: hash });
    }
    const result = await generateSemanticSummaries(this.root, requests, provider, this.options.stateDirectory);
    this.summariesCache = undefined;
    this.lexical = undefined;
    return { ...result, unresolvedTargets };
  }

  private related(id: string): RelatedNode[] {
    return this.graph.edgesOf(id, "both").map((edge) => {
      const direction: "out" | "in" = edge.source === id ? "out" : "in";
      const other = this.graph.node(direction === "out" ? edge.target : edge.source)!;
      const item: RelatedNode = {
        id: other.id,
        name: other.name,
        kind: other.kind,
        relation: edge.kind,
        direction,
        provenance: edge.evidence.provenance,
        confidence: edge.evidence.confidence,
      };
      if (other.path) item.path = other.path;
      if (edge.evidence.location) item.line = edge.evidence.location.line;
      if (edge.evidence.detail) item.detail = edge.evidence.detail;
      return item;
    });
  }
}

export { commandProvider };
