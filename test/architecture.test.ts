import assert from "node:assert/strict";
import http from "node:http";
import type net from "node:net";
import { test } from "node:test";
import { BriefingFacts } from "../src/codebase-briefing/facts.js";
import { buildArchitectureModel } from "../src/architecture/model.js";
import { layoutDiagram, BASE_CONFIG, type LayoutInput } from "../src/architecture/layout.js";
import { measure, wrap } from "../src/architecture/text.js";
import type { ArchitectureModel, DiagramLayout, PublishedView } from "../src/architecture/types.js";
import { validateLayout } from "../src/architecture/validate.js";
import { layoutWithRepair, publish, viewSpec, type ViewSpec } from "../src/architecture/views.js";
import { FehmEngine } from "../src/engine.js";
import { startServer } from "../src/server.js";
import { ArchitectureService } from "../src/visualization/architecture/service.js";
import { corpusCopy, makeRepo, REPO_ROOT, tempDir } from "./helpers.js";

function model(root: string): { m: ArchitectureModel; engine: FehmEngine } {
  const engine = FehmEngine.open(root, { stateDirectory: tempDir() });
  return { m: buildArchitectureModel(engine), engine };
}
const node = (m: ArchitectureModel, id: string) => m.nodes.find((n) => n.id === id);
const rel = (m: ArchitectureModel, s: string, t: string) => m.relationships.find((r) => r.source === s && r.target === t);

// ─── semantic model ─────────────────────────────────────────────────

test("known repository: roles, stores and relationships come from code evidence", () => {
  const { m } = model(corpusCopy());
  const api = node(m, "component:src/api")!;
  assert.equal(api.type, "api");
  assert.equal(api.role.confidence, "verified", "route nodes from the AST verify the API role");
  assert.ok(api.evidence.some((e) => e.path === "src/api/routes.ts" && e.line), "role evidence points at a source line");

  const db = node(m, "store:database")!;
  assert.equal(db.name, "SQL database", "no engine is named without a declared client");
  assert.equal(db.role.confidence, "strong");
  assert.equal(rel(m, "component:src/payments", "store:database")?.type, "writes");
  assert.equal(rel(m, "component:src/db", "store:database")?.type, "reads");

  const http = rel(m, "actor:http-client", "component:src/api")!;
  assert.equal(http.label, "HTTP");
  const calls = rel(m, "component:src/payments", "component:src/db")!;
  assert.equal(calls.type, "calls");
  assert.equal(calls.confidence, "verified");
  assert.ok(calls.evidence.every((e) => e.path && e.line), "every relationship sample has path:line");

  // Nothing common-but-absent is drawn.
  const names = m.nodes.map((n) => n.name.toLowerCase()).join(" ");
  for (const invented of ["redis", "kafka", "kubernetes", "aws", "postgres"]) assert.ok(!names.includes(invented), `no ${invented}`);
  assert.ok(!m.nodes.some((n) => n.id === "external:express"), "a web framework is a library, not an external system");
  // Stable, identity-derived ids.
  for (const n of m.nodes) assert.match(n.id, /^(component|module|file|actor|store|external):/);
});

test("evidence honesty: naming is only ever inferred, silence is unknown", () => {
  const { m } = model(
    makeRepo({
      "src/services/billing.ts": "export function charge(n: number) { return n; }\n",
      "src/misc/thing.ts": "import { charge } from '../services/billing';\nexport const x = charge(1);\n",
    }),
  );
  const services = node(m, "component:src/services")!;
  assert.equal(services.type, "service");
  assert.equal(services.role.confidence, "inferred");
  assert.match(services.role.reasons[0]!, /named like/);
  const misc = node(m, "component:src/misc")!;
  assert.equal(misc.type, "component");
  assert.equal(misc.role.confidence, "unknown");
  assert.ok(m.unknowns.some((u) => /no role evidence/.test(u)));
  assert.ok(!m.nodes.some((n) => n.tier !== 1), "no actors, stores or externals without evidence");
});

test("external systems appear only when code imports their SDK", () => {
  const { m } = model(
    makeRepo({
      "package.json": JSON.stringify({ name: "shop", dependencies: { stripe: "1.0.0" } }),
      "src/pay.ts": `import Stripe from "stripe";\nexport function pay() { return new Stripe("k"); }\n`,
    }),
  );
  const stripe = m.nodes.find((n) => n.type === "external-system")!;
  assert.ok(stripe, "stripe is an external system");
  const owner = m.nodes.find((n) => n.level === 1 && n.files.includes("src/pay.ts"))!;
  assert.equal(rel(m, owner.id, stripe.id)?.type, "calls");
});

