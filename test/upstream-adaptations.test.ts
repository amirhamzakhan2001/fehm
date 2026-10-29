import assert from "node:assert/strict";
import { test } from "node:test";
import { diversifyHits, fileFirstRoundRobin } from "../src/context-selection.js";
import { LexicalIndex } from "../src/lexical-index.js";
import { computeRelevanceBoost, DEFAULT_LOCATION_BOOST, DEFAULT_STACK_MATCH_BOOST, rankMemory, wholeTokens } from "../src/memory.js";
import type { MemoryEntry, RetrievalHit } from "../src/model.js";
import { stem } from "../src/stemmer.js";
import { getSynonyms } from "../src/synonyms.js";
import { camelShouldSplit, splitIdentifier } from "../src/text.js";
// ── Graft: fileFirstRoundRobin (upstream test/ask-file-selection.test.ts) ──

test("graft upstream: leaders before sibling spans, file order preserved, bounded prefix", () => {
  const ranked = [
    { id: "A1", file: "a.ts" }, { id: "A2", file: "a.ts" }, { id: "B1", file: "b.ts" }, { id: "C1", file: "c.ts" },
    { id: "A3", file: "a.ts" }, { id: "D1", file: "d.ts" }, { id: "B2", file: "b.ts" }, { id: "D2", file: "d.ts" },
  ];
  const grouped = ranked.map((value) => ({ group: value.file, value }));
  const projected = fileFirstRoundRobin(grouped);
  assert.deepEqual(projected.map((v) => v.id), ["A1", "B1", "C1", "D1", "A2", "B2", "D2", "A3"]);
  assert.equal(projected[0], ranked[0], "identity preserved");
  assert.deepEqual(fileFirstRoundRobin(grouped, 3).map((v) => v.id), ["A1", "B1", "C1"]);
});

test("graft upstream: concepts are singleton partitions", () => {
  const ranked = [{ id: "A1", group: "file:a.ts" }, { id: "A2", group: "file:a.ts" }, { id: "concept", group: "concept:auth:0" }, { id: "B1", group: "file:b.ts" }];
  assert.deepEqual(fileFirstRoundRobin(ranked.map((v) => ({ group: v.group, value: v }))).map((v) => v.id), ["A1", "concept", "B1", "A2"]);
});

test("graft: empty input, zero/negative/fractional limits, duplicates kept by identity", () => {
  assert.deepEqual(fileFirstRoundRobin([]), []);
  assert.deepEqual(fileFirstRoundRobin([{ group: "a", value: 1 }], 0), []);
  assert.deepEqual(fileFirstRoundRobin([{ group: "a", value: 1 }], -3), []);
  assert.deepEqual(fileFirstRoundRobin([{ group: "a", value: 1 }, { group: "b", value: 2 }], 1.9), [1]);
  assert.deepEqual(fileFirstRoundRobin([{ group: "a", value: 1 }, { group: "a", value: 1 }]), [1, 1]);
});

test("graft: large input is a permutation and deterministic", () => {
  const input = Array.from({ length: 5000 }, (_, i) => ({ group: `f${i % 37}`, value: i }));
  const a = fileFirstRoundRobin(input);
  const b = fileFirstRoundRobin(input);
  assert.deepEqual(a, b);
  assert.equal(a.length, 5000);
  assert.deepEqual([...a].sort((x, y) => x - y), input.map((x) => x.value));
});

function hit(nodeId: string, path: string | undefined, score: number): RetrievalHit {
  return { nodeId, kind: "function", name: nodeId, ...(path ? { path } : {}), score, depth: 0, reasons: [], signals: { lexical: 0, symbol: 0, semantic: 0, graph: 0, intent: 0 } };
}

