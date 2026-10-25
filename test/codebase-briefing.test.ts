import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import http from "node:http";
import type net from "node:net";
import { join } from "node:path";
import { test } from "node:test";
import { estimateTokens } from "../src/compression.js";
import { buildCodebaseBriefing, withFreshness } from "../src/codebase-briefing/briefing.js";
import { humanizeModule, moduleLabels } from "../src/codebase-briefing/builder.js";
import { stripRegexLiterals, stripStrings } from "../src/codebase-briefing/facts.js";
import { renderBriefing } from "../src/codebase-briefing/render.js";
import { SECTION_IDS, type Block, type BriefingSection, type CodebaseBriefing, type SectionId } from "../src/codebase-briefing/types.js";
import { FehmEngine } from "../src/engine.js";
import { startServer } from "../src/server.js";
import { corpusCopy, makeRepo, REPO_ROOT, tempDir, writeFile } from "./helpers.js";

function brief(root: string, state = tempDir()): { b: CodebaseBriefing; engine: FehmEngine; state: string } {
  const engine = FehmEngine.open(root, { stateDirectory: state });
  return { b: buildCodebaseBriefing(engine, { stateDirectory: state }), engine, state };
}
const sec = (b: CodebaseBriefing, id: SectionId): BriefingSection => b.sections.find((s) => s.id === id)!;
const blocks = <T extends Block["type"]>(s: BriefingSection, type: T): Extract<Block, { type: T }>[] => s.blocks.filter((x): x is Extract<Block, { type: T }> => x.type === type);
const allText = (b: CodebaseBriefing): string => JSON.stringify(b.sections.map((s) => [s.summary, s.claims.map((c) => c.text), s.blocks]));

test("known repository: entry points, API, flows, data and architecture come from the index", () => {
  const { b } = brief(corpusCopy());
  assert.equal(b.schemaVersion, "1.0");
  assert.deepEqual(b.sections.map((s) => s.id), [...SECTION_IDS]);
  assert.equal(b.archetype.primary, "api");

  const http = blocks(sec(b, "entryPoints"), "groups")[0]!.groups.find((g) => g.title === "HTTP")!;
  const login = http.items.find((i) => i.title === "POST /login")!;
  assert.ok(login, "POST /login detected");
  assert.equal(login.nodeId, "function:src/api/routes.ts#loginRoute", "handler resolved through the enclosing function's calls");

  const apiRows = blocks(sec(b, "api"), "facts")[0]!.rows;
  assert.equal(apiRows.find((r) => r.label === "Framework")?.value, "Express");
  const fw = sec(b, "api").claims.find((c) => c.text.includes("Express"))!;
  assert.equal(fw.state, "confirmed", "an observed import edge confirms the framework");

  const flows = blocks(sec(b, "dataFlows"), "flow");
  const loginFlow = flows.find((f) => f.title.includes("/login"))!;
  assert.deepEqual(loginFlow.steps.slice(1, 4).map((s) => s.name), ["loginRoute", "authenticateUser", "loadUser"]);
  assert.match(loginFlow.steps.at(-1)!.name, /SQL: users/);

  const tables = blocks(sec(b, "database"), "list").find((l) => l.title?.startsWith("Tables"))!;
  assert.deepEqual(tables.items.map((i) => i.title).sort(), ["payments", "users"]);

  const top = blocks(sec(b, "components"), "ranking")[0]!.rows[0]!;
  assert.equal(top.name, "src/db/connection.ts", "the most depended-upon file ranks first");
  assert.equal(sec(b, "cheatSheet").blocks.length, 2);
});

