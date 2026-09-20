import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createConfig } from "../src/config.js";
import { buildIndex } from "../src/indexer.js";
import {
  buildSystemMap,
  explainLikeSenior,
  exploreExecutionFlow,
} from "../src/system-map.js";

async function createSystemFixture(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "fehm-system-map-"));
  await mkdir(path.join(root, "src", "services"), { recursive: true });
  await mkdir(path.join(root, "test"), { recursive: true });
  await writeFile(path.join(root, "package.json"), JSON.stringify({
    name: "checkout-fixture",
    bin: { checkout: "./dist/cli.js" },
    dependencies: { express: "latest", pg: "latest" },
  }));
  await writeFile(path.join(root, "src", "services", "checkout.ts"), [
    "export function chargeCard(total: number): string {",
    "  return 'charged:' + total;",
    "}",
    "export function checkout(total: number): string {",
    "  if (total <= 0) throw new Error('invalid total');",
    "  return chargeCard(total);",
    "}",
  ].join("\n"));
  await writeFile(path.join(root, "src", "server.ts"), [
    "import { checkout } from './services/checkout.js';",
    "declare const app: { post(path: string, handler: unknown): void };",
    "export function startServer(): void {",
    "  app.post('/checkout', checkout);",
    "}",
  ].join("\n"));
  await writeFile(path.join(root, "src", "cli.ts"), [
    "import { checkout } from './services/checkout.js';",
    "export function main(): string {",
    "  return checkout(42);",
    "}",
    "main();",
  ].join("\n"));
  await writeFile(path.join(root, "src", "example.ts"), [
    "export const documentation = \"app.post('/phantom', handler)\";",
    "// router.get('/also-phantom', handler);",
  ].join("\n"));
  await writeFile(path.join(root, "test", "checkout.test.ts"), [
    "import { checkout } from '../src/services/checkout.js';",
    "export function verifiesCheckout(): boolean {",
    "  return checkout(10) === 'charged:10';",
    "}",
  ].join("\n"));
  return root;
}

test("builds codebase DNA, entry points, prophecy, onboarding, and uncertainty", async () => {
  const root = await createSystemFixture();
  try {
    const graph = await buildIndex(createConfig(root));
    const report = await buildSystemMap(graph);
    assert.ok(report.dna.technologies.includes("Express"));
    assert.ok(report.dna.technologies.includes("PostgreSQL"));
    assert.ok(report.entryPoints.some((entry) => entry.kind === "http-route" && entry.label === "POST /checkout"));
    assert.ok(!report.entryPoints.some((entry) => entry.label.includes("phantom")));
    assert.ok(report.entryPoints.some((entry) => entry.kind === "cli" && entry.label === "CLI checkout"));
    assert.ok(report.prophecies.some((item) => item.node.name === "checkout" || item.node.name === "chargeCard"));
    assert.ok(report.unknowns.some((item) => item.kind === "architecture-intent"));
    assert.match(report.onboarding.title, /Senior engineer briefing/);
    assert.ok(report.onboarding.confidence > 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("traces an execution flow and explains a symbol like a senior engineer", async () => {
  const root = await createSystemFixture();
  try {
    const graph = await buildIndex(createConfig(root));
    const flow = await exploreExecutionFlow(graph, "POST /checkout");
    assert.ok(flow.entryPoint);
    assert.ok(flow.steps.some((step) => step.node.name === "checkout"));
    assert.ok(flow.steps.some((step) => step.node.name === "chargeCard"));
    assert.ok(flow.confidence > 0);
    const explanation = await explainLikeSenior(graph, "checkout");
    assert.match(explanation.title, /checkout/);
    assert.ok(explanation.facts.some((fact) => fact.includes("Fan-in")));
    assert.ok(explanation.confidence > 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
