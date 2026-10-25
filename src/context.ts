import { compressSource, estimateTokens, fitToBudget, focusedExcerpt, TOKEN_ESTIMATOR } from "./compression.js";
import { diversifyHits } from "./context-selection.js";
import type { CodeGraph } from "./graph.js";
import type { LexicalIndex } from "./lexical-index.js";
import { rankMemory, stackKeywords } from "./memory.js";
import {
  GRAPH_SCHEMA_VERSION,
  type ContextItem,
  type ContextPacket,
  type ContextRelationship,
  type DetailLevel,
  type GraphNode,
  type Language,
  type MemoryEntry,
  type RetrievalHit,
  type RetrievalIntent,
} from "./model.js";
import { detectIntent, retrieve, type RetrievalWeights } from "./retrieval.js";
import { freshSemanticSummary, type SemanticSummary } from "./semantic-summary.js";
import type { SourceReader } from "./source.js";
import { deterministicSummary } from "./summary.js";
import { queryTerms, tokenize } from "./text.js";
import { entryPoints, languageCounts, topDirectories } from "./system-map.js";

/** Everything context building reads. Supplied by the engine; never re-parses the repo. */
export interface ContextSources {
  graph: CodeGraph;
  index: LexicalIndex;
  source: SourceReader;
  summaries: Record<string, SemanticSummary>;
  hashes: ReadonlyMap<string, string>;
  memory: readonly MemoryEntry[];
  fresh: boolean;
}

export interface ContextOptions {
  /** Token budget for the rendered packet. Default 4000. */
  budget?: number;
  intent?: RetrievalIntent;
  depth?: number;
  /** Candidate pool size from retrieval. Default 40. */
  candidates?: number;
  weights?: Partial<RetrievalWeights>;
}

const LEVELS: DetailLevel[] = ["relationship", "summary", "signature", "section", "source"];
const LEVEL_RANK: Record<DetailLevel, number> = { relationship: 0, summary: 1, signature: 2, section: 3, source: 4 };
const MAX_SOURCE_LINES = 150;
const FENCE: Partial<Record<Language, string>> = { typescript: "ts", javascript: "js", python: "python", go: "go", rust: "rust", java: "java" };

interface Candidate {
  hit: RetrievalHit;
  node: GraphNode;
  anchor: boolean;
  max: DetailLevel;
  level?: DetailLevel;
  texts: Partial<Record<DetailLevel, string>>;
  costs: Partial<Record<DetailLevel, number>>;
  summarySource: "deterministic" | "semantic";
}

