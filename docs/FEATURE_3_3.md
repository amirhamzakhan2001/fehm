# Feature 3.3 — Architecture

`fehm serve` → `http://127.0.0.1:4317/architecture` (dashboard: `/#/architecture`), and `fehm architecture` on the command line.

3.1 answers *what is connected to what*. 3.3 answers *what this codebase is as a software system*. It shows the major components and their roles, the interfaces into the code, and the data stores and outside systems the code reaches. From there you can drill down to modules and files. It is a curated projection of the Feature 1 graph, not another graph renderer. No model is called.

```
FehmEngine ─→ BriefingFacts (3.2's single extraction pass)
                 │
                 ▼
        semantic model (src/architecture/model.ts)
        components · modules · files · actors · stores · externals
        roles + confidence + evidence · file-level links
                 │  views are projections (views.ts)
                 ▼
        Layout IR (layout.ts) ──→ validation (validate.ts) ──fail──→ repair (looser spacing, ≤5 attempts)
                 │ pass                                       └──still fails──→ last known good / nothing
                 ▼
        .fehm/architecture-layout.json (verified layouts by view + fingerprint)
                 ▼
        /api/architecture/* ──→ /architecture page (SVG canvas + inspector)
```

## Two IRs, kept apart

- **Semantic IR** (`ArchitectureModel`): what exists, what connects, why, the evidence and the confidence. It carries only a semantic tier hint (outside/top, inside, outside/bottom) and never pixels.
- **Layout IR** (`DiagramLayout`): rectangles, wrapped text lines, orthogonal routes, label rectangles, boundaries and the viewBox for one view. The same semantic model can produce several views.

IDs are derived from identity (`component:src/auth`, `module:src/skill*`, `file:src/a.ts`, `store:database`, `external:stripe`, `rel:<a>→<b>`), so a later architecture delta can diff models directly.

## Evidence and confidence

| Confidence | Meaning | Examples |
|---|---|---|
| Verified | Compiler/AST/filesystem fact, or a manifest declaration | route nodes, `imports` of a DB client, manifest `bin`, `calls` edges |
| Strong | Pattern-extracted from a specific source line, or several independent heuristic links | route registrations, SQL statements, `process.argv`, DOM API use, file writes |
| Inferred | A reading of names or structure | `services/` → service logic; "used by ≥3, uses nothing" → shared |
| Unknown | No evidence; the role is not claimed | a directory with no signals |

Rules:
- Evidence priority is declarations/compiler facts, then source lines, then names, then shape. A weaker tier never overrides a stronger one.
- Clusters never borrow a name-based role from their hub.
- Nothing without evidence is drawn. The database node appears only for SQL statements or a DB-client import. It is named after the engine only when a client declares one ("SQL database" otherwise). External systems appear only for an imported service SDK (payments, AI, cloud, queue, cache, …) or a literal outbound URL. Web frameworks and other libraries are listed as technologies in the inspector, not as boxes.
- Coverage is shown as shares of claims per confidence level, never as a quality score.
- `unknowns` states what could not be determined, for example that runtime traffic is not observed.

## Components

Modules come from 3.2 (directory, or filename-prefix group in a flat directory). They are grouped into at most 12 system-level components, deterministically:

1. **Collapse directories, deepest first.** This runs while there are too many groups, never at the common source root, and never into a group larger than 2.5× the fair share.
2. **Merge by dependency affinity.** Affinity is the cosine of file-level dependency counts. Loose sibling modules merge with each other, and directories merge only with their own subdirectories. Two groups with different evidenced roles never merge, and an interface (HTTP API, CLI, UI) never dissolves into a role-less cluster.
3. **Name the cluster after its hub:** the member that uses the most other members. Barrel files (`index`) are excluded.

Hierarchy: system → component → module → file. The 3.1 graph takes over at symbol level ("Open in graph").

## Views

