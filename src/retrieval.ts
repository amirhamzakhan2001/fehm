import type { CodeGraph } from "./graph.js";
import { LexicalIndex } from "./lexical-index.js";
import type { EdgeKind, GraphNode, NodeKind, RetrievalHit, RetrievalIntent, RetrievalSignals } from "./model.js";
import type { SourceReader } from "./source.js";
import { queryTerms, splitIdentifier } from "./text.js";

export interface RetrievalWeights {
  lexical: number;
  symbol: number;
  semantic: number;
  graph: number;
}

/** Default blend. Intent is applied as a bounded multiplier (see `retrieve`). */
export const DEFAULT_WEIGHTS: RetrievalWeights = { lexical: 0.35, symbol: 0.35, semantic: 0.1, graph: 0.2 };

export interface RetrievalOptions {
  limit?: number;
  /** Graph expansion depth (0–3). Default depends on intent. */
  depth?: number;
  intent?: RetrievalIntent;
  weights?: Partial<RetrievalWeights>;
}

const EXPANSION_KINDS: readonly EdgeKind[] = ["calls", "references", "uses", "imports", "extends", "implements", "defines", "writes", "handles"];
const INDEXED_KINDS = new Set<NodeKind>(["file", "package", "module", "class", "interface", "enum", "function", "method", "field", "variable", "type", "route", "section"]);
const SEED_COUNT = 8;
const MAX_BODY_LINES = 200;

