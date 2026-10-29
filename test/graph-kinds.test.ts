import assert from "node:assert/strict";
import { test } from "node:test";
import { FehmEngine } from "../src/engine.js";
import { indexRepository } from "../src/indexer.js";
import { GraphViewService } from "../src/visualization/graph/service.js";
import { makeRepo, tempDir } from "./helpers.js";

const index = (files: Record<string, string>) => indexRepository(makeRepo(files), { stateDirectory: tempDir() }).graph;
const has = (g: ReturnType<typeof index>, id: string) => g.edge(id);

test("typescript: enum, namespace module, class/param/interface fields", () => {
  const g = index({
    "a.ts": [
      "export enum Color { Red, Blue }",
      "export namespace Billing { export function total() { return 1; } }",
      "export interface User { id: string; name: string; greet(): void }",
      "export class Store {",
      "  private count = 0;",
      "  constructor(readonly url: string, private secret: string, plain: number) {}",
      "}",
    ].join("\n"),
  });
  assert.equal(g.node("enum:a.ts#Color")?.kind, "enum");
  assert.equal(g.node("module:a.ts#Billing")?.kind, "module");
  assert.ok(has(g, "defines|module:a.ts#Billing|function:a.ts#Billing.total"), "namespace member defined by its module");
  assert.ok(has(g, "defines|interface:a.ts#User|field:a.ts#User.id"));
  assert.ok(!g.node("field:a.ts#User.greet"), "method signatures are not fields");
  assert.ok(has(g, "defines|class:a.ts#Store|field:a.ts#Store.count"));
  assert.equal(g.node("field:a.ts#Store.url")?.exported, true);
  assert.equal(g.node("field:a.ts#Store.secret")?.exported, false);
  assert.ok(!g.node("field:a.ts#Store.plain"), "plain constructor params are not fields");
});

test("typescript: writes to variables and fields are type-checker resolved", () => {
  const g = index({
    "a.ts": [
      "export let hits = 0;",
      "export class Counter {",
      "  value = 0;",
      "  bump() { this.value += 1; hits++; }",
      "  read() { return this.value; }",
      "}",
    ].join("\n"),
  });
  const w = has(g, "writes|method:a.ts#Counter.bump|field:a.ts#Counter.value");
  assert.equal(w?.evidence.provenance, "type-checker");
  assert.ok(has(g, "writes|method:a.ts#Counter.bump|variable:a.ts#hits"));
  assert.ok(!has(g, "writes|method:a.ts#Counter.read|field:a.ts#Counter.value"));
  assert.ok(has(g, "references|method:a.ts#Counter.read|field:a.ts#Counter.value"));
});

test("typescript: express routes with named and inline handlers; HTTP client calls are not routes", () => {
  const g = index({
    "app.ts": [
      "declare const app: any; declare const axios: any;",
      "export function listUsers() {}",
      "export function createUser() {}",
      "export function setup() {",
      "  app.get('/users', listUsers);",
      "  app.post('/users', (req: unknown) => createUser());",
      "  axios.get('/api/users', { timeout: 1 });",
      "}",
    ].join("\n"),
  });
  assert.equal(g.node("route:app.ts#GET /users")?.kind, "route");
  assert.ok(has(g, "handles|function:app.ts#listUsers|route:app.ts#GET /users"));
  assert.equal(has(g, "handles|function:app.ts#createUser|route:app.ts#POST /users")?.evidence.confidence, 0.75);
  assert.ok(has(g, "defines|function:app.ts#setup|route:app.ts#GET /users"));
  assert.ok(!g.node("route:app.ts#GET /api/users"));
});

test("typescript: NestJS decorator routes combine the controller prefix", () => {
  const g = index({
    "c.ts": [
      "declare function Controller(p: string): any; declare function Get(p?: string): any;",
      "@Controller('orders')",
      "export class OrdersController {",
      "  @Get(':id') find() { return 1; }",
      "}",
    ].join("\n"),
  });
  assert.ok(has(g, "handles|method:c.ts#OrdersController.find|route:c.ts#GET /orders/:id"));
});