One page, ten lenses in three groups. The tabs are always all shown. A view whose evidence the repository lacks is disabled, with the reason as its tooltip (for example "No Dockerfile, compose file, Kubernetes manifest or hosting-platform configuration was found"). Views about one thing at a time have a picker: entry point, process, entity, revision or component.

| # | View | Evidence it is built from | Layout | Module |
|---|---|---|---|---|
| 1 | **System** | Components inside a system boundary; actors above; stores and external systems below | layered, semantic bands | `views.ts` |
| 2 | **Components** | One component's children (modules, or files). Components it uses sit below and components that use it sit above, dashed, as context | layered, focus boundary | `views.ts` |
| 3 | **Runtime / sequence** | From one entry point (HTTP route, CLI command, worker, `main`): resolved calls in call-site order. Calls across components become messages with replies; SQL, file I/O, outbound HTTP and SDK calls become messages to stores and systems. Labelled "not a recorded runtime trace" | sequence: participants, lifelines, ordered messages | `view-runtime.ts`, `sequence-layout.ts` |
| 4 | **Data flow** | Callers → entry handlers → functions that touch data → tables (from SQL), files, external systems. Writes point at the store; reads come out of it | flow layering, ranks | `view-dataflow.ts` |
| 5 | **Workflow** | One process function's structure: steps (resolved calls, found per line so repeats count), decisions (`if`/`else if`, `switch`/`match`), loops (retry when the code says retry/attempt/backoff), error paths (`catch`/`except`), returns → End, throws → Fails | flow layering (loops are back edges) | `view-workflow.ts`, `control-flow.ts` |
| 6 | **Lifecycle** | States from status-like enums, literal unions and Python Enums. Transitions from status assignments: the guard just before (`=== X`, `case X`) is the origin, else the previous assignment in that function. Literals and defaults start it; states with no way out are final | flow layering | `view-lifecycle.ts` |
| 7 | **Deployment** | docker-compose services (depends_on, ports, connection strings), Dockerfiles, Kubernetes Deployment/StatefulSet/Service/Ingress (selectors, rules), platform files, CI deploy steps. Datastores and gateways by image; build contexts → code components. Each compose project and namespace is its own boundary | ranks per group | `view-deployment.ts`, `yaml.ts` |
| 8 | **Security** | Zones: callers → public entry points → authentication → trusted code → data, secrets and sinks. Auth = auth libraries + auth-named functions reached from routes; per-route check for a reachable auth call; sinks (exec, eval, raw HTML, deserialization); secret-like env vars. Labelled "not a security audit" | ranks per zone, zone boundaries | `view-security.ts` |
| 9 | **Dependencies** | The 30 most connected modules; the rest are counted in a note | layered by dependency depth | `views.ts` |
| 10 | **Delta** | The same model built at a git revision (`git archive` into a temp dir) and compared by stable id at module level: added / removed / changed (files or weight), with unchanged endpoints as context. Default: working tree vs last commit, or the previous commit when clean | layered, status styling | `view-delta.ts` |

`views.ts` holds the registry (`VIEWS`), `describeViews` (availability, reasons and choices) and `buildView`. `view-kit.ts` holds the shared entry-point discovery, call-site ordering and per-function data operations.

Behaviour and operations nodes (workflow steps, states, containers, messages) exist only in the view that shows them. The inspector API resolves them from the views built so far.

## Layout

Deterministic and Sugiyama-style:

1. Semantic bands, then longest-path layers over the condensed DAG (a cycle shares one layer). Foundations and isolated parts go to the bottom of the band.
2. Wide layers are split into rows of at most 7 nodes or 1500px.
3. Dummy corridors are inserted for long edges.
4. Barycenter crossing minimization keeps the best ordering seen.
5. X placement uses weighted isotonic regression toward neighbour barycenters, with minimum separation.
6. Ports are distributed per side, sorted by the other end. Nodes widen when a side carries many ports.
7. Stubs are separated: same-side stubs and straight runs of different edges are kept ≥ 8px apart. Ports slide along their side; a dummy corridor moves as a whole.
8. Channels are routed with a **constrained left-edge** algorithm. Where one edge descends near the x at which another rises, the descending one takes the higher track, so vertical runs never share a line or cross next to a bend.
9. Labels slide along each segment (the one entering the target first) and are checked against nodes, labels, every route and boundary borders.
10. Boundary titles are placed in the top corners, or in a widened left gutter when routes cross both corners.

