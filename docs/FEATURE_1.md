# Feature 1 — Codebase Understanding & Context Engine

The local-first engine every later Fehm feature reads from. It turns a repository into a provenance-labelled code graph and answers queries with small, budgeted, LLM-ready context packets. No LLM, network service or external database is involved in normal operation.

```
Repository → scanner → analyzers (TS type checker | heuristic) → linker → CodeGraph
          → .fehm/ (per-file cache + graph) → retrieval (lexical · symbol · concept · graph · intent)
          → selection (anchors + file-first diversification) → progressive packing under a token budget
          → ContextPacket (JSON, canonical) → Markdown rendering (a view)
```

## Modules

| Module | Responsibility |
|---|---|
| `src/model.ts` | All shared types and version constants (`GRAPH_SCHEMA_VERSION`, `ANALYSIS_VERSION`, `SUMMARY_VERSION`). |
| `src/scanner.ts` | Deterministic walk, `.gitignore`/`.fehmignore`, language/role/test detection, SHA-256 fingerprints, size/binary/unreadable handling, `diffScan` (added/modified/deleted/unchanged + rename evidence). |
| `src/analyzer-typescript.ts` | TS/JS through the TypeScript compiler + type checker. `node_modules` is invisible, so bare imports become `package` nodes instead of being type-resolved. |
| `src/analyzer-heuristic.ts` | Python, Go, Rust, Java declarations by pattern on comment/string-stripped text; calls/imports/bases recorded as *pending references*. |
| `src/linker.ts` | Resolves pending references against the whole repository with a confidence ladder; ambiguity becomes an `UnresolvedReference`, never a guessed edge. |
| `src/graph.ts` | `CodeGraph`: dedup (strongest evidence wins), no dangling edges, depth-bounded BFS (max 3), stats, JSON round-trip. |
| `src/indexer.ts` | full / incremental / cache-hit synchronization, dependency invalidation, persistence, change report. |
| `src/summary.ts` | Deterministic 1–3 sentence summaries from the graph. |
| `src/semantic-summary.ts` | Opt-in semantic summaries through an explicit provider; cached with model, source hash and version; stale on change. |
| `src/lexical-index.ts`, `src/text.ts`, `src/stemmer.ts`, `src/synonyms.ts` | BM25 + identifier-aware tokenization + deterministic concept expansion. |
| `src/retrieval.ts` | Hybrid ranking and intent detection. |
| `src/context-selection.ts` | Anchor preservation + Graft file-first round-robin. |
| `src/compression.ts` | Token estimator, comment/blank-line compression, focused excerpts, hard budget cut. |
| `src/context.ts` | ContextPacket assembly, progressive packing, quality metrics, Markdown rendering. |
| `src/memory.ts` | Project memory (local facts linked to paths/symbols), ECC-derived relevance ranking. |
| `src/system-map.ts` | Project map, entry points, connectivity/hubs/isolated files. |
| `src/engine.ts` | `FehmEngine` — the single facade used by the CLI, the HTTP debug view and library consumers. |
| `src/cli.ts`, `src/server.ts` | CLI (`--json` everywhere) and a localhost-only debug page. |

## Graph

Node kinds: `repository directory file package module class interface enum function method field variable type route section`.
Edge kinds: `contains defines imports calls references uses extends implements writes configures handles`.

| Kind | Where it comes from |
|---|---|
| `module` | TS `namespace`/`declare module`, Rust `mod`, Go/Java `package` clause (contained by its folder) |
| `field` | TS class properties, constructor parameter properties, interface properties; Python class attributes and `self.x =`; Go/Rust struct fields; Java class fields |
| `enum` | TS, Rust and Java enums |
| `route` | Express/Koa-style `app.get("/x", handler)` (only when a handler is a function), NestJS `@Get` + `@Controller`, Flask/FastAPI decorators, Go `HandleFunc`/gin/echo/chi, actix attributes, axum `.route()`, Spring `@*Mapping`, JAX-RS |
| `section` | Markdown headings (nested by level; fenced code ignored) |
| `writes` | assignments/`++`/`--` to a variable or field — type-checker resolved in TS; `self.`/`this.`/receiver and Python `global` in heuristic languages |
| `handles` | handler function/method → route; inline handlers credit the repository functions they call (0.75) |
| `configures` | manifest → declared dependency (`package`), entry points (`main`/`bin`/`exports`, `[project.scripts]`, Cargo `[[bin]]`), files named in scripts, Dockerfile `CMD`/`RUN`, CI `run:` steps |
| `references` (docs) | markdown link → repository file/folder; broken links are reported as unresolved |

Ids are stable strings: `file:src/a.ts`, `function:src/a.ts#name`, `method:src/a.ts#Class.method`, `package:express`, `directory:src/auth`, `repository:.`.