test("a browser `click` event is not command-line evidence", () => {
  const root = makeRepo({ "src/ui/main.ts": `document.getElementById("b")!.addEventListener("click", () => {});\nexport const x = 1;\n` });
  const engine = FehmEngine.open(root, { stateDirectory: tempDir() });
  assert.equal(new BriefingFacts(engine).cliSourceFiles.size, 0);
  const ui = buildArchitectureModel(engine).nodes.find((n) => n.level === 1)!;
  assert.equal(ui.type, "frontend");
});

test("clustering keeps the system view readable on a flat repository and never merges interfaces away", () => {
  const files: Record<string, string> = {};
  for (let i = 0; i < 30; i += 1) files[`src/m${i}.ts`] = `import { f${(i + 1) % 30} } from "./m${(i + 1) % 30}";\nexport function f${i}() { return f${(i + 1) % 30}; }\n`;
  files["src/cli.ts"] = `import { f0 } from "./m0";\nconst cmd = process.argv[2];\nexport function main() { return cmd ? f0() : 0; }\n`;
  const { m } = model(makeRepo(files));
  assert.ok(m.components.length <= 12, `${m.components.length} components`);
  assert.equal(node(m, "component:src/cli")?.type, "cli", "the CLI entry stays its own component");
});

// ─── layout and validation ──────────────────────────────────────────

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

function randomInput(n: number, e: number, seed: number): LayoutInput {
  const r = rng(seed);
  const nodes = Array.from({ length: n }, (_, i) => ({ id: `n${i}`, type: "component" as const, name: `Component ${i}${i % 7 === 0 ? " with a rather long descriptive name" : ""}`, tag: "component", band: "middle" as const, subtitle: `${i % 5} files` }));
  const edges = new Map<string, LayoutInput["edges"][number]>();
  while (edges.size < e) {
    const a = Math.floor(r() * n);
    const b = Math.floor(r() * n);
    if (a === b) continue;
    const id = `rel:n${a}→n${b}`;
    edges.set(id, { id, source: `n${a}`, target: `n${b}`, weight: 1 + Math.floor(r() * 5), type: "calls", confidence: "verified", ...(r() < 0.05 ? { label: "uses" } : {}) });
  }
  return { view: "dependencies", nodes, edges: [...edges.values()], boundaries: [] };
}

const HARD = ["geometry/non-finite", "node/overlap", "edge/through-node", "edge/detached", "edge/non-orthogonal", "viewbox/clip", "ref/unknown-endpoint"];

test("stress: 100 nodes / 250 edges with cycles — no overlap, no edge through a node, finite, deterministic", () => {
  const input = randomInput(100, 250, 7);
  const started = performance.now();
  const a = layoutDiagram(input, BASE_CONFIG);
  const elapsed = performance.now() - started;
  const b = layoutDiagram(input, BASE_CONFIG);
  assert.deepEqual(a, b, "same input, same geometry");
  const report = validateLayout(a, "showcase");
  const hard = report.diagnostics.filter((d) => HARD.includes(d.code));
  assert.deepEqual(hard.map((d) => d.message), []);
  assert.ok(elapsed < 8000, `layout took ${Math.round(elapsed)}ms`);
});

test("small and medium graphs pass showcase validation, including cycles and parallel edges", () => {
  for (const [n, e, seed] of [[1, 0, 1], [2, 1, 2], [5, 4, 3], [10, 20, 4], [20, 40, 5]] as const) {
    const c = layoutWithRepair(randomInput(n, e, seed));
    assert.ok(c.report.valid, `${n}/${e}: ${c.report.diagnostics.filter((d) => d.severity === "error").map((d) => d.code).join(", ")}`);
  }
  const both: LayoutInput = {
    view: "system",
    nodes: [
      { id: "a", type: "api", name: "API", tag: "http api", band: "middle" },
      { id: "b", type: "service", name: "Service", tag: "service", band: "middle" },
    ],
    edges: [
      { id: "rel:a→b", source: "a", target: "b", weight: 3, type: "calls", confidence: "verified" },
      { id: "rel:b→a", source: "b", target: "a", weight: 1, type: "calls", confidence: "inferred" },
    ],
    boundaries: [{ id: "boundary:x", title: "System", members: ["a", "b"] }],
  };
  assert.ok(layoutWithRepair(both).report.valid, "a two-node cycle inside a boundary");
});

