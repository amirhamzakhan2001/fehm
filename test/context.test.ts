import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  buildContextPacket,
  classifyIntent,
  estimateTokens,
  formatContextPacket,
  retrieveContext,
  tokenize,
} from "../src/context.js";
import { createConfig } from "../src/config.js";
import { buildIndex } from "../src/indexer.js";

async function contextFixture(): Promise<{ root: string; cleanup: () => Promise<void> }> {
  const root = await mkdtemp(path.join(os.tmpdir(), "fehm-context-"));
  await mkdir(path.join(root, "src"), { recursive: true });
  await mkdir(path.join(root, "test"), { recursive: true });
  await writeFile(
    path.join(root, "src", "greeting.ts"),
    [
      "export function formatGreeting(name: string): string {",
      "  return `Hello ${name}`;",
      "}",
      "export function greetUser(name: string): string {",
      "  return formatGreeting(name);",
      "}",
    ].join("\n"),
  );
  await writeFile(
    path.join(root, "src", "main.ts"),
    'import { greetUser } from "./greeting.js";\nexport function run() { return greetUser("fehm"); }\n',
  );
  await writeFile(
    path.join(root, "test", "greeting.test.ts"),
    'import { greetUser } from "../src/greeting.js";\nexport const actual = greetUser("Ada");\n',
  );
  return { root, cleanup: () => rm(root, { recursive: true, force: true }) };
}

test("tokenizes code identifiers and classifies task intent", () => {
  assert.deepEqual(tokenize("formatGreeting OAuth2"), ["format", "greeting", "oauth2"]);
  assert.equal(classifyIntent("change the greeting formatter"), "change");
  assert.equal(classifyIntent("why does authentication fail?"), "debug");
  assert.equal(classifyIntent("which tests cover greeting?"), "test");
});

test("hybrid retrieval ranks symbols and expands through the call graph", async () => {
  const project = await contextFixture();
  try {
    const graph = await buildIndex(createConfig(project.root));
    const hits = await retrieveContext(graph, "format greeting", { depth: 2, limit: 30 });
    assert.equal(hits[0]?.node.name, "formatGreeting");
    assert.ok(hits[0]?.scores.symbol && hits[0].scores.symbol > 0.7);
    const run = hits.find((hit) => hit.node.name === "run");
    assert.ok(run, "two-hop caller should be included by graph expansion");
    assert.ok(run.graphDistance !== undefined && run.graphDistance <= 2);
    assert.ok(run.reasons.some((reason) => reason.includes("graph neighbor")));
  } finally {
    await project.cleanup();
  }
});

test("builds a token-budgeted, evidence-linked context packet", async () => {
  const project = await contextFixture();
  try {
    const graph = await buildIndex(createConfig(project.root));
    const packet = await buildContextPacket(graph, "change the greeting formatter", {
      budgetTokens: 500,
      depth: 2,
    });
    assert.equal(packet.intent, "change");
    assert.ok(packet.recommendedNodes.some((hit) => hit.node.name === "formatGreeting"));
    assert.ok(packet.excerpts.some((excerpt) => excerpt.path === "src/greeting.ts"));
    assert.ok(packet.relationships.some((edge) => edge.kind === "calls"));
    assert.ok(packet.budget.usedTokens <= packet.budget.maximumTokens);
    assert.equal(packet.budget.remainingTokens, packet.budget.maximumTokens - packet.budget.usedTokens);
    assert.ok(estimateTokens(formatContextPacket(packet)) <= packet.budget.maximumTokens);
    assert.ok(packet.quality.score > 0);
    assert.ok(packet.architecture.layers.length > 0);
    assert.ok(packet.tests.includes("test/greeting.test.ts"));
    const compact = await buildContextPacket(graph, "greeting", { budgetTokens: 128, depth: 1 });
    assert.ok(estimateTokens(formatContextPacket(compact)) <= compact.budget.maximumTokens);
    assert.equal(compact.budget.usedTokens, estimateTokens(formatContextPacket(compact)));
    assert.equal(compact.quality.architectureCoverage, Math.min(1, (compact.architecture.layers.length + compact.architecture.constraints.length) / 2));
    assert.equal(compact.quality.testCoverage, Math.min(1, compact.tests.length / 2));
    const longQuery = "change greeting ".repeat(1_000);
    const long = await buildContextPacket(graph, longQuery, { budgetTokens: 128 });
    assert.equal(long.query, longQuery, "structured output preserves the user's query");
    assert.equal(long.budget.truncated, true);
    assert.ok(estimateTokens(formatContextPacket(long)) <= 128);
    assert.equal(long.budget.usedTokens, estimateTokens(formatContextPacket(long)));
    assert.deepEqual(await retrieveContext(graph, "  "), []);
  } finally {
    await project.cleanup();
  }
});

test("context packets give other files a turn before repeat symbols", async () => {
  const fixture = await contextFixture();
  try {
    const graph = await buildIndex(createConfig(fixture.root));
    const packet = await buildContextPacket(graph, "greeting", { budgetTokens: 8000 });
    const paths = packet.recommendedNodes.slice(3).map(hit => hit.node.path).filter(Boolean);
    const unique = new Set(paths);
    assert.ok(unique.size >= 2);
    assert.equal(new Set(paths.slice(0, unique.size)).size, unique.size);
    assert.ok(estimateTokens(formatContextPacket(packet)) <= 8000);
  } finally { await fixture.cleanup(); }
});