export function buildContextPacket(src: ContextSources, query: string, options: ContextOptions = {}): ContextPacket {
  const maximumTokens = Math.max(0, Math.floor(options.budget ?? 4000));
  const intent = options.intent ?? detectIntent(query);
  const hits = retrieve(src.graph, src.index, query, {
    intent,
    limit: options.candidates ?? 40,
    ...(options.depth !== undefined ? { depth: options.depth } : {}),
    ...(options.weights ? { weights: options.weights } : {}),
  });
  const { ordered, anchors } = diversifyHits(hits);
  const terms = queryTerms(query);
  const identifiers = query.match(/[A-Za-z_$][\w$]*/g) ?? [];

  const packet: ContextPacket = {
    schemaVersion: GRAPH_SCHEMA_VERSION,
    query,
    intent,
    budget: { maximumTokens, usedTokens: 0, remainingTokens: maximumTokens, truncated: false, dropped: 0, downgraded: 0, estimator: TOKEN_ESTIMATOR },
    quality: { queryTermCoverage: 0, exactSymbolMatch: false, meanConfidence: 0, heuristicShare: 0, filesCovered: 0, testsIncluded: 0, relationshipsIncluded: 0, unresolvedNearby: 0 },
    architecture: { languages: languageCounts(src.graph), topDirectories: topDirectories(src.graph, 5), entryPoints: entryPoints(src.graph).slice(0, 5) },
    memory: [],
    tests: [],
    recommendedNodes: [],
    relationships: [],
    unknowns: [],
    index: {
      root: src.graph.root,
      files: src.graph.stats().files,
      symbols: src.graph.nodes().filter((n) => !["repository", "directory", "file", "package"].includes(n.kind)).length,
      relationships: src.graph.edgeCount,
      fresh: src.fresh,
    },
  };

  // ── Candidates with lazily-rendered detail levels ─────────────────────────
  const maxItems = Math.max(1, Math.min(40, Math.floor(maximumTokens / 100)));
  const floor = (hits[0]?.score ?? 0) * 0.2;
  const eligible = ordered.filter((h) => anchors.has(h.nodeId) || h.score >= floor);
  const chosen = eligible.slice(0, maxItems);
  const pathsWithSymbols = new Set(chosen.filter((h) => h.kind !== "file" && h.path).map((h) => h.path!));
  const candidates: Candidate[] = chosen.map((hit) => {
    const node = src.graph.node(hit.nodeId)!;
    const anchor = anchors.has(hit.nodeId);
    const semantic = freshSemanticSummary(src.summaries, node.id, node.path ? src.hashes.get(node.path) : undefined);
    // A file whose symbols are selected would only repeat their source: keep it structural.
    const max: DetailLevel =
      node.kind === "package" ? "summary"
      : node.kind === "file" && node.path && pathsWithSymbols.has(node.path) ? "signature"
      : anchor ? "source"
      : hit.depth === 0 ? "section"
      : "signature";
    return { hit, node, anchor, max, texts: {}, costs: {}, summarySource: semantic ? "semantic" : "deterministic" };
  });
  const focus = [...new Set([...identifiers, ...terms])];
  const textFor = (c: Candidate, level: DetailLevel): string | undefined => {
    if (!(level in c.texts)) {
      const t = renderItem(src, c, level, focus);
      if (t !== undefined) {
        c.texts[level] = t;
        c.costs[level] = estimateTokens(t) + 1;
      }
    }
    return c.texts[level];
  };

  // ── Small sections first, each capped to a share of the budget ───────────
  const header = renderHeader(packet);
  let reserved = estimateTokens(header);
  const within = (text: string, share: number): boolean => estimateTokens(text) <= maximumTokens * share && reserved + estimateTokens(text) <= maximumTokens;

  const selectedPreview = new Set(candidates.flatMap((c) => [c.node.id, c.node.path ?? ""]));
  for (const ranked of rankMemory(src.memory, query, selectedPreview, stackKeywords(src.graph))) {
    const next = [...packet.memory, ranked.entry];
    if (!within(renderMemory(next), 0.1)) break;
    packet.memory = next;
  }
  if (packet.memory.length) reserved += estimateTokens(renderMemory(packet.memory));
  const archText = renderArchitecture(packet);
  if (within(archText, 0.08)) reserved += estimateTokens(archText);
  else packet.architecture = { languages: {}, topDirectories: [], entryPoints: [] };

  // ── Progressive packing ───────────────────────────────────────────────────
  // 1. every candidate as a one-line relationship (breadth, cheap)
  // 2. anchors get real detail first, capped so they cannot starve the rest
  // 3. remaining candidates get summaries, then signatures, then sections
  // 4. anchors may take full source with whatever is left
  const relationshipReserve = Math.min(Math.floor(maximumTokens * 0.12), 400);
  const itemBudget = Math.max(0, maximumTokens - reserved - relationshipReserve - 40);
  let used = 0;
  let anchorSpend = 0;
  /** `anchorCap` bounds what anchors alone may spend; the total never exceeds itemBudget. */
  const raise = (c: Candidate, level: DetailLevel, anchorCap: number): void => {
    if (LEVEL_RANK[level] > LEVEL_RANK[c.max]) return;
    if (c.level && LEVEL_RANK[level] <= LEVEL_RANK[c.level]) return;
    if (level !== "relationship" && !c.level) return;
    const text = textFor(c, level);
    if (text === undefined) return;
    const delta = c.costs[level]! - (c.level ? c.costs[c.level]! : 0);
    if (used + delta > itemBudget) return;
    if (c.anchor && anchorSpend + delta > anchorCap) return;
    used += delta;
    if (c.anchor) anchorSpend += delta;
    c.level = level;
  };
  const anchorsFirst = candidates.filter((c) => c.anchor);
  const others = candidates.filter((c) => !c.anchor);
  const steps: [Candidate[], DetailLevel, number][] = [
    [candidates, "relationship", 1],
    [anchorsFirst, "summary", 1],
    [anchorsFirst, "signature", 0.55],
    [anchorsFirst, "section", 0.55],
    [anchorsFirst, "source", 0.55],
    [others, "summary", 1],
    [others, "signature", 1],
    [others, "section", 1],
    [anchorsFirst, "signature", 1],
    [anchorsFirst, "section", 1],
    [anchorsFirst, "source", 1],
  ];
  for (const [group, level, share] of steps) for (const c of group) raise(c, level, itemBudget * share);
  const included = candidates.filter((c) => c.level);
  packet.budget.dropped = eligible.length - included.length;
  // Downgraded = a richer level existed within the item's cap but did not fit.
  packet.budget.downgraded = included.filter((c) =>
    LEVELS.slice(LEVEL_RANK[c.level!] + 1, LEVEL_RANK[c.max] + 1).some((l) => textFor(c, l) !== undefined),
  ).length;
  packet.recommendedNodes = included.map((c) => toItem(c));

  // ── Relationships, tests, unknowns ────────────────────────────────────────
  const selectedIds = new Set(included.map((c) => c.node.id));
  const selectedPaths = new Set(included.map((c) => c.node.path).filter((p): p is string => !!p));
  packet.relationships = relationshipsFor(src.graph, selectedIds, new Set(included.filter((c) => c.anchor).map((c) => c.node.id)));
  packet.tests = relatedTests(src.graph, selectedIds, included);
  const unresolved = src.graph.unresolved.filter((u) => selectedIds.has(u.fromNode) || selectedPaths.has(u.location.path));
  packet.unknowns = unresolved.slice(0, 5).map((u) => `${u.location.path}:${u.location.line} ${u.kind} \`${u.text.slice(0, 60)}\` unresolved (${u.reason})`);
  if (unresolved.length > 5) packet.unknowns.push(`…and ${unresolved.length - 5} more unresolved references near the selection`);
  const heuristicLanguages = [...new Set(included.filter((c) => c.node.evidence.provenance === "heuristic").map((c) => c.node.language))];
  if (heuristicLanguages.length) packet.unknowns.push(`${heuristicLanguages.join(", ")} relationships are pattern-based (heuristic), not compiler-resolved`);
  if (!src.fresh) packet.unknowns.push("index may be stale: repository changed since last scan");
  if (hits.length === 0) packet.unknowns.push("no repository nodes matched the query");

  // ── Enforce the budget on the final rendering ─────────────────────────────
  // Measure with usedTokens at its widest value so the header can only shrink.
  const fit = (): number => {
    packet.budget.usedTokens = maximumTokens;
    return estimateTokens(renderUnbounded(packet));
  };
  let total = fit();
  while (total > maximumTokens && packet.relationships.length > 0) {
    packet.relationships.pop();
    packet.budget.truncated = true;
    total = fit();
  }
  for (const drop of [() => packet.unknowns.pop(), () => packet.tests.pop(), () => packet.memory.pop()]) {
    while (total > maximumTokens && drop() !== undefined) total = fit();
  }
  while (total > maximumTokens && packet.recommendedNodes.length > 0) {
    // Lose detail from the lowest-ranked item first; drop it once it is a single line.
    const last = included[packet.recommendedNodes.length - 1]!;
    const lower = LEVELS[LEVEL_RANK[last.level!] - 1];
    if (lower && textFor(last, lower) !== undefined) {
      last.level = lower;
      packet.budget.downgraded += 1;
      packet.recommendedNodes[packet.recommendedNodes.length - 1] = toItem(last);
    } else {
      packet.recommendedNodes.pop();
      packet.budget.dropped += 1;
    }
    total = fit();
  }
  if (total > maximumTokens) {
    packet.architecture = { languages: {}, topDirectories: [], entryPoints: [] };
    total = fit();
  }
  packet.budget.truncated ||= packet.budget.dropped > 0 || packet.budget.downgraded > 0;

  // ── Quality metrics (observable evidence, not "understanding") ────────────
  const finalIds = new Set(packet.recommendedNodes.map((n) => n.nodeId));
  const covered = new Set(packet.recommendedNodes.flatMap((n) => tokenize(`${n.name} ${n.path ?? ""} ${n.text}`)));
  const confidences = [
    ...packet.recommendedNodes.map((n) => src.graph.node(n.nodeId)!.evidence.confidence),
    ...packet.relationships.map((r) => r.confidence),
  ];
  packet.quality = {
    queryTermCoverage: terms.length ? round(terms.filter((t) => covered.has(t)).length / terms.length) : 0,
    exactSymbolMatch: hits.some((h) => finalIds.has(h.nodeId) && h.signals.symbol >= 0.9),
    meanConfidence: confidences.length ? round(confidences.reduce((a, b) => a + b, 0) / confidences.length) : 0,
    heuristicShare: packet.relationships.length ? round(packet.relationships.filter((r) => r.provenance === "heuristic").length / packet.relationships.length) : 0,
    filesCovered: new Set(packet.recommendedNodes.map((n) => n.path).filter(Boolean)).size,
    testsIncluded: packet.tests.length,
    relationshipsIncluded: packet.relationships.length,
    unresolvedNearby: unresolved.length,
  };
  // Report the estimate of the final rendering (stable after at most a few passes).
  if (total > maximumTokens) packet.budget.truncated = true; // header itself is hard-cut
  let reported = Math.min(total, maximumTokens);
  for (let i = 0; i < 3; i += 1) {
    packet.budget.usedTokens = reported;
    const measured = estimateTokens(renderContextPacket(packet));
    if (measured === reported) break;
    reported = measured;
  }
  packet.budget.usedTokens = reported;
  packet.budget.remainingTokens = maximumTokens - reported;
  return packet;
}