test("validator: overlaps, edges through nodes and label collisions are hard failures with measurements", () => {
  const base: DiagramLayout = {
    view: "system",
    nodes: [
      { id: "a", type: "component", shape: "box", lines: ["A"], tag: "c", layer: 0, x: 0, y: 0, width: 100, height: 50 },
      { id: "b", type: "component", shape: "box", lines: ["B"], tag: "c", layer: 0, x: 90, y: 10, width: 100, height: 50 },
      { id: "c", type: "component", shape: "box", lines: ["C"], tag: "c", layer: 1, x: 0, y: 200, width: 100, height: 50 },
    ],
    edges: [{ id: "rel:a→c", source: "a", target: "c", points: [{ x: 50, y: 50 }, { x: 50, y: 200 }], weight: 1, type: "calls", confidence: "verified", label: { text: "uses", x: 60, y: 205, width: 40, height: 17 } }],
    boundaries: [],
    viewBox: { x: -20, y: -20, width: 260, height: 300 },
    metrics: { crossings: 0, bends: 0, layers: 2 },
  };
  const r = validateLayout(base, "showcase");
  const overlap = r.diagnostics.find((d) => d.code === "node/overlap")!;
  assert.ok(overlap && overlap.measured! < 0 && overlap.required === 16 && overlap.suggestions.length);
  assert.ok(r.diagnostics.some((d) => d.code === "label/overlap-node"));
  assert.equal(r.valid, false);

  const through: DiagramLayout = { ...base, nodes: [base.nodes[0]!, { ...base.nodes[1]!, x: 20, y: 100, width: 60, height: 40 }, base.nodes[2]!], edges: [{ ...base.edges[0]!, label: undefined as never }] };
  delete (through.edges[0] as { label?: unknown }).label;
  assert.ok(validateLayout(through).diagnostics.some((d) => d.code === "edge/through-node" && d.subjects.includes("b")));

  const clipped: DiagramLayout = { ...base, nodes: [base.nodes[0]!, base.nodes[2]!], edges: [], viewBox: { x: 0, y: 0, width: 50, height: 50 } };
  assert.ok(validateLayout(clipped).diagnostics.some((d) => d.code === "viewbox/clip"));
});

test("last known good: a failed candidate never replaces a verified layout, and nothing unverified is published", () => {
  const input = randomInput(4, 3, 9);
  const good = layoutWithRepair(input);
  assert.ok(good.report.valid);
  const spec: ViewSpec = { view: "system", title: "t", nodes: [], relationships: [], input, path: [], notes: [] };
  const failed = { ...good, report: { profile: "showcase" as const, valid: false, diagnostics: [{ code: "node/overlap", severity: "error" as const, message: "x", subjects: [], suggestions: [] }] } };
  const withLkg = publish(spec, failed, good.layout);
  assert.equal(withLkg.validation.source, "last-known-good");
  assert.equal(withLkg.layout, good.layout);
  const none = publish(spec, failed, undefined);
  assert.equal(none.layout, null);
  assert.equal(none.validation.source, "unverified");
  assert.ok(none.validation.draft, "the draft is kept only for an explicit request");
});

test("text measurement wraps long names within the node width and never loses them silently", () => {
  const lines = wrap("src/visualization/graph/ui/canvas-view-extremely-long-module-name", 200, 13, 600, 2);
  assert.ok(lines.length <= 2);
  for (const l of lines) assert.ok(measure(l, 13, 600) <= 200, l);
  assert.ok(measure("MMMM", 13) > measure("iiii", 13), "width depends on glyphs, not character count");
});

// ─── views, service, server ─────────────────────────────────────────

