import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import http from "node:http";
import type net from "node:net";
import { join } from "node:path";
import { test } from "node:test";
import { CONTRACT_FILE, globToRegExp, parseContract, writeContract } from "../src/drift/contract.js";
import { DECISIONS_FILE, decideFinding, decidePattern } from "../src/drift/decisions.js";
import { analyzeDrift } from "../src/drift/drift.js";
import { dateFindings, HistoryEvaluator, pointOf, readBaseline, writeBaseline } from "../src/drift/history.js";
import { qualitySignals } from "../src/drift/signals.js";
import type { ArchitectureContract, DriftFinding, DriftPagePayload, DriftReport } from "../src/drift/types.js";
import { BriefingFacts } from "../src/codebase-briefing/facts.js";
import { FehmEngine } from "../src/engine.js";
import { startServer } from "../src/server.js";
import { DriftService } from "../src/visualization/drift/service.js";
import { LAYERED } from "./fixtures/drift-layers.js";
import { shopFiles } from "./fixtures/drift-shop.js";
import { makeRepo, tempDir, writeFile } from "./helpers.js";

function drift(root: string): DriftReport {
  return analyzeDrift({ engine: FehmEngine.open(root, { stateDirectory: tempDir() }) }).report;
}

const find = (r: DriftReport, id: string): DriftFinding => {
  const f = r.findings.find((x) => x.id === id);
  assert.ok(f, `finding ${id}; have:\n  ${r.findings.map((x) => x.id).join("\n  ")}`);
  return f;
};

let shopReport: DriftReport | undefined;
const shop = (): DriftReport => (shopReport ??= drift(makeRepo(shopFiles())));

