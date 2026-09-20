import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createConfig } from "../src/config.js";
import { focusGraph } from "../src/graph.js";
import { buildIndex, writeIndex } from "../src/indexer.js";
import { startProjectSynchronizer } from "../src/synchronizer.js";

async function fixture(): Promise<{ root: string; cleanup: () => Promise<void> }> {
  const root = await mkdtemp(path.join(os.tmpdir(), "fehm-test-"));
  await mkdir(path.join(root, "src", "services"), { recursive: true });
  await mkdir(path.join(root, "test"), { recursive: true });
  await writeFile(
    path.join(root, "src", "services", "greeter.ts"),
    [
      "export interface Named { name: string }",
      "export class Greeter {",
      "  greet(person: Named): string { return formatGreeting(person.name); }",
      "}",
      "export function formatGreeting(name: string): string { return `Hello ${name}`; }",
    ].join("\n"),
  );
  await writeFile(
    path.join(root, "src", "main.ts"),
    [
      'import { Greeter } from "./services/greeter.js";',
      "export function run(): string {",
      "  const greeter = new Greeter();",
      '  return greeter.greet({ name: "fehm" });',
      "}",
    ].join("\n"),
  );
  await writeFile(
    path.join(root, "test", "main.test.ts"),
    'import { run } from "../src/main.js";\nexport const result = run();\n',
  );
  return { root, cleanup: () => rm(root, { recursive: true, force: true }) };
}

test("builds a typed, evidence-backed repository graph", async () => {
  const project = await fixture();
  try {
    const graph = await buildIndex(createConfig(project.root));
    const run = graph.nodes.find((node) => node.name === "run" && node.kind === "function");
    const greet = graph.nodes.find((node) => node.name === "greet" && node.kind === "method");
    const greeterFile = graph.nodes.find((node) => node.qualifiedName === "src/services/greeter.ts");

    assert.ok(run, "run function should be indexed");
    assert.ok(greet, "greet method should be indexed");
    assert.ok(greeterFile, "nested source file should be indexed");
    assert.ok(graph.nodes.some((node) => node.kind === "directory" && node.path === "src/services"));
    assert.ok(graph.edges.some((edge) => edge.kind === "imports" && edge.target === greeterFile.id));
    assert.ok(graph.edges.some((edge) => edge.kind === "calls" && edge.source === run.id && edge.target === greet.id));
    assert.ok(graph.edges.every((edge) => edge.evidence.confidence > 0 && edge.evidence.confidence <= 1));
    assert.equal(graph.stats.files, 3);
    assert.ok(graph.stats.symbols >= 6);
    assert.ok(graph.stats.tests >= 1);
  } finally {
    await project.cleanup();
  }
});

