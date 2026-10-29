import type { FehmEngine, FlowStep } from "../../engine.js";
import { buildCodebaseBriefing, briefingFreshness, withFreshness, type BriefingOptions } from "../../codebase-briefing/briefing.js";
import { renderBriefing, type BriefingDepth } from "../../codebase-briefing/render.js";
import type { BriefingAskResponse, BriefingFlowResponse, CodebaseBriefing, FlowTreeNode, SectionId } from "../../codebase-briefing/types.js";
import { deterministicSummary } from "../../summary.js";

/**
 * Feature 3.2's server side. One briefing per engine instance (the engine is
 * replaced on refresh), with working-tree freshness overlaid per request.
 * Flow and "ask" requests go straight to the Feature 1 engine.
 */
export class BriefingService {
  private readonly built = new WeakMap<FehmEngine, CodebaseBriefing>();

  constructor(private readonly options: BriefingOptions = {}) {}

  base(engine: FehmEngine): CodebaseBriefing {
    let b = this.built.get(engine);
    if (!b) {
      b = buildCodebaseBriefing(engine, this.options);
      this.built.set(engine, b);
    }
    return b;
  }

  briefing(engine: FehmEngine): CodebaseBriefing {
    return withFreshness(this.base(engine), engine);
  }

  freshness(engine: FehmEngine) {
    return briefingFreshness(engine);
  }

  markdown(engine: FehmEngine, depth: BriefingDepth, sections?: SectionId[]): string {
    return renderBriefing(this.briefing(engine), { depth, ...(sections?.length ? { sections } : {}) }).text;
  }

  /** Call tree from any node, via `FehmEngine.flow` (depth ≤ 4 for the page). */
  flow(engine: FehmEngine, id: string, depth = 3): BriefingFlowResponse {
    const r = engine.flow(id, Math.min(Math.max(1, depth), 4));
    if (r.status !== "found") return { root: null, error: r.status === "ambiguous" ? "ambiguous target" : "not found" };
    const convert = (s: FlowStep): FlowTreeNode => ({
      id: s.id,
      name: s.name,
      ...(s.path ? { path: s.path } : {}),
      provenance: s.provenance,
      ...(s.repeated ? { repeated: true } : {}),
      children: s.children.slice(0, 15).map(convert),
    });
    return { root: convert(r.result) };
  }

  /** "Ask about this codebase": Feature 1 retrieval plus deterministic summaries — no second search engine. */
  ask(engine: FehmEngine, query: string, limit = 8): BriefingAskResponse {
    if (!query.trim()) return { query, hits: [] };
    const hits = engine.search(query, { limit }).map((h) => {
      const node = engine.graph.node(h.nodeId);
      return {
        nodeId: h.nodeId,
        kind: h.kind,
        name: h.name,
        ...(h.path ? { path: h.path } : {}),
        ...(node?.location?.line ? { line: node.location.line } : {}),
        summary: node ? deterministicSummary(engine.graph, node) : "",
        reasons: h.reasons.slice(0, 3),
        score: Math.round(h.score * 1000) / 1000,
      };
    });
    return { query, hits };
  }
}
