# Feature 3.2 — Explain Codebase

A 15-minute senior-engineer briefing of an unfamiliar repository, served by `fehm serve` at `http://127.0.0.1:4317/explain` and printed by `fehm brief`.

3.2 is an **explanation layer**. It has no scanner, parser, graph, index, retrieval engine, token counter or summary store of its own. Every section is built from `FehmEngine`: the graph and its provenance, `flow`, `systemMap`, `connectivity`, `search`, `explain`, `freshness`, and the indexed file contents. No model is called and no API key is needed.

```
FehmEngine ─→ BriefingFacts (one pass, memoized) ─→ 18 section builders ─→ claims + evidence + confidence
                                                                              │
                .fehm/briefing.json (per-section fingerprints) ←──────────────┤
                                                                              ▼
                          /api/briefing (+ freshness overlay)    fehm brief (markdown, token-budgeted)
                                        │
                          /explain page: evidence · flow · explain · graph links · ask
```

## Modules (`src/codebase-briefing/`, `src/visualization/briefing/`)

| Module | Responsibility |
|---|---|
| `types.ts` | The `CodebaseBriefing` contract, shared with the browser (type-only). Sections are rendered from a small set of block types: text, facts, list, groups, flow, diagram, ranking and risks. |
| `facts.ts` | `BriefingFacts`, the only extraction pass. Its structure comes from the graph: file roles, file-level dependencies, metrics, cycles (Tarjan), modules, entry files and package usage. It also parses the manifests. Line-level signals are pattern checks over indexed files: routes, CLI dispatch, env vars, runtime starters, sinks, SQL, models, file writes and security headers. Regex literals are stripped before any pattern check, string contents are stripped for code-only checks, and JS process execution only counts when the file imports `child_process`. |
| `evidence.ts` | `ClaimSet` and the confidence policy (below). |
| `catalog.ts` | What well-known dependencies are *for*. A catalog hit explains a dependency; only an `imports` edge proves it is used. |
| `builder.ts` | Archetype detection (cli, api, frontend, library, ml, service), adaptive priority and default expansion, unique module labels. |
| `sections-structure.ts` | Overview, architecture, entry points, features, data flows, runtime. |
| `sections-interfaces.ts` | API, database, integrations, infrastructure, security, technology, testing. |
| `sections-analysis.ts` | Components (centrality ranking), dependencies and hotspots, risks, what an engineer must know, cheat sheet. |
| `briefing.ts` | Build order, per-section fingerprints and cache, freshness overlay, affected-section calculation. |
| `render.ts` | Markdown at `minimal` (~1.5k tokens), `standard` (~6k) and `deep` (~20k) budgets, measured with Feature 1's `estimateTokens`. Sections that don't fit shrink to one line and are then listed as omitted. |
| `visualization/briefing/*` | `/explain` page, `/api/briefing/*`, and the browser UI (`ui/main.ts`, which reuses 3.1's `dom.ts`). |

## Evidence model

Feature 1 provenance maps onto three states:

| State | Source | Confidence |
|---|---|---|
| CONFIRMED | Observed through the type-checker, AST or filesystem (0.92–1.0), or declared in a manifest/config (0.9, *as a declaration*) | ≥ 0.85 |
| LIKELY | Pattern-extracted (heuristic, 0.7) or inferred from structure (≤ 0.8, never confirmed) | 0.45–0.85 |
| UNKNOWN | No evidence; the question is stated, not answered | 0 |

Each claim carries `path:line`, source, provenance and an optional node id, and says whether it is stale. Every section also lists what it could not determine, and those items are collected on the page and in the markdown. Wording rules are enforced by tests:
- A cloud SDK never implies a hosting provider.
- An empty scan says "No supported security findings were detected by the available static checks", never "secure".
- Centrality is a "potential change hotspot", not a bottleneck.
- Test figures are "static reachability", not coverage.

## Freshness and incremental rebuilds

Each section declares which file roles it reads by content, which it reads by presence, and which upstream sections it depends on (`SECTION_DEPENDENCIES`). Its fingerprint hashes those inputs plus the upstream fingerprints. On a rebuild, unchanged sections come from `.fehm/briefing.json`: a README edit rebuilds only Overview and Cheat sheet, and a source edit leaves Infrastructure cached. On every request the working tree is compared with the index (hash-only rescan). The page then shows a stale banner with the changed files and affected sections, and marks each stale section and each evidence row pointing at a changed file. **Refresh** re-indexes incrementally and rebuilds the affected sections, in about 110 ms on this repository.

## Page

- **Hero:** name, declared purpose, stack tags, confirmed share, unknown count, index size and cache use.
- **Ask about this codebase:** Feature 1 retrieval plus deterministic summaries.
- **18 collapsible sections.** Overview, Architecture, Entry points, Features and Cheat sheet are open by default, plus the archetype's most relevant section (Data flows for a CLI, API for an HTTP service).
- **Claim actions:** every claim has **evidence**. Entities also get **explain** (3.1's `/api/graph/node`: what it does, who uses it, what it uses, related tests), **graph** (`/graph#node=…`) and, for entry points, **flow** (a `FehmEngine.flow` call tree).
- **Export:** markdown (three depths) or JSON.
- **Navigation:** a table of contents with per-section state; `/` focuses Ask. Freshness is re-checked on window focus.

## API

| Route | |
|---|---|
| `GET /explain` | Page. |
| `GET /api/briefing` | Full briefing with the freshness overlay. |
| `GET /api/briefing/freshness` | Changed files and affected sections (no rebuild). |
| `POST /api/briefing/refresh` | Incremental re-index plus rebuild of affected sections. |
| `GET /api/briefing/flow?id=&depth=` | Call tree from a node. |
| `GET /api/briefing/ask?q=` | Retrieval hits with summaries. |
| `GET /api/briefing/markdown?depth=&sections=` | Markdown export. |

CLI: `fehm brief [--depth minimal|standard|deep] [--sections overview,api] [--budget N] [--json] [--force]`.

## Deviations from the spec, and deferred items

- **Reused modules that no longer exist.** The spec names `knowledge-model.ts`, `contract-intelligence.ts`, `security-graph.ts`, `testing-intelligence.ts`, `project-intelligence.ts`, `intelligence.ts` and `report-explanation.ts`. All were removed in the fresh rebuild, so the evidence model maps Feature 1 provenance directly. The API, infrastructure, security and testing orientation is a small set of bounded pattern checks, all marked heuristic. The 3.4–3.6 features should replace these with their own results when they are built.
- **Invalidation is at file-role granularity, not per symbol.** A source edit rebuilds every source-dependent section (about 110 ms). That is correct, but coarser than the spec's "only API and Security".
- **Not indexed by Feature 1:** `.sql`, `.prisma` and `.tf`. The Database and Infrastructure sections say so as unknowns.
- **Deferred:**
  - Optional LLM synthesis (Mode B) and deep subsystem explanation (Mode C), beyond flow, explain and ask.
  - An MCP `get_codebase_brief` tool: the rebuilt tree has no MCP server yet; `fehm brief --json` and `/api/briefing` expose the same data.
  - Links to 3.3–3.8: those pages don't exist yet; 3.1 graph links are wired.
- **CLI output:** `fehm brief` waits for stdout to flush before the CLI's `process.exit`. Other commands still write without waiting, so output larger than 64 KB piped from them can be truncated. That is pre-existing and unchanged.
