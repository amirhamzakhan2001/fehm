import type { GraphNode } from "../model.js";
import type { ArchNode, ArchRelationship } from "./types.js";
import { callees, dataOps, entryPoints, evOf, hasData, layoutEdge, layoutNode, mergeRelations, node, relation, type Availability, type ViewContext, type ViewResult } from "./view-kit.js";

/**
 * Data-flow view: where data enters (callers of entry points), which code
 * handles it, which functions touch data, and the stores and systems it
 * reaches. Edges follow the data: writes point at the store, reads point
 * from the store to the reader. Tables are separate nodes when SQL names them.
 */

const MAX_DEPTH = 6;
const MAX_ENTRIES = 14;
const MAX_NODES = 44;

export function dataflowAvailability(ctx: ViewContext): Availability {
  const ops = dataOps(ctx);
  const entries = entryPoints(ctx).filter((e) => reachesData(ctx, e.handler, ops));
  if (!entries.length) {
    return { available: false, reason: [...ops.values()].some(hasData) ? "Data access was found, but no entry point reaches it through resolved calls." : "No data access was detected (SQL, file reads/writes, outbound HTTP or service SDK calls)." };
  }
  return { available: true, optionLabel: "Flows", options: [{ id: "all", label: `All entry points (${entries.length})` }, ...entries.map((e) => ({ id: e.id, label: e.label, detail: e.handler.name }))] };
}

function reachesData(ctx: ViewContext, start: GraphNode, ops: ReturnType<typeof dataOps>): boolean {
  const seen = new Set<string>();
  const stack: [GraphNode, number][] = [[start, 0]];
  while (stack.length) {
    const [fn, d] = stack.pop()!;
    if (seen.has(fn.id)) continue;
    seen.add(fn.id);
    if (hasData(ops.get(fn.id))) return true;
    if (d < MAX_DEPTH) for (const c of callees(ctx, fn.id)) stack.push([c.node, d + 1]);
  }
  return false;
}