Every node and edge carries `evidence { provenance, confidence, location?, detail? }`:

| Fact | Provenance | Confidence |
|---|---|---|
| directory/file structure | `filesystem` | 1.0 |
| TS/JS declarations, external-module imports | `ast` | 1.0 |
| TS/JS cross-file calls, references, type uses, extends/implements, module resolution | `type-checker` | 1.0 |
| TS/JS literal `import()` / `require()` | `ast` | 0.9 / 0.95 |
| call of an imported package binding | `ast` | 0.9 |
| Python/Go/Rust/Java declarations | `heuristic` | 0.9 |
| heuristic imports resolved to a file | `heuristic` | 0.7–0.9 |
| heuristic calls: same file / imported name / imported file / unique name | `heuristic` | 0.8 / 0.75 / 0.65 / 0.5 (member calls −0.1) |
| module not found locally (heuristic langs) | `heuristic` edge to `package` | 0.6–0.9, detail says "treated as external" |

Unresolved facts are kept in `graph.unresolved` with a reason: non-literal dynamic imports, missing relative modules, bases not declared in the repository, ambiguous names ("ambiguous: N candidates").

Granularity: top-level declarations and class members are nodes. Nested functions, callbacks and anonymous functions fold into their enclosing symbol.

## Incremental indexing

`.fehm/index.json` stores, per file, `{hash, analysis}`, with `schemaVersion` and `analysisVersion`; `.fehm/graph.json` stores the built graph.

- **cache-hit** — no file added, modified or deleted: nothing re-analyzed.
- **incremental** — changed files are re-analyzed; unchanged TS/JS files whose resolved edges point into a changed or deleted file are *invalidated* and re-resolved by the checker; TS/JS files with unresolved imports are retried when files are added. Heuristic references are re-linked globally on every run (cheap, no parsing).
- **full** — no cache, `--force`, unreadable/malformed cache, or a version change (reason reported).

The graph is rebuilt from cached + fresh analyses, so deleted files leave no nodes or dangling edges. A test asserts incremental output equals a fresh full index of the same tree. The report lists analyzed/reused/invalidated/removed files, added/removed symbols, added/removed relationships and stale semantic summaries.

## Retrieval

```
base  = 0.35·lexical + 0.35·symbol + 0.10·semantic + 0.20·graph      (DEFAULT_WEIGHTS, overridable)
score = base · (0.6 + 0.4·intentPrior)
```

- **lexical** — BM25 over name (×4), path, signature, doc, body; prefix matches at half idf.
- **symbol** — exact/qualified/case-insensitive name matches; words typed as a name ("xml parser" → `XMLParser`). A plain lowercase word inside a longer question is capped at 0.6.
- **semantic** — deterministic synonym expansion (e.g. login → auth); fresh semantic summaries, when present, are indexed as extra text. Not embeddings.
- **graph** — depth-bounded expansion (1 for locate/test/architecture, 2 otherwise, max 3) from the top 8 seeds, decaying 0.5 per hop and scaled by edge confidence; seeds connected to other seeds get a centrality bonus.
- **intent** — `locate explain change debug test architecture`, keyword-classified; the prior de-ranks tests except for `test`.

Order: score ↓, depth ↑, kind, id — identical input gives identical output.

## Context selection and budget

1. Retrieval candidates (40), filtered at 20 % of the top score; at most `budget/100` items.
2. Anchors (up to 3 leading hits ≥ 75 % of the top score) keep rank order; the rest go through Graft's file-first round-robin.
3. Progressive packing, each item capped at a detail level (anchors → `source`, direct matches → `section`, neighbours → `signature`, packages → `summary`, a file whose symbols are selected → `signature`):
   one-line `relationship` for all → anchors to summary/signature/section/source within 55 % of the item budget → others to summary → signature → section → anchors take whatever is left.
4. Relationships among selected nodes (+ anchor neighbours), related tests, nearby unknowns, ranked project memory and a small architecture header fill reserved shares.
5. The **rendered Markdown** is measured with `estimateTokens`; relationships, unknowns, tests, memory, then item detail are shed until it fits. If even the header cannot fit, the text is hard-cut. `usedTokens ≤ maximumTokens` always holds for the estimator.

`budget: { maximumTokens, usedTokens, remainingTokens, truncated, dropped, downgraded, estimator }`. `quality` reports observable evidence only (term coverage, exact match, mean confidence, heuristic share, files covered, tests, relationships, unresolved nearby).

The token estimator (`fehm-approx-v1`) is deterministic and deliberately a little pessimistic for code; it is not a vendor tokenizer.

## Project memory vs code graph

