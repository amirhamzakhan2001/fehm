import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { aggregate, buildArchitectureModel } from "../../architecture/model.js";
import { ARCHITECTURE_VERSION, LAYOUT_VERSION, type ArchitectureModel, type ArchitectureSummary, type ArchNode, type ArchRelationship, type DiagramLayout, type NodeDetail, type PublishedView, type RelationshipDetail, type SearchHit, type SourceExcerpt, type ViewDescriptor, type ViewType } from "../../architecture/types.js";
import { buildView, describeViews, layoutWithRepair, publish, type ViewContext } from "../../architecture/views.js";
import { BriefingFacts } from "../../codebase-briefing/facts.js";
import type { FehmEngine } from "../../engine.js";
import { stateDir } from "../../persistence.js";

export interface ArchitectureServiceOptions {
  stateDirectory?: string;
  /** Do not read or write `.fehm/architecture-layout.json`. */
  dryRun?: boolean;
}

interface Built {
  model: ArchitectureModel;
  facts: BriefingFacts;
  byId: Map<string, ArchNode>;
  ctx: ViewContext;
  views: Map<string, PublishedView>;
  catalog?: ViewDescriptor[];
  durationMs: number;
}

interface LayoutCache {
  version: string;
  /** Per view key: the last layout that passed showcase validation, and the model fingerprint it was made for. */
  views: Record<string, { fingerprint: string; layout: DiagramLayout; savedAt: string }>;
}

const CACHE_VERSION = `${ARCHITECTURE_VERSION}.${LAYOUT_VERSION}`;
const MAX_CACHED_VIEWS = 200;

/**
 * Feature 3.3's server side. One semantic model per engine instance (the
 * engine is replaced on refresh); views are projected, laid out and validated
 * on first request and memoized. Verified layouts persist in
 * `.fehm/architecture-layout.json` keyed by view and model fingerprint: an unchanged
 * repository reuses them without layout work, and a failed candidate falls
 * back to the last verified layout of that view.
 */
export class ArchitectureService {
  private readonly built = new WeakMap<FehmEngine, Built>();

  constructor(private readonly options: ArchitectureServiceOptions = {}) {}

  private base(engine: FehmEngine): Built {
    let b = this.built.get(engine);
    if (!b) {
      const started = performance.now();
      const facts = new BriefingFacts(engine);
      const model = buildArchitectureModel(engine, facts);
      const byId = new Map(model.nodes.map((n) => [n.id, n]));
      b = { model, facts, byId, ctx: { engine, facts, model, byId }, views: new Map(), durationMs: Math.round(performance.now() - started) };
      this.built.set(engine, b);
    }
    return b;
  }

  model(engine: FehmEngine): ArchitectureModel {
    return this.base(engine).model;
  }

  /** The 3.2 facts the model was built from (Feature 3.4 reuses both instead of re-extracting). */
  facts(engine: FehmEngine): BriefingFacts {
    return this.base(engine).facts;
  }

  /** All ten views with availability, reasons and choices (memoized per engine: it runs git and signal scans). */
  views(engine: FehmEngine): ViewDescriptor[] {
    const b = this.base(engine);
    b.catalog ??= describeViews(b.ctx);
    return b.catalog;
  }

  summary(engine: FehmEngine): ArchitectureSummary {
    const { model, durationMs } = this.base(engine);
    const views = this.views(engine);
    const components = model.components.length;
    return {
      schemaVersion: model.schemaVersion,
      repository: model.repository,
      fingerprint: model.fingerprint,
      generatedAt: model.generatedAt,
      counts: {
        components,
        modules: model.nodes.filter((n) => n.level === 3).length,
        files: model.nodes.filter((n) => n.level === 4).length,
        relationships: model.relationships.filter((r) => model.components.includes(r.source) || model.components.includes(r.target)).length,
        externals: model.nodes.filter((n) => n.tier !== 1).length,
        boundaries: components ? 1 : 0,
      },
      coverage: model.coverage,
      views,
      unknowns: model.unknowns,
      freshness: engine.freshness(),
      durationMs,
    };
  }

  view(engine: FehmEngine, type: ViewType, focus?: string): PublishedView | { error: string } {
    const b = this.base(engine);
    const spec = buildView(b.ctx, type, focus);
    if ("error" in spec) return spec;
    const key = `${spec.view}:${spec.focus ?? ""}`;
    const memo = b.views.get(key);
    if (memo) return memo;
    const cache = this.readCache(engine);
    const stored = cache?.views[key];
    let published: PublishedView;
    if (stored && stored.fingerprint === b.model.fingerprint) {
      // Same code, same model and layout versions: the verified layout is reused as is.
      published = { view: spec.view, title: spec.title, nodes: spec.nodes, relationships: spec.relationships, path: spec.path, notes: spec.notes, layout: stored.layout, validation: { profile: "showcase", valid: true, diagnostics: [], attempts: 0, source: "fresh" }, ...(spec.focus ? { focus: spec.focus } : {}) };
    } else {
      const candidate = layoutWithRepair(spec.input);
      published = publish(spec, candidate, stored?.layout);
      if (candidate.report.valid) this.writeCache(engine, cache, key, b.model.fingerprint, candidate.layout);
    }
    b.views.set(key, published);
    return published;
  }