test("python: fields, self/global writes, flask route", () => {
  const g = index({
    "app.py": [
      "counter = 0",
      "",
      "class Account:",
      "    kind: str = 'basic'",
      "",
      "    def __init__(self, owner):",
      "        self.owner = owner",
      "        self.balance = 0",
      "",
      "    def deposit(self, n):",
      "        self.balance += n",
      "",
      "def tick():",
      "    global counter",
      "    counter = counter + 1",
      "",
      "@app.route('/accounts', methods=['POST'])",
      "def create_account():",
      "    return Account('x')",
    ].join("\n"),
  });
  assert.ok(has(g, "defines|class:app.py#Account|field:app.py#Account.kind"));
  assert.ok(has(g, "defines|class:app.py#Account|field:app.py#Account.owner"));
  assert.ok(has(g, "writes|method:app.py#Account.deposit|field:app.py#Account.balance"));
  assert.ok(has(g, "writes|function:app.py#tick|variable:app.py#counter"));
  assert.ok(has(g, "handles|function:app.py#create_account|route:app.py#POST /accounts"));
  assert.ok(has(g, "calls|function:app.py#create_account|class:app.py#Account"), "call on a line after the decorator still attributed");
});

test("go: package module under its folder, struct fields, embedding, routes, receiver writes", () => {
  const g = index({
    "svc/server.go": [
      "package server",
      "",
      "type Base struct {",
      "\tID string",
      "}",
      "",
      "type Server struct {",
      "\tBase",
      "\tName, Host string",
      "\tport int",
      "}",
      "",
      "func (s *Server) SetPort(p int) {",
      "\ts.port = p",
      "}",
      "",
      "func Health(w any, r any) {}",
      "",
      "func Routes() {",
      '\thttp.HandleFunc("GET /health", Health)',
      "}",
    ].join("\n"),
  });
  assert.ok(has(g, "contains|directory:svc|module:svc#server"));
  assert.ok(has(g, "defines|class:svc/server.go#Server|field:svc/server.go#Server.Name"));
  assert.ok(has(g, "defines|class:svc/server.go#Server|field:svc/server.go#Server.Host"));
  assert.equal(g.node("field:svc/server.go#Server.port")?.exported, false);
  assert.equal(has(g, "extends|class:svc/server.go#Server|class:svc/server.go#Base")?.evidence.detail, "embedded struct");
  assert.ok(has(g, "writes|method:svc/server.go#Server.SetPort|field:svc/server.go#Server.port"));
  assert.ok(has(g, "handles|function:svc/server.go#Health|route:svc/server.go#GET /health"));
});

test("rust: mod module, enum, struct fields, actix/axum routes, self writes", () => {
  const g = index({
    "src/main.rs": [
      "mod api;",
      "pub enum Mode { Fast, Slow }",
      "pub struct Cfg {",
      "    pub retries: u32,",
      "    name: String,",
      "}",
      "impl Cfg {",
      "    fn reset(&mut self) { self.retries = 0; }",
      "}",
      "#[get(\"/ping\")]",
      "async fn ping() -> &'static str { \"pong\" }",
      "fn list() {}",
      "fn app() { Router::new().route(\"/items\", get(list)); }",
    ].join("\n"),
    "src/api.rs": "pub fn x() {}\n",
  });
  assert.equal(g.node("module:src/main.rs#api")?.kind, "module");
  assert.ok(has(g, "imports|file:src/main.rs|file:src/api.rs"));
  assert.equal(g.node("enum:src/main.rs#Mode")?.kind, "enum");
  assert.ok(has(g, "defines|class:src/main.rs#Cfg|field:src/main.rs#Cfg.retries"));
  assert.ok(has(g, "writes|method:src/main.rs#Cfg.reset|field:src/main.rs#Cfg.retries"));
  assert.ok(has(g, "handles|function:src/main.rs#ping|route:src/main.rs#GET /ping"));
  assert.ok(has(g, "handles|function:src/main.rs#list|route:src/main.rs#GET /items"));
});

test("java: package module, enum, fields, spring route with class prefix, this writes", () => {
  const g = index({
    "src/com/shop/OrderController.java": [
      "package com.shop;",
      "",
      "@RestController",
      '@RequestMapping("/orders")',
      "public class OrderController {",
      "  private final OrderRepo repo;",
      "  public int served = 0;",
      "",
      '  @GetMapping("/{id}")',
      "  public Order find(String id) {",
      "    this.served += 1;",
      "    return null;",
      "  }",
      "}",
    ].join("\n"),
    "src/com/shop/Status.java": "package com.shop;\npublic enum Status {\n  OPEN, CLOSED\n}\n",
  });
  const cls = "class:src/com/shop/OrderController.java#OrderController";
  assert.ok(has(g, "contains|directory:src/com/shop|module:src/com/shop#com.shop"));
  assert.equal(g.node("enum:src/com/shop/Status.java#Status")?.kind, "enum");
  assert.ok(has(g, `defines|${cls}|field:src/com/shop/OrderController.java#OrderController.repo`));
  assert.ok(has(g, `handles|method:src/com/shop/OrderController.java#OrderController.find|route:src/com/shop/OrderController.java#GET /orders/{id}`));
  assert.ok(has(g, "writes|method:src/com/shop/OrderController.java#OrderController.find|field:src/com/shop/OrderController.java#OrderController.served"));
});

