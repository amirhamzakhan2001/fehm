import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import http from "node:http";
import type net from "node:net";
import { test } from "node:test";
import { parseBody, type Stmt } from "../src/architecture/control-flow.js";
import { layoutSequence } from "../src/architecture/sequence-layout.js";
import type { ArchRelationship, DiagramLayout, PublishedView, ViewType } from "../src/architecture/types.js";
import { validateLayout } from "../src/architecture/validate.js";
import { parseYamlDocuments } from "../src/architecture/yaml.js";
import { FehmEngine } from "../src/engine.js";
import { startServer } from "../src/server.js";
import { ArchitectureService } from "../src/visualization/architecture/service.js";
import { SHOP } from "./fixtures/architecture-shop.js";
import { makeRepo, tempDir, writeFile } from "./helpers.js";

/** The shop fixture as a git repository: first commit without the worker, second adds it. */
function gitShop(): string {
  const { "src/worker/jobs.ts": worker, ...first } = SHOP;
  const root = makeRepo(first);
  const git = (...a: string[]): void => void execFileSync("git", ["-C", root, "-c", "user.email=t@t", "-c", "user.name=t", ...a], { stdio: "ignore" });
  git("init", "-q");
  git("add", ".");
  git("commit", "-qm", "orders");
  writeFile(root, "src/worker/jobs.ts", worker!);
  git("add", ".");
  git("commit", "-qm", "worker");
  return root;
}

const shopRoot = gitShop();
const state = tempDir();
const engine = FehmEngine.open(shopRoot, { stateDirectory: state });
const service = new ArchitectureService({ stateDirectory: state, dryRun: true });

function view(type: ViewType, focus?: string): PublishedView {
  const v = service.view(engine, type, focus);
  assert.ok(!("error" in v), `${type}: ${"error" in v ? v.error : ""}`);
  return v as PublishedView;
}
const rel = (v: PublishedView, source: string, target: string): ArchRelationship | undefined => v.relationships.find((r) => r.source === source && r.target === target);
const named = (v: PublishedView, name: string) => v.nodes.find((n) => n.name === name);

test("all ten views are offered for a repository with the evidence, and each passes showcase validation", () => {
  const views = service.views(engine);
  assert.deepEqual(views.map((v) => v.type), ["system", "components", "runtime", "dataflow", "workflow", "lifecycle", "deployment", "security", "dependencies", "delta"]);
  for (const d of views) {
    assert.ok(d.available, `${d.type}: ${d.reason}`);
    const v = view(d.type);
    assert.equal(v.validation.source, "fresh", `${d.type}: ${v.validation.diagnostics.map((x) => x.message).join("; ")}`);
    assert.ok(v.layout && v.layout.nodes.length === v.nodes.length, d.type);
  }
});

test("a repository without the evidence lists every view, and says why the behaviour and operations views are unavailable", () => {
  const tiny = FehmEngine.open(makeRepo({ "src/a.ts": "export const a = 1;\n" }), { stateDirectory: tempDir() });
  const views = new ArchitectureService({ dryRun: true }).views(tiny);
  assert.equal(views.length, 10);
  for (const type of ["runtime", "dataflow", "workflow", "lifecycle", "deployment", "security", "delta"] as const) {
    const d = views.find((v) => v.type === type)!;
    assert.equal(d.available, false, type);
    assert.ok(d.reason && d.reason.length > 10, `${type} explains itself`);
  }
});

test("runtime: a sequence of messages across components, with replies, data access and lifelines", () => {
  const v = view("runtime", "http:POST /orders");
  assert.equal(v.layout!.kind, "sequence");
  assert.equal(v.layout!.lifelines!.length, v.nodes.length);
  const labels = v.relationships.map((r) => r.label);
  assert.equal(labels[0], "POST /orders");
  assert.ok(labels.includes("requireAuth()") && labels.includes("placeOrder()"));
  assert.ok(labels.some((l) => l === "INSERT orders"), "SQL becomes a message to the database");
  assert.ok(v.relationships.some((r) => r.type === "returns"), "calls across components get replies");
  const order = v.layout!.edges.map((e) => e.order!);
  assert.deepEqual(order, [...order].sort((a, b) => a - b), "messages top to bottom in call order");
  assert.ok(v.notes.some((n) => /not a recorded runtime trace/.test(n)));
});