Node widths come from a per-glyph text measurement table (`text.ts`), not a character count. Long names wrap to two lines; the full name stays in the accessible label and the inspector. The browser re-measures after rendering and compresses any text its font renders wider (`textLength`), so a font difference can't cause overflow.

## Validation (`validate.ts`)

The validator re-measures the finished geometry and does not trust the layout's construction. **Showcase** is the profile that publishes, and all of these are hard failures:

- non-finite geometry, unknown endpoints or members
- `node/overlap`, and node gap < 16px (`node/tight-spacing`)
- `edge/through-node` (4px clearance), `edge/detached`, `edge/non-orthogonal`, `edge/short-terminal` (< 12px for the arrowhead)
- `edge/collinear-overlap` between different edges, `edge/ambiguous-crossing` (a crossing within 5px of a bend reads as a junction)
- `label/unplaced`, `label/overlap-node`, `label/overlap-label`, `label/overlap-edge`, `label/overlap-boundary`
- `boundary/membership`, `boundary/intrusion`, `boundary/partial-overlap`, `boundary/title-*`
- `viewbox/clip`, `viewbox/invalid`

**Standard** downgrades spacing, crossing and collinear rules to warnings. Every diagnostic carries a rule code, subjects, the measured and required values, and suggested fixes.

**Repair.** Up to 5 attempts, each loosening spacing (node gap, channel padding, track gap, port gap). Nodes, edges and labels are never dropped to pass.

**Last known good.** A failed candidate never replaces a verified layout of the same view. With no verified layout at all, nothing is drawn by default: the page lists the diagnostics and offers the failed draft only on explicit request, clearly marked.

## Caching

Views are memoized per engine instance. Verified layouts persist in `.fehm/architecture-layout.json`, keyed by `view:focus` and the model fingerprint (hash of indexed file contents + `ARCHITECTURE_VERSION` + `LAYOUT_VERSION`). An unchanged repository serves them with no layout work. Zooming, selecting and searching never regenerate anything; Refresh re-indexes incrementally.

Bump `ARCHITECTURE_VERSION` when model output changes, and `LAYOUT_VERSION` when geometry changes.

## Page

- **Header and bar.** Search (`/`) covers architecture nodes, then Feature 1 retrieval hits mapped to the node that owns their file; choosing a hit switches to a view that contains it. The bar holds the view tabs, a drill-down breadcrumb, upstream/downstream/both highlighting, zoom, Fit and 1:1.
- **Canvas.**
  - **Shape, not colour alone:** interfaces have an accent bar, actors are pills, stores are cylinders, external systems are dashed, context nodes are dashed-hollow, and stacked cards can be opened.
  - **Confidence:** a dot in each node's corner shows role confidence, and edges are solid when verified and dashed when inferred.
  - **Semantic zoom:** subtitles, tags and labels hide below 55%, and second title lines below 32%.
  - **Keyboard:** Tab order follows the diagram, arrows move to the nearest node in that direction, Enter selects and Shift+Enter opens.
  - **Trace and motion:** Shift+click a second node to trace the shortest dependency path. Motion is limited to camera moves and respects reduced motion.
- **Inspector.**
  - **Node:** role, confidence and reasons; the description from doc comments; files, symbols, depends on / used by (with weights), technologies, most-used symbols, why-this-role evidence and files.
  - **Relationship:** type, confidence, counts by Feature 1 edge kind, and evidence samples.
  - **Every evidence row** opens the source excerpt (only indexed files are readable), the 3.1 graph node, or the editor.
  - **Empty state:** legend, evidence coverage and what was not determined.
