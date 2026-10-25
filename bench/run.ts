/**
 * Feature 1 benchmark. Measures indexing/retrieval/context performance on
 * generated repositories and retrieval quality on the hand-labelled corpus.
 *
 * It does NOT measure model answer quality: no model is called. Token numbers
 * are Fehm's own estimate (compression.ts), not a vendor tokenizer.
 *
 *   npm run bench            # prints a report, writes bench/results.json
 */
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { estimateTokens } from "../src/compression.js";
import { renderContextPacket } from "../src/context.js";
import { FehmEngine } from "../src/engine.js";
import { indexRepository } from "../src/indexer.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const temps: string[] = [];
const tmp = (p: string): string => {
  const d = mkdtempSync(join(tmpdir(), p));
  temps.push(d);
  return d;
};

const ms = (start: number): number => Math.round((performance.now() - start) * 10) / 10;
const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)]! : 0;
};

/** Deterministic synthetic TypeScript + Python repository with real call chains. */
function generateRepo(modules: number): string {
  const dir = tmp(`fehm-bench-${modules}-`);
  const domains = ["auth", "billing", "orders", "catalog", "search", "users", "notify", "storage"];
  for (let i = 0; i < modules; i += 1) {
    const domain = domains[i % domains.length]!;
    const prev = i > 0 ? i - 1 : undefined;
    const lines = [
      prev !== undefined ? `import { ${domains[prev % domains.length]}Step${prev} } from "../${domains[prev % domains.length]}/module${prev}";` : "",
      `/** ${domain} step ${i}: validates input and forwards to the next stage. */`,
      `export function ${domain}Step${i}(input: string): string {`,
      `  const cleaned = normalize${i}(input);`,
      prev !== undefined ? `  return ${domains[prev % domains.length]}Step${prev}(cleaned);` : "  return cleaned;",
      "}",
      `function normalize${i}(value: string): string {`,
      "  return value.trim().toLowerCase();",
      "}",
      `export class ${domain[0]!.toUpperCase()}${domain.slice(1)}Service${i} {`,
      `  run(value: string) { return ${domain}Step${i}(value); }`,
      "}",
    ];
    const path = join(dir, "src", domain, `module${i}.ts`);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${lines.filter(Boolean).join("\n")}\n`);
    if (i % 10 === 0) {
      const py = join(dir, "scripts", `job${i}.py`);
      mkdirSync(dirname(py), { recursive: true });
      writeFileSync(py, `def job_${i}(rows):\n    """Batch job ${i}."""\n    return [clean_${i}(r) for r in rows]\n\n\ndef clean_${i}(row):\n    return row.strip()\n`);
    }
  }
  writeFileSync(join(dir, "package.json"), '{ "name": "synthetic" }\n');
  return dir;
}

interface PerfRow {
  repo: string;
  files: number;
  nodes: number;
  edges: number;
  fullMs: number;
  incrementalMs: number;
  cacheHitMs: number;
  retrievalMedianMs: number;
  contextMedianMs: number;
  contextTokens: number;
  filesSelected: number;
  symbolsSelected: number;
}

function perf(name: string, root: string, queries: string[]): PerfRow {
  const state = tmp("fehm-state-");
  let t = performance.now();
  const full = indexRepository(root, { stateDirectory: state });
  const fullMs = ms(t);
  const target = full.scan.files.find((f) => f.language === "typescript" && !f.isTest)!;
  writeFileSync(target.absolutePath, `${readFileSync(target.absolutePath, "utf8")}\nexport const benchTouch = 1;\n`);
  t = performance.now();
  const inc = indexRepository(root, { stateDirectory: state });
  const incrementalMs = ms(t);
  if (inc.report.mode !== "incremental") throw new Error(`expected incremental, got ${inc.report.mode}`);
  t = performance.now();
  const hit = indexRepository(root, { stateDirectory: state });
  const cacheHitMs = ms(t);
  if (hit.report.mode !== "cache-hit") throw new Error(`expected cache-hit, got ${hit.report.mode}`);

  const engine = FehmEngine.open(root, { stateDirectory: state });
  engine.search("warm up lexical index");
  const retrieval: number[] = [];
  const context: number[] = [];
  let tokens = 0;
  let files = 0;
  let symbols = 0;
  for (const q of queries) {
    t = performance.now();
    engine.search(q, { limit: 20 });
    retrieval.push(ms(t));
    t = performance.now();
    const p = engine.context(q, { budget: 4000 });
    context.push(ms(t));
    tokens += p.budget.usedTokens;
    files += new Set(p.recommendedNodes.map((n) => n.path).filter(Boolean)).size;
    symbols += p.recommendedNodes.filter((n) => n.kind !== "file" && n.kind !== "package").length;
  }
  const s = hit.graph.stats();
  return {
    repo: name,
    files: s.files,
    nodes: s.nodes,
    edges: s.edges,
    fullMs,
    incrementalMs,
    cacheHitMs,
    retrievalMedianMs: median(retrieval),
    contextMedianMs: median(context),
    contextTokens: Math.round(tokens / queries.length),
    filesSelected: Math.round((files / queries.length) * 10) / 10,
    symbolsSelected: Math.round((symbols / queries.length) * 10) / 10,
  };
}

interface Question {
  query: string;
  relevant: string[];
}

function quality(root: string, questions: Question[]) {
  const engine = FehmEngine.open(root, { stateDirectory: tmp("fehm-q-") });
  const allSource = engine.graph
    .nodes()
    .filter((n) => n.kind === "file" && n.path && !/\.(json|md)$/.test(n.path))
    .map((n) => readFileSync(join(root, n.path!), "utf8"))
    .join("\n");
  const perQuestion = questions.map((q) => {
    const hits = engine.search(q.query, { limit: 10 }).map((h) => h.nodeId);
    const at = (k: number) => hits.slice(0, k).filter((id) => q.relevant.includes(id)).length;
    const firstRank = hits.findIndex((id) => q.relevant.includes(id));
    const packet = engine.context(q.query, { budget: 4000 });
    const packetIds = new Set(packet.recommendedNodes.map((n) => n.nodeId));
    const packetFiles = new Set(packet.recommendedNodes.map((n) => n.path));
    const relevantFiles = [...new Set(q.relevant.map((id) => engine.graph.node(id)?.path).filter(Boolean))];
    const relevantSymbols = q.relevant.filter((id) => !id.startsWith("file:"));
    const oracleFilesText = relevantFiles.map((p) => readFileSync(join(root, p!), "utf8")).join("\n");
    return {
      query: q.query,
      intent: packet.intent,
      p5: at(5) / 5,
      r5: at(5) / q.relevant.length,
      r10: at(10) / q.relevant.length,
      mrr: firstRank >= 0 ? 1 / (firstRank + 1) : 0,
      fileCoverage: relevantFiles.filter((p) => packetFiles.has(p)).length / Math.max(1, relevantFiles.length),
      symbolCoverage: relevantSymbols.length ? relevantSymbols.filter((id) => packetIds.has(id)).length / relevantSymbols.length : 1,
      packetTokens: estimateTokens(renderContextPacket(packet)),
      relevantFilesFullTokens: estimateTokens(oracleFilesText),
      top3: hits.slice(0, 3),
    };
  });
  const mean = (k: keyof (typeof perQuestion)[number]) => Math.round((perQuestion.reduce((a, q) => a + (q[k] as number), 0) / perQuestion.length) * 1000) / 1000;
  return {
    summary: {
      questions: perQuestion.length,
      "precision@5": mean("p5"),
      "recall@5": mean("r5"),
      "recall@10": mean("r10"),
      mrr: mean("mrr"),
      fileCoverage: mean("fileCoverage"),
      symbolCoverage: mean("symbolCoverage"),
      meanPacketTokens: Math.round(mean("packetTokens")),
      meanRelevantFilesFullTokens: Math.round(mean("relevantFilesFullTokens")),
      wholeRepositoryTokens: estimateTokens(allSource),
    },
    perQuestion,
  };
}

function main(): void {
  const corpus = tmp("fehm-corpus-");
  cpSync(join(HERE, "corpus"), corpus, { recursive: true });
  const questions = JSON.parse(readFileSync(join(HERE, "questions.json"), "utf8")) as Question[];
  const queries = questions.map((q) => q.query);
  const synthQueries = ["auth step validation", "billing service run", "normalize input", "orders step 40", "batch job rows"];

  const perfRows = [
    perf("corpus (small)", corpus, queries),
    perf("synthetic-200 (medium)", generateRepo(200), synthQueries),
    perf("synthetic-1000 (large)", generateRepo(1000), synthQueries),
  ];
  const q = quality(resolve(join(HERE, "corpus")), questions);

  console.log("\nPerformance (ms; tokens are Fehm estimates at budget 4000)");
  console.table(perfRows);
  console.log("Retrieval quality on bench/corpus (hand-labelled, 14 questions)");
  console.table([q.summary]);
  console.table(q.perQuestion.map((x) => ({ query: x.query, intent: x.intent, "P@5": x.p5, "R@5": x.r5, MRR: Math.round(x.mrr * 100) / 100, fileCov: x.fileCoverage, symCov: Math.round(x.symbolCoverage * 100) / 100 })));

  const out = { generatedAt: new Date().toISOString(), node: process.version, platform: `${process.platform}-${process.arch}`, performance: perfRows, quality: q };
  writeFileSync(join(HERE, "results.json"), `${JSON.stringify(out, null, 2)}\n`);
  for (const d of temps) rmSync(d, { recursive: true, force: true });
}

main();
