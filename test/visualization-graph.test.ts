import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import http from "node:http";
import type net from "node:net";
import { join } from "node:path";
import { test } from "node:test";
import { FehmEngine } from "../src/engine.js";
import { startServer } from "../src/server.js";
import { adaptCodeGraph } from "../src/visualization/graph/adapter.js";
import { computeLayout } from "../src/visualization/graph/layout.js";
import { nodeStyle, viewEdgeKind, type GraphViewPayload } from "../src/visualization/graph/model.js";
import { GraphViewService } from "../src/visualization/graph/service.js";
import { Camera } from "../src/visualization/graph/ui/camera.js";
import { GraphModel } from "../src/visualization/graph/ui/graph-model.js";
import { SpatialIndex } from "../src/visualization/graph/ui/spatial.js";
import { computeVisibility, computeVisualState, CONTEXT, HIDDEN, LEVEL_RELATED, LEVEL_SELECTED, PRIMARY } from "../src/visualization/graph/ui/visual-state.js";
import { corpusCopy, makeRepo, REPO_ROOT, tempDir, writeFile } from "./helpers.js";

const REPO = {
  "src/api/users.ts": `import { createUserService } from "../services/user-service.js";
import type { User } from "../models/user.js";
export function createUser(name: string): User { return createUserService(name); }
export class UsersController { handle(name: string) { return createUser(name); } }
`,
  "src/services/user-service.ts": `import { User } from "../models/user.js";
export function createUserService(name: string): User { return new User(name); }
`,
  "src/models/user.ts": `export class User { constructor(public name: string) {} }
export class Admin extends User {}
`,
  "src/util/format.ts": `import path from "node:path";
export const sep = path.sep;
export function pad(s: string): string { return s.padStart(4); }
`,
};

function view(root: string, state = tempDir()): { engine: FehmEngine; payload: GraphViewPayload; service: GraphViewService; state: string } {
  const engine = FehmEngine.open(root, { stateDirectory: state });
  const service = new GraphViewService({ stateDirectory: state });
  return { engine, payload: service.view(engine), service, state };
}

const idx = (p: GraphViewPayload, id: string): number => {
  const i = p.nodes.id.indexOf(id);
  assert.ok(i >= 0, `missing ${id}`);
  return i;
};

test("adapter: hierarchy comes from Feature 1 contains/defines edges; most specific parent wins", () => {
  const engine = FehmEngine.open(makeRepo(REPO), { stateDirectory: tempDir() });
  const v = adaptCodeGraph(engine.graph);
  const parentOf = (id: string): string | undefined => {
    const p = v.parent[v.index.get(id)!]!;
    return p >= 0 ? v.nodes[p]!.id : undefined;
  };
  assert.equal(parentOf("repository:."), undefined);
  assert.equal(parentOf("directory:src"), "repository:.");
  assert.equal(parentOf("directory:src/api"), "directory:src");
  assert.equal(parentOf("file:src/api/users.ts"), "directory:src/api");
  assert.equal(parentOf("function:src/api/users.ts#createUser"), "file:src/api/users.ts");
  assert.equal(parentOf("method:src/api/users.ts#UsersController.handle"), "class:src/api/users.ts#UsersController");
  assert.equal(parentOf("package:path"), "repository:.", "external packages are grouped under the project");
  // The adapter reads the engine's graph; it neither adds nor drops relationships.
  assert.equal(v.edges.length, engine.graph.edgeCount);
  assert.equal(v.nodes.length, engine.graph.nodeCount);
});

test("payload: every node and edge is a Feature 1 fact, with valid indices and counts", () => {
  const { engine, payload } = view(makeRepo(REPO));
  const stats = engine.graph.stats();
  assert.equal(payload.nodes.id.length, stats.nodes);
  assert.equal(payload.edges.source.length, stats.edges);
  const graphEdges = new Set(engine.graph.edges().map((e) => `${e.kind}|${e.source}|${e.target}`));
  for (let e = 0; e < payload.edges.source.length; e += 1) {
    // View kinds refine contains/defines by target kind; the base kind is the Feature 1 fact.
    const viewKind = payload.edgeKinds[payload.edges.kind[e]!]!;
    const base = viewKind.replace(/-(folder|file|method|field)$/, "");
    const targetKind = payload.nodeKinds[payload.nodes.kind[payload.edges.target[e]!]!]!;
    assert.equal(viewEdgeKind(base, targetKind), viewKind);
    const key = `${base}|${payload.nodes.id[payload.edges.source[e]!]}|${payload.nodes.id[payload.edges.target[e]!]}`;
    assert.ok(graphEdges.has(key), `edge not in Feature 1 graph: ${key}`);
  }
  for (const p of payload.nodes.parent) assert.ok(p >= -1 && p < payload.nodes.id.length);
  assert.equal(payload.stats.files, 4);
  assert.ok(payload.stats.semanticEdges > 0);
  assert.equal(payload.layout.mode, "full");
});

