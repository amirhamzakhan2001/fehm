import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createConfig } from "../dist/config.js";
import { buildIndex, writeIndex } from "../dist/indexer.js";
import { createCockpitServer } from "../dist/server.js";

const root = await mkdtemp(path.join(os.tmpdir(), "fehm-smoke-"));
let server;

try {
  await mkdir(path.join(root, "src"), { recursive: true });
  await writeFile(path.join(root, "package.json"), JSON.stringify({ name: "deployment-smoke" }));
  await writeFile(path.join(root, "src", "main.ts"), "export function ready() { return true; }\n");
  const config = createConfig(root);
  const graphPath = await writeIndex(await buildIndex(config), config.outputDirectory);
  server = createCockpitServer({ graphPath, authToken: "smoke-secret", maxBodyBytes: 1_024 });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const base = `http://127.0.0.1:${address.port}`;
  const authorization = { authorization: "Bearer smoke-secret" };

  const live = await fetch(`${base}/api/live`);
  assert.equal(live.status, 200);
  assert.equal((await live.json()).status, "ok");

  const ready = await fetch(`${base}/api/ready`);
  assert.equal(ready.status, 200);
  assert.equal((await ready.json()).status, "ready");

  assert.equal((await fetch(`${base}/api/overview`)).status, 401);
  const overview = await fetch(`${base}/api/overview`, { headers: authorization });
  assert.equal(overview.status, 200);
  assert.equal(overview.headers.get("x-content-type-options"), "nosniff");
  assert.ok(overview.headers.get("x-request-id"));

  for (const route of ["/api/architecture-audit", "/api/capabilities", "/api/production-audit", "/api/connectivity", "/api/onboarding", "/api/practices"]) {
    const response = await fetch(`${base}${route}`, { headers: authorization });
    assert.equal(response.status, 200, route);
    assert.equal(response.headers.get("content-type"), "application/json; charset=utf-8", route);
  }

  const malformed = await fetch(`${base}/api/context`, {
    method: "POST",
    headers: { ...authorization, "content-type": "application/json" },
    body: "{",
  });
  assert.equal(malformed.status, 400);
  for (const value of [null, [], "query", 42]) {
    const response = await fetch(`${base}/api/context`, {
      method: "POST",
      headers: { ...authorization, "content-type": "application/json" },
      body: JSON.stringify(value),
    });
    assert.equal(response.status, 400, "request bodies must be JSON objects");
  }

  const wrongType = await fetch(`${base}/api/context`, {
    method: "POST",
    headers: authorization,
    body: "{}",
  });
  assert.equal(wrongType.status, 415);
  for (const [route, input] of [["/api/context", { query: 42 }], ["/api/prompt/analyze", { prompt: 42 }], ["/api/checkpoint", { name: [] }]]) {
    const response = await fetch(base + route, { method: "POST", headers: { ...authorization, "content-type": "application/json" }, body: JSON.stringify(input) });
    assert.equal(response.status, 400, route);
  }

  const oversized = await fetch(`${base}/api/context`, {
    method: "POST",
    headers: { ...authorization, "content-type": "application/json" },
    body: JSON.stringify({ query: "x".repeat(2_000) }),
  });
  assert.equal(oversized.status, 413);
  assert.equal((await fetch(`${base}/api/overview?project=missing`, { headers: authorization })).status, 404);
  const savedGraph = await readFile(graphPath, "utf8");
  await writeFile(graphPath, "{}");
  assert.equal((await fetch(`${base}/api/ready`)).status, 503, "invalid graph shape is not ready");
  const movedGraph = JSON.parse(savedGraph);
  movedGraph.repository.root = path.join(root, "missing-repository");
  await writeFile(graphPath, JSON.stringify(movedGraph));
  assert.equal((await fetch(`${base}/api/ready`)).status, 503, "a graph pointing to a moved repository is not ready");
  await writeFile(graphPath, savedGraph);
  assert.equal((await fetch(`${base}/api/ready`)).status, 200);
  console.log("Deployment smoke passed: liveness, readiness, auth, readiness intelligence, headers, validation, limits, and project routing.");
} finally {
  if (server) await new Promise((resolve) => server.close(resolve));
  await rm(root, { recursive: true, force: true });
}
