import assert from "node:assert/strict";
import test from "node:test";
import { calculateStats, exploreRelationships, focusGraph } from "../src/graph.js";
import type { CodeGraph } from "../src/model.js";

function fixture(): CodeGraph {
  const nodes: CodeGraph["nodes"] = ["alpha", "beta", "gamma", "isolated"].map((name) => ({ id: name, name, qualifiedName: `src/${name}`, kind: "function" }));
  const edges: CodeGraph["edges"] = [
    { id: "ab", source: "alpha", target: "beta", kind: "calls", evidence: { provenance: "ast", confidence: 0.8 } },
    { id: "bc", source: "beta", target: "gamma", kind: "calls", evidence: { provenance: "ast", confidence: 0.5 } },
    { id: "ca", source: "gamma", target: "alpha", kind: "calls", evidence: { provenance: "ast", confidence: 1 } },
  ];
  return { schemaVersion: "0.1.0", generatedAt: new Date(0).toISOString(), repository: { name: "fixture", root: "/tmp", fingerprint: "fixture" }, nodes, edges, stats: calculateStats(nodes, edges), fileHashes: {}, changes: { added: [], changed: [], removed: [], unchanged: [] } };
}

test("focus bounds initial matches and reports only actual omissions", () => {
  const graph = fixture();
  const broad = focusGraph(graph, "src/", 0, 2);
  assert.equal(broad.nodes.length, 2);
  assert.equal(broad.matches.length, 2);
  assert.equal(broad.truncated, true);
  assert.equal(focusGraph(graph, "isolated", 4, 1).truncated, false);
  assert.equal(focusGraph(graph, "alpha", 0, 1).truncated, false);
  assert.equal(focusGraph(graph, "alpha", 1, 1).truncated, true);
  assert.equal(focusGraph(graph, "alpha", 4, 3).truncated, false);
  assert.equal(focusGraph(graph, "alpha", 1, 0).nodes.length, 0);
});

test("relationship traversal preserves direction, paths, confidence, and bounds through cycles", () => {
  const graph = fixture();
  const dependencies = exploreRelationships(graph, "alpha", "dependencies", 4);
  assert.deepEqual(dependencies.related.map((item) => [item.node.id, item.distance, item.confidence]), [["beta", 1, 0.8], ["gamma", 2, 0.4]]);
  assert.deepEqual(dependencies.related[1]?.path, ["src/alpha", "src/beta", "src/gamma"]);
  assert.deepEqual(exploreRelationships(graph, "alpha", "callers", 1).related.map((item) => item.node.id), ["gamma"]);
  assert.equal(exploreRelationships(graph, "alpha", "both", 0).related.length, 0);
  assert.equal(exploreRelationships(graph, "alpha", "both", 4, 1).truncated, true);
  assert.equal(exploreRelationships(graph, "alpha", "both", 4, 2).truncated, false);
});