test("layout: deterministic, no overlapping entities, children clustered around their parents", () => {
  const root = corpusCopy();
  const a = view(root).payload;
  const b = view(root).payload;
  assert.deepEqual(a.nodes.x, b.nodes.x);
  assert.deepEqual(a.nodes.y, b.nodes.y);

  const n = a.nodes.id.length;
  const r = a.nodes.kind.map((k) => nodeStyle(a.nodeKinds[k]!).radius);
  for (let i = 0; i < n; i += 1) {
    for (let j = i + 1; j < n; j += 1) {
      const d = Math.hypot(a.nodes.x[i]! - a.nodes.x[j]!, a.nodes.y[i]! - a.nodes.y[j]!);
      assert.ok(d >= (r[i]! + r[j]!) * 0.9, `${a.nodes.id[i]} overlaps ${a.nodes.id[j]} (d=${d.toFixed(2)})`);
    }
  }
  // A file sits nearer its own folder than the average folder of the project.
  const dirs = a.nodes.id.map((id, i) => (id.startsWith("directory:") ? i : -1)).filter((i) => i >= 0);
  let nearer = 0;
  let files = 0;
  for (let i = 0; i < n; i += 1) {
    if (!a.nodes.id[i]!.startsWith("file:")) continue;
    const p = a.nodes.parent[i]!;
    if (!a.nodes.id[p]!.startsWith("directory:")) continue;
    const dist = (j: number): number => Math.hypot(a.nodes.x[i]! - a.nodes.x[j]!, a.nodes.y[i]! - a.nodes.y[j]!);
    const mean = dirs.reduce((s, j) => s + dist(j), 0) / dirs.length;
    files += 1;
    if (dist(p) < mean) nearer += 1;
  }
  assert.ok(files > 5 && nearer === files, `${nearer}/${files} files nearer their folder than average`);
});

test("layout: refresh keeps known positions and inserts new entities next to their parent", () => {
  const root = makeRepo(REPO);
  const first = view(root);
  writeFile(root, "src/api/auth.ts", "export function login(user: string) { return user; }\n");
  const second = view(root, first.state);
  assert.equal(second.payload.layout.mode, "incremental");
  for (let i = 0; i < first.payload.nodes.id.length; i += 1) {
    const j = idx(second.payload, first.payload.nodes.id[i]!);
    assert.equal(second.payload.nodes.x[j], first.payload.nodes.x[i], `${first.payload.nodes.id[i]} moved`);
    assert.equal(second.payload.nodes.y[j], first.payload.nodes.y[i]);
  }
  const p = second.payload;
  const file = idx(p, "file:src/api/auth.ts");
  const fn = idx(p, "function:src/api/auth.ts#login");
  const dir = idx(p, "directory:src/api");
  const d = (i: number, j: number): number => Math.hypot(p.nodes.x[i]! - p.nodes.x[j]!, p.nodes.y[i]! - p.nodes.y[j]!);
  assert.ok(d(file, dir) < 60, `new file ${d(file, dir).toFixed(1)} from its folder`);
  assert.ok(d(fn, file) < 30, `new function ${d(fn, file).toFixed(1)} from its file`);
  // A second open with nothing changed is served from the saved layout.
  assert.equal(view(root, first.state).payload.layout.mode, "cached");
});

test("layout: the global shape emerges from packing, not from a fixed circle", () => {
  const ids = ["root", ...Array.from({ length: 40 }, (_, i) => `leaf${i}`)];
  const result = computeLayout({ ids, kinds: ["repository", ...ids.slice(1).map(() => "function")], parent: [-1, ...ids.slice(1).map(() => 0)], edges: [] });
  const radii = ids.slice(1).map((_, k) => Math.hypot(result.x[k + 1]!, result.y[k + 1]!));
  assert.ok(Math.max(...radii) - Math.min(...radii) > 5, "leaves fill the area around the parent instead of a single ring");
});

