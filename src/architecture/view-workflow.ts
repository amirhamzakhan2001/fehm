import type { GraphNode } from "../model.js";
import { parseBody, type Stmt } from "./control-flow.js";
import type { ArchEvidence, ArchNode, ArchNodeType, ArchRelationship } from "./types.js";
import { callees, entryPoints, layoutEdge, layoutNode, node, relation, type Availability, type ViewContext, type ViewResult } from "./view-kit.js";

/**
 * Workflow view: the control flow of one process — an entry handler, job or
 * processing function — as a flowchart. Steps are the resolved calls in
 * order; decisions, switches, loops (retries when the code says so),
 * error handlers, returns and throws come from the function's structure.
 */

const PROCESS_NAME = /^(process|handle|run|execute|perform|sync|import|export|checkout|submit|dispatch|consume|work|job|pipeline|ingest|apply|migrate|deploy|build|generate|publish|send|place|create|update|refund|pay|charge|retry)/i;
const CONTROL = /\b(if|switch|match|for|while|try|catch|except|elif|case)\b/;
const MAX_NODES = 60;
const MAX_LINES = 1500;
const RETRY = /retr(y|ies)|attempt|backoff/i;

interface Candidate {
  id: string;
  label: string;
  fn: GraphNode;
}

function candidates(ctx: ViewContext): Candidate[] {
  const memo = (ctx as ViewContext & { _wf?: Candidate[] })._wf;
  if (memo) return memo;
  const out: Candidate[] = [];
  const seen = new Set<string>();
  const consider = (fn: GraphNode, label: string): void => {
    if (seen.has(fn.id) || !fn.path || !fn.location?.endLine) return;
    const lines = ctx.facts.lines(fn.path).slice(fn.location.line - 1, fn.location.endLine);
    if (lines.length < 3 || lines.length > MAX_LINES || !lines.some((l) => CONTROL.test(l))) return;
    if (!callees(ctx, fn.id).length) return;
    seen.add(fn.id);
    out.push({ id: `fn:${fn.id}`, label, fn });
  };
  for (const e of entryPoints(ctx)) consider(e.handler, `${e.handler.name} (${e.label})`);
  for (const n of ctx.engine.graph.nodes()) if ((n.kind === "function" || n.kind === "method") && PROCESS_NAME.test(n.name.split(".").pop()!) && n.path && ctx.facts.roleByPath.get(n.path) === "source") consider(n, n.name);
  const result = out.slice(0, 80);
  (ctx as ViewContext & { _wf?: Candidate[] })._wf = result;
  return result;
}

export function workflowAvailability(ctx: ViewContext): Availability {
  const c = candidates(ctx);
  if (!c.length) return { available: false, reason: "No entry handler or process-like function with both branching and resolved calls was found." };
  return { available: true, optionLabel: "Process", options: c.map((x) => ({ id: x.id, label: x.label, detail: `${x.fn.path}:${x.fn.location?.line ?? ""}` })) };
}

interface Dangling {
  from: string;
  label?: string;
}

