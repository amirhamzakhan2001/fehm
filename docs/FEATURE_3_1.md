# Feature 3.1 — Localhost Codebase Graph

One continuously navigable graph of the whole repository: project → folders → files → classes → functions/methods/variables, plus the semantic relationships between them (imports, calls, references, uses, inherits, implements). Served by `fehm serve` at `http://127.0.0.1:4317/graph`.

Feature 3.1 is a **visual consumer of Feature 1**. It has no scanner, parser, linker or graph of its own. Every node and edge on screen is a `CodeGraph` fact from `FehmEngine`; search goes through the engine's index; node details come from `engine.explain`.

```
FehmEngine.graph ─→ adapter (hierarchy from contains/defines) ─→ layout (server, cached) ─→ columnar payload
                                                                                              │
browser:  GraphModel (typed arrays, CSR adjacency) ─→ visual state (filters · focus · hover · search)
          ─→ WebGL2 renderer (instanced nodes + GPU-tessellated curved edges) + 2D label layer
```

## Modules (`src/visualization/graph/`)

| Module | Responsibility |
|---|---|
| `model.ts` | View types, per-kind styles, payload schema. Every node is a glowing circle; kinds differ by glow colour, with only a narrow size range (≈4:1, project → variable) for structural level, never degree. Shared by server and browser; type-only imports. |
| `adapter.ts` | Reads `CodeGraph`; parent = source of the node's `defines` edge (class beats file) else its `contains` edge. External packages are grouped under the project for placement only. |
| `layout.ts` | Deterministic hierarchy-aware layout (below). |
| `service.ts` | Builds the payload, owns `.fehm/graph-layout.json`, forwards search/detail to the engine. |
| `routes.ts`, `page.ts`, `assets.ts` | `/graph`, `/graph/assets/*`, `/api/graph/*`. Browser modules are the compiled `dist` files, or the `.ts` sources transpiled with the TypeScript compiler Fehm already depends on — no bundler, no CDN, strict same-origin CSP. |
| `ui/graph-model.ts` | Immutable render model: typed arrays, child/edge CSR, bundling control points. |
| `ui/visual-state.ts` | Pure: filters → visibility; selection/hover/search → per-node alpha/glow and per-edge alpha/width. |
| `ui/renderer.ts` | three.js (MIT, served locally via an import map — no CDN) HDR pipeline: three additive layers — **nebula** (a wide faint cloud per node, so dense regions accumulate into glowing clouds tinted by the kinds that dominate them), **edges** (light streams), **stars** (each node an over-exposed core in a coloured point-spread falloff, core size capped per kind so zoomed-in entities stay points of light) — into a half-float target, then `UnrealBloomPass` and a hue-preserving tone map (luminance-only extended Reinhard with hue-preserving gamut scaling instead of per-channel ACES), so accumulated light keeps the dominant kind's colour instead of bleaching to white. Exposure, bloom and edge strength fall as the camera zooms out (and a little more for graphs over ~1.5k nodes), where many entities share each pixel. Geometry uploaded once per model; interaction only rewrites per-instance attributes; pan/zoom are uniforms. |
| `ui/labels.ts` | Density-aware, priority-ordered, collision-free labels (cap 320). |
| `ui/camera.ts`, `ui/spatial.ts` | Map camera (log-space zoom anchored at the cursor, animated fit); grid spatial index for picking and label culling. |
| `ui/store.ts`, `ui/canvas-view.ts`, `ui/sidebar.ts`, `ui/search.ts`, `ui/inspector.ts`, `ui/main.ts` | UI state store, render loop + interaction, panels, bootstrap. |

## Layout

1. **Packing, bottom-up.** Each entity's children (their whole clusters) are packed around it, largest first. Each goes on the free spot that is closest to the centre and to already-placed siblings it has semantic relationships with. Edges are lifted to the sibling pair under their lowest common ancestor, so `api/` and `services/` sit next to each other when their files call each other. A cluster is placed by its enclosing circle rather than by its parent node, so single-child folder chains grow linearly instead of doubling per level.
2. **Refinement.** 15–60 iterations of weak, degree-normalized semantic springs against a strong anchor to the packed position, with collision. Nodes lean toward what they relate to, and the hierarchy stays readable.