test("missing deployment is UNKNOWN — a cloud SDK never implies a hosting provider", () => {
  const root = makeRepo({
    "package.json": JSON.stringify({ name: "svc", dependencies: { "@aws-sdk/client-s3": "3.0.0" } }),
    "src/upload.ts": `import { S3Client } from "@aws-sdk/client-s3";\nexport function upload() { return new S3Client({}); }\n`,
  });
  const { b } = brief(root);
  const infra = sec(b, "infrastructure");
  assert.equal(infra.state, "unknown");
  assert.ok(infra.unknowns.some((u) => /Deployment target is unknown/.test(u)));
  const cloud = infra.claims.find((c) => /AWS SDK/.test(c.text))!;
  assert.match(cloud.text, /deployment target is unknown/);
  assert.notEqual(cloud.state, "confirmed");
  assert.doesNotMatch(allText(b), /runs on AWS|deployed (to|on) AWS/i);
});

test("declared deployment config is confirmed as a declaration, with its limitation", () => {
  const root = makeRepo({
    "package.json": JSON.stringify({ name: "svc" }),
    "fly.toml": `app = "svc"\n`,
    Dockerfile: "FROM node:20\nEXPOSE 3000\nCMD [\"node\", \"index.js\"]\n",
    ".github/workflows/ci.yml": "name: CI\non:\n  push:\n  pull_request:\njobs:\n  t:\n    runs-on: ubuntu-latest\n    steps:\n      - run: npm test\n",
    "src/index.ts": "export const x = 1;\n",
  });
  const infra = sec(brief(root).b, "infrastructure");
  const target = infra.claims.find((c) => c.text.startsWith("Declared target"))!;
  assert.match(target.text, /Fly\.io/);
  assert.equal(target.basis, "declared");
  assert.match(target.note ?? "", /not inspected/);
  assert.ok(infra.claims.some((c) => /CI workflow .*ci\.yml runs on push, pull_request/.test(c.text)));
});

test("stale index: changed files mark evidence and dependent sections stale", () => {
  const root = corpusCopy();
  const { b, engine } = brief(root);
  assert.equal(withFreshness(b, engine).freshness.fresh, true);
  writeFile(root, "src/db/users.ts", "export const changed = true;\n");
  const stale = withFreshness(b, engine);
  assert.equal(stale.freshness.fresh, false);
  assert.deepEqual(stale.freshness.changed.modified, ["src/db/users.ts"]);
  assert.ok(stale.freshness.affectedSections.includes("database"));
  const db = stale.sections.find((s) => s.id === "database")!;
  assert.equal(db.stale, true);
  assert.ok(db.claims.some((c) => c.evidence.some((e) => e.path === "src/db/users.ts" && e.stale)));
  assert.match(renderBriefing(stale).text, /working tree changed since indexing/);
});

test("inferred claims stay LIKELY: architecture style and features are never CONFIRMED", () => {
  const { b } = brief(corpusCopy());
  const style = sec(b, "architecture").claims.find((c) => /monolith|modular/.test(c.text))!;
  assert.equal(style.basis, "inferred");
  assert.notEqual(style.state, "confirmed");
  for (const c of sec(b, "features").claims) assert.ok(c.state !== "confirmed", c.text);
  for (const s of b.sections) for (const c of s.claims) if (c.state === "unknown") assert.equal(c.confidence, 0);
});

test("no security findings are never presented as 'secure'", () => {
  const root = makeRepo({ "package.json": JSON.stringify({ name: "calc" }), "src/add.ts": "export function add(a: number, b: number) { return a + b; }\n" });
  const s = sec(brief(root).b, "security");
  const text = blocks(s, "text").map((t) => t.text).join(" ");
  assert.match(text, /No supported security findings were detected by the available static checks/);
  assert.match(text, /not evidence that the code is secure/);
});

test("pattern checks ignore regex literals, method calls named exec and lower-case prose", () => {
  assert.equal(stripStrings(stripRegexLiterals(`["scheduled", /\\bcron\\.schedule\\(/],`)), `["", /re/],`);
  const root = makeRepo({
    "package.json": JSON.stringify({ name: "p" }),
    "src/parse.ts": `const RE = /\\beval\\(|exec\\(/;\nexport function parse(s: string) { const m = RE.exec(s); return m ? "update failed from cache" : "SELECT nothing"; }\n`,
    "src/run.ts": `import { execSync } from "node:child_process";\nexport function run() { return execSync("ls"); }\n`,
  });
  const { b } = brief(root);
  const sinks = sec(b, "security").claims.filter((c) => /site/.test(c.text));
  assert.equal(sinks.length, 1, JSON.stringify(sinks.map((c) => c.text)));
  assert.equal(sinks[0]!.evidence[0]!.path, "src/run.ts");
  assert.ok(!blocks(sec(b, "database"), "list").some((l) => l.title?.startsWith("Tables")), "prose is not SQL");
});