function toItem(c: Candidate): ContextItem {
  const item: ContextItem = {
    nodeId: c.node.id,
    kind: c.node.kind,
    name: c.node.name,
    score: c.hit.score,
    detail: c.level!,
    text: c.texts[c.level!]!,
    tokens: c.costs[c.level!]!,
    summarySource: c.summarySource,
  };
  if (c.node.path) item.path = c.node.path;
  if (c.node.location) item.location = c.node.location;
  return item;
}

function renderItem(src: ContextSources, c: Candidate, level: DetailLevel, focus: readonly string[]): string | undefined {
  const node = c.node;
  const where = node.path ? `${node.path}${node.location ? `:${node.location.line}${node.location.endLine && node.location.endLine !== node.location.line ? `-${node.location.endLine}` : ""}` : ""}` : "";
  const title = `${node.kind} ${node.name}${where ? ` — ${where}` : ""}`;
  if (level === "relationship") return `- ${title}${c.hit.reasons[0] ? ` (${c.hit.reasons[0]})` : ""}`;
  const semantic = c.summarySource === "semantic" ? src.summaries[node.id] : undefined;
  const summary = semantic ? `${semantic.text} [semantic: ${semantic.model}]` : deterministicSummary(src.graph, node);
  if (level === "summary") return `### ${title}\n${summary}`;
  if (level === "signature") {
    const sig =
      node.kind === "file"
        ? src.graph.edgesOf(node.id, "out", ["defines"]).map((e) => src.graph.node(e.target)?.signature).filter(Boolean).slice(0, 8).join("\n")
        : node.signature;
    if (!sig) return undefined;
    return `### ${title}\n${summary}\n\`\`\`${FENCE[node.language ?? "other"] ?? ""}\n${sig}\n\`\`\``;
  }
  if (!node.path) return undefined;
  const raw = node.kind === "file" ? src.source.lines(node.path) : node.location?.endLine ? src.source.slice(node.path, node.location.line, node.location.endLine) : undefined;
  if (!raw || raw.length === 0) return undefined;
  const lines = compressSource(raw, node.language);
  let body: string[];
  if (level === "section") body = focusedExcerpt(lines, [...focus, ...calleeNames(src.graph, node)]);
  else {
    if (lines.length > MAX_SOURCE_LINES) return undefined;
    body = lines;
  }
  const label = level === "section" && body.length < lines.length ? " (excerpt)" : "";
  return `### ${title}${label}\n${summary}\n\`\`\`${FENCE[node.language ?? "other"] ?? ""}\n${body.join("\n")}\n\`\`\``;
}

