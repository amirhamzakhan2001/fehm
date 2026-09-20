import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { approveArchitecture, inferArchitecture, readArchitectureState, writeArchitectureProposal } from "../src/architecture.js";
import { createConfig } from "../src/config.js";
import { buildIndex, writeIndex } from "../src/indexer.js";

test("infers a reviewable architecture and only enforces it after approval", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "fehm-architecture-"));
  try {
    await mkdir(path.join(root, "src", "components"), { recursive: true });
    await mkdir(path.join(root, "src", "db"), { recursive: true });
    await writeFile(path.join(root, "src", "db", "client.ts"), "export const database = { name: 'local' };\n");
    await writeFile(path.join(root, "src", "components", "profile.ts"), "import { database } from '../db/client.js';\nexport const profile = database.name;\n");
    await writeFile(path.join(root, "package.json"), JSON.stringify({ dependencies: { react: "19.0.0", pg: "8.0.0" } }));
    const config = createConfig(root);
    const graph = await buildIndex(config);
    await writeIndex(graph, config.outputDirectory);

    const inferred = await inferArchitecture(graph);
    assert.equal(inferred.status, "proposed");
    assert.ok(inferred.config.layers.some((layer) => layer.name === "frontend"));
    assert.ok(inferred.config.layers.some((layer) => layer.name === "database"));
    assert.ok(inferred.detectedTechnologies.includes("React"));
    assert.equal((await readArchitectureState(graph)).contract, undefined);

    await writeArchitectureProposal(graph);
    const approved = await approveArchitecture(graph);
    assert.equal(approved.contract.approval?.status, "approved");
    assert.ok((await readArchitectureState(graph)).contract);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