export function dataflowView(ctx: ViewContext, focus?: string): ViewResult {
  const ops = dataOps(ctx);
  const all = entryPoints(ctx).filter((e) => reachesData(ctx, e.handler, ops));
  const chosen = !focus || focus === "all" ? all.slice(0, MAX_ENTRIES) : all.filter((e) => e.id === focus || e.handler.id === focus);
  if (!chosen.length) return { error: "no entry point reaches data" };
  const nodes = new Map<string, { n: ArchNode; rank: number; subtitle?: string }>();
  const rels: ArchRelationship[] = [];
  const put = (n: ArchNode, rank: number, subtitle?: string): string => {
    const prev = nodes.get(n.id);
    if (!prev || rank < prev.rank) nodes.set(n.id, { n, rank: prev ? Math.min(prev.rank, rank) : rank, ...(subtitle ? { subtitle } : prev?.subtitle ? { subtitle: prev.subtitle } : {}) });
    return n.id;
  };
  const fnNode = (fn: GraphNode): ArchNode => node(`fn:${fn.id}`, "function", fn.name, { confidence: "verified", files: fn.path ? [fn.path] : [], graphNodeId: fn.id, evidence: [evOf(fn)], reasons: [`${fn.kind} in ${fn.path}`], ...(fn.doc ? { description: fn.doc } : {}) });
  const table = (name: string): ArchNode => node(`table:${name}`, "database", name, { tier: 3, confidence: "strong", reasons: ["named in SQL statements"], description: `Table ${name}` });
  let truncated = false;

  for (const entry of chosen) {
    const src = entry.kind === "http" ? (ctx.byId.get("actor:http-client") ?? node("actor:http-client", "actor", "HTTP clients", { tier: 0 })) : entry.kind === "cli" ? (ctx.byId.get("actor:cli-user") ?? node("actor:cli-user", "actor", "CLI user", { tier: 0 })) : node("actor:trigger", "actor", "Scheduler / trigger", { tier: 0, confidence: "inferred" });
    const s = put(src, 0);
    const h = put(fnNode(entry.handler), 1, entry.label);
    rels.push(relation(s, h, "flows", { label: "input", evidence: [entry.evidence], id: `rel:${s}→${h}` }));
    // Breadth-first so each data function is attributed to its nearest handler path.
    const seen = new Set<string>([entry.handler.id]);
    const queue: [GraphNode, number, number][] = [[entry.handler, 0, 0]];
    while (queue.length) {
      const [fn, depth, hops] = queue.shift()!;
      const data = ops.get(fn.id);
      if (hasData(data)) {
        if (nodes.size >= MAX_NODES) {
          truncated = true;
          break;
        }
        const at = fn.id === entry.handler.id ? h : put(fnNode(fn), 2, "touches data");
        if (at !== h) rels.push(relation(h, at, "calls", { confidence: "verified", id: `rel:${h}→${at}`, evidence: [{ path: fn.path ?? "", ...(fn.location ? { line: fn.location.line } : {}), nodeId: fn.id, provenance: "ast", detail: hops > 1 ? `reached through ${hops - 1} intermediate ${hops === 2 ? "call" : "calls"}` : "called directly" }] }));
        for (const [t, evs] of data!.writes) rels.push(relation(at, put(table(t), 3), "writes", { label: "writes", evidence: evs.slice(0, 4), weight: evs.length }));
        for (const [t, evs] of data!.reads) rels.push(relation(put(table(t), 3), at, "reads", { label: "reads", evidence: evs.slice(0, 4), weight: evs.length }));
        if (data!.fileWrites.length) rels.push(relation(at, put(ctx.byId.get("store:filesystem") ?? node("store:filesystem", "filesystem", "Local files", { tier: 3 }), 3), "writes", { label: "writes", evidence: data!.fileWrites.slice(0, 4), weight: data!.fileWrites.length }));
        if (data!.fileReads.length) rels.push(relation(put(ctx.byId.get("store:filesystem") ?? node("store:filesystem", "filesystem", "Local files", { tier: 3 }), 3), at, "reads", { label: "reads", evidence: data!.fileReads.slice(0, 4), weight: data!.fileReads.length }));
        if (data!.outbound.length) rels.push(relation(at, put(ctx.byId.get("external:http") ?? node("external:http", "external-system", "External HTTP APIs", { tier: 3 }), 3), "calls", { label: "sends", evidence: data!.outbound.slice(0, 4) }));
        for (const x of data!.externals) {
          const ext = ctx.byId.get(x);
          if (ext) rels.push(relation(at, put(ext, 3), "calls", { label: "uses SDK", confidence: "inferred" }));
        }
      }
      if (depth >= MAX_DEPTH) continue;
      for (const c of callees(ctx, fn.id)) {
        if (seen.has(c.node.id)) continue;
        seen.add(c.node.id);
        queue.push([c.node, depth + 1, hops + 1]);
      }
    }
  }
  const merged = mergeRelations(rels).filter((r) => r.source !== r.target);
  const shown = [...nodes.values()];
  const notes = ["Static data flow: data functions are attributed to the entry points that reach them through resolved calls. Tables come from SQL text."];
  if (truncated) notes.push(`Limited to ${MAX_NODES} nodes; choose one entry point to see its full flow.`);
  if (!focus || focus === "all") if (all.length > chosen.length) notes.push(`${all.length - chosen.length} more entry points reach data; choose one from the list.`);
  const single = chosen.length === 1 ? chosen[0]! : undefined;
  return {
    view: "dataflow",
    focus: single ? single.id : "all",
    title: single ? `Data flow: ${single.label}` : "Data flow",
    nodes: shown.map((x) => x.n),
    relationships: merged,
    input: {
      view: "dataflow",
      focus: single ? single.id : "all",
      layering: "flow",
      nodes: shown.map((x) => layoutNode(x.n, "middle", { rank: x.rank, ...(x.subtitle ? { subtitle: x.subtitle } : {}) })),
      edges: merged.map((r) => layoutEdge(r)),
      boundaries: [],
    },
    path: [{ id: "system", name: ctx.model.repository.name }, { id: single?.id ?? "all", name: single?.label ?? "All flows" }],
    notes,
  };
}
