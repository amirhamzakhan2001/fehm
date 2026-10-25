import assert from "node:assert/strict";
import { test } from "node:test";
import { compressSource, estimateTokens, fitToBudget, focusedExcerpt } from "../src/compression.js";
import { renderContextPacket } from "../src/context.js";
import { FehmEngine } from "../src/engine.js";
import { addMemory } from "../src/memory.js";
import { corpusCopy, makeRepo, tempDir } from "./helpers.js";

const state = tempDir();
const dir = corpusCopy();
addMemory(dir, { text: "Auth tokens are opaque bearer strings, not JWTs.", links: ["src/auth/token.ts"], tags: ["auth"] }, state);
const engine = FehmEngine.open(dir, { stateDirectory: state });

test("context: budget is never exceeded across budgets and queries", () => {
  const queries = ["how does authentication work", "What calls processPayment?", "tests for login", "error handling", "database connection", "architecture overview"];
  for (const budget of [5, 40, 100, 500, 1000, 4000, 8000]) {
    for (const q of queries) {
      const p = engine.context(q, { budget });
      const rendered = renderContextPacket(p);
      assert.ok(estimateTokens(rendered) <= budget, `${q} @ ${budget}: ${estimateTokens(rendered)}`);
      assert.equal(p.budget.maximumTokens, budget);
      assert.equal(p.budget.usedTokens, estimateTokens(rendered));
      assert.equal(p.budget.remainingTokens, budget - p.budget.usedTokens);
    }
  }
});

test("context: small budgets truncate and keep the strongest anchor", () => {
  const p = engine.context("how does authentication work", { budget: 300 });
  assert.equal(p.budget.truncated, true);
  assert.equal(p.recommendedNodes[0]?.nodeId, "function:src/auth/authenticate.ts#authenticateUser");
  const tiny = engine.context("how does authentication work", { budget: 5 });
  assert.ok(tiny.budget.truncated);
});

test("context: larger budgets add detail progressively; anchors get source first", () => {
  const small = engine.context("how does authentication work", { budget: 1200 });
  const large = engine.context("how does authentication work", { budget: 8000 });
  const anchor = (p: typeof small) => p.recommendedNodes.find((n) => n.nodeId === "function:src/auth/authenticate.ts#authenticateUser")!;
  assert.equal(anchor(small).detail, "source");
  assert.ok(large.recommendedNodes.length >= small.recommendedNodes.length);
  const detail = (p: typeof small) => p.recommendedNodes.filter((n) => n.detail === "section" || n.detail === "source").length;
  assert.ok(detail(large) > detail(small));
  assert.equal(large.budget.downgraded, 0);
});

test("context: diversified across files, relationships and tests included", () => {
  const p = engine.context("how does authentication work", { budget: 4000 });
  assert.ok(p.quality.filesCovered >= 5);
  assert.ok(p.relationships.some((r) => r.kind === "calls" && r.targetName === "authenticateUser" && r.provenance === "type-checker"));
  assert.ok(p.tests.includes("test/auth.test.ts"));
  assert.ok(p.quality.exactSymbolMatch === false && p.quality.queryTermCoverage > 0);
  const first = p.recommendedNodes.slice(0, 6).map((n) => n.path);
  assert.ok(new Set(first).size >= 4, "no single file monopolises the head of the packet");
});

test("context: packet contains memory, architecture and unknowns; markdown is a view of the JSON", () => {
  const p = engine.context("how are tokens validated", { budget: 4000 });
  assert.deepEqual(p.memory.map((m) => m.text), ["Auth tokens are opaque bearer strings, not JWTs."]);
  assert.ok(p.architecture.entryPoints.includes("src/index.ts"));
  const md = renderContextPacket(p);
  for (const n of p.recommendedNodes) assert.ok(md.includes(n.text));
  assert.ok(md.includes("## Project memory"));
  const loader = engine.context("loadPlugin dynamic plugins", { budget: 2000 });
  assert.ok(loader.unknowns.some((u) => u.includes("dynamic-import")), "unresolved dynamic import surfaced");
  assert.equal(JSON.parse(JSON.stringify(p)).schemaVersion, p.schemaVersion);
});

test("context: exact-fit budget — rebuilding with the used amount yields the same packet", () => {
  const p = engine.context("processPayment", { budget: 1500 });
  const exact = engine.context("processPayment", { budget: p.budget.usedTokens });
  assert.ok(exact.budget.usedTokens <= p.budget.usedTokens);
  assert.ok(exact.recommendedNodes.length >= 1);
  assert.equal(exact.recommendedNodes[0]?.nodeId, p.recommendedNodes[0]?.nodeId);
});

test("context: empty candidate set yields a valid, honest packet", () => {
  const p = engine.context("zzqqxx", { budget: 1000 });
  assert.deepEqual(p.recommendedNodes, []);
  assert.ok(p.unknowns.includes("no repository nodes matched the query"));
  assert.equal(p.quality.queryTermCoverage, 0);
});

test("context: deterministic for identical input", () => {
  const a = engine.context("payment refund", { budget: 2000 });
  const b = engine.context("payment refund", { budget: 2000 });
  assert.deepEqual(a, b);
});

test("context: heuristic languages are labelled as such", () => {
  const p = engine.context("build_report ReportBuilder", { budget: 3000 });
  assert.ok(p.unknowns.some((u) => u.includes("python relationships are pattern-based")));
});

test("compression: comments and blank lines removed, code untouched, dedented", () => {
  const out = compressSource(["    // note", "    const a = 1; // keep inline", "", "    /* block", "       more */", "    return a;"], "typescript");
  assert.deepEqual(out, ["const a = 1; // keep inline", "return a;"]);
  assert.deepEqual(compressSource(["# c", "x = 1  # y"], "python"), ["x = 1  # y"]);
  assert.deepEqual(compressSource([], "go"), []);
});

test("compression: focused excerpt keeps head, matches and tail within the cap", () => {
  const lines = Array.from({ length: 100 }, (_, i) => (i === 50 ? "charge(card)" : `line ${i}`));
  const ex = focusedExcerpt(lines, ["charge"], 10);
  assert.ok(ex.includes("charge(card)") && ex[0] === "line 0" && ex.at(-1) === "line 99");
  assert.ok(ex.filter((l) => l !== "…").length <= 10);
  assert.deepEqual(focusedExcerpt(["a", "b"], ["x"]), ["a", "b"]);
});

test("token estimate and fitToBudget", () => {
  assert.equal(estimateTokens(""), 0);
  assert.ok(estimateTokens("function authenticateUser() {}") > 4);
  const text = "alpha beta\ngamma delta\nepsilon";
  assert.ok(estimateTokens(fitToBudget(text, 3)) <= 3);
  assert.equal(fitToBudget(text, 1000), text);
});

test("context: a repository with nothing indexable still answers", () => {
  const e = FehmEngine.open(makeRepo({ "README.md": "# empty\n" }), { stateDirectory: tempDir() });
  const p = e.context("anything", { budget: 200 });
  assert.equal(p.recommendedNodes.length, 0);
  assert.ok(p.budget.usedTokens <= 200);
});