test("CLI dispatch: commands found, shared helper calls are not mistaken for handlers", () => {
  const root = makeRepo({
    "package.json": JSON.stringify({ name: "tool", bin: { tool: "./dist/cli.js" } }),
    "src/cli.ts": `import { scan, stats, open } from "./ops.js";
export function main(argv: string[]) {
  switch (argv[0]) {
    case "scan": { const e = open(); return scan(e); }
    case "stats": { const e = open(); return stats(e); }
    case "other": { const e = open(); return e; }
  }
}
main(process.argv.slice(2));
`,
    "src/ops.ts": "export function open() { return {}; }\nexport function scan(e: object) { return e; }\nexport function stats(e: object) { return e; }\n",
  });
  const { b } = brief(root);
  assert.equal(b.archetype.primary, "cli");
  const cli = blocks(sec(b, "entryPoints"), "groups")[0]!.groups.find((g) => g.title === "CLI")!;
  const byName = new Map(cli.items.map((i) => [i.title, i]));
  assert.equal(byName.get("tool")?.badge, "bin");
  assert.equal(byName.get("scan")?.nodeId, "function:src/ops.ts#scan");
  assert.equal(byName.get("stats")?.nodeId, "function:src/ops.ts#stats");
});

test("bounded output: depth budgets hold and nothing reads source beyond the index", () => {
  const files: Record<string, string> = { "package.json": JSON.stringify({ name: "big", description: "A large synthetic repository." }) };
  for (let i = 0; i < 300; i += 1) files[`src/m${i % 12}/f${i}.ts`] = `import { f${(i + 1) % 300} } from "../m${((i + 1) % 300) % 12}/f${(i + 1) % 300}.js";\n/** Function ${i}. */\nexport function f${i}() { return f${(i + 1) % 300}; }\n`;
  const { b } = brief(makeRepo(files));
  const minimal = renderBriefing(b, { depth: "minimal" });
  assert.ok(minimal.tokens <= 1500, `minimal ${minimal.tokens}`);
  const standard = renderBriefing(b, { depth: "standard" });
  assert.ok(standard.tokens <= 6000, `standard ${standard.tokens}`);
  assert.equal(standard.tokens, estimateTokens(standard.text));
  const tight = renderBriefing(b, { depth: "deep", tokenBudget: 800 });
  assert.ok(tight.tokens <= 900 && tight.omitted.length > 0);
  assert.match(tight.text, /Omitted to fit 800 tokens/);
  for (const s of b.sections) for (const blk of s.blocks) if (blk.type === "list") assert.ok(blk.items.length <= 60);
});

test("incremental: a docs edit rebuilds only overview and cheat sheet; source edits keep config-only sections", () => {
  const root = corpusCopy();
  writeFile(root, "README.md", "# Shop\n\nA demo shop backend.\n");
  const state = tempDir();
  const first = brief(root, state).b;
  assert.equal(first.cache.rebuilt.length, 18);
  assert.equal(brief(root, state).b.cache.reused.length, 18, "unchanged repository: everything reused");

  writeFile(root, "README.md", "# Shop\n\nA demo shop backend service.\n");
  const docs = brief(root, state).b;
  assert.deepEqual([...docs.cache.rebuilt].sort(), ["cheatSheet", "overview"]);
  assert.equal(sec(docs, "overview").summary, "A demo shop backend service.");

  writeFile(root, "src/auth/token.ts", "export function signToken() { return 't'; }\n");
  const src = brief(root, state).b;
  assert.ok(src.cache.rebuilt.includes("security") && src.cache.rebuilt.includes("api"));
  assert.ok(src.cache.reused.includes("infrastructure"), "infrastructure reads only config and manifests");
});