  node(engine: FehmEngine, id: string): NodeDetail | undefined {
    const { model, byId, facts } = this.base(engine);
    const node = byId.get(id);
    if (!node) return this.viewLocalNode(engine, id);
    const rels = this.relationshipsAtLevel(engine, node);
    const entry = (otherId: string, r: (typeof rels)[number]) => {
      const o = byId.get(otherId)!;
      return { id: o.id, name: o.name, type: o.type, relationship: r.id, relType: r.type, weight: r.weight, confidence: r.confidence };
    };
    const dependsOn = rels.filter((r) => r.source === id && byId.has(r.target)).map((r) => entry(r.target, r)).sort((a, b) => b.weight - a.weight);
    const usedBy = rels.filter((r) => r.target === id && byId.has(r.source)).map((r) => entry(r.source, r)).sort((a, b) => b.weight - a.weight);
    const keySymbols = node.files
      .flatMap((f) => facts.keySymbols(f, 3).map((k) => ({ id: k.node.id, name: k.node.name, kind: k.node.kind, path: f, ...(k.node.location ? { line: k.node.location.line } : {}), inbound: k.inbound })))
      .sort((a, b) => b.inbound - a.inbound || (a.name < b.name ? -1 : 1))
      .slice(0, 8);
    const children = node.children.map((c) => byId.get(c)).filter((c): c is ArchNode => Boolean(c)).map((c) => ({ id: c.id, name: c.name, type: c.type, files: c.files.length }));
    const path: { id: string; name: string }[] = [];
    for (let cur: ArchNode | undefined = node; cur; cur = cur.parent ? byId.get(cur.parent) : undefined) path.unshift({ id: cur.id, name: cur.name });
    path.unshift({ id: "system", name: model.repository.name });
    return { node, dependsOn, usedBy, children, keySymbols, path };
  }

  /** A relationship by id: from the model, else re-aggregated for the two endpoints (drill-down and file levels). */
  relationship(engine: FehmEngine, id: string): RelationshipDetail | undefined {
    const { model, byId } = this.base(engine);
    let rel = model.relationships.find((r) => r.id === id);
    const local = rel ? undefined : this.viewLocal(engine, (v) => v.relationships.find((r) => r.id === id));
    if (local) {
      const nodes = this.viewLocalNodes(engine);
      const pick = (x: string) => {
        const n = nodes.get(x) ?? byId.get(x);
        return n ? { id: n.id, name: n.name, type: n.type } : { id: x, name: x, type: "component" as const };
      };
      return { relationship: local, source: pick(local.source), target: pick(local.target) };
    }
    if (!rel) {
      const m = /^rel:(.+)→(.+)$/.exec(id);
      if (!m) return undefined;
      const [, s, t] = m as unknown as [string, string, string];
      const sn = byId.get(s);
      const tn = byId.get(t);
      if (!sn || !tn) return undefined;
      const sFiles = new Set(sn.files);
      const tFiles = new Set(tn.files);
      const keyOf = (f: string): string | undefined => (sFiles.has(f) ? s : tFiles.has(f) ? t : undefined);
      rel = aggregate(model.codeLinks, model.externalLinks, keyOf, (x) => x === s || x === t).find((r) => r.id === id);
    }
    if (!rel) return undefined;
    const pick = (x: string) => {
      const n = byId.get(x)!;
      return { id: n.id, name: n.name, type: n.type };
    };
    return { relationship: rel, source: pick(rel.source), target: pick(rel.target) };
  }

  source(engine: FehmEngine, path: string, line: number, radius = 8): SourceExcerpt | undefined {
    const lines = engine.sourceLines(path);
    if (!lines) return undefined;
    const focus = Math.min(Math.max(1, Math.floor(line) || 1), Math.max(1, lines.length));
    const start = Math.max(1, focus - radius);
    const end = Math.min(lines.length, focus + radius);
    return { path, start, focus, lines: lines.slice(start - 1, end).map((l) => (l.length > 240 ? `${l.slice(0, 239)}…` : l)) };
  }

  /** Architecture nodes by name/path first; then Feature 1 retrieval, mapped to the node that owns each hit's file. */
  search(engine: FehmEngine, query: string, limit = 12): SearchHit[] {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const { model, byId } = this.base(engine);
    const score = (n: ArchNode): number => {
      const name = n.name.toLowerCase();
      const id = n.id.toLowerCase();
      if (name === q) return 0;
      if (name.startsWith(q)) return 1;
      if (name.includes(q)) return 2;
      if (id.includes(q)) return 3;
      return Infinity;
    };
    const direct = model.nodes
      .map((n) => ({ n, s: score(n) }))
      .filter((x) => Number.isFinite(x.s))
      .sort((a, b) => a.s - b.s || a.n.level - b.n.level || (a.n.name < b.n.name ? -1 : 1))
      .slice(0, limit)
      .map(({ n }) => ({ id: n.id, name: n.name, type: n.type, target: n.id }));
    const seen = new Set(direct.map((d) => d.id));
    const out: SearchHit[] = [...direct];
    if (out.length < limit) {
      for (const hit of engine.search(query, { limit: limit * 2 })) {
        if (!hit.path || out.length >= limit) continue;
        const file = byId.get(`file:${hit.path}`);
        if (!file || hit.kind === "file" || seen.has(`${hit.nodeId}`)) continue;
        seen.add(hit.nodeId);
        out.push({ id: hit.nodeId, name: hit.name, type: file.type, target: file.id, via: { name: hit.name, kind: hit.kind, path: hit.path } });
      }
    }
    return out;
  }

