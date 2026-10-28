# Architecture library decision — 2026-10-26

## Decision

Retain FEHM's existing TypeScript semantic model, diagram projections, deterministic layered layout, dedicated sequence layout, validation/repair pipeline, and SVG canvas. **No production dependencies added and no third-party implementation code copied.** ELK.js is the strongest candidate for a future optional layout adapter; it is not selected for shipping in this change. Model/layout separation means that decision remains reversible.

FEHM is a framework-free Node >=20 application, with `three` and `typescript` as runtime dependencies. React Flow would introduce a UI framework solely for one workspace. A second graph renderer would also duplicate the existing source inspector, confidence styling, selection, keyboard interaction and SVG export. No listed repository is needed to implement the discovery and abstraction improvements.

## Audit of existing implementation

`BriefingFacts` and `buildArchitectureModel` already extract evidence separately from `views.ts` projections. `LayoutInput` carries diagram constraints; `DiagramLayout` carries geometry. `validateLayout`, repair, and persisted last-good geometry are independent of browser rendering. Sequence diagrams already have a different layout policy from structural and workflow diagrams. Reuse this architecture.

| Existing view | Finding / action |
|---|---|
| System | Major components plus externals becomes dense; default to the existing repository-context projection and retain subsystems as a drill-down. Do not rename source modules as deployment containers. |
| Components | Useful focused projection with parent and dependency context. Preserve breadcrumbs and source inspector. |
| Runtime | Lifelines and static call order already exist. Label as static sequence rather than observed execution. |
| Data flow | Source operations and storage signals already exist. Do not market this as an ER diagram. |
| Workflow | Branches, loops and failures already have flow layout. Offer only when control-flow evidence exists. |
| Lifecycle | State assignment evidence is partial, not an exhaustive state machine. Keep explicit qualification. |
| Deployment | Configuration-derived units and boundaries exist. Config declarations are not proof of live deployment. |
| Security | Trust-zone projection is useful; keep its distinction from a security audit. |
| Dependencies | Default capped at 30 modules; earlier note mentioned missing modules but not lost relationships. Add explicit relationship counts and an All modules choice. |
| Delta | Local Git comparison already exists. Preserve availability checks and source comparison semantics. |

The oversized layouts are primarily dense graphs plus conservative routing corridors. Undersized diagrams arise from automatically fitting all geometry to a viewport. Sparse projects are not an error. The old flat tab bar displayed unavailable views alongside useful ones and hid relevance behind tooltips. The replacement gallery groups available diagrams by engineering question, exposes evidence limitations, and generates a selected view on demand. Large diagrams now open at a minimum 75% scale; explicit Fit still shows the whole graph. This does not solve every dense graph: component drill-down and relationship filters remain necessary.

## Representative comparison

See [raw results](architecture-layout-results.json), [visual contact sheet](architecture-layout-comparison.html), and [reproduction script](../../bench/architecture-layout.mjs). Inputs are actual indexed FEHM sources and `bench/corpus` (API/data-access fixture), not invented demo nodes. Three projections per project: context, subsystems, and dependencies. All candidates receive identical node dimensions and relationship endpoints.

| FEHM projection | Nodes / edges | Existing layout fit | ELK fit | Cytoscape breadthfirst fit |
|---|---:|---:|---:|---:|
| Context | 5 / 4 | 100% | 100% | 90% |
| Subsystems | 28 / 148 | 15% | 31% | 12% |
| Dependencies | 30 / 154 | 15% | 31% | 11% |
| Fixture subsystems | 11 / 14 | 71% | 100% | 63% |

Fit is for 1100 × 650, capped at 100%. All runs had zero node-box overlaps. This does **not** establish zero edge crossings or label collisions. Candidate adapters are flat: they omit FEHM's boundaries, semantic bands and relationship-label constraints. Cytoscape uses its built-in headless breadthfirst layout with straight preview edges, not every possible Cytoscape extension. ELK uses layered orthogonal routing and fixed seed. FEHM timings include projection/validation (and initial model construction); candidate timings cover layout only. These are exploratory single-run timings, not fair throughput rankings. SVG previews intentionally use neutral common shapes; production semantics are reviewed in the live FEHM UI.

ELK materially improves compactness, particularly on the fixture, but the large graphs still fit at unreadable scale. The immediate fix is abstraction/discovery, not replacing the renderer. Reconsider ELK after a constraint-preserving adapter passes FEHM's independent validation with boundaries, edge labels, cycles, and representative compound graphs. Do not replace sequence layout with ELK layered layout.

Reproduce after building:

```sh
npm install --prefix /tmp/fehm-architecture-research/bench --ignore-scripts --no-audit --no-fund elkjs@0.12.0 cytoscape@3.33.1
node bench/architecture-layout.mjs /tmp/fehm-architecture-research/bench
```