test("data flow: writes point at stores, reads come out of them, tables from SQL", () => {
  const v = view("dataflow");
  const orders = v.nodes.find((n) => n.id === "table:orders")!;
  assert.equal(orders.type, "database");
  assert.equal(rel(v, "fn:function:src/db/orders.ts#insertOrder", "table:orders")?.type, "writes");
  assert.equal(rel(v, "table:orders", "fn:function:src/db/orders.ts#loadOrder")?.type, "reads");
  assert.ok(rel(v, "fn:function:src/payments/stripe.ts#charge", "external:stripe"), "the payment SDK is reached");
});

test("workflow: decisions, a retry loop, an error path, returns and throws from the function's structure", () => {
  const v = view("workflow");
  const types = v.nodes.map((n) => n.type);
  for (const t of ["start", "step", "decision", "loop", "failure", "end"]) assert.ok(types.includes(t as never), t);
  const loop = v.nodes.find((n) => n.type === "loop")!;
  assert.match(loop.name, /^retry:/);
  assert.ok(v.relationships.some((r) => r.target === loop.id && r.label === "retry"), "the error path loops back");
  assert.ok(v.relationships.some((r) => r.source === loop.id && r.label === "done"));
  assert.ok(v.relationships.some((r) => r.label === "yes") && v.relationships.some((r) => r.label === "no"));
  assert.ok(v.nodes.some((n) => n.type === "step" && n.name.includes("saveStatus") && v.relationships.some((r) => r.target === n.id && v.nodes.find((x) => x.id === r.source)?.type === "failure")), "the catch body is a step after the error node");
});

test("lifecycle: states from the enum, transitions from guarded assignments, initial and final states", () => {
  const v = view("lifecycle");
  const id = (s: string): string => `state:enum:src/orders/model.ts#OrderStatus:${s}`;
  assert.equal(rel(v, id("Paid"), id("Shipped"))?.confidence, "strong", "guard `status === Paid` then assignment");
  assert.equal(rel(v, id("Pending"), id("Cancelled"))?.label, "cancelOrder", "`case Pending:` guard");
  assert.ok(rel(v, id("Pending"), id("Paid")));
  assert.ok(v.relationships.some((r) => r.source.startsWith("lcstart:") && r.target === id("Pending")), "the literal `status: Pending` starts the lifecycle");
  const shipped = v.layout!.nodes.find((n) => n.id === id("Shipped"))!;
  assert.equal(shipped.tag, "final state");
});

test("deployment: compose services, Kubernetes ingress → service → deployment, CI deploys, datastores by image", () => {
  const v = view("deployment");
  const c = (s: string): string => `deploy:compose:docker-compose.yml:${s}`;
  assert.equal(v.nodes.find((n) => n.id === c("db"))!.type, "database");
  assert.equal(v.nodes.find((n) => n.id === c("proxy"))!.type, "gateway");
  assert.equal(rel(v, "deploy:internet", c("api"))?.label, "8080:8080");
  assert.equal(rel(v, c("api"), c("db"))?.label, "depends on");
  assert.ok(rel(v, "deploy:k8s:shop:Ingress:shop", "deploy:k8s:shop:Service:shop-api"));
  assert.equal(rel(v, "deploy:k8s:shop:Service:shop-api", "deploy:k8s:shop:Deployment:shop-api")?.label, "selects");
  assert.ok(rel(v, "deploy:ci:.github/workflows/deploy.yml", "deploy:k8s:shop:Deployment:shop-api"));
  assert.ok(!rel(v, "deploy:ci:.github/workflows/deploy.yml", c("db")), "docker push reaches only images this repository builds");
  assert.ok(!v.nodes.some((n) => n.name === "Google App Engine"), "a Kubernetes app.yaml is not an App Engine config");
  assert.ok(rel(v, c("api"), "component:src/api"), "the built container runs the API component");
  const b = v.layout!.boundaries.map((x) => x.title).sort();
  assert.deepEqual(b, ["Compose: docker-compose.yml", "Kubernetes namespace: shop"]);
});