test("fehm diversifyHits: strong anchors kept, then one per file before seconds (spec §62)", () => {
  const hits = [hit("A1", "a.ts", 1.0), hit("A2", "a.ts", 0.99), hit("A3", "a.ts", 0.98), hit("B1", "b.ts", 0.9), hit("C1", "c.ts", 0.89), hit("D1", "d.ts", 0.88), hit("A4", "a.ts", 0.5)];
  const { ordered, anchors } = diversifyHits(hits);
  assert.deepEqual([...anchors], ["A1", "A2", "A3"]);
  assert.deepEqual(ordered.map((h) => h.nodeId), ["A1", "A2", "A3", "B1", "C1", "D1", "A4"]);
  const tight = diversifyHits(hits, { maxAnchors: 1 });
  assert.deepEqual(tight.ordered.map((h) => h.nodeId), ["A1", "A2", "B1", "C1", "D1", "A3", "A4"]);
});

test("fehm diversifyHits: ties, duplicates, path-less hits, empty", () => {
  assert.deepEqual(diversifyHits([]).ordered, []);
  const hits = [hit("x", "a.ts", 1), hit("x", "a.ts", 1), hit("pkg", undefined, 0.5), hit("y", "b.ts", 0.5), hit("z", "a.ts", 0.5)];
  const { ordered } = diversifyHits(hits, { maxAnchors: 1 });
  assert.deepEqual(ordered.map((h) => h.nodeId), ["x", "pkg", "y", "z"]);
  assert.deepEqual(diversifyHits(hits, { maxAnchors: 1 }).ordered, ordered, "deterministic");
});

// ── codebase-memory: camel_should_split ────────────────────────────────────

test("codebase-memory upstream: rules 1 and 2 of camel_should_split", () => {
  assert.deepEqual(splitIdentifier("updateCloudClient"), ["update", "cloud", "client"]);
  assert.deepEqual(splitIdentifier("XMLParser"), ["xml", "parser"]);
  assert.deepEqual(splitIdentifier("getUserById"), ["get", "user", "by", "id"]);
  assert.deepEqual(splitIdentifier("HTTPServer"), ["http", "server"]);
  assert.equal(camelShouldSplit("aB", 0), false);
  assert.equal(camelShouldSplit("aB", 1), true);
  assert.equal(camelShouldSplit("ABc", 1), true);
  assert.equal(camelShouldSplit("ABC", 2), false, "trailing acronym has no lowercase successor");
});

test("codebase-memory: Fehm extensions (snake, kebab, digits) and edge cases", () => {
  assert.deepEqual(splitIdentifier("load_rows"), ["load", "rows"]);
  assert.deepEqual(splitIdentifier("x-request-id"), ["x", "request", "id"]);
  assert.deepEqual(splitIdentifier("base64Encode"), ["base", "64", "encode"]);
  assert.deepEqual(splitIdentifier(""), []);
  assert.deepEqual(splitIdentifier("URL"), ["url"]);
  assert.deepEqual(splitIdentifier("a".repeat(3000)).length, 1, "no upstream 2048-byte truncation needed");
});

// ── agentmemory: BM25 SearchIndex (upstream test/search-index.test.ts) ─────

const doc = (id: string, text: string) => ({ id, fields: [{ text, weight: 1 }] });

test("agentmemory upstream: finds docs, empty for no match, respects limit", () => {
  const index = new LexicalIndex();
  assert.equal(index.size, 0);
  index.add(doc("obs_1", "Edit auth middleware JWT validation"));
  assert.equal(index.search("auth")[0]?.id, "obs_1");
  assert.deepEqual(index.search("database"), []);
  for (let i = 0; i < 30; i += 1) index.add(doc(`o${i}`, `auth feature ${i}`));
  assert.equal(index.search("auth", 5).length, 5);
});

test("agentmemory upstream: exact matches score at least as high as prefix matches", () => {
  const index = new LexicalIndex();
  index.add(doc("exact", "redis cache redis caching layer"));
  index.add(doc("prefix", "redistool handler redistool for ops"));
  const results = index.search("redis");
  const exact = results.find((r) => r.id === "exact")!;
  const prefix = results.find((r) => r.id === "prefix")!;
  assert.ok(prefix, "prefix match found");
  assert.ok(exact.lexical >= prefix.lexical);
});