## Repository assessment

Maintenance dates below are repository push/activity observations obtained from first-party repository metadata on 2026-10-26. All inspected GitHub projects were unarchived. Recent activity is a screening signal, not proof of support, correctness, or security. License entries describe inspected repository/package declarations, not a legal opinion about every optional artifact. Exact release dependency and notice audits would be required before adopting any currently rejected project.

| Project / first-party source | Activity | License observed | Fit, distribution and decision |
|---|---|---|---|
| [React Flow / xyflow](https://github.com/xyflow/xyflow) | Oct 22 | MIT core | React/Svelte components, pan/zoom, custom nodes and interaction. Local bundling possible; large-graph performance needs virtualization and memoization. Adds a framework and duplicate renderer. Reference interaction patterns; do not integrate. Paid Pro assets are separate. |
| [ELK.js](https://github.com/kieler/elkjs) | Oct 19 | Package: EPL-2.0 OR GPL-3.0-or-later | Layout only; layered, ports, routing, compound graphs. Framework independent, Node/browser, local worker optional. Best deferred adapter. Pinned 0.12.0 inspected and benchmarked; no runtime dependencies; unpacked package ~8.05 MB (not browser transfer size). EPL source/notice and modification distribution obligations require release review if adopted. |
| [AntV X6](https://github.com/antvis/X6) | Oct 23 | MIT | SVG/HTML node editor with ports and framework adapters. Local bundling possible. Rich editing/plugin surface exceeds a read-only architecture explorer. DOM-heavy graphs need benchmarked limits. Do not integrate. |
| [AntV G6](https://github.com/antvis/G6) | Oct 22 | MIT | Graph visualization, grouping, analysis and many layouts; framework-independent core. Local canvas/WebGL options are useful for large graphs but introduce a second rendering/interaction ecosystem. Defer unless FEHM needs a substantially larger interactive graph surface. |
| [Cytoscape.js](https://github.com/cytoscape/cytoscape.js) | Oct 21 | MIT | Headless algorithms and canvas rendering, framework independent, offline. Pinned 3.33.1 package and license inspected; no runtime dependencies. Good analysis toolkit; built-in breadthfirst was poor for dense FEHM overview. Existing algorithms and SVG evidence interactions cover current needs. No runtime adoption. |
| [D3](https://github.com/d3/d3) | Oct 21 | ISC | Modular DOM/SVG/Canvas primitives, local bundling. Not an architecture model or diagram-specific layout policy. FEHM already implements the required SVG/camera behavior; avoid redundant low-level tooling. |
| [Mermaid](https://github.com/mermaid-js/mermaid) | Oct 25 | MIT | Useful text-to-diagram documentation and many diagram families. Offline bundle supported; font/loading/security configuration still matters. Does not preserve FEHM's exact evidence IDs, inspector and validation pipeline automatically. Consider future Markdown export, not replacement of interactive views. |
| [D2](https://github.com/d2lang/d2) | Oct 11 | MPL-2.0 | Diagram DSL, multiple layout engines, local CLI/Go tooling. Good text artifact reference; binary/engine packaging and per-file copyleft obligations need review. Avoid a separate compilation/rendering path in the Node distribution. |
| [PlantUML](https://github.com/plantuml/plantuml) | Oct 24 | LGPL-3.0 repository metadata; artifact variants differ | Broad UML/documentation syntax. Java distribution and newer TeaVM JavaScript/browser options exist; not Java-only. Graphviz-backed types may need extra artifacts. Local operation possible, but exact chosen artifact licensing/dependencies must be checked. Reference sequence/state conventions; no bundled runtime. |
| [Graphviz](https://gitlab.com/graphviz/graphviz), [license](https://www.graphviz.org/license/) | Oct 25 activity | EPL-2.0 | Strong mature directed graph layout, offline native CLI. Native binary/WASM packaging and source notices add release work. No built-in FEHM evidence UI. ELK is the closer JS adapter candidate; no adoption. |
| [Diagrams](https://github.com/mingrammer/diagrams) | Oct 25 | MIT code | Python architecture DSL normally needs Python and Graphviz; cloud icon assets need their own terms checked. Useful infrastructure visual vocabulary, not a repository extractor or small Node/browser library. Do not install Python/Graphviz solely for this UI. |
| [draw.io](https://github.com/jgraph/drawio) | Oct 23 | Apache-2.0; bundled assets have separate notices | Full diagram editor, local/self-hosted operation. Valuable editing/export reference but too broad for generated read-only architecture. Third-party libraries/icons require audit. Do not embed the editor. |
| [Archify](https://github.com/tt-a1i/archify) | Oct 25 | Apache-2.0 repository metadata; component license notices must be checked | Agent-driven interactive architecture documents; bounded component selection, source linking and validation are useful references. Generation depends on agent reasoning/workflows, not a deterministic reusable FEHM extractor. Learn from progressive detail and last-good output; copy no code. |
| [Diagram Design](https://github.com/cathrynlavery/diagram-design) | Oct 25 | MIT | Agent skill and authored HTML/SVG diagram patterns; some outputs need no external runtime. Useful editorial spacing, overlap/clipping review. Not a package that deterministically extracts and renders architecture. Reference only. |
| [Structurizr](https://github.com/structurizr/structurizr) | Oct 5 | Apache-2.0 source; prebuilt server has separate commercial terms | C4 model with multiple views is the right conceptual reference. Java/Maven/Docker distribution and authored DSL do not replace FEHM source extraction. Do not assume Apache source makes prebuilt server free; see [server pricing source](https://github.com/structurizr/structurizr.github.io/blob/main/commands/03-server/01-pricing.md). Adopt modeling ideas, not server deployment. |
| [Graft candidate: naouaro/graft](https://github.com/naouaro/graft) | Aug 3 | MIT | User supplied a search, not a unique repository. This is a provisional match. Tree-sitter code graph with optional LLM summaries duplicates FEHM indexing. Learn structural/concept separation; no adoption without identity confirmation and a demonstrated extraction gap. |
| [Archi](https://github.com/archimatetool/archi) | Oct 25 | MIT | Java/Eclipse desktop ArchiMate model authoring, local operation. Useful enterprise modeling vocabulary; unsuitable as an embeddable browser dependency. Do not integrate desktop application. |
| [DBML](https://github.com/holistics/dbml) | Oct 23 | Apache-2.0 | Schema DSL, parser/core/CLI. Explicit Ref relations can support honest future ER extraction. Does not create schema evidence from arbitrary source code. Defer parser until real DBML inputs and schema projection are supported; no need to install a parser for an unavailable view. |
| [SchemaSpy](https://github.com/schemaspy/schemaspy) | Mar 5 | LGPL-3.0 | Database introspection/documentation; Java 17+, JDBC driver, viz.js or Graphviz. Local but requires database access and credentials rather than just source indexing. Suitable separate opt-in import workflow, not default local repository scan. |
| [Prisma / ORM](https://github.com/prisma/orm) | Oct 23 | Apache-2.0 | Schema language is a valuable source of explicit relations. Full ORM/client/engine distribution is not needed to draw architecture and would add installation/runtime machinery. Future schema-source adapter only; do not infer an operational database from package presence. |

The original `terrastruct/d2` and `prisma/prisma` URLs redirected to the sources above. For candidates not bundled, inspection covered metadata, README architecture/distribution descriptions, and relevant first-party documentation; it was not a full transitive dependency security audit.

## Selected responsibilities and remaining limits

1. **Extraction:** reuse `FehmEngine` and `BriefingFacts`; no second parser/indexer.
2. **Shared model:** reuse `ArchitectureModel` and source-linked confidence. No geometry in semantic entities.
3. **Projection:** existing registry and per-family view builders. Context aggregates typed relationships; components preserve parent context. Expose dependency detail explicitly.
4. **Layout:** existing layered/flow policies plus dedicated sequence lifelines; independent validation and last-known-good persistence remain intact.
5. **Rendering:** shared `DiagramCanvas`, readable initial camera, gallery, source inspector, type filters, full screen, documentation mode, and self-contained full-geometry SVG export.

This change improves discovery and exploration of the ten existing evidence-backed families. It does not claim a complete new schema/API/CI/test/class diagram extraction engine. Those require dedicated source-backed projections (including cardinalities, pipeline dependencies, or explicit contracts); the UI documents these gaps instead of drawing placeholders or inventing infrastructure. No cloud calls, model calls, external runtime assets, additional persistence, or worker infrastructure are introduced.

## Verification of the implemented workspace

- `npm run build` passed.
- 33 targeted tests passed across architecture, multi-family views, gallery/full dependency scope, and Explain Codebase context projection.
- Headless Chrome exercised FEHM, the API fixture and an empty repository, desktop and 390px mobile viewports, standalone and embedded dashboard routes.
- Verified gallery selection, context inspection, sequence lifelines, 75% minimum initial scale across resize, relationship filtering (148 total / 114 calls in the FEHM snapshot), documentation mode, full screen, and SVG download.
- Opened the exported SVG independently: complete relationships retained, no CSS variable dependencies or filter state, visible title/labels. Reviewed screenshots of context, mobile gallery, sequence, export and candidate layout comparisons.
- Benchmark adapters and third-party packages remain outside the shipped runtime. Dependency manifest and lockfile are unchanged.