test("markdown: nested sections, links to repo paths, fences ignored, broken links reported", () => {
  const g = index({
    "docs/guide.md": [
      "# Guide",
      "Intro text.",
      "## Setup",
      "See [the app](../src/app.ts) and [site](https://example.com).",
      "```",
      "# not a heading",
      "```",
      "### Details",
      "[missing](../nope.ts)",
      "## Setup",
    ].join("\n"),
    "src/app.ts": "export const a = 1;\n",
  });
  assert.ok(has(g, "defines|file:docs/guide.md|section:docs/guide.md#Guide"));
  assert.ok(has(g, "defines|section:docs/guide.md#Guide|section:docs/guide.md#Setup"));
  assert.ok(has(g, "defines|section:docs/guide.md#Setup|section:docs/guide.md#Details"));
  assert.ok(g.node("section:docs/guide.md#Setup (2)"), "duplicate headings stay distinct");
  assert.ok(!g.nodes().some((n) => n.name === "not a heading"));
  assert.equal(g.node("section:docs/guide.md#Guide")?.doc, "Intro text.");
  assert.ok(has(g, "references|section:docs/guide.md#Setup|file:src/app.ts"));
  assert.ok(g.unresolved.some((u) => u.kind === "references" && u.text === "../nope.ts"));
});

test("config: manifests configure dependencies, entry points and script targets", () => {
  const g = index({
    "package.json": JSON.stringify({ main: "src/index.ts", bin: { tool: "dist/cli.js" }, scripts: { dev: "tsx src/index.ts" }, dependencies: { express: "^4" }, devDependencies: { tsx: "^4" } }),
    "src/index.ts": "import express from 'express';\nexport const app = express();\n",
    "pyproject.toml": '[project]\nname = "x"\ndependencies = [\n  "requests>=2",\n]\n\n[project.scripts]\nrun = "tools.cli:main"\n',
    "tools/cli.py": "def main():\n    pass\n",
    "go.mod": "module example.com/x\n\nrequire (\n\tgithub.com/gin-gonic/gin v1.9.0\n)\n",
    "Cargo.toml": '[package]\nname = "x"\n\n[dependencies]\nserde = "1"\n\n[[bin]]\nname = "x"\npath = "src/main.rs"\n',
    "src/main.rs": "fn main() {}\n",
    "requirements.txt": "flask==3.0  # web\n-r other.txt\n",
    "Dockerfile": 'FROM node:22\nCMD ["node", "src/index.ts"]\n',
  });
  const dep = has(g, "configures|file:package.json|package:express");
  assert.equal(dep?.evidence.provenance, "ast");
  assert.ok(g.node("package:tsx"));
  assert.ok(has(g, "configures|file:package.json|file:src/index.ts"));
  assert.ok(has(g, "imports|file:src/index.ts|package:express"), "manifest package node merges with the imported one");
  assert.ok(g.unresolved.some((u) => u.kind === "configures" && u.text === "dist/cli.js"), "build output is reported, not invented");
  assert.ok(has(g, "configures|file:pyproject.toml|function:tools/cli.py#main"));
  assert.ok(has(g, "configures|file:pyproject.toml|package:requests"));
  assert.ok(has(g, "configures|file:go.mod|package:github.com/gin-gonic/gin"));
  assert.ok(has(g, "configures|file:Cargo.toml|package:serde"));
  assert.ok(has(g, "configures|file:Cargo.toml|file:src/main.rs"));
  assert.ok(has(g, "configures|file:requirements.txt|package:flask"));
  assert.equal(has(g, "configures|file:Dockerfile|file:src/index.ts")?.evidence.provenance, "heuristic");
});

test("graph view: contains/defines split into folder/file/method/field filter categories", () => {
  const engine = FehmEngine.open(
    makeRepo({ "src/a.ts": "export class A { x = 1; run() {} }\n", "src/sub/b.ts": "export const b = 1;\n" }),
    { stateDirectory: tempDir() },
  );
  const payload = new GraphViewService({ dryRun: true }).view(engine);
  for (const k of ["contains-folder", "contains-file", "defines-method", "defines-field", "defines"]) assert.ok(payload.edgeKinds.includes(k), k);
  assert.ok(!payload.edgeKinds.includes("contains"), "every contains edge here targets a folder or file");
  for (const k of ["field", "method", "class", "file", "directory", "repository"]) assert.ok(payload.nodeKinds.includes(k), k);
});
