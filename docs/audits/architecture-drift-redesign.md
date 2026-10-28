# Architecture Drift: explanation, scope and comparison correction

## Root causes

- The primary map was the entire dependency graph squeezed between two sidebars; the relevant expected/observed sequence was a secondary text block.
- Missing local authentication signals were worded as absent enforcement, although imports and nearby calls do not prove middleware order or resource-level authorization.
- Generic naming and AI-associated lint findings inflated architecture findings; monorepo packaging alone enabled backend practices.
- Pattern comparison used a green check for zero deviations even without project evidence.
- History rendered unchanged commits and counts prominently; disappeared findings could only show a toast, and commit inspection returned a patch only when a file was supplied.
- The expanded FEHM source graph exposed a layout weakness: label positions were too restrictive and opposite-side stubs could cross too near bends when track ordering had a cycle.

## Implemented behavior

Overview identifies the inferred project type, relevant engineering domains, configured-rule deviations versus investigation needs, and an evidence-backed first investigation. An expandable applicability section lists source evidence and limitations for frontend, backend, persistence, access controls, AI, integrations, infrastructure and configuration. Lack of signals is insufficient evidence, not proof that a control is unnecessary or absent.

Findings group by engineering domain and distinguish configured-rule deviations, potential architectural risks, improvement opportunities, investigation needs and reviewed exceptions. Pattern observations remain distinct from violations; a zero with no project evidence is explicitly unverified. General naming, test-location preferences and generic quality/AI-attribution signals no longer become Drift findings; Project Health retains its quality analysis.

The map now starts with a selected-finding comparison: **Expected architecture** is a rule/convention reference, **Actual architecture** is the detector's observed sequence. Both use role-level abstractions from the same finding. A missing sequence produces a textual evidence comparison, never fabricated components. Node and relationship selection explains meaning, highlights matching roles/relationships and opens the finding's source evidence. Different paths are marked without claiming that a layer is missing elsewhere. Zoom, reset and fit/reset-scroll controls work on the bounded comparison. Long sequences scroll; narrow layouts stack. The broader existing pan/zoom dependency graph remains under an expandable context view, with node/module drill-down preserved.

History emphasizes the initial comparison state and commits where findings appeared/disappeared. Search supports component/path/finding IDs and commit text; date and change-type filters are available. Events link to actual commit metadata and bounded diffs. Working-tree entries explicitly have no commit. Disappearance is not labeled proof of a repair, and commit intent is attributed to the author. Historical snapshots still use today's rules/decisions, stated in the UI.

Authentication reference search now follows up to four import steps / 100 files. It is a bounded static reference search, **not** a control-flow proof. Findings direct users to inspect global middleware, mounting and policies before claiming exposure. Generic monorepos no longer imply server-specific obligations.

Layout repair tries nearby label positions without relaxing collision validation; opposite-side stubs receive separation as well. Layout and drift version changes invalidate incompatible cached results.

## Rule framework and research decisions

No new library or external code was bundled.

- [OWASP Authorization Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html) describes request-level permission validation and centralized enforcement. This supports treating an isolated file's missing auth reference as incomplete evidence, not proof of missing authorization. Authentication and authorization are not interchangeable.
- [ArchUnit user guide](https://www.archunit.org/userguide/html/000_Index.html) supplies a reference for explicit architecture constraints and configurable layers. FEHM retains its local contract evaluator instead of integrating Java bytecode tooling or prescribing one universal architecture.

| Rule family | Applies / rationale | Required evidence | Limits / false positives |
|---|---|---|---|
| Explicit project contracts | Rules deliberately configured for this repository | Matched units and observed dependencies | Only exercised rules are evaluated; parser coverage is limited |
| Layer/data-access conventions | Comparable backend roles demonstrate a convention | Direct access/imports, majority examples, relevant stores | Direct handlers may be intentional; reference layers are not mandatory |
| Authentication boundary consistency | Comparable route modules show auth references | Local and bounded transitive references | Global middleware, policy configuration, dynamic calls and intentionally public routes need investigation |
| Module boundaries/cycles | Modules and dependency relationships are indexed | Actual edges and paths | Runtime-only coupling is unknown |
| Testing/configuration/resilience conventions | Relevant source units and comparable signals exist | Tests, config reads, logging/error references | Static relationships are not execution coverage or operational guarantees |
| Deployment/AI controls | Actual infrastructure/SDK evidence exists | Source/config evidence in applicability report | No invented load balancer, rate limiter, password-storage or RAG findings; dedicated controls remain unverified where analysis is unavailable |

## Verification

- TypeScript checks and production builds passed.
- Focused Drift/comparison tests cover detector-derived sequences, missing-sequence fallback, classification, static sites, monorepo applicability, transitive auth references and removal of lint noise.
- Full suite initially failed one architecture showcase test. Fixed the label/routing defects without weakening validation; rerun passed **315 tests**.
- Final applicability refinement passed **16 focused tests**; final wording/selection changes were rebuilt and checked with the Drift suite.
- Chrome harness (`scripts/human-workspace-smoke.mjs`) passed comparison selection, matching-role highlights, zoom/reset, source navigation, persisted decisions, history commit diffs and filters, and stacked 390px mobile comparison. Existing prompt, health and Git workflows also passed; no JavaScript page errors.
- The first added History browser assertion used a button selector for a tab; corrected and rerun successfully.
- Screenshots inspected at `/tmp/fehm-drift-comparison.png` and `/tmp/fehm-drift-comparison-mobile.png`.

## Files

Analysis: `src/drift/{drift,mining,knowledge,scope,types}.ts`.
UI/API: `src/visualization/drift/{page,service}.ts`, `ui/{main,comparison}.ts`.
Layout: `src/architecture/{layout,types}.ts`.
Verification: `test/{drift,drift-comparison}.test.ts`, `scripts/human-workspace-smoke.mjs`.

## Remaining limitations

- Diagram nodes represent roles, not newly proven services; source evidence is attached to the finding rather than pretending each abstract role has an exact implementation span.
- Comparison uses the available detector sequences. Not every finding has a graph, and the focused view does not synthesize authentication/deployment flows where evidence is insufficient.
- Authorization, password storage, rate limiting, distributed failure guarantees and deployment topology are not comprehensively verified by this pass. Security findings remain the dedicated Security feature's responsibility.
- History is a bounded recomputation under current rules. It is not a complete architectural-event extractor or a reconstruction of the team's original intent.
- Confidence categories qualify static evidence. Review decisions record intentional/accepted/dismissed findings; no button claims a code repair occurred.