test("layout: a chain of single-subfolder directories stays compact (no doubling per level)", () => {
  const files: Record<string, string> = {};
  for (let k = 0; k < 12; k += 1) files[`a/b/c/d/e/f${k}.ts`] = `export function f${k}() { return ${k}; }\n`;
  const p = view(makeRepo(files)).payload;
  const dist = (a: string, b: string): number => Math.hypot(p.nodes.x[idx(p, a)]! - p.nodes.x[idx(p, b)]!, p.nodes.y[idx(p, a)]! - p.nodes.y[idx(p, b)]!);
  // Five nested folders around ~40 world units of leaf content: linear growth, not 2^5.
  assert.ok(dist("repository:.", "directory:a/b/c/d/e") < 250, `deepest folder ${dist("repository:.", "directory:a/b/c/d/e").toFixed(0)} from the project`);
});

test("focus: selection dims unrelated nodes without hiding them; filters are view-only", () => {
  const { payload } = view(makeRepo(REPO));
  const model = new GraphModel(payload);
  const all = { nodeKinds: new Set(model.kindNames), edgeKinds: new Set(model.edgeKindNames) };
  const vis = computeVisibility(model, all);
  const sel = model.indexById.get("function:src/api/users.ts#createUser")!;
  const callee = model.indexById.get("function:src/services/user-service.ts#createUserService")!;
  const unrelated = model.indexById.get("function:src/util/format.ts#pad")!;
  const state = computeVisualState(model, vis, { selected: sel, hovered: -1, matches: null });
  assert.equal(state.level[sel], LEVEL_SELECTED);
  assert.equal(state.level[callee], LEVEL_RELATED);
  assert.ok(state.related.includes(callee));
  assert.ok(state.nodeAlpha[unrelated]! > 0 && state.nodeAlpha[unrelated]! < 0.5, "unrelated nodes stay visible, dimmed");
  for (let i = 0; i < model.n; i += 1) assert.ok(state.nodeAlpha[i]! > 0, `${model.ids[i]} vanished on selection`);

  const xs = Float32Array.from(model.x);
  const functionsOnly = computeVisibility(model, { nodeKinds: new Set(["function"]), edgeKinds: new Set(["calls"]) });
  assert.equal(functionsOnly.node[sel], PRIMARY);
  assert.equal(functionsOnly.node[model.indexById.get("file:src/api/users.ts")!], CONTEXT, "files stay as spatial context");
  assert.equal(functionsOnly.node[model.indexById.get("class:src/models/user.ts#User")!], HIDDEN);
  assert.deepEqual(model.x, xs, "filtering never moves or mutates the graph");
  const calls = model.edgeKindNames.indexOf("calls");
  for (let e = 0; e < model.m; e += 1) if (functionsOnly.edge[e]) assert.equal(model.edgeKind[e], calls);
});

test("camera: zoom keeps the world point under the cursor; fit contains the bounds", () => {
  const cam = new Camera();
  cam.resize(800, 600);
  cam.set(10, 20, 2);
  const before = cam.toWorld(200, 150);
  cam.zoomAt(200, 150, 3);
  for (let t = 0; t < 2000 && cam.animating; t += 16) cam.step(t);
  assert.ok(Math.abs(cam.zoom - 6) < 1e-6);
  const after = cam.toWorld(200, 150);
  assert.ok(Math.abs(after[0] - before[0]) < 1e-6 && Math.abs(after[1] - before[1]) < 1e-6);
  cam.fit({ minX: -500, minY: -100, maxX: 500, maxY: 100 }, 0, { animate: false });
  const v = cam.viewport();
  assert.ok(v.minX <= -500 && v.maxX >= 500 && v.minY <= -100 && v.maxY >= 100);
  cam.zoomAt(0, 0, 1e9);
  for (let t = 3000; t < 9000 && cam.animating; t += 16) cam.step(t);
  assert.ok(Math.abs(cam.zoom - cam.maxZoom) < 1e-9, "zoom is bounded");
});