function gitRepo(files: Record<string, string>): { root: string; git: (...a: string[]) => string } {
  const root = makeRepo(files);
  const git = (...a: string[]): string => execFileSync("git", ["-C", root, "-c", "user.email=t@t", "-c", "user.name=Tester", ...a], { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  git("init", "-q");
  git("add", ".");
  git("commit", "-qm", "clean layers");
  return { root, git };
}

test("context before judgment: language, framework, project type and style come with evidence", () => {
  const c = shop().context;
  assert.equal(c.languages[0]?.name, "TypeScript");
  assert.ok(c.frameworks.some((f) => f.id === "express" && f.evidence.some((e) => /imports express/.test(e))));
  assert.equal(c.primaryType, "backend-service");
  assert.ok(c.architectureSignals.some((a) => a.id === "layered"));
  assert.ok(shop().practices.some((p) => p.id === "IND-DB-BOUNDARY"), "backend practices apply to a backend service");

  const ml = drift(makeRepo({ "train.py": "import torch\n\ndef train():\n    return torch.zeros(1)\n", "notebooks/a.ipynb": "{}", "notebooks/b.ipynb": "{}", "notebooks/c.ipynb": "{}" }));
  assert.ok(ml.context.projectTypes.some((t) => t.type === "ml-project"));
  assert.ok(!ml.practices.some((p) => p.id === "IND-DELEGATE" || p.id === "IND-DB-BOUNDARY"), "an ML repository is not measured against a layered backend");
});

test("project convention mining: every planted deviation, measured against the project's own majority", () => {
  const r = shop();
  const bypass = find(r, "src/controllers/payments.controller.ts|store:database");
  assert.equal(bypass.basis, "project-pattern");
  assert.equal(bypass.confidence, "high");
  assert.deepEqual(bypass.stats && [bypass.stats.matching, bypass.stats.comparable], [5, 6]);
  assert.ok(bypass.evidence.some((e) => e.path === "src/controllers/payments.controller.ts" && e.line === 16), "points at the SQL line");
  assert.deepEqual(bypass.commonChain, ["Controller", "Service", "Repository", "Database"]);
  assert.deepEqual(bypass.observedChain, ["Controller", "Database"]);
  assert.ok(bypass.related.length >= 1, "the database-ownership detector's signal is folded in, not listed twice");
  assert.equal(r.findings.filter((f) => f.unit?.path === "src/controllers/payments.controller.ts" && f.target === "store:database").length, 1);

  assert.equal(find(r, "src/services/invoices.service.ts|di").category, "dependency-injection");
  assert.equal(find(r, "src/controllers/orders.controller.ts|config").category, "configuration");
  assert.equal(find(r, "src/controllers/products.controller.ts|logging").category, "observability");
  const auth = find(r, "src/controllers/reports.controller.ts|auth");
  assert.equal(auth.category, "security-boundary");
  assert.ok(auth.attention === "high" || auth.attention === "critical");
  assert.equal(find(r, "src/services/reports.service.ts|tests").category, "testing");
  assert.equal(find(r, "src/utils/helperFinal.ts|naming").category, "naming");

  // Conforming units produce nothing, and the database client the repositories build on is part of the boundary.
  assert.ok(!r.findings.some((f) => f.unit?.path === "src/controllers/users.controller.ts"));
  assert.ok(!r.findings.some((f) => f.unit?.path === "src/lib/db.ts" && f.category !== "ai-associated"));
  // Established patterns are exposed, with their distributions.
  const di = r.patterns.find((p) => p.id === "di:service")!;
  assert.ok(di.established && di.matching === 5 && di.comparable === 6);
  assert.ok(r.comparison.some((c) => c.practice === "Dependency injection" && c.project && c.deviations >= 1));
});

test("wording is non-prescriptive: deviations, never verdicts", () => {
  for (const f of shop().findings) {
    const text = [f.title, f.observed, f.baseline, f.explanation, f.impact, f.suggestion?.text ?? ""].join(" ");
    assert.doesNotMatch(text, /\b(wrong|invalid|violat|incorrect|bad engineering|written by AI|must\b)/i, f.id);
    if (f.suggestion) assert.match(f.suggestion.text, /^Possible/, `${f.id}: suggestions are possibilities`);
  }
  for (const f of shop().findings.filter((x) => x.category === "ai-associated")) assert.match(f.explanation, /do not establish authorship/);
});

test("too little project evidence: framework convention (medium) stands in, never as a project convention", () => {
  const r = drift(makeRepo(LAYERED));
  assert.equal(r.baseline.project.established, r.patterns.filter((p) => p.established).length);
  const db = find(r, "src/api/users.ts|store:database");
  assert.equal(db.basis, "framework");
  assert.equal(db.confidence, "medium");
  assert.match(db.explanation, /Express/);
});

test("explicit project rules sit at the top of the ladder; the project pattern is kept as a supporting reason", () => {
  const root = makeRepo(shopFiles());
  const c = parseContract({ layers: [{ id: "web", paths: ["src/controllers/**"] }, { id: "app", paths: ["src/services/**"] }, { id: "data", paths: ["src/repositories/**", "src/lib/**"] }], rules: [{ id: "db-only-data", to: "store:database", onlyFrom: ["data"], reason: "persistence stays in the data layer" }], allowUnassigned: true });
  assert.ok(c.ok);
  writeContract(root, CONTRACT_FILE, (c as { contract: ArchitectureContract }).contract);
  const r = drift(root);
  const f = find(r, "src/controllers/payments.controller.ts|store:database");
  assert.equal(f.basis, "explicit-rule");
  assert.equal(f.confidence, "high");
  assert.ok(f.bases.some((b) => b.basis === "project-pattern"), "the project convention still explains it");
  assert.equal(r.rules.find((x) => x.id === "db-only-data")?.status, "deviation");

  const bad = parseContract({ layers: [{ id: "API", paths: [] }], rules: [{ to: "store:database" }] });
  assert.equal(bad.ok, false);
  assert.ok(globToRegExp("src/api/**").test("src/api/v1/users.ts") && !globToRegExp("src/api/*").test("src/api/v1/users.ts"));
});

test("decisions: intentional findings move aside; rejected patterns stop producing findings; approved ones become the baseline", () => {
  const root = makeRepo(shopFiles());
  decideFinding(root, "src/controllers/payments.controller.ts|store:database", "intentional", "legacy reporting endpoint");
  decidePattern(root, "logging", "rejected");
  decidePattern(root, "tests:service", "approved");
  assert.ok(existsSync(join(root, DECISIONS_FILE)));
  const r = drift(root);
  assert.ok(!r.findings.some((f) => f.id === "src/controllers/payments.controller.ts|store:database"));
  const d = r.decided.find((f) => f.id === "src/controllers/payments.controller.ts|store:database")!;
  assert.equal(d.decision?.kind, "intentional");
  assert.equal(d.decision?.by, "Tester".length ? d.decision?.by : "");
  assert.ok(!r.findings.some((f) => f.id === "src/controllers/products.controller.ts|logging"));
  assert.equal(find(r, "src/services/reports.service.ts|tests").basis, "approved-pattern");
});

test("history: the same analysis on earlier commits dates findings, with the commit and before/after", () => {
  const { root, git } = gitRepo(shopFiles({ bypass: false }));
  for (const [p, c] of Object.entries(shopFiles({ bypass: true }))) writeFile(root, p, c);
  git("add", ".");
  git("commit", "-qm", "payments total endpoint");
  const state = tempDir();
  const engine = FehmEngine.open(root, { stateDirectory: state });
  const { report } = analyzeDrift({ engine });
  const commits = git("log", "--format=%H").split("\n");
  const h = new HistoryEvaluator(root, state);
  const points = commits.map((c) => h.point(c));
  assert.ok(points.every((p) => !p.error), points.map((p) => p.error).join(";"));
  assert.ok(existsSync(join(state, "drift-history.json")), "commit results are cached");
  const dated = dateFindings(report.findings, pointOf("working-tree", "working tree", "now", undefined, report), points, undefined);
  const bypass = dated.findings.find((f) => f.id === "src/controllers/payments.controller.ts|store:database")!;
  assert.equal(bypass.status, "new");
  assert.equal(bypass.introduced?.commit, commits[0]);
  assert.ok(bypass.introduced?.after?.includes("store:database") && !bypass.introduced.before?.includes("store:database"), "before/after shows the new dependency");
  assert.equal(dated.findings.find((f) => f.id === "src/services/invoices.service.ts|di")?.status, "existing");
  assert.equal(dated.comparison?.kind, "window");
  assert.equal(h.point("--upload-pack=x").error, "unknown revision --upload-pack=x", "revisions are validated before git sees them");

  writeBaseline(state, report);
  const againstBaseline = dateFindings(report.findings, pointOf("working-tree", "wt", "now", undefined, report), [], readBaseline(state));
  assert.ok(againstBaseline.findings.every((f) => f.status === "existing"));
  assert.equal(againstBaseline.comparison?.kind, "baseline");
});

test("drift map: 3.3's validated component view, with the deviation's edge marked", () => {
  const root = makeRepo(shopFiles());
  const engine = FehmEngine.open(root, { stateDirectory: tempDir() });
  const p = new DriftService({ stateDirectory: tempDir(), dryRun: true }).payload(engine);
  assert.ok(p.map.components.layout, p.map.components.note);
  const f = p.findings.find((x) => x.id === "src/controllers/payments.controller.ts|store:database")!;
  assert.ok(f.map.edges.length);
  assert.equal(p.map.components.marks.edges[f.map.edges[0]!], "violation");
  assert.ok(p.map.components.layout!.edges.some((e) => e.id === f.map.edges[0] && e.drift));
  assert.ok(p.map.components.marks.nodes["component:src/controllers"]?.includes(f.id));
});

test("3.5 keeps its code-pattern API (large files included)", () => {
  const big = Array.from({ length: 1100 }, (_, i) => `export const v${i} = ${i};`).join("\n");
  const engine = FehmEngine.open(makeRepo({ "src/big.ts": big, "src/a.ts": "export const a = 1;\n" }), { stateDirectory: tempDir() });
  const signals = qualitySignals(engine, new BriefingFacts(engine));
  const large = signals.find((s) => s.signal === "large-file");
  assert.ok(large && large.evidence[0]!.confidence === "verified" && Array.isArray(large.verification));
});

test("server: page, API, decisions need POST + x-fehm, LLM context stays small, commits and sources are guarded", async () => {
  const { root } = gitRepo(shopFiles());
  const server = await startServer(root, 0, { stateDirectory: tempDir() });
  const port = (server.address() as net.AddressInfo).port;
  const call = (path: string, method = "GET", headers: Record<string, string> = {}, body?: string) =>
    new Promise<{ status: number; body: string }>((ok, fail) => {
      const req = http.request({ host: "127.0.0.1", port, path, method, headers }, (res) => {
        let b = "";
        res.on("data", (c) => (b += c));
        res.on("end", () => ok({ status: res.statusCode ?? 0, body: b }));
      });
      req.on("error", fail);
      if (body) req.write(body);
      req.end();
    });
  try {
    const page = await call("/drift");
    assert.equal(page.status, 200);
    assert.match(page.body, /\/drift\/assets\/drift\/ui\/main\.js/);
    const main = await call("/drift/assets/drift/ui/main.js");
    assert.equal(main.status, 200);
    assert.doesNotMatch(main.body, /^\s*import\s+\S.*from\s+"(node:|typescript)/m, "browser module must not import Node modules");
    assert.equal((await call("/drift/assets/drift/service.js")).status, 404);

    const payload = JSON.parse((await call("/api/drift")).body) as DriftPagePayload;
    assert.ok(payload.findings.length && payload.patterns.length && payload.context.frameworks.length);
    assert.equal((payload as { deps?: unknown }).deps, undefined, "per-unit dependency lists stay out of the page payload");
    assert.equal(payload.history.git, true);

    const id = "src/controllers/payments.controller.ts|store:database";
    const ctx = await call(`/api/drift/finding/context?id=${encodeURIComponent(id)}`);
    assert.equal(ctx.status, 200);
    assert.match(ctx.body, /Common \/ established/);
    assert.match(ctx.body, /16: .*SELECT SUM/);
    assert.ok(ctx.body.length < 6000, "a finding's context, not the repository");

    const body = JSON.stringify({ id, kind: "accepted", reason: "known" });
    assert.equal((await call("/api/drift/decision", "GET")).status, 405);
    assert.equal((await call("/api/drift/decision", "POST", { "content-type": "application/json" }, body)).status, 403, "a cross-site form has no x-fehm header");
    assert.equal((await call("/api/drift/decision", "POST", { "x-fehm": "1" }, JSON.stringify({ id, kind: "accepted", reason: " " }))).status, 409, "a reason is required");
    assert.equal((await call("/api/drift/decision", "POST", { "x-fehm": "1" }, body)).status, 200);
    assert.equal(JSON.parse(readFileSync(join(root, DECISIONS_FILE), "utf8")).findings[id].kind, "accepted");
    const after = JSON.parse((await call("/api/drift")).body) as DriftPagePayload;
    assert.ok(after.decided.some((f) => f.id === id), "picked up without re-indexing");

    assert.equal((await call("/api/drift/commit?ref=--output%3D%2Ftmp%2Fx")).status, 404);
    assert.equal((await call("/api/drift/commit?ref=HEAD")).status, 200);
    assert.equal((await call("/api/drift/source?path=..%2F..%2Fetc%2Fpasswd")).status, 404);
    const point = JSON.parse((await call("/api/drift/history/point?ref=HEAD")).body);
    assert.ok(point.total >= 1 && !point.error);
  } finally {
    server.close();
  }
});

test("dry run never writes", async () => {
  const root = makeRepo(shopFiles());
  const service = new DriftService({ stateDirectory: tempDir(), dryRun: true });
  const engine = FehmEngine.open(root, { stateDirectory: tempDir() });
  assert.ok("error" in service.decideFinding(engine, "src/services/invoices.service.ts|di", "accepted", "x"));
  assert.ok("error" in service.setBaseline(engine));
  assert.ok(!existsSync(join(root, DECISIONS_FILE)));
});
