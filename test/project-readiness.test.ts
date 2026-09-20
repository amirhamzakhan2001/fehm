import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createConfig } from "../src/config.js";
import { buildIndex } from "../src/indexer.js";
import {
  analyzeGraphConnectivity,
  assessEngineeringCapabilities,
  auditArchitectureIntent,
  auditProductionReadiness,
  buildOnboardingDocument,
  exportObsidianVault,
  writeOnboardingDocument,
} from "../src/project-readiness.js";

async function fixture(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "fehm-readiness-"));
  await mkdir(path.join(root, "src", "api"), { recursive: true });
  await mkdir(path.join(root, "test"), { recursive: true });
  await mkdir(path.join(root, ".github", "workflows"), { recursive: true });
  await mkdir(path.join(root, "docs", "adr"), { recursive: true });
  await writeFile(path.join(root, "package.json"), JSON.stringify({ name: "readiness-fixture", scripts: { test: "node --test" }, dependencies: { express: "latest" } }));
  await writeFile(path.join(root, "tsconfig.json"), JSON.stringify({ compilerOptions: { strict: true } }));
  await writeFile(path.join(root, "src", "api", "server.ts"), [
    "declare const app: { get(path: string, handler: unknown): void };",
    "export async function health(): Promise<string> { return 'ready'; }",
    "app.get('/health', health);",
  ].join("\n"));
  await writeFile(path.join(root, "src", "isolated.ts"), "export const isolated = 1;\n");
  await writeFile(path.join(root, "test", "server.test.ts"), "import { strict as assert } from 'node:assert';\nimport { health } from '../src/api/server.js';\nexport async function check(): Promise<void> { assert.equal(await health(), 'ready'); }\n");
  await writeFile(path.join(root, ".github", "workflows", "ci.yml"), "name: CI\non: [push]\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - run: npm test\n");
  await writeFile(path.join(root, "docs", "adr", "0001-local.md"), "# Decision\nUse a local graph because privacy is an invariant and remote upload is forbidden. Trade-off: local compute.\n");
  await writeFile(path.join(root, "ARCHITECTURE.md"), [
    "# Architecture",
    "The api layer owns transport. New routes belong in src/api.",
    "Tests may import API code. Production code must never import tests.",
    "Critical flow: request enters a route, is validated, then returns a response.",
    "Invariant: source stays local and secrets must never be written to reports.",
    "If a task conflicts with a boundary, STOP and ask the owner with affected files and the smallest compliant fix.",
  ].join("\n\n"));
  await writeFile(path.join(root, "CODEOWNERS"), "src/api/ @platform\n");
  return root;
}

test("audits architecture intent and project-specific capabilities", async () => {
  const root = await fixture();
  try {
    const graph = await buildIndex(createConfig(root));
    const architecture = await auditArchitectureIntent(graph);
    assert.equal(architecture.questions.length, 8);
    assert.ok(architecture.questions.some((item) => item.id === "stop-and-ask" && item.status === "present"));
    assert.ok(architecture.questions.some((item) => item.id === "rationale" && item.status === "present"));
    const capabilities = await assessEngineeringCapabilities(graph);
    assert.equal(capabilities.capabilities.length, 15);
    assert.notEqual(capabilities.capabilities.find((item) => item.id === "api-design")?.status, "missing");
    assert.notEqual(capabilities.capabilities.find((item) => item.id === "testing")?.status, "missing");
    assert.equal(capabilities.capabilities.find((item) => item.id === "api-gateways")?.status, "missing");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("generates durable onboarding and an Obsidian-compatible linked vault", async () => {
  const root = await fixture();
  try {
    const graph = await buildIndex(createConfig(root));
    const document = await buildOnboardingDocument(graph);
    assert.match(document.markdown, /The eight architecture answers/);
    assert.match(document.markdown, /Working safely with an AI coding agent/);
    const saved = await writeOnboardingDocument(graph);
    assert.match(await readFile(saved.path, "utf8"), /Codebase Onboarding/);
    const vault = await exportObsidianVault(graph, path.join(root, ".fehm", "vault"));
    assert.ok(vault.notes >= 5);
    assert.match(await readFile(path.join(vault.path, "fehm.md"), "utf8"), /\[\[Onboarding\]\]/);
    assert.ok((await readdir(path.join(vault.path, "Files"))).length >= 2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("reports honest graph connectivity and production-hardening evidence", async () => {
  const root = await fixture();
  try {
    const graph = await buildIndex(createConfig(root));
    const connectivity = analyzeGraphConnectivity(graph);
    assert.ok(connectivity.components >= 1);
    assert.match(connectivity.note, /never invents edges/);
    const readiness = await auditProductionReadiness(graph);
    assert.equal(readiness.findings.length, 13);
    assert.match(readiness.conclusion, /not proof that AI generated/);
    assert.notEqual(readiness.findings.find((item) => item.id === "release-pipeline")?.status, "missing");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
