import type { GraphNode } from "../model.js";
import type { ArchEvidence, ArchNode, ArchRelationship } from "./types.js";
import { layoutEdge, layoutNode, mergeRelations, node, relation, type Availability, type ViewContext, type ViewResult } from "./view-kit.js";

/**
 * Lifecycle view: the states an entity moves through and the code that moves
 * it. States come from status-like enums, string-literal unions and Python
 * Enum classes. Transitions come from assignments of those states to a
 * status-like field: the state checked just before in the same function
 * (`=== X`, `case X`) is the origin; otherwise the previous assignment in that
 * function; a declared default or a creation context starts the lifecycle.
 * Anything else comes from "any state" and is marked inferred.
 */

const STATE_NAME = /(status|state|phase|stage|lifecycle|step)s?$/i;
const FIELD = "(?:status|state|phase|stage)";
const MAX_STATES = 24;

export interface StateType {
  id: string;
  name: string;
  entity: string;
  node: GraphNode;
  /** Member name → value text; both spellings map to one state. */
  states: { name: string; value: string }[];
}

function readMembers(ctx: ViewContext, n: GraphNode): { name: string; value: string }[] {
  if (!n.path || !n.location) return [];
  const end = n.location.endLine ?? n.location.line + 40;
  const lines = ctx.facts.lines(n.path).slice(n.location.line - 1, end);
  const text = lines.join("\n");
  const out: { name: string; value: string }[] = [];
  const add = (name: string, value: string): void => {
    if (!out.some((s) => s.name === name)) out.push({ name, value });
  };
  if (n.kind === "enum" || /\bclass\s+\w+\s*\(.*Enum\)/.test(lines[0] ?? "")) {
    for (const l of lines.slice(1)) {
      const m = /^\s*([A-Za-z_]\w*)\s*(?:=\s*["']?([\w\- ]+)["']?|\(|,|$)/.exec(l);
      if (m && !/^(def|return|pass|class|case|const|static|public|private)$/.test(m[1]!) && m[1] !== n.name) add(m[1]!, m[2] ?? m[1]!);
    }
    return out;
  }
  // `type OrderStatus = "pending" | "paid" | …`, `status: "a" | "b"`
  const literals = [...text.matchAll(/["']([A-Za-z][\w\- ]{0,30})["']\s*(?=\||;|$|\n|,|\))/g)].map((m) => m[1]!);
  if (/\|/.test(text)) for (const v of literals) add(v, v);
  return out;
}

export function stateTypes(ctx: ViewContext): StateType[] {
  const memo = (ctx as ViewContext & { _st?: StateType[] })._st;
  if (memo) return memo;
  const out: StateType[] = [];
  for (const n of ctx.engine.graph.nodes()) {
    if (!n.path || ctx.facts.roleByPath.get(n.path) !== "source") continue;
    const enumLike = n.kind === "enum" || n.kind === "type" || (n.kind === "class" && /Enum\)/.test(n.signature ?? ""));
    if (!enumLike || !STATE_NAME.test(n.name)) continue;
    const states = readMembers(ctx, n).slice(0, MAX_STATES);
    if (states.length < 2) continue;
    const entity = n.name.replace(STATE_NAME, "") || n.name;
    out.push({ id: `lc:${n.id}`, name: n.name, entity, node: n, states });
  }
  (ctx as ViewContext & { _st?: StateType[] })._st = out;
  return out;
}

export function lifecycleAvailability(ctx: ViewContext): Availability {
  const types = stateTypes(ctx);
  if (!types.length) return { available: false, reason: "No status/state enum or string-literal union with two or more states was found." };
  return { available: true, optionLabel: "Entity", options: types.map((t) => ({ id: t.id, label: `${t.entity} (${t.name})`, detail: `${t.states.length} states · ${t.node.path}` })) };
}

const escape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function lifecycleView(ctx: ViewContext, focus?: string): ViewResult {
  const types = stateTypes(ctx);
  const t = types.find((x) => x.id === focus || x.node.id === focus) ?? types[0];
  if (!t) return { error: "no state types" };
  const facts = ctx.facts;
  const stateId = (s: string): string => `state:${t.node.id}:${s}`;
  // A state is referenced as `Type.Member`, a bare member, or its literal value.
  const refs = t.states.map((s) => ({ s: s.name, re: new RegExp(`(?:\\b${escape(t.name)}\\.${escape(s.name)}\\b|["'\`]${escape(s.value)}["'\`]|["'\`]${escape(s.name)}["'\`])`) }));
  const stateIn = (text: string): string | undefined => refs.find((r) => r.re.test(text))?.s;
  const ASSIGN = new RegExp(`(?:\\.${FIELD}\\s*=(?!=)\\s*|\\b${FIELD}\\s*=(?!=)\\s*|\\b${FIELD}\\s*:\\s*|set${FIELD}\\(\\s*|(?:transition|moveTo|changeStatus|updateStatus|setStatus)\\w*\\([^)]*?|SET\\s+${FIELD}\\s*=\\s*)(.{1,80})`, "i");
  const GUARD = new RegExp(`(?:${FIELD}\\s*(?:===?|!==?|==)\\s*(.{1,60})|\\bcase\\s+(.{1,60}?)\\s*:|${FIELD}\\s+in\\s+(.{1,60}))`, "i");

  const events = new Map<string, { line: number; kind: "assign" | "guard" | "default"; state: string; ev: ArchEvidence; fn?: GraphNode; creation: boolean }[]>();
  for (const path of facts.sourceFiles) {
    const lines = facts.lines(path);
    const text = lines.join("\n");
    if (!refs.some((r) => r.re.test(text))) continue;
    for (let i = 0; i < Math.min(lines.length, 20_000); i += 1) {
      const line = lines[i]!;
      if (path === t.node.path && t.node.location && i + 1 >= t.node.location.line && i + 1 <= (t.node.location.endLine ?? 0)) continue;
      const g = GUARD.exec(line);
      const a = ASSIGN.exec(line);
      const fn = facts.enclosing(path, i + 1);
      const key = fn?.id ?? `${path}#top`;
      const list = events.get(key) ?? [];
      const creation = !fn || /^(constructor|create|new|init|insert|add|make|build|open|register|__init__)/i.test(fn.name.split(".").pop()!) || fn.kind === "class";
      if (g) {
        const st = stateIn(g[1] ?? g[2] ?? g[3] ?? "");
        if (st) list.push({ line: i + 1, kind: "guard", state: st, ev: { path, line: i + 1, provenance: "heuristic", detail: line.trim().slice(0, 100) }, ...(fn ? { fn } : {}), creation });
      }
      if (a && !(g && a.index! > g.index!)) {
        const st = stateIn(a[1]!);
        if (st) {
          // A field declaration with a default (`status: Status = Status.New`, `status = "new"` in a class/model) starts the lifecycle.
          const literal = new RegExp(`\\b${FIELD}\\s*:\\s*`, "i").test(a[0]) && !/\bset\w*\(/i.test(a[0]);
          const isDefault = !fn || fn.kind === "class" || literal || /DEFAULT\s/i.test(line) || /default\s*[:=]/.test(line);
          list.push({ line: i + 1, kind: isDefault ? "default" : "assign", state: st, ev: { path, line: i + 1, provenance: "heuristic", detail: line.trim().slice(0, 100) }, ...(fn ? { fn } : {}), creation });
        }
      }
      if (list.length) events.set(key, list);
    }
  }

  const rels: ArchRelationship[] = [];
  const used = new Set<string>();
  let fromAny = false;
  let starts = false;
  const START = `lcstart:${t.node.id}`;
  const ANY = `lcany:${t.node.id}`;
  for (const list of events.values()) {
    list.sort((a, b) => a.line - b.line);
    let prevAssign: string | undefined;
    let guard: string | undefined;
    for (const e of list) {
      if (e.kind === "guard") {
        guard = e.state;
        continue;
      }
      const to = stateId(e.state);
      used.add(e.state);
      const label = e.fn ? e.fn.name.split(".").pop()! : undefined;
      if (e.kind === "default") {
        starts = true;
        rels.push(relation(START, to, "transitions", { label: "initial", evidence: [e.ev], confidence: "strong" }));
      } else if (guard && guard !== e.state) {
        used.add(guard);
        rels.push(relation(stateId(guard), to, "transitions", { ...(label ? { label } : {}), evidence: [e.ev], confidence: "strong" }));
      } else if (prevAssign && prevAssign !== e.state) {
        rels.push(relation(stateId(prevAssign), to, "transitions", { ...(label ? { label } : {}), evidence: [e.ev], confidence: "inferred" }));
      } else if (e.creation) {
        starts = true;
        rels.push(relation(START, to, "transitions", { ...(label ? { label } : {}), evidence: [e.ev], confidence: "inferred" }));
      } else {
        fromAny = true;
        rels.push(relation(ANY, to, "transitions", { ...(label ? { label } : {}), evidence: [e.ev], confidence: "inferred" }));
      }
      prevAssign = e.state;
    }
  }
  const merged = mergeRelations(rels).map((r): ArchRelationship => {
    const { label: _drop, ...rest } = r;
    void _drop;
    const label = labelOf(r, rels);
    return label ? { ...rest, label } : rest;
  });
  const nodes: ArchNode[] = [];
  if (starts) nodes.push(node(START, "start", `${t.entity} created`, { confidence: "strong", reasons: ["declared default or creation code"] }));
  if (fromAny) nodes.push(node(ANY, "state", "Any state", { confidence: "inferred", reasons: ["assignments whose previous state is not checked in the same function"] }));
  const outgoing = new Set(merged.map((r) => r.source));
  for (const s of t.states) {
    const id = stateId(s.name);
    const final = used.has(s.name) && !outgoing.has(id);
    nodes.push(node(id, "state", s.name, { confidence: used.has(s.name) ? "strong" : "verified", reasons: [`member of ${t.name}`, ...(final ? ["no transition out was found (final)"] : []), ...(used.has(s.name) ? [] : ["never assigned in indexed code"])], evidence: [{ path: t.node.path!, ...(t.node.location ? { line: t.node.location.line } : {}), nodeId: t.node.id, provenance: t.node.evidence.provenance, detail: `${t.name}.${s.name}` }], graphNodeId: t.node.id, ...(s.value !== s.name ? { description: `value "${s.value}"` } : {}) }));
  }
  const notes = [`States from ${t.name} (${t.node.path}:${t.node.location?.line ?? ""}); transitions from status assignments. The origin is the state checked just before in the same function, else the previous assignment.`];
  if (!merged.length) notes.push("No assignments of these states were found; only the states are shown.");
  if (fromAny) notes.push("\"Any state\" collects transitions whose origin is not checked in code.");
  const unused = t.states.filter((s) => !used.has(s.name)).length;
  if (unused) notes.push(`${unused} ${unused === 1 ? "state is" : "states are"} never assigned in indexed code.`);
  return {
    view: "lifecycle",
    focus: t.id,
    title: `Lifecycle: ${t.entity}`,
    nodes,
    relationships: merged,
    input: {
      view: "lifecycle",
      focus: t.id,
      layering: "flow",
      nodes: nodes.map((n) => layoutNode(n, "middle", { rank: n.type === "start" || n.id === ANY ? 0 : 1, ...(n.role.reasons.some((r) => r.includes("(final)")) ? { tag: "final state" } : {}) })),
      edges: merged.map((r) => layoutEdge(r)),
      boundaries: [],
    },
    path: [{ id: "system", name: ctx.model.repository.name }, { id: t.id, name: t.entity }],
    notes,
  };
}

/** One label per transition: the functions that perform it (at most two). */
function labelOf(r: ArchRelationship, all: ArchRelationship[]): string | undefined {
  const names = [...new Set(all.filter((x) => x.id === r.id).map((x) => x.label).filter((x): x is string => Boolean(x)))];
  if (!names.length) return undefined;
  return names.length > 2 ? `${names.slice(0, 2).join(", ")} +${names.length - 2}` : names.join(", ");
}