function calleeNames(graph: CodeGraph, node: GraphNode): string[] {
  return graph.edgesOf(node.id, "out", ["calls"]).map((e) => graph.node(e.target)?.name.split(".").at(-1) ?? "");
}

function relationshipsFor(graph: CodeGraph, selected: ReadonlySet<string>, anchors: ReadonlySet<string>): ContextRelationship[] {
  const out = new Map<string, ContextRelationship>();
  for (const id of [...selected].sort()) {
    for (const edge of graph.edgesOf(id, "both")) {
      if (edge.kind === "contains" || edge.kind === "defines") continue;
      const both = selected.has(edge.source) && selected.has(edge.target);
      if (!both && !anchors.has(id)) continue;
      const s = graph.node(edge.source);
      const t = graph.node(edge.target);
      if (!s || !t) continue;
      out.set(edge.id, {
        kind: edge.kind,
        source: edge.source,
        target: edge.target,
        sourceName: s.name,
        targetName: t.name,
        provenance: edge.evidence.provenance,
        confidence: edge.evidence.confidence,
      });
    }
  }
  return [...out.values()]
    .sort((a, b) => Number(selected.has(b.source) && selected.has(b.target)) - Number(selected.has(a.source) && selected.has(a.target)) || b.confidence - a.confidence || cmp(`${a.kind}|${a.source}|${a.target}`, `${b.kind}|${b.source}|${b.target}`))
    .slice(0, 30);
}