export function workflowView(ctx: ViewContext, focus?: string): ViewResult {
  const all = candidates(ctx);
  const pick = all.find((c) => c.id === focus || c.fn.id === focus) ?? all[0];
  if (!pick) return { error: "no workflow candidates" };
  const fn = pick.fn;
  const path = fn.path!;
  // Feature 1 keeps one call edge per caller/callee pair, so repeated calls are found by name on each line.
  const calls = new Map<number, string[]>();
  const names = [...new Set(callees(ctx, fn.id).map((c) => c.node.name.split(".").pop()!))];
  const lines = ctx.facts.lines(path);
  for (let ln = fn.location!.line + 1; ln <= fn.location!.endLine!; ln += 1) {
    const text = lines[ln - 1] ?? "";
    const hits = names.filter((n) => new RegExp(`(^|[^\\w.])(?:[\\w$]+\\.)*${n.replace(/[$]/g, "\\$")}\\s*\\(`).test(text)).sort((a, b) => text.indexOf(a) - text.indexOf(b));
    if (hits.length) calls.set(ln, hits);
  }
  const body = parseBody({ lines: ctx.facts.lines(path), start: fn.location!.line, end: fn.location!.endLine!, python: fn.language === "python", calls });

  const nodes: ArchNode[] = [];
  const rels: ArchRelationship[] = [];
  let seq = 0;
  let truncated = false;
  const ev = (line: number, detail?: string): ArchEvidence[] => [{ path, line, provenance: "ast", nodeId: fn.id, ...(detail ? { detail } : {}) }];
  const make = (type: ArchNodeType, name: string, line: number, detail?: string): string => {
    const id = `wf:${fn.id}#${(seq += 1)}`;
    nodes.push(node(id, type, name, { confidence: "strong", reasons: [`${type} at ${path}:${line}`], evidence: ev(line, detail), files: [path], graphNodeId: fn.id }));
    return id;
  };
  const link = (from: Dangling[], to: string, label?: string): void => {
    for (const d of from) {
      const text = d.label ?? label;
      rels.push(relation(d.from, to, "flows", { id: `rel:${d.from}→${to}#${rels.length}`, ...(text ? { label: text } : {}), confidence: "strong" }));
    }
  };
  let endId: string | undefined;
  let failId: string | undefined;
  const end = (): string => (endId ??= make("end", "End", fn.location!.endLine!));
  const fail = (line: number): string => (failId ??= make("failure", "Fails", line, "throws"));

  const build = (stmts: Stmt[], entry: Dangling[]): Dangling[] => {
    let exits = entry;
    for (let i = 0; i < stmts.length; i += 1) {
      if (nodes.length >= MAX_NODES) {
        truncated = true;
        return exits;
      }
      const s = stmts[i]!;
      if (s.k === "call") {
        // Consecutive calls are one step.
        const names = [...s.names];
        while (stmts[i + 1]?.k === "call") names.push(...(stmts[(i += 1)] as Extract<Stmt, { k: "call" }>).names);
        const uniq = [...new Set(names)];
        const id = make("step", `${uniq.slice(0, 3).join(" · ")}${uniq.length > 3 ? ` +${uniq.length - 3}` : ""}`, s.line, uniq.map((n) => `${n}()`).join(", "));
        link(exits, id);
        exits = [{ from: id }];
      } else if (s.k === "if") {
        let from = exits;
        const outs: Dangling[] = [];
        for (const [j, b] of s.branches.entries()) {
          const d = make("decision", b.cond ? `${b.cond}?` : "condition?", b.line, `if ${b.cond}`);
          link(from, d, j > 0 ? "no" : undefined);
          outs.push(...build(b.body, [{ from: d, label: "yes" }]));
          from = [{ from: d, label: "no" }];
        }
        if (s.otherwise) outs.push(...build(s.otherwise, from));
        else outs.push(...from);
        exits = outs;
      } else if (s.k === "switch") {
        const d = make("decision", `${s.subject || "switch"}?`, s.line, `switch ${s.subject}`);
        link(exits, d);
        const outs: Dangling[] = [];
        for (const c of s.cases) outs.push(...build(c.body, [{ from: d, label: c.label }]));
        if (!s.cases.some((c) => c.label === "default" || c.label === "_")) outs.push({ from: d, label: "other" });
        exits = outs;
      } else if (s.k === "loop") {
        const retry = RETRY.test(s.head) || JSON.stringify(s.body).match(RETRY) !== null;
        const l = make("loop", retry ? `retry: ${s.head}` : s.head, s.line, retry ? "retry loop" : "loop");
        link(exits, l);
        const bodyExits = build(s.body, [{ from: l, label: retry ? "attempt" : "each" }]);
        link(bodyExits.filter((d) => d.from !== l), l, retry ? "retry" : "next");
        exits = [{ from: l, label: "done" }];
      } else if (s.k === "try") {
        const before = nodes.length;
        const tryExits = build(s.body, exits);
        const firstInTry = nodes[before]?.id;
        const outs = [...tryExits];
        if (s.handler) {
          const h = make("failure", `on error${s.handler.param ? `: ${s.handler.param}` : ""}`, s.handler.line, "catch");
          link(firstInTry ? [{ from: firstInTry }] : exits, h, "error");
          outs.push(...build(s.handler.body, [{ from: h }]));
        }
        exits = s.final ? build(s.final, outs) : outs;
      } else if (s.k === "return") {
        link(exits, end(), s.text ? "return" : undefined);
        exits = [];
      } else if (s.k === "throw") {
        link(exits, fail(s.line));
        exits = [];
      }
    }
    return exits;
  };

  const start = make("start", `${fn.name.split(".").pop()}()`, fn.location!.line, "entry");
  const exits = build(body, [{ from: start }]);
  if (exits.length) link(exits, end());
  // Relationship ids carry an index (parallel yes/no edges); drop exact duplicates only.
  const seen = new Set<string>();
  const unique = rels.filter((r) => {
    const k = `${r.source}|${r.target}|${r.label ?? ""}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  const notes = ["Read from the function's structure (branches, loops, error handling) and its resolved calls; conditions are shown as written."];
  if (truncated) notes.push(`Stopped after ${MAX_NODES} nodes.`);
  if (nodes.length <= 3) notes.push("This function has little control flow; the workflow is short.");
  return {
    view: "workflow",
    focus: pick.id,
    title: `Workflow: ${fn.name}`,
    nodes,
    relationships: unique,
    input: { view: "workflow", focus: pick.id, layering: "flow", nodes: nodes.map((n) => layoutNode(n, "middle")), edges: unique.map((r) => layoutEdge(r)), boundaries: [] },
    path: [{ id: "system", name: ctx.model.repository.name }, { id: pick.id, name: fn.name }],
    notes: [...notes, `Source: ${path}:${fn.location!.line}`],
  };
}

