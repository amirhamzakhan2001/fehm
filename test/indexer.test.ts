import assert from "node:assert/strict";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { cachePath, graphPath, indexRepository, loadGraph } from "../src/indexer.js";
import { generateSemanticSummaries, loadSummaries } from "../src/semantic-summary.js";
import { corpusCopy, makeRepo, tempDir, writeFile } from "./helpers.js";

function setup(files?: Record<string, string>) {
  const dir = files ? makeRepo(files) : corpusCopy();
  const state = tempDir();
  const run = () => indexRepository(dir, { stateDirectory: state });
  return { dir, state, run };
}

test("indexer: full → cache-hit → identical graph", () => {
  const { run } = setup();
  const first = run();
  assert.equal(first.report.mode, "full");
  assert.equal(first.report.reason, "no cache");
  const second = run();
  assert.equal(second.report.mode, "cache-hit");
  assert.deepEqual(second.report.analyzedFiles, []);
  assert.equal(second.report.reusedFiles.length, first.scan.files.length);
  assert.deepEqual(second.graph.toJSON(), first.graph.toJSON());
});

test("indexer: changed file is re-analyzed, unchanged reused, dependents invalidated", () => {
  const { dir, run } = setup();
  run();
  const path = join(dir, "src/auth/token.ts");
  writeFileSync(path, readFileSync(path, "utf8").replace("export function validateToken", "export function verifyToken").replace("validateToken(", "verifyToken("));
  writeFileSync(join(dir, "src/auth/authenticate.ts"), readFileSync(join(dir, "src/auth/authenticate.ts"), "utf8"));
  const r = run();
  assert.equal(r.report.mode, "incremental");
  assert.deepEqual(r.report.analyzedFiles, ["src/auth/token.ts"]);
  assert.ok(r.report.invalidatedFiles.includes("src/auth/authenticate.ts"), "caller of the renamed function is re-resolved");
  assert.ok(r.report.invalidatedFiles.includes("test/auth.test.ts"));
  assert.ok(!r.report.invalidatedFiles.includes("src/payments/gateway.ts"));
  assert.ok(r.report.reusedFiles.includes("src/payments/gateway.ts"));
  assert.deepEqual(r.report.changedSymbols.removed, ["function:src/auth/token.ts#validateToken"]);
  assert.deepEqual(r.report.changedSymbols.added, ["function:src/auth/token.ts#verifyToken"]);
  assert.ok(r.report.changedRelationships.removed > 0 && r.report.changedRelationships.added > 0);
  assert.ok(!r.graph.edges().some((e) => e.target.endsWith("#validateToken")), "no edges to the removed symbol");
});

test("indexer: incremental result equals a fresh full index of the same tree", () => {
  const { dir, run } = setup();
  run();
  writeFile(dir, "src/auth/token.ts", readFileSync(join(dir, "src/auth/token.ts"), "utf8") + "\nexport function revokeToken(t: string) { return validateToken(t); }\n");
  writeFile(dir, "src/new.ts", "import { revokeToken } from './auth/token';\nexport const r = () => revokeToken('x');\n");
  rmSync(join(dir, "src/util/xml.ts"));
  const incremental = run();
  const full = indexRepository(dir, { stateDirectory: tempDir() });
  assert.deepEqual(incremental.graph.toJSON(), full.graph.toJSON());
});

test("indexer: deleted file removes its file node, symbols and every edge touching them", () => {
  const { dir, run } = setup();
  run();
  rmSync(join(dir, "src/db/users.ts"));
  const r = run();
  assert.deepEqual(r.report.removedFiles, ["src/db/users.ts"]);
  assert.ok(!r.graph.node("file:src/db/users.ts"));
  assert.ok(!r.graph.node("function:src/db/users.ts#loadUser"));
  assert.ok(r.graph.edges().every((e) => r.graph.node(e.source) && r.graph.node(e.target)), "no dangling edges");
  assert.ok(r.report.invalidatedFiles.includes("src/auth/authenticate.ts"));
  assert.ok(r.graph.unresolved.some((u) => u.text === "../db/users"), "the now-missing import is reported as unresolved");
});