test("agentmemory upstream: removed docs stop occupying result slots; unknown remove is a no-op", () => {
  const index = new LexicalIndex();
  index.add(doc("obs_a", "jose for JWT"));
  index.add(doc("obs_b", "JWT tokens expire after 30 minutes"));
  assert.equal(index.search("jose jwt", 1)[0]?.id, "obs_a");
  index.remove("obs_a");
  assert.equal(index.search("jose jwt", 1)[0]?.id, "obs_b");
  index.remove("does_not_exist");
  assert.equal(index.size, 1);
});

test("fehm BM25: synonym evidence is reported as semantic, not lexical", () => {
  const index = new LexicalIndex();
  index.add(doc("a", "authentication flow"));
  const [r] = index.search("auth");
  assert.ok(r);
  assert.ok(r.semantic > 0 || r.lexical > 0);
  const [s] = index.search("login");
  assert.equal(s?.id, "a", "login → auth synonym (Fehm group) reaches 'authentication'");
  assert.equal(s?.lexical, 0);
  assert.ok(s!.semantic > 0);
});

test("fehm BM25: ties broken by id; duplicates replace; deterministic on large input", () => {
  const index = new LexicalIndex();
  index.add(doc("b", "same words"));
  index.add(doc("a", "same words"));
  index.add(doc("a", "same words"));
  assert.deepEqual(index.search("same").map((r) => r.id), ["a", "b"]);
  const big = new LexicalIndex();
  for (let i = 0; i < 3000; i += 1) big.add(doc(`d${String(i).padStart(4, "0")}`, `payment ${i % 7 === 0 ? "refund" : "charge"} item${i}`));
  assert.deepEqual(big.search("refund payment", 50), big.search("refund payment", 50));
  assert.deepEqual(new LexicalIndex().search("anything"), []);
  assert.deepEqual(big.search(""), []);
});

test("agentmemory stemmer/synonyms: upstream behaviour preserved", () => {
  assert.equal(stem("authentication"), stem("authenticating"));
  assert.equal(stem("tests"), stem("test"));
  assert.ok(getSynonyms(stem("db")).includes(stem("database")));
});

// ── ECC: instinct-relevance → memory relevance ─────────────────────────────

const mem = (id: string, text: string, links: string[] = [], tags: string[] = []): MemoryEntry => ({ id, text, links, tags, createdAt: "2026-01-01T00:00:00Z" });

test("ecc upstream: whole-token matching avoids substring false positives", () => {
  assert.deepEqual(wholeTokens("Good-Go_code"), ["good", "go", "code"]);
  const entry = mem("1", "this is good advice");
  assert.equal(computeRelevanceBoost(entry, new Set(), new Set(["go"])), 0, "`go` must not match `good`");
});

test("ecc upstream: boosts are additive (location + stack) and zero when neither applies", () => {
  const entry = mem("1", "use the typescript compiler", ["src/a.ts"], ["typescript"]);
  assert.equal(computeRelevanceBoost(entry, new Set(["src/a.ts"]), new Set(["typescript"])), DEFAULT_LOCATION_BOOST + DEFAULT_STACK_MATCH_BOOST);
  assert.equal(computeRelevanceBoost(entry, new Set(), new Set()), 0);
});

test("fehm rankMemory: stack boost reorders but never admits an unrelated entry; ties by id", () => {
  const entries = [mem("b", "auth uses JWT tokens"), mem("a", "auth uses JWT tokens"), mem("c", "typescript everywhere", [], ["typescript"])];
  const ranked = rankMemory(entries, "how does auth work", new Set(), new Set(["typescript"]));
  assert.deepEqual(ranked.map((r) => r.entry.id), ["a", "b"]);
  assert.deepEqual(rankMemory([], "x", new Set(), new Set()), []);
});
