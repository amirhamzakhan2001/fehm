import assert from "node:assert/strict";
import { test } from "node:test";
import { FehmEngine } from "../src/engine.js";
import { detectIntent } from "../src/retrieval.js";
import { corpusCopy, makeRepo, tempDir } from "./helpers.js";

const engine = FehmEngine.open(corpusCopy(), { stateDirectory: tempDir() });
const top = (q: string, n = 5, opts = {}) => engine.search(q, { limit: n, ...opts }).map((h) => h.nodeId);

test("retrieval: exact symbol query ranks the symbol first with full symbol signal", () => {
  const hits = engine.search("processPayment", { limit: 5 });
  assert.equal(hits[0]!.nodeId, "function:src/payments/processor.ts#processPayment");
  assert.equal(hits[0]!.signals.symbol, 1);
  assert.equal(engine.search("HTTPServer")[0]!.nodeId, "class:src/util/xml.ts#HTTPServer", "acronym identifier");
  assert.equal(engine.search("xml parser")[0]!.nodeId, "class:src/util/xml.ts#XMLParser", "split acronym matches words");
});

test("retrieval: lexical/concept queries find the implementation, not just the keyword", () => {
  assert.ok(top("how does authentication work", 2).includes("function:src/auth/authenticate.ts#authenticateUser"));
  assert.ok(top("where is the database connection created", 3).includes("function:src/db/connection.ts#createConnection"));
  assert.ok(top("login", 5).some((id) => id.includes("loginRoute")));
  assert.ok(top("refund a payment", 3).includes("function:src/payments/processor.ts#refundPayment"));
  assert.ok(top("python revenue report", 5).includes("function:scripts/report.py#build_report"));
});

test("retrieval: 'sign in' reaches auth code through deterministic concept expansion only", () => {
  const hits = engine.search("signin flow", { limit: 10 });
  const auth = hits.find((h) => h.nodeId === "function:src/auth/authenticate.ts#authenticateUser" || h.nodeId === "function:src/api/routes.ts#loginRoute");
  assert.ok(auth, "reached via synonym groups");
  assert.ok(auth.signals.semantic > 0 || auth.signals.graph > 0);
});

test("retrieval: graph expansion surfaces callers/callees and records why", () => {
  const hits = engine.search("What calls processPayment?", { limit: 10 });
  const caller = hits.find((h) => h.nodeId === "function:src/api/routes.ts#checkoutRoute");
  assert.ok(caller, "caller reached");
  assert.ok(caller.signals.graph > 0);
  const neighbour = engine.search("validateToken", { limit: 15 }).find((h) => h.nodeId === "function:src/auth/authenticate.ts#authenticateUser");
  assert.ok(neighbour && neighbour.signals.graph > 0);
});

test("retrieval: depth 0 disables expansion; depth is bounded", () => {
  const flat = engine.search("createSession", { depth: 0, limit: 30 });
  assert.ok(flat.every((h) => h.depth === 0));
  const deep = engine.search("createSession", { depth: 99, limit: 200 });
  assert.ok(deep.every((h) => h.depth <= 3));
});

test("retrieval: intent classification and effect", () => {
  assert.equal(detectIntent("what tests cover login"), "test");
  assert.equal(detectIntent("why does checkout fail with an error"), "debug");
  assert.equal(detectIntent("give me an architecture overview"), "architecture");
  assert.equal(detectIntent("add refund support"), "change");
  assert.equal(detectIntent("where is validateToken defined"), "locate");
  assert.equal(detectIntent("how does the session store work"), "explain");
  const tests = engine.search("tests for login authentication", { limit: 5 });
  assert.ok(tests.slice(0, 3).some((h) => h.path?.startsWith("test/")), "test intent lifts test files");
  const explain = engine.search("login authentication", { limit: 3, intent: "explain" });
  assert.ok(!explain[0]!.path?.startsWith("test/"), "non-test intents de-rank tests");
});

test("retrieval: deterministic ranking with stable tie-breaking", () => {
  const a = engine.search("payment gateway charge", { limit: 20 });
  const b = FehmEngine.open(engine.root, { stateDirectory: tempDir() }).search("payment gateway charge", { limit: 20 });
  assert.deepEqual(a, b);
  const dir = makeRepo({ "b.ts": "export function twin() {}\n", "a.ts": "export function twin() {}\n" });
  const tie = FehmEngine.open(dir, { stateDirectory: tempDir() }).search("twin", { limit: 2 });
  assert.equal(tie[0]!.score, tie[1]!.score);
  assert.deepEqual(tie.map((h) => h.nodeId), ["function:a.ts#twin", "function:b.ts#twin"]);
});

test("retrieval: empty / stop-word-only / unmatched queries return nothing", () => {
  assert.deepEqual(engine.search(""), []);
  assert.deepEqual(engine.search("how is the"), []);
  assert.deepEqual(engine.search("zzqqxx"), []);
});

test("retrieval: plain words in a question are weak symbol evidence; typed identifiers are strong", () => {
  const e = FehmEngine.open(makeRepo({ "a.ts": "export function round(n: number) { return n; }\nexport function roundRobinSelect(items: string[]) { return items; }\n" }), { stateDirectory: tempDir() });
  assert.equal(e.search("round robin select items")[0]!.nodeId, "function:a.ts#roundRobinSelect");
  assert.equal(e.search("round")[0]!.signals.symbol, 1, "single-word query is treated as a name");
  assert.equal(e.search("where is roundRobinSelect")[0]!.signals.symbol, 1);
});
