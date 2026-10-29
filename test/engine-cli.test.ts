import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync } from "node:fs";
import http from "node:http";
import net from "node:net";
import { join } from "node:path";
import { test } from "node:test";
import { FehmEngine } from "../src/engine.js";
import { startServer } from "../src/server.js";
import { commandProvider } from "../src/semantic-summary.js";
import { corpusCopy, makeRepo, REPO_ROOT, tempDir } from "./helpers.js";

const dir = corpusCopy();
const state = tempDir();

function cli(...args: string[]) {
  const r = spawnSync(process.execPath, ["--import", "tsx", join(REPO_ROOT, "src/cli.ts"), ...args, "--state-dir", state], { cwd: REPO_ROOT, encoding: "utf8" });
  return { code: r.status, out: r.stdout, err: r.stderr, json: () => JSON.parse(r.stdout) };
}

test("cli: scan reports full then cache-hit; every command has JSON output", () => {
  assert.equal(cli("scan", dir, "--json").json().report.mode, "full");
  assert.equal(cli("scan", dir, "--json").json().report.mode, "cache-hit");
  assert.ok(cli("stats", "--root", dir, "--json").json().stats.nodes > 50);
  assert.equal(cli("search", "processPayment", "--root", dir, "--json").json()[0].name, "processPayment");
  const packet = cli("context", "how does authentication work", "--budget", "800", "--root", dir, "--json").json();
  assert.ok(packet.budget.usedTokens <= 800);
  assert.equal(cli("focus", "authenticateUser", "--root", dir, "--json").json().status, "found");
  assert.ok(cli("relationships", "validateToken", "--root", dir, "--json").json().result.related.some((r: { relation: string }) => r.relation === "calls"));
  assert.ok(cli("explain", "src/auth/token.ts", "--root", dir, "--json").json().result.excerpt.length > 0);
  assert.equal(cli("flow", "main@src/index.ts", "--root", dir, "--json").json().result.children.length, 2);
  assert.ok(cli("system-map", "--root", dir, "--json").json().entryPoints.includes("src/index.ts"));
  assert.ok(Array.isArray(cli("connectivity", "--root", dir, "--json").json().hubs));
});