test("views project one model: system boundary holds exactly the components; drill-down shows children and context", () => {
  const { m } = model(corpusCopy());
  const system = viewSpec(m, "system") as ViewSpec;
  const c = layoutWithRepair(system.input);
  assert.ok(c.report.valid, c.report.diagnostics.map((d) => d.message).join("\n"));
  const boundary = c.layout.boundaries[0]!;
  assert.deepEqual([...boundary.members].sort(), [...m.components].sort());
  const actor = c.layout.nodes.find((n) => n.id === "actor:http-client")!;
  const store = c.layout.nodes.find((n) => n.id === "store:database")!;
  assert.ok(actor.y + actor.height <= boundary.y, "actors sit above the system boundary");
  assert.ok(store.y >= boundary.y + boundary.height, "stores sit below it");

  const drill = viewSpec(m, "components", "component:src/api") as ViewSpec;
  assert.deepEqual(drill.path.map((p) => p.id), ["system", "component:src/api"]);
  assert.ok(drill.input.nodes.some((n) => n.id === "file:src/api/routes.ts" && n.band === "middle"));
  assert.ok(drill.input.nodes.some((n) => n.id === "component:src/db" && n.context && n.band === "bottom"), "a used component is context below");
  assert.ok(drill.input.nodes.some((n) => n.id === "actor:http-client" && n.band === "top"));
  assert.ok(drill.relationships.some((r) => r.source === "file:src/api/routes.ts" && r.target === "component:src/db"), "file-level relationships to context");
  assert.ok(layoutWithRepair(drill.input).report.valid);
});

test("service: verified layouts persist and are reused for an unchanged repository", () => {
  const root = corpusCopy();
  const state = tempDir();
  const first = new ArchitectureService({ stateDirectory: state }).view(FehmEngine.open(root, { stateDirectory: state }), "system") as PublishedView;
  assert.equal(first.validation.source, "fresh");
  assert.ok(first.validation.attempts >= 1);
  const again = new ArchitectureService({ stateDirectory: state }).view(FehmEngine.open(root, { stateDirectory: state }), "system") as PublishedView;
  assert.equal(again.validation.attempts, 0, "cache hit: no layout work");
  assert.deepEqual(again.layout, first.layout);
});

test("this repository: system and dependency views pass showcase validation", () => {
  const { m } = model(REPO_ROOT);
  for (const v of ["system", "dependencies"] as const) {
    const c = layoutWithRepair((viewSpec(m, v) as ViewSpec).input);
    assert.ok(c.report.valid, `${v}: ${c.report.diagnostics.filter((d) => d.severity === "error").map((d) => d.message).join("\n")}`);
  }
});

test("server: architecture API — views, detail, evidence excerpts, search, and no reads outside the index", async () => {
  const root = corpusCopy();
  const server = await startServer(root, 0, { stateDirectory: tempDir() });
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
    assert.equal(summary.counts.components, 9);
    const view = JSON.parse((await get("/api/architecture/view?type=system")).body) as PublishedView;
    assert.equal(view.validation.source, "fresh");
    assert.ok(view.layout);
    assert.equal((await get("/api/architecture/view?type=nope")).status, 400);
    const detail = JSON.parse((await get(`/api/architecture/node?id=${encodeURIComponent("component:src/payments")}`)).body);
    assert.ok(detail.dependsOn.some((d: { id: string }) => d.id === "component:src/db"));
    assert.ok(detail.usedBy.some((d: { id: string }) => d.id === "component:src/api"));
    const drillRel = JSON.parse((await get(`/api/architecture/relationship?id=${encodeURIComponent("rel:file:src/api/routes.ts→component:src/db")}`)).body);
    assert.ok(drillRel.relationship.evidence.length, "relationships outside the model are re-aggregated on demand");
    const ex = JSON.parse((await get("/api/architecture/source?path=src/api/routes.ts&line=11")).body);
    assert.equal(ex.focus, 11);
    assert.match(ex.lines.join("\n"), /\/login/);
    assert.equal((await get("/api/architecture/source?path=../../etc/passwd&line=1")).status, 404);
    assert.equal((await get("/api/architecture/source?path=node_modules/express/index.js&line=1")).status, 404, "unindexed files are not readable");
    const hits = JSON.parse((await get("/api/architecture/search?q=authenticateUser")).body);
    assert.equal(hits[0].target, "file:src/auth/authenticate.ts");
    const main = await get("/architecture/assets/architecture/ui/main.js");
    assert.equal(main.status, 200);
    assert.doesNotMatch(main.body, /^\s*import\s+\S.*from\s+"(node:|typescript)/m);
    assert.equal((await get("/architecture/assets/architecture/service.js")).status, 404, "server modules are not exposed");
  } finally {
    server.close();
  }
});