test("indexes Python, Go, Rust, and Java declarations and imports", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "fehm-polyglot-"));
  try {
    for (const directory of ["python", "go", "rust/src", "java"]) await mkdir(path.join(root, directory), { recursive: true });
    await writeFile(path.join(root, "python", "helper.py"), "def work(value):\n    return value\n");
    await writeFile(path.join(root, "python", "main.py"), "from helper import work\nclass Runner:\n    pass\ndef run():\n    return work(1)\n");
    await writeFile(path.join(root, "go", "main.go"), "package main\nimport \"fmt\"\ntype Runner struct {}\nfunc Run() { fmt.Println(\"ok\") }\n");
    await writeFile(path.join(root, "rust", "src", "lib.rs"), "pub struct Runner;\npub fn run() -> bool { true }\n");
    await writeFile(path.join(root, "java", "Runner.java"), "public class Runner { public boolean run() { return true; } }\n");
    const graph = await buildIndex(createConfig(root));
    for (const language of ["python", "go", "rust", "java"]) assert.ok(graph.nodes.some((node) => node.kind === "file" && node.language === language), `${language} file should be indexed`);
    assert.ok(graph.nodes.some((node) => node.language === "python" && node.name === "work" && node.kind === "function"));
    assert.ok(graph.nodes.some((node) => node.language === "go" && node.name === "Run" && node.kind === "function"));
    assert.ok(graph.nodes.some((node) => node.language === "rust" && node.name === "run" && node.kind === "function"));
    assert.ok(graph.nodes.some((node) => node.language === "java" && node.name === "Runner" && node.kind === "class"));
    assert.ok(graph.edges.some((edge) => edge.kind === "imports" && edge.source === "file:python/main.py" && edge.target === "file:python/helper.py"));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("tracks file freshness across scans", async () => {
  const project = await fixture();
  try {
    const config = createConfig(project.root);
    const initial = await buildIndex(config);
    assert.equal(initial.changes.added.length, 3);
    await writeIndex(initial, config.outputDirectory);

    const unchanged = await buildIndex(config);
    assert.equal(unchanged.changes.unchanged.length, 3);
    assert.equal(unchanged.changes.changed.length, 0);

    const mainPath = path.join(project.root, "src", "main.ts");
    await writeFile(mainPath, `${await readFile(mainPath, "utf8")}\nexport const version = 2;\n`);
    const changed = await buildIndex(config);
    assert.deepEqual(changed.changes.changed, ["src/main.ts"]);
  } finally {
    await project.cleanup();
  }
});

test("focus mode returns the local dependency neighborhood", async () => {
  const project = await fixture();
  try {
    const graph = await buildIndex(createConfig(project.root));
    const result = focusGraph(graph, "run", 1);
    assert.equal(result.matches.length, 1);
    assert.ok(result.nodes.some((node) => node.name === "greet"));
    assert.ok(result.edges.some((edge) => edge.kind === "calls"));
  } finally {
    await project.cleanup();
  }
});

test("reuses persisted file units and only reanalyzes invalidated dependents", async () => {
  const project = await fixture();
  try {
    const config = createConfig(project.root);
    const initial = await buildIndex(config);
    await writeIndex(initial, config.outputDirectory);

    const testPath = path.join(project.root, "test", "main.test.ts");
    await writeFile(testPath, `${await readFile(testPath, "utf8")}\nexport const freshnessProbe = true;\n`);
    const incremental = await buildIndex(config);
    assert.equal(incremental.synchronization?.mode, "incremental");
    assert.deepEqual(incremental.synchronization?.analyzedFiles, ["test/main.test.ts"]);
    assert.deepEqual(incremental.synchronization?.reusedFiles, ["src/main.ts", "src/services/greeter.ts"]);
    assert.ok(incremental.nodes.some((node) => node.name === "freshnessProbe"));
    assert.ok(incremental.nodes.some((node) => node.name === "formatGreeting"), "cached symbols should remain available");

    await writeIndex(incremental, config.outputDirectory);
    const cacheHit = await buildIndex(config);
    assert.equal(cacheHit.synchronization?.mode, "cache-hit");
    assert.equal(cacheHit.synchronization?.analyzedFiles.length, 0);
  } finally {
    await project.cleanup();
  }
});

test("continuously synchronizes changes without overlapping refreshes", async () => {
  const project = await fixture();
  const synchronizer = startProjectSynchronizer(createConfig(project.root), { intervalMs: 60_000 });
  try {
    const initial = await synchronizer.runNow();
    assert.equal(initial.synchronization?.mode, "full");
    const testPath = path.join(project.root, "test", "main.test.ts");
    await writeFile(testPath, `${await readFile(testPath, "utf8")}\nexport const watched = true;\n`);
    const refreshed = await synchronizer.runNow();
    assert.equal(refreshed.synchronization?.mode, "incremental");
    assert.ok(refreshed.nodes.some((node) => node.name === "watched"));
  } finally {
    synchronizer.stop();
    await project.cleanup();
  }
});

test("rebuilds when an interrupted write leaves the analysis cache from another snapshot", async () => {
  const project = await fixture();
  try {
    const config = createConfig(project.root);
    await writeIndex(await buildIndex(config), config.outputDirectory);
    const cachePath = path.join(config.outputDirectory, "analysis-cache.json");
    const cache = JSON.parse(await readFile(cachePath, "utf8"));
    cache.repositoryFingerprint = "older-snapshot";
    await writeFile(cachePath, JSON.stringify(cache));
    const rebuilt = await buildIndex(config);
    assert.equal(rebuilt.synchronization?.mode, "full");
    assert.ok(rebuilt.nodes.some((node) => node.name === "formatGreeting"));
    await writeIndex(rebuilt, config.outputDirectory);
    assert.equal((await buildIndex(config)).synchronization?.mode, "cache-hit");
  } finally {
    await project.cleanup();
  }
});