test("cli: markdown context, ambiguity and not-found are explicit", () => {
  const md = cli("context", "What calls processPayment?", "--root", dir);
  assert.equal(md.code, 0);
  assert.match(md.out, /^# fehm context: What calls processPayment\?/);
  const missing = cli("focus", "doesNotExist", "--root", dir);
  assert.equal(missing.code, 2);
  assert.match(missing.out, /No symbol or file matches/);
  const bad = cli("context", "x", "--intent", "nonsense", "--root", dir);
  assert.equal(bad.code, 1);
  assert.match(bad.err, /--intent must be one of/);
  assert.equal(cli("bogus").code, 2);
});

test("cli: memory add/list/remove round-trip", () => {
  const added = cli("memory", "add", "Payments", "never", "retry", "charges", "--link", "src/payments/processor.ts", "--root", dir, "--json").json();
  assert.ok(cli("memory", "list", "--root", dir, "--json").json().some((m: { id: string }) => m.id === added.id));
  assert.equal(cli("memory", "remove", added.id, "--root", dir).code, 0);
});

test("engine: ambiguous symbols are reported with candidates, name@path disambiguates", () => {
  const e = FehmEngine.open(makeRepo({ "a.ts": "export function run() {}\n", "b.ts": "export function run() {}\n" }), { stateDirectory: tempDir() });
  const r = e.focus("run");
  assert.equal(r.status, "ambiguous");
  assert.equal(r.status === "ambiguous" && r.candidates.length, 2);
  const one = e.focus("run@b.ts");
  assert.equal(one.status === "found" && one.result.node.id, "function:b.ts#run");
});

test("engine: flow marks cycles instead of looping", () => {
  const e = FehmEngine.open(makeRepo({ "a.ts": "export function ping(n: number): number { return n ? pong(n - 1) : 0; }\nexport function pong(n: number): number { return ping(n); }\n" }), { stateDirectory: tempDir() });
  const r = e.flow("ping", 6);
  assert.equal(r.status, "found");
  if (r.status === "found") assert.equal(r.result.children[0]!.children[0]!.repeated, true);
});

test("engine: normal operation makes no network connections or fetches", () => {
  const originalConnect = net.Socket.prototype.connect;
  const originalFetch = globalThis.fetch;
  let calls = 0;
  net.Socket.prototype.connect = function (...args: unknown[]) {
    calls += 1;
    return originalConnect.apply(this, args as never);
  } as typeof originalConnect;
  globalThis.fetch = (async () => {
    calls += 1;
    throw new Error("network disabled in test");
  }) as typeof fetch;
  try {
    const e = FehmEngine.open(corpusCopy(), { stateDirectory: tempDir() });
    e.search("authentication");
    e.context("how does authentication work", { budget: 2000 });
    e.explain("authenticateUser");
    e.systemMap();
    e.connectivity();
    assert.equal(calls, 0);
  } finally {
    net.Socket.prototype.connect = originalConnect;
    globalThis.fetch = originalFetch;
  }
});

test("semantic summaries: opt-in command provider, cached, fresh until source changes, failures collected", async () => {
  const repo = makeRepo({ "a.ts": "/** Adds. */\nexport function add(a: number, b: number) { return a + b; }\n" });
  const st = tempDir();
  const e = FehmEngine.open(repo, { stateDirectory: st });
  assert.equal(e.explain("add").status === "found" && e.explain("add").status, "found");
  const provider = commandProvider(`${JSON.stringify(process.execPath)} -e "process.stdin.resume();process.stdin.on('end',()=>console.log('Adds two numbers.'))"`, "echo-model");
  const r = await e.summarize(["add", "missing"], provider);
  assert.deepEqual(r.generated, ["function:a.ts#add"]);
  assert.deepEqual(r.unresolvedTargets, ["missing"]);
  const again = await FehmEngine.open(repo, { stateDirectory: st }).summarize(["add"], provider);
  assert.deepEqual(again.reused, ["function:a.ts#add"], "fresh cache entry reused, provider not called");
  const ex = FehmEngine.open(repo, { stateDirectory: st }).explain("add");
  assert.ok(ex.status === "found" && ex.result.semanticSummary?.model === "echo-model");
  const failing = await FehmEngine.open(repo, { stateDirectory: tempDir() }).summarize(["add"], commandProvider(`${JSON.stringify(process.execPath)} -e "process.exit(3)"`));
  assert.equal(failing.failed.length, 1);
  assert.match(failing.failed[0]!.error, /exit 3/);
});

test("server: localhost debug endpoints use the same engine", async () => {
  const server = await startServer(dir, 0, { stateDirectory: tempDir() });
  const port = (server.address() as net.AddressInfo).port;
  const get = (path: string, method = "GET") =>
    new Promise<{ status: number; body: string }>((resolveP, reject) => {
      const req = http.request({ host: "127.0.0.1", port, path, method }, (res) => {
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () => resolveP({ status: res.statusCode ?? 0, body }));
      });
      req.on("error", reject);
      req.end();
    });
  try {
    assert.match((await get("/engine")).body, /Context Engine · fehm/);
    assert.ok(JSON.parse((await get("/api/freshness")).body).fresh);
    assert.ok(JSON.parse((await get("/api/status")).body).stats.files > 10);
    const ctx = JSON.parse((await get("/api/context?q=refund&budget=600")).body);
    assert.ok(ctx.packet.budget.usedTokens <= 600 && ctx.markdown.startsWith("# fehm context"));
    assert.equal((await get("/api/rescan")).status, 405);
    assert.equal(JSON.parse((await get("/api/rescan", "POST")).body).sync.mode, "cache-hit");
    assert.equal((await get("/nope")).status, 404);
  } finally {
    server.close();
  }
});

test("failure handling: unreadable file mid-repo does not break indexing", { skip: process.platform === "win32" || process.getuid?.() === 0 }, () => {
  const repo = makeRepo({ "a.ts": "export function a() { return b(); }\nimport { b } from './b';\n", "b.ts": "export function b() {}\n" });
  chmodSync(join(repo, "b.ts"), 0o000);
  try {
    const e = FehmEngine.open(repo, { stateDirectory: tempDir() });
    assert.ok(e.sync.scanErrors.some((x) => x.path === "b.ts"));
    assert.ok(e.graph.node("function:a.ts#a"));
    assert.match(e.graph.node("file:b.ts")!.evidence.detail!, /not analyzed: unreadable/);
  } finally {
    chmodSync(join(repo, "b.ts"), 0o644);
  }
});
