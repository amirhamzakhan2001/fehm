import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

test("MCP survives malformed requests and serves tools and graph resources over stdio", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "fehm-mcp-"));
  try {
    const graphPath = path.join(root, "graph.json");
    const graph = { schemaVersion: "0.1.0", repository: { root, name: "mcp", fingerprint: "fixture" }, nodes: [
      { id: "alpha", kind: "function", name: "alpha", qualifiedName: "alpha" },
      { id: "beta", kind: "function", name: "beta", qualifiedName: "beta" },
    ], edges: [{ id: "ab", source: "alpha", target: "beta", kind: "calls", evidence: { provenance: "ast", confidence: 1 } }], fileHashes: {}, stats: {}, changes: {} };
    await writeFile(graphPath, JSON.stringify(graph));
    const requests = [
      "{", "null", "[]", "42", '{"jsonrpc":"2.0","method":42,"id":1}',
      JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
      ...[
        { id: 2, method: "initialize", params: { protocolVersion: "2024-11-05" } },
        { id: 3, method: "tools/list" },
        { id: 4, method: "tools/call", params: { name: "fehm_focus", arguments: [] } },
        { id: 5, method: "tools/call", params: { name: "fehm_focus", arguments: { query: "alpha", depth: 0 } } },
        { id: 6, method: "resources/read", params: { uri: "fehm://graph" } },
        { id: 7, method: "ping" },
        { id: 8, method: "tools/call", params: { name: "fehm_practices", arguments: {} } },
      ].map((request) => JSON.stringify({ jsonrpc: "2.0", ...request })),
    ];
    const output = await new Promise<string>((resolve, reject) => {
      const child = spawn(process.execPath, ["--import", "tsx", "src/cli.ts", "mcp", graphPath], { cwd: process.cwd(), timeout: 30_000 });
      let stdout = "";
      let stderr = "";
      child.stdout.setEncoding("utf8").on("data", (chunk) => { stdout += chunk; });
      child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; });
      child.on("error", reject);
      child.on("close", (code) => code === 0 ? resolve(stdout) : reject(new Error(`MCP exited ${code}: ${stderr}`)));
      child.stdin.end(`${requests.join("\n")}\n`);
    });
    const responses = output.trim().split("\n").map((line) => JSON.parse(line));
    assert.equal(responses.length, requests.length - 1, "notifications do not receive responses");
    assert.equal(responses[0].error.code, -32700);
    for (const response of responses.slice(1, 5)) assert.equal(response.error.code, -32600);
    assert.equal(responses.find((response) => response.id === 2).result.serverInfo.name, "fehm");
    assert.ok(responses.find((response) => response.id === 3).result.tools.some((tool: { name: string }) => tool.name === "fehm_context"));
    assert.equal(responses.find((response) => response.id === 4).error.code, -32602);
    const focus = JSON.parse(responses.find((response) => response.id === 5).result.content[0].text);
    assert.deepEqual(focus.nodes.map((node: { id: string }) => node.id), ["alpha"]);
    assert.deepEqual(JSON.parse(responses.find((response) => response.id === 6).result.contents[0].text), graph);
    assert.deepEqual(responses.find((response) => response.id === 7).result, {});
    const practices = JSON.parse(responses.find((response) => response.id === 8).result.content[0].text);
    assert.equal(practices.policySource, "advisory");
    assert.equal(practices.findings.length, 31);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
