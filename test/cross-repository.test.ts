import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createConfig } from "../src/config.js";
import { buildCrossRepositoryGraph } from "../src/cross-repository.js";
import { buildIndex, writeIndex } from "../src/indexer.js";
import { createCockpitServer } from "../src/server.js";

async function repository(root: string, manifest: object, source: string) {
  await mkdir(path.join(root, "src"), { recursive: true });
  await writeFile(path.join(root, "package.json"), JSON.stringify(manifest));
  await writeFile(path.join(root, "src", "index.ts"), source);
  const config = createConfig(root); const graph = await buildIndex(config); const graphPath = await writeIndex(graph, config.outputDirectory);
  return { graph, graphPath };
}

test("connects package and API contracts across repositories and reports conflicts", async () => {
  const parent = await mkdtemp(path.join(os.tmpdir(), "fehm-cross-"));
  const providerRoot = path.join(parent, "accounts"); const consumerRoot = path.join(parent, "web");
  try {
    const provider = await repository(providerRoot, { name: "@acme/accounts", version: "2.1.0" }, [
      "declare const app: { get(path: string, callback: (req: any, res: any) => void): void };",
      "app.get('/api/accounts/:id', (_req, res) => res.json({ account: true }));",
      "app.get('/api/admin/:id', (_req, res) => res.json({ admin: true }));",
    ].join("\n"));
    const consumer = await repository(consumerRoot, {
      name: "@acme/web", version: "1.0.0",
      dependencies: { "@acme/accounts": "^1.0.0", "@acme/missing": "workspace:*" },
    }, [
      "import '@acme/accounts';",
      "export function loadAccount() { return fetch('/api/accounts/42'); }",
      "export function updateAdmin() { return fetch('/api/admin/42', { method: 'POST' }); }",
    ].join("\n"));
    const report = await buildCrossRepositoryGraph([provider.graph, consumer.graph]);
    assert.equal(report.summary.repositories, 2);
    assert.equal(report.summary.packageDependencies, 1);
    assert.equal(report.summary.apiConnections, 1);
    assert.ok(report.edges.some((item) => item.relation === "package-dependency" && item.evidence.some((evidence) => evidence.includes("@acme/accounts@^1.0.0"))));
    assert.ok(report.edges.some((item) => item.relation === "api-consumer" && item.evidence.some((evidence) => evidence.includes("/api/accounts/42"))));
    assert.ok(report.conflicts.some((item) => item.kind === "version-mismatch"));
    assert.ok(report.conflicts.some((item) => item.kind === "unresolved-workspace-dependency"));
    assert.ok(report.conflicts.some((item) => item.kind === "api-method-mismatch"));
    const persisted = JSON.parse(await readFile(path.join(providerRoot, ".fehm", "cross-repository", "latest.json"), "utf8")) as { summary: { repositories: number } };
    assert.equal(persisted.summary.repositories, 2);

    const server = createCockpitServer({ projects: [{ id: "accounts", graphPath: provider.graphPath }, { id: "web", graphPath: consumer.graphPath }] });
    assert.equal(typeof server.listen, "function");
    assert.ok((await readFile(path.join(process.cwd(), "src", "server.ts"), "utf8")).includes("/api/cross-repository"));
  } finally { await rm(parent, { recursive: true, force: true }); }
});

test("rejects single or duplicate repository inputs", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "fehm-cross-invalid-"));
  try {
    const value = await repository(root, { name: "single", version: "1.0.0" }, "export const value = 1;\n");
    await assert.rejects(buildCrossRepositoryGraph([value.graph]), /at least two/);
    await assert.rejects(buildCrossRepositoryGraph([value.graph, value.graph]), /distinct repository roots/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
