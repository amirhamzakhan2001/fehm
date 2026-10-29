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

The default quick briefing places the declared purpose, structural inference, technology tags, entry points, storage signals, system-context preview and first-meeting concerns together. Index counts stay in expandable analysis metadata.

Five anchor-linked stages preserve all 18 analysis sections in a continuous onboarding report: Understand, Explore, Trace, Evaluate, and Change safely. `#stage-<stage>` and `#sec-<section>` scroll to content; legacy `#report-<group>` links resolve to the corresponding topic. Navigation does not hide report sections. Technical inventories remain expandable, and long lists render in batches.

- **Requirements:** existing capability claims and operational signals retain their source basis. Missing SLOs, reliability guarantees, privacy obligations and accessibility evidence remain unknown. Static test reach is never labelled as executed coverage.
- **Meeting preparation:** “Before Your First Project Meeting” brings together key facts, engineering concerns, questions derived from actual evidence gaps, and a reading order drawn from documented purpose, entry points and important components.
- **API reference:** search by route, handler or source; filter by HTTP method; inspect resolved handlers, relationships and related tests; open the corresponding static request sequence. Pagination replaces the former server-side group/item truncation. Request/response schemas, status codes and per-route authentication enforcement remain explicitly unestablished.
- **Evidence:** contextual filename/line references open the existing claim panel. Labels distinguish documentation, declared configuration, source verification, static patterns, inference and unknowns. No static result is called an observed execution.
- **Ask and export:** indexed retrieval, Markdown at three depths, and briefing JSON remain available. The browser's onboarding organization does not change the CLI/JSON contract. `/` focuses Ask; refresh failures preserve the prior briefing and expose a retry action.

### Diagram workspace

`ui/workspace.ts` uses Feature 3.3's cached architecture APIs, semantic IR, validated layout IR, shared `DiagramCanvas` and diagram styles. It adds no renderer dependency or extraction pipeline. `system&focus=context` projects the existing model into one repository boundary with evidence-preserving external relationships; a repository boundary is not a deployment boundary.

Views cover system context, system components, component drill-down, static runtime sequences, data flow, workflows/failure paths, discovered containers/deployment and dependencies. Controls provide pan, zoom, fit, full screen, keyboard node/edge selection, relationship/role highlighting, source navigation and standalone SVG export. Empty evidence and failed layout validation produce explanations rather than fabricated diagrams. The renderer is disposed when a refreshed briefing replaces it.

Runtime sequences are reconstructed from static calls. Evidence-free returns are illustrative, not traced execution. SQL references may come from examples or fixtures; neither table usage nor an SDK import establishes a live production integration. Verified ER diagrams are unavailable because the index does not extract column types, keys or cardinalities. The Data section preserves the available table/model usage without inventing schema relationships.

`ui/onboarding.ts` contains the pure grouping, provenance-label, reading-order and meeting-question projections. Regression tests cover those projections, API completeness and context relationship provenance. Browser verification covers FEHM, an API fixture and an empty repository.

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
  - An MCP `get_codebase_brief` tool: the current MCP server does not expose that tool; `fehm brief --json` and `/api/briefing` expose the same data.
  - Complete endpoint contracts and relational schema extraction are not supplied by the current briefing index.

Graph, Architecture, Architecture Drift, Project Health, Security Review, Prompt Intelligence and Git Memory links are available for deeper investigation.
- **CLI output:** `fehm brief` waits for stdout to flush before the CLI's `process.exit`. Other commands still write without waiting, so output larger than 64 KB piped from them can be truncated. That is pre-existing and unchanged.

### Continuous engineering onboarding report

FEHM retains its original application sidebar and collapse behavior. Only Explain Codebase has a local, sticky section navigation. Its five anchors—Understand, Explore, Trace, Evaluate, Change safely—scroll through one continuous report. A topic selector reaches individual areas directly. Sections are never hidden when navigating; existing `#sec-*` and legacy `#report-*` links remain supported, with keyboard focus and reduced-motion-aware scrolling.

The reading order is defined in `briefing/ui/report.ts`. All 18 existing analysis sections appear exactly once. Understand introduces the actual project, detected consumers, inferred capabilities, FR/NFR evidence and technologies. Explore treats architecture, code organization, entry points, APIs, data and integrations as distinct topics. Trace connects static operations to their calls and evidence. Evaluate covers setup/deployment, security, testing, risks and optional recent Git history. Change safely presents dependencies, a prioritized source reading path with inline related-code/test inspection, documented design evidence and handover questions. Detailed blocks and unknowns remain expandable beneath concise explanations.

The system map stays in Explore; a separate operation map loads lazily when Trace approaches the viewport. Each map has independent camera/selection state and unique DOM IDs. Technology selection highlights actual usage in the system map and scrolls there. Endpoint inspection opens the corresponding runtime sequence in Trace. Both use the existing architecture model, validated layouts and SVG renderer. Unsupported schemas, deployment topology, business intent and production behavior are never filled with demonstration data.

Technology logos remain bundled locally from Devicon v2.17.0 with the existing MIT attribution. npm manifest requirements are shown with source evidence and explicitly distinguished from installed/resolved versions. Other version formats remain unextracted. Briefing version 7 refreshes caches for these additional facts. Declaration-only dependencies do not establish component usage. Recent Git history is read on demand through the existing bounded Git Memory API; it does not claim to summarize the full repository history or deployed releases.

Implementation: briefing/page.ts, ui/main.ts, ui/report.ts, ui/report-history.ts, ui/workspace.ts and ui/technology.ts; codebase-briefing/facts.ts, sections-interfaces.ts and types.ts. Dashboard files have been restored to their original sidebar implementation. Tests cover complete/unique report topic coverage, technology declaration and version evidence, briefing APIs and existing analysis. Browser checks cover restored desktop sidebar, continuous rendering, stage/topic anchors, API-to-flow and technology-to-map navigation, unique map IDs, inline dependencies/tests, Git history and mobile overflow.