test("security: zones, authentication reached from routes, sinks and secrets — and an honest disclaimer", () => {
  const v = view("security");
  assert.ok(rel(v, "sec:callers", "component:src/api"));
  assert.ok(v.relationships.some((r) => r.type === "authenticates" && r.source === "component:src/api"));
  assert.ok(named(v, "Process execution"), "execSync is a sink");
  const secrets = v.nodes.find((n) => n.id === "sec:secrets")!;
  assert.match(secrets.role.reasons[0]!, /JWT_SECRET/);
  assert.ok(v.notes.some((n) => /1 of 2 HTTP routes/.test(n)), v.notes.join("\n"));
  assert.ok(v.notes.some((n) => /Authentication endpoints: POST \/login/.test(n)));
  assert.ok(v.notes[0]!.includes("not a security audit"));
  assert.ok(!v.nodes.some((n) => n.id === "external:jsonwebtoken"), "a JWT library is code, not an external system");
});

test("delta: a module added since the previous commit; revisions are validated before git sees them", () => {
  const v = view("delta");
  const worker = v.nodes.find((n) => n.id === "module:src/worker")!;
  assert.equal(worker.status, "added");
  assert.ok(v.relationships.some((r) => r.status === "added" && r.source === "module:src/worker"));
  for (const bad of ["--output=/tmp/x", "HEAD;rm -rf /", "$(id)", "../../etc"]) {
    const r = service.view(engine, "delta", bad);
    assert.ok("error" in r, bad);
  }
});

test("control flow: branches, switch, loops and try/catch in TypeScript and Python", () => {
  const ts = `function f(x) {
  if (x > 1) {
    a();
  } else if (x < 0) {
    return b();
  } else {
    c();
  }
  switch (x) {
    case 1:
      d();
      break;
    default:
      throw new Error("no");
  }
  for (const i of items) {
    try {
      e(i);
    } catch (err) {
      g();
    }
  }
}`.split("\n");
  const calls = new Map<number, string[]>([[3, ["a"]], [5, ["b"]], [7, ["c"]], [11, ["d"]], [18, ["e"]], [20, ["g"]]]);
  const body = parseBody({ lines: ts, start: 1, end: ts.length, python: false, calls });
  assert.deepEqual(body.map((s) => s.k), ["if", "switch", "loop"]);
  const iff = body[0] as Extract<Stmt, { k: "if" }>;
  assert.equal(iff.branches.length, 2);
  assert.equal(iff.branches[1]!.body[1]!.k, "return");
  assert.deepEqual(iff.otherwise!.map((s) => s.k), ["call"]);
  const sw = body[1] as Extract<Stmt, { k: "switch" }>;
  assert.deepEqual(sw.cases.map((c) => c.label), ["1", "default"]);
  const loop = body[2] as Extract<Stmt, { k: "loop" }>;
  assert.equal(loop.body[0]!.k, "try");

  const py = `def f(x):
    if x > 1:
        a()
    elif x < 0:
        return b()
    else:
        c()
    for i in items:
        try:
            e(i)
        except ValueError:
            raise
    return x`.split("\n");
  const pcalls = new Map<number, string[]>([[3, ["a"]], [5, ["b"]], [7, ["c"]], [10, ["e"]]]);
  const pbody = parseBody({ lines: py, start: 1, end: py.length, python: true, calls: pcalls });
  assert.deepEqual(pbody.map((s) => s.k), ["if", "loop", "return"]);
  const ptry = (pbody[1] as Extract<Stmt, { k: "loop" }>).body[0] as Extract<Stmt, { k: "try" }>;
  assert.equal(ptry.handler!.body[0]!.k, "throw");
});