  /** Search the views built so far (most recent first) — behaviour/operations nodes exist only there. */
  private viewLocal<T>(engine: FehmEngine, find: (v: PublishedView) => T | undefined): T | undefined {
    for (const v of [...this.base(engine).views.values()].reverse()) {
      const hit = find(v);
      if (hit) return hit;
    }
    return undefined;
  }

  private viewLocalNodes(engine: FehmEngine): Map<string, ArchNode> {
    const out = new Map<string, ArchNode>();
    for (const v of this.base(engine).views.values()) for (const n of v.nodes) out.set(n.id, n);
    return out;
  }

  private viewLocalNode(engine: FehmEngine, id: string): NodeDetail | undefined {
    const view = this.viewLocal(engine, (v) => (v.nodes.some((n) => n.id === id) ? v : undefined));
    if (!view) return undefined;
    const nodes = new Map(view.nodes.map((n) => [n.id, n]));
    const node = nodes.get(id)!;
    const entry = (otherId: string, r: ArchRelationship) => {
      const o = nodes.get(otherId)!;
      return { id: o.id, name: o.name, type: o.type, relationship: r.id, relType: r.type, weight: r.weight, confidence: r.confidence };
    };
    const dependsOn = view.relationships.filter((r) => r.source === id && nodes.has(r.target)).map((r) => entry(r.target, r));
    const usedBy = view.relationships.filter((r) => r.target === id && nodes.has(r.source)).map((r) => entry(r.source, r));
    const keySymbols = node.files.slice(0, 4).flatMap((f) => this.base(engine).facts.keySymbols(f, 2).map((k) => ({ id: k.node.id, name: k.node.name, kind: k.node.kind, path: f, ...(k.node.location ? { line: k.node.location.line } : {}), inbound: k.inbound })));
    return { node, dependsOn, usedBy, children: [], keySymbols, path: [...view.path, { id: node.id, name: node.name }] };
  }

  /** Relationships at the node's own level (component, module, or file — aggregated on demand). */
  private relationshipsAtLevel(engine: FehmEngine, node: ArchNode) {
    const { model, byId } = this.base(engine);
    if (node.level !== 4) return model.relationships.filter((r) => r.source === node.id || r.target === node.id);
    const keyOf = (f: string): string | undefined => (byId.has(`file:${f}`) ? `file:${f}` : undefined);
    return aggregate(
      model.codeLinks.filter((l) => l.source === node.files[0] || l.target === node.files[0]),
      model.externalLinks.filter((l) => l.file === node.files[0]),
      keyOf,
      (id) => byId.has(id),
    );
  }

  // ─── last-known-good cache ────────────────────────────────────────

  private cachePath(engine: FehmEngine): string {
    // `.fehm/architecture.json` is Feature 3.4's architecture contract, committed with the code.
    return join(stateDir(engine.root, this.options.stateDirectory), "architecture-layout.json");
  }

  private readCache(engine: FehmEngine): LayoutCache | undefined {
    const path = this.cachePath(engine);
    if (this.options.dryRun || !existsSync(path)) return undefined;
    try {
      const data = JSON.parse(readFileSync(path, "utf8")) as LayoutCache;
      return data.version === CACHE_VERSION && data.views ? data : undefined;
    } catch {
      return undefined;
    }
  }

  private writeCache(engine: FehmEngine, cache: LayoutCache | undefined, key: string, fingerprint: string, layout: DiagramLayout): void {
    const path = this.cachePath(engine);
    if (this.options.dryRun) return;
    const next: LayoutCache = { version: CACHE_VERSION, views: { ...(cache?.views ?? {}) } };
    next.views[key] = { fingerprint, layout, savedAt: new Date().toISOString() };
    const keys = Object.keys(next.views);
    if (keys.length > MAX_CACHED_VIEWS) {
      for (const k of keys.sort((a, b) => (next.views[a]!.savedAt < next.views[b]!.savedAt ? -1 : 1)).slice(0, keys.length - MAX_CACHED_VIEWS)) delete next.views[k];
    }
    try {
      mkdirSync(dirname(path), { recursive: true });
      const tmp = `${path}.tmp`;
      writeFileSync(tmp, JSON.stringify(next));
      renameSync(tmp, path);
    } catch {
      // The cache is an optimization and a fallback; failing to write it never fails a request.
    }
  }
}
