import type { GraphNode } from "../model.js";
import { confidenceOf } from "./model.js";
import type { SequenceMessage } from "./sequence-layout.js";
import type { ArchEvidence, ArchNode, ArchRelationship, RelationshipType } from "./types.js";
import { callees, componentOf, dataOps, entryById, entryPoints, layoutNode, node, type Availability, type EntryPoint, type ViewContext, type ViewResult } from "./view-kit.js";

/**
 * Runtime / sequence view: what happens when one entry point is invoked.
 * Participants are the components that own the functions reached from the
 * entry's handler through resolved calls, in call-site order; calls inside
 * one component collapse, calls across components become messages with a
 * reply. Data access, file I/O and outbound calls become messages to the
 * stores and systems involved. It is an inferred request flow from static
 * calls — not a recorded runtime trace — and says so.
 */

const MAX_DEPTH = 6;
const MAX_MESSAGES = 60;

export function runtimeAvailability(ctx: ViewContext): Availability {
  const entries = entryPoints(ctx);
  if (!entries.length) return { available: false, reason: "No entry point with a resolved handler (HTTP route, CLI command, worker or main function) was found." };
  return { available: true, optionLabel: "Entry point", options: entries.map((e) => ({ id: e.id, label: e.label, detail: `${e.handler.name} · ${e.handler.path}` })) };
}

function trigger(ctx: ViewContext, entry: EntryPoint): ArchNode {
  if (entry.kind === "http") return ctx.byId.get("actor:http-client") ?? node("actor:http-client", "actor", "HTTP client", { tier: 0 });
  if (entry.kind === "cli") return ctx.byId.get("actor:cli-user") ?? node("actor:cli-user", "actor", "CLI user", { tier: 0 });
  return node("actor:trigger", "actor", entry.kind === "worker" ? "Scheduler / queue" : "Process start", { tier: 0, confidence: "inferred", reasons: [entry.evidence.detail ?? "runtime trigger"] });
}

export function runtimeView(ctx: ViewContext, focus?: string): ViewResult {
  const entry = entryById(ctx, focus);
  if (!entry) return { error: "no entry point found" };
  const ops = dataOps(ctx);
  const graph = ctx.engine.graph;
  const actor = trigger(ctx, entry);
  const participants = new Map<string, ArchNode>([[actor.id, actor]]);
  const outside = new Map<string, ArchNode>();
  const messages: SequenceMessage[] = [];
  const rels: ArchRelationship[] = [];
  let order = 0;
  let truncated = false;

  const ownerOf = (fn: GraphNode): ArchNode => {
    const c = componentOf(ctx, fn.path);
    if (c) return c;
    return node(`fn-owner:${fn.path ?? fn.id}`, "component", fn.path ?? fn.name, { confidence: "unknown" });
  };
  const participant = (n: ArchNode, external = false): string => {
    if (external) {
      if (!outside.has(n.id)) outside.set(n.id, n);
    } else if (!participants.has(n.id)) participants.set(n.id, n);
    return n.id;
  };
  const send = (source: string, target: string, label: string, type: RelationshipType, evidence: ArchEvidence[]): void => {
    if (order >= MAX_MESSAGES) {
      truncated = true;
      return;
    }
    order += 1;
    const id = `msg:${order}`;
    const confidence = evidence.length ? confidenceOf(evidence[0]!.provenance) : "inferred";
    messages.push({ id, source, target, label: `${order}. ${label}`, type, confidence, order });
    rels.push({ id, source, target, type, label, counts: { signal: 1 }, weight: 1, confidence, evidence });
  };
  const store = (id: string, fallback: () => ArchNode): string => participant(ctx.byId.get(id) ?? fallback(), true);

  const expanded = new Set<string>();
  const visit = (fn: GraphNode, at: string, depth: number): void => {
    const data = ops.get(fn.id);
    if (data) {
      for (const [table, evs] of data.reads) {
        const db = store("store:database", () => node("store:database", "database", "Database", { tier: 3 }));
        send(at, db, `SELECT ${table}`, "reads", evs.slice(0, 3));
        send(db, at, "rows", "returns", []);
      }
      for (const [table, evs] of data.writes) send(at, store("store:database", () => node("store:database", "database", "Database", { tier: 3 })), `${evs[0]?.detail?.split(" ")[0] ?? "WRITE"} ${table}`, "writes", evs.slice(0, 3));
      if (data.fileWrites.length) send(at, store("store:filesystem", () => node("store:filesystem", "filesystem", "Local files", { tier: 3 })), "write file", "writes", data.fileWrites.slice(0, 3));
      if (data.fileReads.length) send(at, store("store:filesystem", () => node("store:filesystem", "filesystem", "Local files", { tier: 3 })), "read file", "reads", data.fileReads.slice(0, 3));
      if (data.outbound.length) {
        const ext = store("external:http", () => node("external:http", "external-system", "External HTTP APIs", { tier: 3 }));
        send(at, ext, "HTTP request", "calls", data.outbound.slice(0, 3));
        send(ext, at, "response", "returns", []);
      }
      for (const x of data.externals) {
        const ext = store(x, () => node(x, "external-system", x.replace(/^external:/, ""), { tier: 3 }));
        send(at, ext, "SDK call", "calls", []);
      }
    }
    if (depth >= MAX_DEPTH || expanded.has(fn.id)) return;
    expanded.add(fn.id);
    for (const c of callees(ctx, fn.id)) {
      const owner = participant(ownerOf(c.node));
      if (owner === at) visit(c.node, at, depth + 1);
      else {
        send(at, owner, `${c.node.name}()`, "calls", [c.ev]);
        visit(c.node, owner, depth + 1);
        send(owner, at, "return", "returns", []);
      }
    }
  };

  const start = participant(ownerOf(entry.handler));
  send(actor.id, start, entry.kind === "http" ? entry.label : entry.kind === "cli" ? entry.label.replace(/ \(command\)$/, "") : `${entry.handler.name}()`, entry.kind === "http" ? "requests" : "invokes", [entry.evidence]);
  visit(entry.handler, start, 0);
  send(start, actor.id, entry.kind === "http" ? "response" : "done", "returns", []);
  void graph;

  const ordered = [...participants.values(), ...outside.values()];
  const notes = ["Inferred from static calls in call-site order — not a recorded runtime trace. Calls inside one component are collapsed."];
  if (truncated) notes.push(`Stopped after ${MAX_MESSAGES} messages.`);
  return {
    view: "runtime",
    focus: entry.id,
    title: `Runtime: ${entry.label}`,
    nodes: ordered,
    relationships: rels,
    input: { kind: "sequence", view: "runtime", focus: entry.id, participants: ordered.map((n) => layoutNode(n, "middle")), messages },
    path: [{ id: "system", name: ctx.model.repository.name }, { id: entry.id, name: entry.label }],
    notes,
  };
}
