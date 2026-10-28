# Unified engineering concepts workspace

Concept Intelligence and Ontology Explorer previously split definitions from repository findings even though both used the same catalog and service. Their hard limits also made portions of the catalog unreachable. The merged Engineering concepts workspace retains both routes and the existing API, with one sidebar entry, one definition/evidence panel, and a complete paginated inventory.

## Research and ordering

- IEEE Computer Society's [SWEBOK knowledge areas](https://www.computer.org/education/bodies-of-knowledge/software-engineering/topics) provide a broad engineering reference, including design, architecture, testing and operations.
- The [C4 abstraction model](https://c4model.com/abstractions) starts with familiar systems, applications, components and code before deeper detail. This supports an approachable vocabulary-first presentation.

Neither source establishes conversational frequency. FEHM therefore labels its ordering as an editorial learning path: everyday engineering, working with systems, specialized concepts. An explicit, reviewable vocabulary set determines the first tier; practical catalog domains determine the middle tier; remaining entries stay accessible in the last tier. Exact name or alias searches take precedence. Within a tier, direct or structural repository evidence ranks ahead of reference-only entries. Documentation claims do not receive that evidence boost.

## Behavior

- Repository signals are the default; All concepts includes every catalog definition.
- Search covers names, aliases, definitions and finding paths. Domain, depth, evidence status, scope and path filters intersect.
- Thirty entries render per page. No catalog entries are dropped by the old lookup limit.
- Selection keeps the definition, source excerpts, graph navigation, related concepts, evidence limitations and advanced guidance together.
- `/ontology` opens the same workspace in All concepts mode; old dashboard ontology hashes select the merged feature.
- Catalog definitions remain usable when repository analysis fails. Definitions never imply implementation or runtime verification.
- Existing analysis, CLI lookup limits and evidence identities are unchanged; no new dependencies or remotely loaded assets.

## Limits

The curated tiers are not a measured popularity score and may need domain-specific tuning. Repository findings remain static signals, not proof of runtime behavior. Advanced guidance and history still use expandable structured data. The catalog is fetched once in full while DOM rendering is paginated; much larger future catalogs may warrant server pagination.

## Verification

Build, catalog/order/API tests, full repository suite and a Chrome workflow harness (`scripts/concepts-workspace-smoke.mjs`). Browser checks cover pagination, search and exact selection, reload, legacy route, mobile overflow and unavailable-analysis fallback. See the implementation report for final run results.
