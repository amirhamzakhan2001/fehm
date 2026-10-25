import assert from "node:assert/strict";
import { test } from "node:test";
import { stripCommentsAndStrings } from "../src/analyzer-heuristic.js";
import { indexRepository } from "../src/indexer.js";
import { corpusCopy, makeRepo, tempDir } from "./helpers.js";

const index = (dir: string) => indexRepository(dir, { stateDirectory: tempDir() });
const edge = (g: ReturnType<typeof index>["graph"], id: string) => g.edge(id);

test("typescript: cross-file calls, uses, implements and extends are type-checker resolved", () => {
  const { graph } = index(corpusCopy());
  const call = edge(graph, "calls|function:src/api/routes.ts#loginRoute|function:src/auth/authenticate.ts#authenticateUser");
  assert.equal(call?.evidence.provenance, "type-checker");
  assert.equal(call?.evidence.confidence, 1);
  assert.equal(call?.evidence.location?.path, "src/api/routes.ts");
  assert.ok(edge(graph, "implements|class:src/payments/gateway.ts#StripeGateway|interface:src/payments/gateway.ts#PaymentGateway"));
  assert.ok(edge(graph, "extends|class:src/auth/token.ts#TokenError|class:src/util/errors.ts#AppError"));
  assert.ok(edge(graph, "uses|function:src/db/users.ts#loadUser|class:src/db/connection.ts#DatabaseConnection"));
  assert.ok(edge(graph, "calls|function:src/db/connection.ts#createConnection|class:src/db/connection.ts#DatabaseConnection"), "new X() calls class");
  assert.ok(edge(graph, "defines|class:src/auth/session.ts#SessionStore|method:src/auth/session.ts#SessionStore.save"));
  assert.ok(edge(graph, "calls|function:test/auth.test.ts#testLoginSucceeds|function:src/auth/authenticate.ts#authenticateUser"));
});

test("typescript: imports resolve to files; bare specifiers become external packages", () => {
  const { graph } = index(corpusCopy());
  assert.ok(edge(graph, "imports|file:src/api/routes.ts|file:src/auth/authenticate.ts"));
  const pkg = edge(graph, "imports|file:src/api/server.ts|package:express");
  assert.equal(pkg?.evidence.provenance, "ast", "external module is not type-resolved");
  assert.equal(graph.node("package:express")?.kind, "package");
  assert.ok(edge(graph, "uses|function:src/api/server.ts#createServer|package:express"));
});

