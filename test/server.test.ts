import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createCockpitServer, sliceGraph } from "../src/server.js";
import { createConfig } from "../src/config.js";
import { buildIndex, writeIndex } from "../src/indexer.js";
import type { CodeGraph } from "../src/model.js";

const execFileAsync = promisify(execFile);

const graph: CodeGraph = {
  schemaVersion: "0.1.0",
  generatedAt: new Date(0).toISOString(),
  repository: { name: "fixture", root: "/tmp/fixture", fingerprint: "fixture" },
  changes: { added: [], changed: [], removed: [], unchanged: [] },
  stats: { nodes: 4, edges: 3, files: 1, symbols: 1, calls: 0, imports: 0, tests: 0, unresolvedCalls: 0 },
  nodes: [
    { id: "repo", kind: "repository", name: "fixture", qualifiedName: "fixture" },
    { id: "dir", kind: "directory", name: "src", qualifiedName: "src", path: "src" },
    { id: "file", kind: "file", name: "main.ts", qualifiedName: "src/main.ts", path: "src/main.ts" },
    { id: "symbol", kind: "function", name: "run", qualifiedName: "src/main.ts#run", path: "src/main.ts" },
  ],
  edges: [
    { id: "one", kind: "contains", source: "repo", target: "dir", evidence: { provenance: "filesystem", confidence: 1 } },
    { id: "two", kind: "contains", source: "dir", target: "file", evidence: { provenance: "filesystem", confidence: 1 } },
    { id: "three", kind: "defines", source: "file", target: "symbol", evidence: { provenance: "ast", confidence: 1 } },
  ],
  fileHashes: {},
};

test("creates semantic graph slices for progressive disclosure", () => {
  const system = sliceGraph(graph, "system");
  assert.deepEqual(system.nodes.map((node) => node.kind), ["repository", "directory"]);
  assert.equal(system.edges.length, 1);
  assert.equal(system.truncated, false, "semantic filtering is not truncation");
  const symbols = sliceGraph(graph, "symbols");
  assert.equal(symbols.nodes.length, 4);
  assert.equal(symbols.edges.length, 3);
  const focused = sliceGraph(graph, "symbols", "run");
  assert.ok(focused.nodes.some((node) => node.name === "run"));
  const dense = { ...graph, edges: Array.from({ length: 701 }, (_, index) => ({ ...graph.edges[0]!, id: String(index) })) };
  assert.equal(sliceGraph(dense, "symbols").truncated, true, "edge caps must be disclosed");
});

test("ships a recognizable local cockpit and context simulator", async () => {
  const root = path.resolve("public");
  const [html, script, styles] = await Promise.all([
    readFile(path.join(root, "index.html"), "utf8"),
    readFile(path.join(root, "app.js"), "utf8"),
    readFile(path.join(root, "styles.css"), "utf8"),
  ]);
  assert.ok(html.includes("fehm Cockpit"));
  assert.ok(html.includes("AI Context"));
  assert.ok(html.includes("System Map"));
  assert.ok(html.includes("Flows"));
  assert.ok(html.includes("Relationships"));
  assert.ok(html.includes("Health"));
  assert.ok(html.includes("Readiness"));
  assert.ok(html.includes("Intelligence"));
  assert.ok(html.includes("Prompt Lab"));
  assert.ok(html.includes("project-selector"));
  assert.ok(script.includes("AI Context Simulator"));
  assert.ok(script.includes("/api/context"));
  assert.ok(script.includes("/api/architecture/propose"));
  assert.ok(script.includes("/api/system-map"));
  assert.ok(script.includes("/api/flow"));
  assert.ok(script.includes("/api/explain"));
  assert.ok(script.includes("/api/prompt/analyze"));
  assert.ok(script.includes("/api/prompt/save"));
  assert.ok(script.includes("/api/relationships"));
  assert.ok(script.includes("/api/search"));
  assert.ok(script.includes("/api/coverage"));
  for (const route of ["/api/dependency-risk", "/api/dead-code", "/api/bug-history", "/api/mutation-testing", "/api/agent/analytics", "/api/ai-evaluations", "/api/cross-repository", "/api/hallucination-verify"]) assert.ok(script.includes(route));
  for (const route of ["/api/architecture-audit", "/api/capabilities", "/api/production-audit", "/api/connectivity", "/api/onboarding"]) assert.ok(script.includes(route));
  assert.ok(script.includes("semanticLevel"));
  assert.ok(script.includes("Prompt dependency graph"));
  assert.ok(script.includes("CODEBASE DNA"));
  assert.ok(script.includes("Index freshness"));
  assert.ok(styles.includes(".graph-stage"));
  const server = createCockpitServer({ graphPath: "/tmp/graph.json" });
  assert.equal(server.listening, false);
  server.close();
});

test("serves real health, intelligence, validation, and error responses", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "fehm-server-"));
  await mkdir(path.join(root, "src"), { recursive: true });
  await writeFile(path.join(root, "package.json"), JSON.stringify({ name: "server-fixture", dependencies: { express: "5.0.0" } }));
  await writeFile(path.join(root, "src", "api.ts"), "export function account() { return true; }\n");
  const config = createConfig(root); const indexed = await buildIndex(config); const graphPath = await writeIndex(indexed, config.outputDirectory);
  try {
    const script = `
      import { createCockpitServer } from "./src/server.ts";
      const server = createCockpitServer({ graphPath: process.env.FEHM_TEST_GRAPH });
      await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
      const base = \`http://127.0.0.1:\${server.address().port}\`; const statuses = {};
      for (const route of ["/api/overview", "/api/health", "/api/dependency-risk", "/api/dead-code", "/api/agent/analytics", "/api/ai-evaluations", "/api/search", "/api/mutation-testing", "/api/not-real"]) statuses[route] = (await fetch(base + route)).status;
      const verified = await fetch(base + "/api/hallucination-verify", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ claims: ["function account exists"] }) });
      const verification = await verified.json(); statuses["claim"] = verified.status; statuses["verified"] = verification.summary.verified;
      await new Promise((resolve) => server.close(resolve)); console.log(JSON.stringify(statuses));
    `;
    const environment = { ...process.env, FEHM_TEST_GRAPH: graphPath }; delete environment.NODE_TEST_CONTEXT;
    let output;
    try { output = await execFileAsync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", script], { cwd: process.cwd(), env: environment, timeout: 30_000 }); }
    catch (error) {
      if (String((error as { stderr?: string }).stderr ?? error).includes("listen EPERM")) { context.skip("test-runner sandbox does not permit listeners; direct API smoke test covers this path"); return; }
      throw error;
    }
    const statuses = JSON.parse(output.stdout.trim()) as Record<string, number>;
    for (const route of ["/api/overview", "/api/health", "/api/dependency-risk", "/api/dead-code", "/api/agent/analytics", "/api/ai-evaluations"]) assert.equal(statuses[route], 200, route);
    assert.equal(statuses["/api/search"], 400); assert.equal(statuses["/api/mutation-testing"], 404); assert.equal(statuses["/api/not-real"], 404);
    assert.equal(statuses.claim, 200); assert.equal(statuses.verified, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