Memory (`.fehm/memory.json`) holds short, source-linked project facts. It is ranked per query (query-term relevance, plus ECC's additive boosts for linking into the selection and matching the stack) and injected into packets, but it never becomes graph edges.

## CLI

```
fehm scan [path] [--force]      fehm stats
fehm search "<q>" [--limit N]   fehm context "<q>" [--budget N] [--intent I] [--depth D]
fehm focus <symbol>             fehm relationships <symbol>
fehm explain <symbol|file>      fehm flow <entry> [--depth N]
fehm system-map                 fehm connectivity
fehm summaries [--generate T... --command CMD --model M]
fehm memory add|list|remove     fehm serve [--port 4317]
```

Symbols can be disambiguated as `name@path` or by node id; ambiguous names return the candidate list (exit code 2) instead of a guess.

## Upstream adaptations

| Upstream | Commit | License | Adapted into | What |
|---|---|---|---|---|
| trailhq/Graft `src/ask/file-selection.ts` | `8c05769618d413041ea2c8891f82d566f0461b3c` | MIT | `src/context-selection.ts` | `fileFirstRoundRobin`, unchanged except one `!` |
| DeusData/codebase-memory-mcp `src/store/store.c` | `92abefa3f57a94591a92bcecd6a6f102da373575` | MIT | `src/text.ts` | `camel_should_split` rules, ported C → TS |
| rohitg00/agentmemory `src/state/{search-index,stemmer,synonyms}.ts` | `bcf4f0d00d1c71e9221287a4778e4122ce2d7574` | Apache-2.0 | `src/lexical-index.ts`, `src/stemmer.ts`, `src/synonyms.ts` | BM25 index, Porter stemmer, synonym groups |
| affaan-m/ECC `scripts/lib/instinct-relevance.js` | `9ac593b55cba44c8b20152a5c7f28d300a67ec7e` | MIT | `src/memory.ts` | additive relevance boosts, whole-token matching |

Originals are preserved byte-for-byte under `legal/upstream/<project>/vendor/` with `LICENSE`, `manifest.json` (hashes, verified by tests) and a README listing every modification. Caveman, Open Code Review, gstack and Agency Agents are not Feature 1 dependencies.

## Benchmarks

`npm run bench` (writes `bench/results.json`). Numbers below: Node 26, Apple Silicon.

| Repository | Files | Nodes | Edges | Full | Incremental (1 file) | Cache-hit | Retrieval p50 | Context p50 |
|---|---|---|---|---|---|---|---|---|
| bench/corpus | 21 | 98 | 193 | 55 ms | 11 ms | 4 ms | 0.8 ms | 3 ms |
| synthetic-200 | 221 | 1 073 | 1 890 | 73 ms | 43 ms | 18 ms | 4 ms | 9 ms |
| synthetic-1000 | 1 101 | 5 313 | 9 410 | 263 ms | 171 ms | 93 ms | 20 ms | 28 ms |

Retrieval quality on 14 hand-labelled corpus questions (`bench/questions.json`): Recall@5 0.923, Recall@10 0.982, MRR 0.952, Precision@5 0.414 (most questions have only 1–3 relevant nodes, so P@5 is bounded well below 1), file coverage 1.0, symbol coverage 1.0 in 4000-token packets.

Tokens: a 4000-budget packet averaged ~2 170 estimated tokens; the whole corpus is ~3 960 and the files containing the labelled answers ~370. On a repository this small a packet is *not* smaller than reading the right files — the saving Fehm targets is the exploration needed to *find* them, which grows with repository size. No model-quality claim is made; no model was evaluated.

## Known limitations

- Heuristic languages have no type inference; member calls (`obj.method()`) resolve only within the file or imported files. Go `type ( … )` groups, Python decorators and Rust macros are not modelled.
- TS/JS: `noLib` is used for speed, so standard-library symbols are not nodes (common builtin bases are not reported as unknown). CommonJS `module.exports = …` patterns are not extracted as symbols. Method calls through an interface type resolve to the interface member, which is not a node.
- Incremental TS analysis still builds a program over all TS/JS files (parsing only; extraction is limited to changed + invalidated files).
- The lexical index is rebuilt in memory per engine instance.
- Intent detection is keyword-based; "what calls X" is classified `explain`, not a dedicated caller intent.
- The token estimator approximates; budgets are exact only with respect to it.

## Deferred to later features

- Visual graph page (3.1), codebase explanation page (3.2), architecture page (3.3), drift (3.4), health & coverage (3.5), security review (3.6), prompt intelligence incl. Caveman-style output compression (3.7), git memory/logs and rename history (3.8), 3.9+.
- MCP server exposure of this engine and agent skills/integration files (they should wrap `FehmEngine`, not re-implement it).
- Persisted lexical index, embeddings, and a `callers` intent.