test("indexer: added file lets previously unresolved imports resolve", () => {
  const { dir, run } = setup({ "a.ts": "import { b } from './b';\nexport const a = () => b();\n" });
  const first = run();
  assert.ok(first.graph.unresolved.some((u) => u.text === "./b"));
  writeFile(dir, "b.ts", "export function b() { return 1; }\n");
  const second = run();
  assert.ok(second.report.invalidatedFiles.includes("a.ts"));
  assert.ok(second.graph.edge("calls|function:a.ts#a|function:b.ts#b"));
  assert.equal(second.graph.unresolved.length, 0);
});

test("indexer: malformed or version-mismatched cache triggers a clean full rebuild", () => {
  const { dir, state, run } = setup({ "a.ts": "export const a = 1;\n" });
  run();
  writeFileSync(cachePath(dir, state), "{ not json");
  const r = run();
  assert.equal(r.report.mode, "full");
  assert.match(r.report.reason!, /cache unreadable/);
  const cache = JSON.parse(readFileSync(cachePath(dir, state), "utf8"));
  cache.analysisVersion = "0";
  writeFileSync(cachePath(dir, state), JSON.stringify(cache));
  assert.match(run().report.reason!, /version changed/);
  writeFileSync(cachePath(dir, state), JSON.stringify({ ...cache, analysisVersion: "1", files: { "a.ts": { hash: 3 } } }));
  assert.equal(run().report.mode, "full");
});

test("indexer: corrupted graph.json is not trusted; loadGraph returns undefined", () => {
  const { dir, state, run } = setup({ "a.ts": "export const a = 1;\n" });
  run();
  writeFileSync(graphPath(dir, state), "garbage");
  assert.equal(loadGraph(dir, state), undefined);
  const r = run();
  assert.equal(r.report.mode, "cache-hit");
  assert.ok(loadGraph(dir, state), "graph rewritten");
});

test("indexer: --force re-analyzes everything", () => {
  const { dir, state, run } = setup({ "a.ts": "export const a = 1;\n" });
  run();
  const r = indexRepository(dir, { stateDirectory: state, force: true });
  assert.equal(r.report.mode, "full");
  assert.equal(r.report.reason, "forced");
});

test("indexer: semantic summaries become stale when their source changes", async () => {
  const { dir, state, run } = setup({ "a.ts": "export function a() { return 1; }\n" });
  const first = run();
  const provider = { name: "fake", model: "fake-1", summarize: async () => "Returns one." };
  await generateSemanticSummaries(dir, [{ nodeId: "function:a.ts#a", prompt: "p", sourceHash: first.hashes.get("a.ts")! }], provider, state);
  assert.deepEqual(run().report.staleSummaries, []);
  writeFile(dir, "a.ts", "export function a() { return 2; }\n");
  assert.deepEqual(run().report.staleSummaries, ["function:a.ts#a"]);
  assert.equal(loadSummaries(dir, state)["function:a.ts#a"]?.model, "fake-1", "cache keeps provenance until regenerated");
});

test("indexer: unsupported and non-code files get file nodes but no fabricated symbols", () => {
  const { run } = setup({ "README.md": "# hi\n", "config.yaml": "a: 1\n", "a.ts": "export const x = 1;\n" });
  const { graph } = run();
  assert.ok(graph.node("file:README.md"));
  assert.deepEqual(graph.edgesOf("file:README.md", "out", ["defines"]).map((e) => e.target), ["section:README.md#hi"], "a real heading, not a fabricated symbol");
  assert.equal(graph.edgesOf("file:config.yaml", "out").length, 0);
  assert.ok(graph.node("repository:."));
  assert.ok(graph.edge("contains|repository:.|file:a.ts"));
});