Nothing is placed on a predetermined circle or sphere; the overall shape emerges from the packing.

**Stability.** Positions are saved to `.fehm/graph-layout.json` (`LAYOUT_VERSION`). When at least 50% of the current nodes have saved positions, those positions are kept exactly. New nodes are inserted on the nearest free spot beside their parent, parents first. The sidebar's **Re-layout** discards the file.

Measured on a synthetic repo of 18,050 nodes and 48,049 edges: full layout plus payload 0.9 s, cached load 74 ms, client model 12 ms, focus recompute under 1 ms, payload 2.2 MB.

## Interaction

- **Zoom** is continuous and centred on the cursor. Level of detail changes rendering only: tiny entities recede to faint points, labels appear as on-screen size grows, and a detail line (kind · line · path) appears when close. Data is never dropped.
- **Selection** puts the view in focus mode. The selected node is brightest (white outline plus halo pulse); direct relationships and, for folders, files and classes, their contents are emphasized; edges leaving the selected subtree stay visible at medium strength. Everything else is dimmed, never hidden. Clicking empty canvas clears the selection.
- **Filters** are view-only. Filtered-off folders and files stay as faint spatial context; other kinds are hidden. Edges show only when their kind is active and both endpoints are shown. A selection is cleared only when its kind becomes hidden.
- **Search** uses `engine.search` and never scans source. Matches inside the active filters come first; matches outside them are listed separately, and picking one re-enables its kind.
- **Inspector:** relationship groups (Calls / Called by / …) from the loaded graph; summary, signature, doc, evidence and unresolved references from `explain`; *Open source* via the `vscode://file` handler.
- **State:** filters, selection, camera and labels persist per project in `sessionStorage`. `#node=<id>` deep-links a selection. The status indicator shows Loading / Computing layout / Ready / Stale (fingerprint re-scan on window focus, at most every 15 s) / Updating / Error. Refresh re-indexes incrementally and keeps camera, filters and selection.
- **Keys:** `/` search · `Esc` clear · `f` fit (to the selection when one exists) · `F` focus mode · `+`/`-` zoom · `0` reset · `l` labels.

## API

| Route | |
|---|---|
| `GET /api/graph` | Columnar payload (`GRAPH_VIEW_SCHEMA`). |
| `GET /api/graph/status` | ready/empty, counts, whether a layout is cached. |
| `GET /api/graph/search?q=` | Engine search hits. |
| `GET /api/graph/node?id=` | Detail via `engine.explain`. |
| `GET /api/graph/freshness` | Working tree vs index (hash-only re-scan, `FehmEngine.freshness()`). |
| `POST /api/graph/refresh` · `POST /api/graph/relayout` | Incremental re-index · fresh layout. |

## Deviations from the spec, and deferred items

- **Visual theme.** Galaxy/nebula: brightness is emitted light, so density reads as glow. The nebula is emitted by real nodes only; there are no decorative particles.
- **No React and no Web Worker.** The repository has no frontend toolchain, so the UI is plain TypeScript modules around a central store; the camera and animation run outside the store, which meets the spec's rule against per-frame UI renders. Layout runs on the server, which keeps it off the UI thread, deterministic, testable under `node --test`, and persisted for stability.
- **Node and edge kinds** are Feature 1's, including module, field, enum, route and section, and writes, configures and handles. For filtering only, the view splits `contains` into *contains folder* / *contains file* and `defines` into *defines method* / *defines field* by target kind (`viewEdgeKind`); Feature 1 stores a single kind. Fields start filtered off (high volume). Kinds added after a view was saved start at their default instead of being treated as switched off. Unknown kinds render with a fallback style.
- **Edge bundling** is a single control point pulled toward the endpoints' lowest common ancestor. There is no force-directed bundling. Direction is shown as a source-faint → target-bright gradient rather than arrowheads.
- **Deferred:** minimap; delta streaming (refresh reloads the payload; positions stay stable); layout for graphs far beyond about 50k nodes (not yet benchmarked); edge confidence encoding in the canvas (it appears in the inspector tooltips).