test("picking: spatial index returns the node under the pointer, nothing on empty space", () => {
  const { payload } = view(corpusCopy());
  const model = new GraphModel(payload);
  const index = new SpatialIndex(model);
  for (const i of [0, Math.floor(model.n / 2), model.n - 1])
    assert.equal(
      index.pick(model.x[i]!, model.y[i]!, 4, () => true),
      i,
    );
  const b = model.bounds;
  assert.equal(
    index.pick(b.maxX + 1000, b.maxY + 1000, 4, () => true),
    -1,
  );
});

test("server: graph page, modules and API run on the same engine", async () => {
  const root = makeRepo(REPO);
  const server = await startServer(root, 0, { stateDirectory: tempDir() });
  const port = (server.address() as net.AddressInfo).port;
  const get = (path: string, method = "GET") =>
    new Promise<{ status: number; body: string; headers: http.IncomingHttpHeaders }>((resolveP, reject) => {
      const req = http.request({ host: "127.0.0.1", port, path, method }, (res) => {
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () => resolveP({ status: res.statusCode ?? 0, body, headers: res.headers }));
      });
      req.on("error", reject);
      req.end();
    });
  try {
    const page = await get("/graph");
    assert.equal(page.status, 200);
    assert.match(page.body, /\/graph\/assets\/ui\/main\.js/);
    assert.match(String(page.headers["content-security-policy"]), /default-src 'self'/);

    // Every browser module is servable, and imports resolve to servable modules.
    const modules = ["model", ...readdirSync(join(REPO_ROOT, "src/visualization/graph/ui")).map((f) => `ui/${f.replace(/\.ts$/, "")}`)];
    for (const m of modules) {
      const r = await get(`/graph/assets/${m}.js`);
      assert.equal(r.status, 200, m);
      assert.match(String(r.headers["content-type"]), /javascript/);
      assert.doesNotMatch(r.body, /^\s*import\s+\S.*from\s+"(node:|typescript)/m, `${m} must not import Node modules`);
    }
    assert.equal((await get("/graph/assets/../server.js")).status, 404);
    // three.js is served locally through the page's import map; only the modules the renderer needs.
    assert.match(page.body, /<script type="importmap">/);
    const three = await get("/graph/vendor/three/build/three.module.js");
    assert.equal(three.status, 200);
    assert.match(three.body, /REVISION/);
    assert.equal((await get("/graph/vendor/three/examples/jsm/postprocessing/UnrealBloomPass.js")).status, 200);
    assert.equal((await get("/graph/vendor/three/package.json")).status, 404);
    assert.equal((await get("/graph/vendor/three/build/../../../package.json")).status, 404);
    assert.equal((await get("/graph/assets/service.js")).status, 404, "server-side modules are not exposed");

    const payload = JSON.parse((await get("/api/graph")).body) as GraphViewPayload;
    assert.ok(payload.nodes.id.includes("function:src/api/users.ts#createUser"));
    const status = JSON.parse((await get("/api/graph/status")).body);
    assert.equal(status.state, "ready");
    assert.equal(status.layoutCached, true);
    const hits = JSON.parse((await get("/api/graph/search?q=createUser")).body);
    assert.equal(hits[0].id, "function:src/api/users.ts#createUser");
    const detail = JSON.parse((await get(`/api/graph/node?id=${encodeURIComponent("function:src/api/users.ts#createUser")}`)).body);
    assert.equal(detail.kind, "function");
    assert.ok(detail.related.some((r: { relation: string; id: string }) => r.relation === "calls" && r.id.endsWith("#createUserService")));
    assert.equal((await get("/api/graph/node?id=nope")).status, 404);
    assert.equal(JSON.parse((await get("/api/graph/freshness")).body).fresh, true);
    writeFile(root, "src/api/extra.ts", "export const x = 1;\n");
    assert.equal(JSON.parse((await get("/api/graph/freshness")).body).fresh, false);
    assert.equal((await get("/api/graph/refresh")).status, 405);
    const refreshed = JSON.parse((await get("/api/graph/refresh", "POST")).body) as GraphViewPayload;
    assert.ok(refreshed.nodes.id.includes("file:src/api/extra.ts"));
    assert.equal(refreshed.layout.mode, "incremental");
    assert.equal(JSON.parse((await get("/api/graph/freshness")).body).fresh, true);
    const relaid = JSON.parse((await get("/api/graph/relayout", "POST")).body) as GraphViewPayload;
    assert.equal(relaid.layout.mode, "full");
  } finally {
    server.close();
  }
});