test("module labels are unique and readable", () => {
  assert.equal(humanizeModule("src/skill*"), "Skill");
  assert.equal(humanizeModule("src/util"), "Util");
  assert.equal(humanizeModule("src/visualization/graph/ui/main"), "Graph UI main");
  const labels = moduleLabels(["src/graph", "src/visualization/graph"]);
  assert.notEqual(labels.get("src/graph"), labels.get("src/visualization/graph"));
});

test("fehm brief works without any API key or model", () => {
  const root = corpusCopy();
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (/API_KEY|OPENAI|ANTHROPIC/.test(k)) delete env[k];
  const run = (...args: string[]) => spawnSync(process.execPath, ["--import", "tsx", join(REPO_ROOT, "src/cli.ts"), "brief", "--root", root, "--state-dir", tempDir(), ...args], { cwd: REPO_ROOT, encoding: "utf8", env });
  const md = run("--depth", "minimal");
  assert.equal(md.status, 0, md.stderr);
  assert.match(md.stdout, /# corpus-shop — Codebase briefing/);
  assert.match(md.stdout, /## Meeting cheat sheet/);
  const json = run("--json");
  assert.equal(JSON.parse(json.stdout).mode, "deterministic");
  const bad = run("--sections", "nope");
  assert.notEqual(bad.status, 0);
});

test("server: /explain page, briefing API, flows, ask and a strict asset allowlist", async () => {
  const root = corpusCopy();
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
    const page = await get("/explain");
    assert.equal(page.status, 200);
    assert.match(String(page.headers["content-security-policy"]), /script-src 'self'/);
    assert.match(page.body, /\/explain\/assets\/briefing\/ui\/main\.js/);
    const main = await get("/explain/assets/briefing/ui/main.js");
    assert.equal(main.status, 200);
    assert.doesNotMatch(main.body, /^\s*import\s+\S.*from\s+"(node:|typescript)/m, "browser module imports no Node code");
    assert.match(main.body, /from "\.\.\/\.\.\/graph\/ui\/dom\.js"/);
    assert.equal((await get("/explain/assets/graph/ui/dom.js")).status, 200);
    for (const bad of ["graph/service.js", "graph/ui/renderer.js", "briefing/service.js", "../server.js", "codebase-briefing/facts.js"]) assert.equal((await get(`/explain/assets/${bad}`)).status, 404, bad);

    const b = JSON.parse((await get("/api/briefing")).body) as CodebaseBriefing;
    assert.equal(b.sections.length, 18);
    assert.equal(b.freshness.fresh, true);
    const handler = "function:src/api/routes.ts#loginRoute";
    const flow = JSON.parse((await get(`/api/briefing/flow?id=${encodeURIComponent(handler)}`)).body);
    assert.equal(flow.root.name, "loginRoute");
    assert.ok(flow.root.children.some((c: { name: string }) => c.name === "authenticateUser"));
    const ask = JSON.parse((await get("/api/briefing/ask?q=authenticate%20user")).body);
    assert.ok(ask.hits.some((h: { name: string }) => h.name === "authenticateUser"));
    const md = await get("/api/briefing/markdown?depth=minimal");
    assert.match(String(md.headers["content-type"]), /markdown/);
    assert.equal((await get("/api/briefing/refresh")).status, 405);
    writeFile(root, "src/db/users.ts", "export const x = 1;\n");
    const fr = JSON.parse((await get("/api/briefing/freshness")).body);
    assert.equal(fr.fresh, false);
    const refreshed = JSON.parse((await get("/api/briefing/refresh", "POST")).body) as CodebaseBriefing;
    assert.equal(refreshed.freshness.fresh, true);
    assert.ok(refreshed.cache.reused.includes("infrastructure"));
    assert.match((await get("/graph")).body, /href="\/#\/explain"/, "graph page links to the briefing");
  } finally {
    server.close();
  }
});