/** Deterministic intent classification. First matching rule wins. */
export function detectIntent(query: string): RetrievalIntent {
  const q = query.toLowerCase();
  if (/\b(tests?|testing|spec|specs|coverage|tested)\b/.test(q)) return "test";
  if (/\b(bug|bugs|error|errors|fail|fails|failing|failure|crash|crashes|exception|broken|debug|fix|stack ?trace|why does(n't| not))\b/.test(q)) return "debug";
  if (/\b(architecture|structure|overview|organi[sz]ed|layers?|modules?|design|components?|dependency graph)\b/.test(q)) return "architecture";
  if (/\b(add|implement|change|modify|refactor|rename|update|extend|remove|delete|replace|support|migrate)\b/.test(q)) return "change";
  if (/\b(where|find|locate|which file|defined|definition|declared)\b/.test(q)) return "locate";
  return "explain";
}

const DEFAULT_DEPTH: Record<RetrievalIntent, number> = { locate: 1, explain: 2, change: 2, debug: 2, test: 1, architecture: 1 };

/** Prior in [0,1] for how useful a node of this shape is for the intent. */
export function intentPrior(node: GraphNode, intent: RetrievalIntent): number {
  const base = basePrior(node, intent);
  // Fine-grained members and doc headings are useful evidence but should not
  // crowd out the functions/classes they belong to.
  if (node.kind === "field") return base * 0.7;
  if (node.kind === "section") return base * (intent === "architecture" || intent === "explain" ? 0.85 : 0.7);
  return base;
}

function basePrior(node: GraphNode, intent: RetrievalIntent): number {
  const symbol = node.kind !== "file" && node.kind !== "package";
  const test = !!node.isTest;
  switch (intent) {
    case "test":
      return test ? 1 : symbol ? 0.6 : 0.5;
    case "debug":
      if (test) return 0.4;
      return /error|exception|fail|throw|catch|handle|valid/i.test(node.name) ? 1 : node.kind === "function" || node.kind === "method" ? 0.85 : 0.6;
    case "architecture":
      if (test) return 0.3;
      return node.kind === "file" ? 1 : node.kind === "class" || node.kind === "interface" || node.kind === "package" ? 0.85 : 0.6;
    case "change":
      if (test) return 0.55;
      return symbol ? (node.exported ? 1 : 0.85) : 0.7;
    case "locate":
      if (test) return 0.4;
      return symbol ? 1 : 0.8;
    case "explain":
    default:
      if (test) return 0.4;
      return node.kind === "function" || node.kind === "method" || node.kind === "class" ? 1 : 0.75;
  }
}

/** Build the lexical index for all retrievable nodes. */
export function buildLexicalIndex(graph: CodeGraph, source: SourceReader, extraText?: (nodeId: string) => string | undefined): LexicalIndex {
  const index = new LexicalIndex();
  for (const node of graph.nodes()) {
    if (!INDEXED_KINDS.has(node.kind)) continue;
    const fields: { text: string; weight: number }[] = [{ text: node.name, weight: 4 }];
    if (node.path) fields.push({ text: node.path, weight: node.kind === "file" ? 3 : 1 });
    if (node.signature) fields.push({ text: node.signature, weight: 2 });
    if (node.doc) fields.push({ text: node.doc, weight: 2 });
    const extra = extraText?.(node.id);
    if (extra) fields.push({ text: extra, weight: 1 });
    if (node.kind === "file") {
      const defined = graph.edgesOf(node.id, "out", ["defines"]).map((e) => graph.node(e.target)?.name ?? "");
      fields.push({ text: defined.join(" "), weight: 1 });
    } else if (node.path && node.location?.endLine) {
      const body = source.slice(node.path, node.location.line, Math.min(node.location.endLine, node.location.line + MAX_BODY_LINES));
      if (body) fields.push({ text: body.join("\n"), weight: 1 });
    }
    index.add({ id: node.id, fields });
  }
  return index;
}

/** Identifier-like tokens as the user typed them, for exact symbol matching. */
function queryIdentifiers(query: string): string[] {
  return [...new Set(query.match(/[A-Za-z_$][\w$.]*/g) ?? [])].map((s) => s.replace(/\.$/, "")).filter((s) => s.length >= 2);
}

/** camelCase, PascalCase, snake_case, dotted or digit-bearing: typed as a name, not prose. */
function identifierShaped(token: string): boolean {
  return /[A-Z_.$0-9]/.test(token);
}

/** In a multi-word question a plain lowercase word ("round") is weak evidence of a symbol name. */
export const PLAIN_WORD_SYMBOL_CAP = 0.6;

export function symbolSignal(node: GraphNode, identifiers: readonly string[]): number {
  const simple = node.name.split(".").at(-1)!;
  const base = node.kind === "file" ? node.name.replace(/\.[^.]+$/, "") : simple;
  let best = 0;
  for (const id of identifiers) {
    if (id === node.name || id === simple || (node.kind === "file" && (id === node.path || id === node.name))) return 1;
    const lower = id.toLowerCase();
    if (lower === simple.toLowerCase() || lower === node.name.toLowerCase()) best = Math.max(best, 0.9);
    else if (lower === base.toLowerCase()) best = Math.max(best, 0.8);
    else if (splitIdentifier(id).join("") === splitIdentifier(simple).join("")) best = Math.max(best, 0.9);
    else if (lower.length >= 4 && simple.toLowerCase().includes(lower)) best = Math.max(best, 0.25);
  }
  return best;
}

const KIND_ORDER: Record<string, number> = { function: 0, method: 1, route: 2, class: 3, interface: 4, enum: 5, type: 6, module: 7, field: 8, variable: 9, file: 10, section: 11, package: 12 };

/**
 * Hybrid retrieval: lexical (BM25) + exact symbol + deterministic concept
 * expansion (synonyms) + depth-bounded graph expansion, scaled by an intent
 * prior. Output order is fully deterministic: score, depth, kind, id.
 */
export function retrieve(graph: CodeGraph, index: LexicalIndex, query: string, options: RetrievalOptions = {}): RetrievalHit[] {
  const intent = options.intent ?? detectIntent(query);
  const weights = { ...DEFAULT_WEIGHTS, ...options.weights };
  const depth = Math.min(3, Math.max(0, options.depth ?? DEFAULT_DEPTH[intent]));
  const limit = options.limit ?? 30;
  const identifiers = queryIdentifiers(query);
  if (queryTerms(query).length === 0 && identifiers.length === 0) return [];

  const lexical = index.search(query, 200);
  const maxLex = Math.max(0, ...lexical.map((l) => l.lexical));
  const maxSem = Math.max(0, ...lexical.map((l) => l.semantic));

  const acc = new Map<string, { signals: RetrievalSignals; depth: number; reasons: string[] }>();
  const entry = (id: string) => {
    let e = acc.get(id);
    if (!e) acc.set(id, (e = { signals: { lexical: 0, symbol: 0, semantic: 0, graph: 0, intent: 0 }, depth: 0, reasons: [] }));
    return e;
  };
  for (const l of lexical) {
    const e = entry(l.id);
    e.signals.lexical = maxLex > 0 ? l.lexical / maxLex : 0;
    e.signals.semantic = maxSem > 0 ? l.semantic / maxSem : 0;
    if (l.matchedTerms.length) e.reasons.push(`terms: ${l.matchedTerms.join(", ")}`);
    if (l.semantic > 0) e.reasons.push("related concept");
  }
  const singleWord = identifiers.length === 1;
  const strongIds = identifiers.filter((id) => singleWord || identifierShaped(id));
  const plainIds = identifiers.filter((id) => !strongIds.includes(id));
  // "xml parser" / "session store": a name typed as consecutive words.
  const words = query.match(/[A-Za-z0-9]+/g) ?? [];
  for (let n = 2; n <= 3; n += 1) {
    for (let i = 0; i + n <= words.length; i += 1) strongIds.push(words.slice(i, i + n).join(""));
  }
  if (identifiers.length) {
    for (const node of graph.nodes()) {
      if (!INDEXED_KINDS.has(node.kind)) continue;
      const s = Math.max(
        symbolSignal(node, strongIds),
        Math.min(PLAIN_WORD_SYMBOL_CAP, symbolSignal(node, plainIds)),
      );
      if (s > 0) {
        const e = entry(node.id);
        e.signals.symbol = s;
        e.reasons.push(s >= 0.9 ? "name match" : "partial name match");
      }
    }
  }

  const base = (s: RetrievalSignals): number =>
    weights.lexical * s.lexical + weights.symbol * s.symbol + weights.semantic * s.semantic + weights.graph * s.graph;

  // Graph expansion from the strongest direct matches, depth-bounded.
  const seeds = [...acc.entries()]
    .map(([id, e]) => ({ id, score: base(e.signals) }))
    .sort((a, b) => b.score - a.score || cmp(a.id, b.id))
    .slice(0, SEED_COUNT);
  const topSeed = seeds[0]?.score ?? 0;
  const seedIds = new Set(seeds.map((s) => s.id));
  for (const seed of seeds) {
    const strength = topSeed > 0 ? seed.score / topSeed : 0;
    let connected = 0;
    for (const step of graph.traverse(seed.id, { depth, kinds: EXPANSION_KINDS, limit: 60 })) {
      const node = graph.node(step.nodeId);
      if (!node || !INDEXED_KINDS.has(node.kind)) continue;
      if (seedIds.has(step.nodeId)) connected += 1;
      const g = strength * Math.pow(0.5, step.depth - 1) * step.via.evidence.confidence * 0.8;
      const e = entry(step.nodeId);
      if (g > e.signals.graph) {
        e.signals.graph = g;
        if (!seedIds.has(step.nodeId) && e.signals.lexical === 0 && e.signals.symbol === 0) {
          e.depth = step.depth;
          const seedName = graph.node(seed.id)?.name ?? seed.id;
          const rel = step.via.source === step.nodeId ? `${step.via.kind} ${seedName}` : `${step.via.kind === "calls" ? "called by" : `${step.via.kind} from`} ${seedName}`;
          e.reasons = [step.depth === 1 ? rel : `${step.depth} hops from ${seedName}`];
        }
      }
    }
    // Seeds linked to other seeds sit at the centre of the match set.
    const se = acc.get(seed.id)!;
    se.signals.graph = Math.max(se.signals.graph, Math.min(1, connected / Math.max(1, seeds.length - 1)));
  }

  const hits: RetrievalHit[] = [];
  for (const [id, e] of acc) {
    const node = graph.node(id);
    if (!node || !INDEXED_KINDS.has(node.kind)) continue;
    if (node.kind === "package" && e.signals.symbol === 0 && intent !== "architecture") continue;
    e.signals.intent = intentPrior(node, intent);
    const score = base(e.signals) * (0.6 + 0.4 * e.signals.intent);
    if (score <= 0) continue;
    const hit: RetrievalHit = {
      nodeId: id,
      kind: node.kind,
      name: node.name,
      score: round(score),
      signals: roundSignals(e.signals),
      depth: e.depth,
      reasons: e.reasons,
    };
    if (node.path) hit.path = node.path;
    hits.push(hit);
  }
  hits.sort(
    (a, b) => b.score - a.score || a.depth - b.depth || (KIND_ORDER[a.kind] ?? 9) - (KIND_ORDER[b.kind] ?? 9) || cmp(a.nodeId, b.nodeId),
  );
  return hits.slice(0, limit);
}

function round(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

function roundSignals(s: RetrievalSignals): RetrievalSignals {
  return { lexical: round(s.lexical), symbol: round(s.symbol), semantic: round(s.semantic), graph: round(s.graph), intent: round(s.intent) };
}

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
