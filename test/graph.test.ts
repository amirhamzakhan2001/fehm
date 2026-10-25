import assert from "node:assert/strict";
import { test } from "node:test";
import { CodeGraph } from "../src/graph.js";
import type { Evidence, GraphNode } from "../src/model.js";

const ev = (confidence = 1, provenance: Evidence["provenance"] = "type-checker"): Evidence => ({ provenance, confidence });
const fn = (name: string, path = "a.ts"): GraphNode => ({ id: `function:${path}#${name}`, kind: "function", name, path, evidence: ev(1, "ast") });

/** A calls B, B calls C, D imports A (file), E references B. */
function fixture(): CodeGraph {
  const g = new CodeGraph("/repo");
  for (const n of ["A", "B", "C", "E"]) g.addNode(fn(n));
  g.addNode({ id: "file:d.ts", kind: "file", name: "d.ts", path: "d.ts", evidence: ev(1, "filesystem") });
  g.addEdge("calls", "function:a.ts#A", "function:a.ts#B", ev());
  g.addEdge("calls", "function:a.ts#B", "function:a.ts#C", ev());
  g.addEdge("imports", "file:d.ts", "function:a.ts#A", ev(0.9, "heuristic"));
  g.addEdge("references", "function:a.ts#E", "function:a.ts#B", ev());
  return g;
}

test("graph: node and edge creation, statistics", () => {
  const g = fixture();
  const s = g.stats();
  assert.equal(s.nodes, 5);
  assert.equal(s.edges, 4);
  assert.equal(s.files, 1);
  assert.deepEqual(s.edgesByKind, { calls: 2, imports: 1, references: 1 });
  assert.deepEqual(s.edgesByProvenance, { "type-checker": 3, heuristic: 1 });
});

test("graph: duplicate edges collapse, keeping the strongest evidence", () => {
  const g = new CodeGraph("/r");
  g.addNode(fn("A"));
  g.addNode(fn("B"));
  g.addEdge("calls", "function:a.ts#A", "function:a.ts#B", ev(0.5, "heuristic"));
  g.addEdge("calls", "function:a.ts#A", "function:a.ts#B", ev(1));
  g.addEdge("calls", "function:a.ts#A", "function:a.ts#B", ev(0.7, "heuristic"));
  assert.equal(g.edgeCount, 1);
  assert.equal(g.edges()[0]!.evidence.provenance, "type-checker");
  assert.equal(g.edges()[0]!.evidence.confidence, 1);
});

test("graph: duplicate nodes replace only with evidence at least as strong", () => {
  const g = new CodeGraph("/r");
  g.addNode({ ...fn("A"), evidence: ev(1, "ast") });
  g.addNode({ ...fn("A"), signature: "weak", evidence: ev(0.5, "heuristic") });
  assert.equal(g.node("function:a.ts#A")!.signature, undefined);
});

test("graph: edges never dangle and self-loops are rejected", () => {
  const g = new CodeGraph("/r");
  g.addNode(fn("A"));
  assert.equal(g.addEdge("calls", "function:a.ts#A", "function:a.ts#missing", ev()), false);
  assert.equal(g.addEdge("calls", "function:a.ts#A", "function:a.ts#A", ev()), false);
  assert.equal(g.edgeCount, 0);
  const f = fixture();
  f.removeNode("function:a.ts#B");
  assert.ok(f.edges().every((e) => f.node(e.source) && f.node(e.target)));
  assert.equal(f.edgeCount, 1);
});

test("graph: callers and dependencies in both directions (spec §59)", () => {
  const g = fixture();
  const callers = g.edgesOf("function:a.ts#B", "in", ["calls"]).map((e) => e.source);
  assert.deepEqual(callers, ["function:a.ts#A"]);
  const deps = g.traverse("function:a.ts#A", { direction: "out", kinds: ["calls"], depth: 2 });
  assert.deepEqual(deps.map((d) => [d.nodeId, d.depth]), [["function:a.ts#B", 1], ["function:a.ts#C", 2]]);
});

test("graph: traversal depth is bounded, clamped at 3, and limited", () => {
  const g = new CodeGraph("/r");
  for (let i = 0; i < 10; i += 1) g.addNode(fn(`n${i}`));
  for (let i = 0; i < 9; i += 1) g.addEdge("calls", `function:a.ts#n${i}`, `function:a.ts#n${i + 1}`, ev());
  assert.equal(g.traverse("function:a.ts#n0", { direction: "out", depth: 0 }).length, 0);
  assert.equal(g.traverse("function:a.ts#n0", { direction: "out", depth: 2 }).length, 2);
  assert.equal(g.traverse("function:a.ts#n0", { direction: "out", depth: 99 }).length, 3, "clamped to MAX_TRAVERSAL_DEPTH");
  assert.equal(g.traverse("function:a.ts#n0", { direction: "out", depth: 3, limit: 1 }).length, 1);
  assert.equal(g.traverse("missing").length, 0);
});

test("graph: confidence filter and deterministic neighbour order", () => {
  const g = fixture();
  const all = g.traverse("function:a.ts#A", { depth: 1 });
  assert.deepEqual(all.map((s) => s.nodeId), ["function:a.ts#B", "file:d.ts"], "higher confidence first");
  const strong = g.traverse("function:a.ts#A", { depth: 1, minConfidence: 0.95 });
  assert.deepEqual(strong.map((s) => s.nodeId), ["function:a.ts#B"]);
});

test("graph: JSON round-trip is lossless and schema-checked", () => {
  const g = fixture();
  g.unresolved = [{ kind: "call", fromNode: "function:a.ts#A", text: "x", location: { path: "a.ts", line: 1 }, reason: "r" }];
  const back = CodeGraph.fromJSON(JSON.parse(JSON.stringify(g.toJSON())));
  assert.deepEqual(back.toJSON(), g.toJSON());
  assert.throws(() => CodeGraph.fromJSON({ ...g.toJSON(), schemaVersion: "0.0.1" }));
});

test("graph: findByName prefers exact then case-insensitive, ranked by kind", () => {
  const g = fixture();
  g.addNode({ id: "class:b.ts#B", kind: "class", name: "B", path: "b.ts", evidence: ev(1, "ast") });
  assert.deepEqual(g.findByName("B").map((n) => n.id), ["function:a.ts#B", "class:b.ts#B"]);
  assert.deepEqual(g.findByName("b").map((n) => n.id), ["function:a.ts#B", "class:b.ts#B"]);
  assert.deepEqual(g.findByName("zzz"), []);
});