test("typescript: symbols carry signature, doc, exported flag and line range", () => {
  const { graph } = index(corpusCopy());
  const n = graph.node("function:src/auth/authenticate.ts#authenticateUser")!;
  assert.equal(n.exported, true);
  assert.match(n.signature!, /^export async function authenticateUser\(db: DatabaseConnection/);
  assert.equal(n.doc, "Authenticate a user from an email and bearer token and open a session.");
  assert.deepEqual([n.location!.line, n.location!.endLine], [10, 17]);
  assert.equal(graph.node("variable:src/auth/session.ts#store")?.exported, false);
});

test("typescript: dynamic imports — literal resolved with lower confidence, computed reported unresolved", () => {
  const dir = makeRepo({
    "src/a.ts": "export async function load(name: string) { await import(`./x/${name}`); return import('./b'); }\n",
    "src/b.ts": "export const b = 1;\n",
  });
  const { graph } = index(dir);
  const lit = edge(graph, "imports|file:src/a.ts|file:src/b.ts");
  assert.equal(lit?.evidence.confidence, 0.9);
  assert.equal(lit?.evidence.detail, "dynamic import");
  assert.ok(graph.unresolved.some((u) => u.kind === "dynamic-import" && u.fromNode === "function:src/a.ts#load"));
});

test("typescript: re-exports, aliases and barrels resolve to the defining declaration", () => {
  const dir = makeRepo({
    "src/impl.ts": "export function realName() { return 1; }\n",
    "src/index.ts": "export { realName as alias } from './impl';\n",
    "src/use.ts": "import { alias } from './index';\nexport function caller() { return alias(); }\n",
  });
  const { graph } = index(dir);
  assert.ok(edge(graph, "calls|function:src/use.ts#caller|function:src/impl.ts#realName"));
});

test("typescript: same names in different files stay distinct; arrow functions and methods are symbols", () => {
  const dir = makeRepo({
    "a.ts": "export const handler = () => helper();\nfunction helper() { return 1; }\n",
    "b.ts": "export class Svc { run = () => 1; go() { return this.run(); } }\nexport function handler() {}\n",
  });
  const { graph } = index(dir);
  assert.equal(graph.node("function:a.ts#handler")?.kind, "function");
  assert.equal(graph.node("function:b.ts#handler")?.kind, "function");
  assert.ok(edge(graph, "calls|function:a.ts#handler|function:a.ts#helper"));
  assert.ok(edge(graph, "calls|method:b.ts#Svc.go|method:b.ts#Svc.run"));
});

test("typescript: nested functions and callbacks fold into the enclosing symbol", () => {
  const dir = makeRepo({ "a.ts": "function inner() {}\nexport function outer() { const cb = () => inner(); [1].map(function named() { return inner(); }); return cb; }\n" });
  const { graph } = index(dir);
  assert.ok(edge(graph, "calls|function:a.ts#outer|function:a.ts#inner"));
  assert.equal(graph.nodes().filter((n) => n.name === "cb" || n.name === "named").length, 0);
});

test("typescript: malformed source is analyzed best-effort with a diagnostic", () => {
  const dir = makeRepo({ "a.ts": "export function ok() { return 1; }\nexport function broken( {\n" });
  const { graph } = index(dir);
  assert.ok(graph.node("function:a.ts#ok"));
});

test("python: classes, methods, functions, imports and heuristic calls with graded confidence", () => {
  const { graph } = index(corpusCopy());
  const method = graph.node("method:scripts/report.py#ReportBuilder.render")!;
  assert.equal(method.evidence.provenance, "heuristic");
  assert.ok(method.evidence.confidence < 1);
  assert.equal(graph.node("class:scripts/report.py#ReportBuilder")?.doc, "Accumulate payment rows and render a revenue report.");
  assert.equal(edge(graph, "imports|file:scripts/report.py|file:scripts/utils.py")?.evidence.provenance, "heuristic");
  assert.equal(edge(graph, "calls|function:scripts/report.py#build_report|function:scripts/utils.py#load_rows")?.evidence.confidence, 0.75);
  assert.equal(edge(graph, "calls|function:scripts/report.py#build_report|class:scripts/report.py#ReportBuilder")?.evidence.confidence, 0.8);
  assert.ok(edge(graph, "imports|file:scripts/report.py|package:os"));
  assert.ok(!graph.edges().some((e) => e.target.endsWith("#render") && e.source.endsWith("#ReportBuilder.render")), "call inside a comment is ignored");
});

test("go: functions, methods on receivers, structs, interfaces, stdlib imports", () => {
  const { graph } = index(corpusCopy());
  assert.equal(graph.node("class:services/billing/main.go#Invoice")?.kind, "class");
  assert.equal(graph.node("interface:services/billing/main.go#Biller")?.kind, "interface");
  assert.equal(graph.node("method:services/billing/main.go#Invoice.Describe")?.exported, true);
  assert.equal(graph.node("function:services/billing/main.go#main")?.exported, false);
  assert.ok(edge(graph, "calls|function:services/billing/main.go#main|function:services/billing/main.go#NewInvoice"));
  assert.ok(edge(graph, "imports|file:services/billing/main.go|package:fmt"));
  assert.ok(edge(graph, "defines|class:services/billing/main.go#Invoice|method:services/billing/main.go#Invoice.Describe"));
});

test("go: module-local imports resolve through a nested go.mod", () => {
  const dir = makeRepo({
    "svc/go.mod": "module example.com/svc\n",
    "svc/main.go": 'package main\n\nimport "example.com/svc/util"\n\nfunc main() {\n\tutil.Helper()\n}\n',
    "svc/util/util.go": "package util\n\nfunc Helper() {}\n",
  });
  const { graph } = index(dir);
  assert.ok(edge(graph, "imports|file:svc/main.go|file:svc/util/util.go"));
  assert.ok(edge(graph, "calls|function:svc/main.go#main|function:svc/util/util.go#Helper"));
});

test("rust: fns, structs, traits, impl methods and implements", () => {
  const dir = makeRepo({
    "src/lib.rs": "mod auth;\nuse crate::auth::login;\n\n/// Service entry.\npub struct Service { id: u32 }\npub trait Runner { fn run(&self); }\nimpl Runner for Service {\n    fn run(&self) { login(); }\n}\npub fn start() { let s = Service { id: 1 }; s.run(); }\n",
    "src/auth.rs": "pub fn login() {}\n",
  });
  const { graph } = index(dir);
  assert.equal(graph.node("class:src/lib.rs#Service")?.doc, "Service entry.");
  assert.ok(graph.node("method:src/lib.rs#Service.run"));
  assert.ok(edge(graph, "implements|class:src/lib.rs#Service|interface:src/lib.rs#Runner"));
  assert.ok(edge(graph, "imports|file:src/lib.rs|file:src/auth.rs"));
  assert.ok(edge(graph, "calls|method:src/lib.rs#Service.run|function:src/auth.rs#login"), "call on a one-line fn body");
  assert.equal(edge(graph, "calls|function:src/lib.rs#start|method:src/lib.rs#Service.run")?.evidence.confidence, 0.7, "member call, same-file candidate");
  assert.ok(!edge(graph, "calls|interface:src/lib.rs#Runner|method:src/lib.rs#Service.run"), "trait method signature is not a call");
});

test("java: classes, methods, constructors, extends/implements, imports", () => {
  const dir = makeRepo({
    "src/main/java/com/shop/Base.java": "package com.shop;\npublic abstract class Base {\n  public void touch() {}\n}\n",
    "src/main/java/com/shop/Pay.java": "package com.shop;\npublic interface Pay {\n  void charge(int cents);\n}\n",
    "src/main/java/com/shop/Card.java": "package com.shop;\n\nimport com.shop.Base;\nimport java.util.List;\n\n/** Card payments. */\npublic class Card extends Base implements Pay {\n  public Card() {\n    touch();\n  }\n  @Override\n  public void charge(int cents) {\n    touch();\n  }\n}\n",
  });
  const { graph } = index(dir);
  const card = "class:src/main/java/com/shop/Card.java#Card";
  assert.equal(graph.node(card)?.doc, "Card payments.");
  assert.ok(graph.node("method:src/main/java/com/shop/Card.java#Card.constructor"));
  assert.ok(graph.node("method:src/main/java/com/shop/Card.java#Card.charge"));
  assert.ok(edge(graph, `extends|${card}|class:src/main/java/com/shop/Base.java#Base`));
  assert.ok(edge(graph, `implements|${card}|interface:src/main/java/com/shop/Pay.java#Pay`));
  assert.ok(edge(graph, "imports|file:src/main/java/com/shop/Card.java|file:src/main/java/com/shop/Base.java"));
  assert.ok(edge(graph, "imports|file:src/main/java/com/shop/Card.java|package:java.util"));
});

test("heuristic linker: ambiguous names are reported, never guessed", () => {
  const dir = makeRepo({
    "a.py": "def helper():\n    pass\n",
    "b.py": "def helper():\n    pass\n",
    "c.py": "def main():\n    helper()\n",
  });
  const { graph } = index(dir);
  assert.ok(!graph.edges().some((e) => e.kind === "calls" && e.source === "function:c.py#main"));
  const u = graph.unresolved.find((x) => x.fromNode === "function:c.py#main");
  assert.match(u!.reason, /^ambiguous: 2 candidates/);
});

test("heuristic linker: unique repository-wide name gets the weakest confidence", () => {
  const dir = makeRepo({ "a.py": "def only_here():\n    pass\n", "c.py": "def main():\n    only_here()\n" });
  const { graph } = index(dir);
  const e = edge(graph, "calls|function:c.py#main|function:a.py#only_here");
  assert.equal(e?.evidence.confidence, 0.5);
  assert.match(e!.evidence.detail!, /unique name/);
});

test("stripCommentsAndStrings keeps layout and blanks code-like text", () => {
  const src = 'x = "call(me)"  # other()\ny = 1\n';
  const out = stripCommentsAndStrings(src, "python");
  assert.equal(out.length, src.length);
  assert.ok(!out.includes("call(") && !out.includes("other("));
  assert.equal(out.split("\n").length, src.split("\n").length);
  const rust = stripCommentsAndStrings("fn f<'a>(x: &'a str) -> char { 'c' } // f()", "rust");
  assert.ok(rust.includes("fn f<'a>(x: &'a str)"), "lifetimes are not strings");
});