function relatedTests(graph: CodeGraph, selected: ReadonlySet<string>, included: readonly Candidate[]): string[] {
  const counts = new Map<string, number>();
  for (const c of included) if (c.node.isTest && c.node.path) counts.set(c.node.path, (counts.get(c.node.path) ?? 0) + 2);
  for (const id of selected) {
    const node = graph.node(id);
    const targets = [id, ...(node?.path && node.kind !== "file" ? [`file:${node.path}`] : [])];
    for (const t of targets) {
      for (const edge of graph.edgesOf(t, "in", ["imports", "calls", "references", "uses"])) {
        const from = graph.node(edge.source);
        if (from?.isTest && from.path) counts.set(from.path, (counts.get(from.path) ?? 0) + 1);
      }
    }
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || cmp(a[0], b[0])).slice(0, 5).map(([p]) => p);
}

// ── Rendering (a view of the JSON packet, never the store) ──────────────────

function renderHeader(p: ContextPacket): string {
  return `# fehm context: ${p.query}\nintent: ${p.intent} · budget: ${p.budget.usedTokens}/${p.budget.maximumTokens} tokens (${p.budget.estimator}) · index: ${p.index.files} files, ${p.index.symbols} symbols${p.index.fresh ? "" : " (stale)"}`;
}

function renderArchitecture(p: ContextPacket): string {
  const langs = Object.entries(p.architecture.languages).sort((a, b) => b[1] - a[1] || cmp(a[0], b[0])).slice(0, 5).map(([l, n]) => `${l} ${n}`);
  if (!langs.length && !p.architecture.topDirectories.length) return "";
  const parts = [`languages: ${langs.join(", ")}`];
  if (p.architecture.topDirectories.length) parts.push(`main dirs: ${p.architecture.topDirectories.join(", ")}`);
  if (p.architecture.entryPoints.length) parts.push(`entry points: ${p.architecture.entryPoints.join(", ")}`);
  return `## Project\n${parts.join("\n")}`;
}

function renderMemory(entries: readonly MemoryEntry[]): string {
  if (!entries.length) return "";
  return `## Project memory\n${entries.map((e) => `- ${e.text}${e.links.length ? ` (re: ${e.links.join(", ")})` : ""}`).join("\n")}`;
}

/**
 * Markdown rendering of a packet. The budget is enforced against this text;
 * if even the header cannot fit (tiny budgets) the text is hard-cut.
 */
export function renderContextPacket(p: ContextPacket): string {
  return fitToBudget(renderUnbounded(p), p.budget.maximumTokens);
}

function renderUnbounded(p: ContextPacket): string {
  const sections = [renderHeader(p)];
  const arch = renderArchitecture(p);
  if (arch) sections.push(arch);
  const mem = renderMemory(p.memory);
  if (mem) sections.push(mem);
  const full = p.recommendedNodes.filter((n) => n.detail !== "relationship");
  const brief = p.recommendedNodes.filter((n) => n.detail === "relationship");
  if (full.length) sections.push(`## Relevant code\n${full.map((n) => n.text).join("\n\n")}`);
  if (brief.length) sections.push(`## Also relevant\n${brief.map((n) => n.text).join("\n")}`);
  if (p.relationships.length) {
    sections.push(`## Relationships\n${p.relationships.map((r) => `- ${r.sourceName} ${r.kind} ${r.targetName} [${r.provenance} ${r.confidence.toFixed(2)}]`).join("\n")}`);
  }
  if (p.tests.length) sections.push(`## Tests\n${p.tests.map((t) => `- ${t}`).join("\n")}`);
  if (p.unknowns.length) sections.push(`## Unknowns\n${p.unknowns.map((u) => `- ${u}`).join("\n")}`);
  return sections.join("\n\n");
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