- **Footer.** Validation source and attempts, node and relationship counts, crossings, the fingerprint, and notes.
- **Deep links.** `#view=components&focus=<id>&sel=<id>` (from the dashboard: `/#/architecture?view=…`).

## API

| Route | |
|---|---|
| `GET /architecture` | Page. |
| `GET /api/architecture` | Summary: counts, coverage, views, unknowns, freshness. |
| `GET /api/architecture/view?type=system\|components\|dependencies&focus=` | Semantic nodes/relationships + validated Layout IR + validation report. |
| `GET /api/architecture/node?id=` | Node detail. |
| `GET /api/architecture/relationship?id=` | Relationship detail (re-aggregated for drill-down/file-level ids). |
| `GET /api/architecture/source?path=&line=` | Excerpt of an indexed file. |
| `GET /api/architecture/search?q=` | Search hits with the node to show. |
| `POST /api/architecture/refresh` | Incremental re-index. |

CLI: `fehm architecture [--view …] [--focus ID] [--json]`. It exits 1 when no verified layout exists.

## Deviations from the spec, and deferred items

- **Reused modules that no longer exist.** The spec builds on `architecture.ts`, `architecture-provider.ts`, `knowledge-model.ts`, `public/report-diagrams.js` and `directed-layout.js`, all removed in the rebuild. 3.3 builds on `FehmEngine` and 3.2's `BriefingFacts` instead, and has its own layout engine. **ELK is not used:** its compound-graph, port and orthogonal routing concepts were implemented directly so validation can reason about every construction step, and no new dependency is added.
- **Fixed alongside:** 3.2's CLI detection matched the word `click` (the Python library) in browser UI files, so DOM `click` handlers counted as command-line evidence. It now requires an import. `BRIEFING_VERSION` is now 2; 3.2's Architecture section links to 3.3.
- **All ten views are implemented.** Each extractor is heuristic in a stated way and marks its confidence:
  - **Workflow:** a structural reader, not a compiler.
  - **Lifecycle:** assignment and guard patterns.
  - **Security:** static signals. It should consume Feature 3.6 when that exists.
  - **Delta:** module level; commit-to-commit git memory belongs to 3.8.
- **Also fixed in 3.2:** a Kubernetes manifest named `app.yaml` was classified as a Google App Engine config (`BRIEFING_VERSION` 3). JWT-style auth libraries are no longer drawn as external systems (`ARCHITECTURE_VERSION` 2).
- **Changed by Feature 3.4:**
  - `handles` edges (handler function → route node) are now aggregated as route file → handler file, the direction of the dependency. Before, a route in `api/` handled by `services/` read as "services depends on api" (`ARCHITECTURE_VERSION` 3).
  - A node side that receives two or more labelled edges is widened so each port has a label-width gap beside it. This repository's system view had four "writes" edges into the filesystem store, and one label had no place (`LAYOUT_VERSION` 2).
  - Label placement tries the seven preferred positions per segment first, then sweeps the segment in ~6px steps.
  - The layout cache moved from `.fehm/architecture.json` to `.fehm/architecture-layout.json`: the old path is 3.4's architecture contract, which is committed with the code. A leftover cache at the old path is ignored by 3.4.
  - The diagram CSS is shared (`diagram-css.ts`), and the canvas takes `{ wheel: "modifier" }` for diagrams inside a scrolling page.
- **Other deferrals:**
  - **Boundaries:** one level only (the system, or the opened component). Nested package boundaries are deferred; package membership shows in the inspector.
  - **LLM interpretation:** component responsibility beyond doc comments is deferred. The architecture is fully deterministic.
  - **Theme and tests:** there is no light theme, since the dashboard pages are dark only. Screenshot-based visual regression tests are deferred. Geometry is covered by validator unit tests, seeded stress tests (100 nodes / 250 edges), a determinism check, and validation of this repository's own views.
- **Density:** the Dependencies view caps at 30 modules. That is a readability decision made up front and stated in the footer. It is not a repair.