test("yaml: compose mappings, compact sequences, flow collections and multi-document manifests", () => {
  const [compose] = parseYamlDocuments(`services:
  api:
    build: .
    ports: ["8080:8080", "9090"]
    environment:
      - A=1
    depends_on:
      db:
        condition: service_healthy
  db:
    image: "postgres:16" # comment
`);
  const services = (compose as Record<string, Record<string, Record<string, unknown>>>).services!;
  assert.deepEqual(services.api!.ports, ["8080:8080", "9090"], "quoted flow items stay strings");
  assert.deepEqual(services.api!.environment, ["A=1"]);
  assert.equal(services.db!.image, "postgres:16");
  const docs = parseYamlDocuments(`kind: Service
metadata:
  name: a
---
kind: Deployment
spec:
  template:
    spec:
      containers:
      - name: web
        image: nginx
      - name: side
        image: busybox
`);
  assert.equal(docs.length, 2);
  const containers = (docs[1] as { spec: { template: { spec: { containers: { image: string }[] } } } }).spec.template.spec.containers;
  assert.deepEqual(containers.map((c) => c.image), ["nginx", "busybox"]);
});

test("sequence layout: labels sit beside the caller and never cross another lifeline; detached messages are caught", () => {
  const p = (id: string) => ({ id, type: "component" as const, name: id.toUpperCase(), tag: "component", band: "middle" as const });
  const layout = layoutSequence({
    kind: "sequence",
    view: "runtime",
    participants: [p("a"), p("b"), p("c")],
    messages: [
      { id: "m1", source: "a", target: "c", label: "1. a very long message label that is wide", type: "calls", confidence: "verified", order: 1 },
      { id: "m2", source: "c", target: "a", label: "2. return", type: "returns", confidence: "inferred", order: 2 },
    ],
  });
  const report = validateLayout(layout);
  assert.ok(report.valid, report.diagnostics.map((d) => d.message).join("\n"));
  const broken: DiagramLayout = { ...layout, edges: [{ ...layout.edges[0]!, points: [{ x: 5, y: layout.edges[0]!.points[0]!.y }, layout.edges[0]!.points[1]!] }] };
  assert.ok(validateLayout(broken).diagnostics.some((d) => d.code === "edge/detached"));
});

test("server: every view type is served; view-local nodes and messages resolve in the inspector API", async () => {
  const server = await startServer(shopRoot, 0, { stateDirectory: tempDir(), dryRun: true });
  const port = (server.address() as net.AddressInfo).port;
  const get = (path: string) =>
    new Promise<{ status: number; body: string }>((ok, fail) => {
      http.get({ host: "127.0.0.1", port, path }, (res) => {
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () => ok({ status: res.statusCode ?? 0, body }));
      }).on("error", fail);
    });
  try {
    const summary = JSON.parse((await get("/api/architecture")).body);
    assert.equal(summary.views.filter((v: { available: boolean }) => v.available).length, 10);
    const wf = JSON.parse((await get("/api/architecture/view?type=workflow")).body) as PublishedView;
    const step = wf.nodes.find((n) => n.type === "decision")!;
    const detail = JSON.parse((await get(`/api/architecture/node?id=${encodeURIComponent(step.id)}`)).body);
    assert.equal(detail.node.id, step.id);
    assert.ok(detail.usedBy.length + detail.dependsOn.length > 0);
    const rt = JSON.parse((await get(`/api/architecture/view?type=runtime&focus=${encodeURIComponent("http:POST /orders")}`)).body) as PublishedView;
    const msg = JSON.parse((await get(`/api/architecture/relationship?id=${encodeURIComponent(rt.relationships[1]!.id)}`)).body);
    assert.equal(msg.relationship.label, "requireAuth()");
    const none = JSON.parse((await get("/api/architecture/view?type=runtime&focus=nope")).body);
    assert.ok(none.layout || none.error, "an unknown choice falls back or explains itself");
  } finally {
    server.close();
  }
});
