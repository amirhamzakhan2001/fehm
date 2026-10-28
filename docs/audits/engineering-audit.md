# Engineering audit: Drift, Health, Prompt Intelligence

## Initial reconnaissance

FEHM uses Node HTTP routes, TypeScript and DOM-built UI (no React). FehmEngine owns bounded repository scanning, indexed source, graph edges and incremental hashes. BriefingFacts and ArchitectureService supply shared facts/AIR. Drift builds context, mined conventions, explicit contracts and decisions into evidence-backed grouped findings. Health combines AST metrics, graph reach, artifact coverage, dependency metadata, opt-in advisories and explicitly requested checks. PromptService reuses architecture facts and SecurityService, then discovers, analyzes, proposes candidates and evaluates recorded outputs. State is local JSON with atomic persistence; no new database is needed.

Retain: explicit-rule > approved-pattern > mined-pattern > framework > industry hierarchy; finding deduplication and intentional decisions; dimension-level health and distinction between structural reach and measured coverage; opt-in checks/advisories; static/semantic/behavioral prompt separation; source-span and evaluation gates before library-level apply.

## Confirmed initial findings

| Feature | Severity / confidence | Finding |
|---|---|---|
| Prompts | High / verified by code | Discovery skips test files in both AST and heuristic loops. |
| Prompts | High / verified by code | Identity uses path, owner, line and call, allowing same-line collisions. Broad fragment-line deduplication can erase distinct definitions. |
| Prompts | High / verified by code | Unresolved named definitions are discarded unless a resolved fragment reaches eight characters. |
| Prompts | Medium / verified by code | Configuration extraction omits common role/content and prompt/template keys; some text assets are excluded at ingestion. |
| Prompts | Medium / verified by code | Save records revision metadata, not candidate text. UI save reads the current mode selector rather than the displayed candidate's mode; editing is absent. |
| Health | High / verified by code | Service cache signature tracks config/reviews/build/advisories but not coverage artifacts. New coverage can remain invisible on the same engine. |
| Drift | High / verified by code | Malformed decisions become an empty file silently; the next decision can overwrite the damaged state. |

## Research and integration decisions

- TypeScript Compiler API: reuse the installed 5.x parser and SourceFile traversal; it fits the synchronous indexed-source architecture. Official compiler API documentation warns of changes in later major versions; no upgrade is needed. Existing Apache-2.0 dependency, no new redistribution surface. https://github.com/microsoft/TypeScript/wiki/Using-the-Compiler-API
- Istanbul: keep importing measured artifacts rather than equating graph reach with execution. Its instrumentation counters establish what coverage means; do not run repository test code during a scan. No new Istanbul package is bundled. https://istanbul.js.org/
- ArchUnit: use explicit dependency/layer/cycle constraints and justified exceptions as methodology. Its maintained 1.5.1 guide describes Java-bytecode/JUnit integration, unsuitable as FEHM's cross-language in-process analyzer. Reference only; no code reused. https://www.archunit.org/userguide/html/000_Index.html
- Promptfoo test-case documentation fetch failed during research. Do not claim its workflow or licensing was verified; preserve FEHM's existing exact-suite/model/digest evaluation gates instead of adopting an unverified dependency.

The audit does not infer that every current UI control or every possible runtime prompt is correct. Regression fixtures and browser checks below are required before completion.

## Implemented corrections

### Architecture Drift

`src/drift/decisions.ts` validates persisted version, record containers and decision values. Unreadable or invalid state produces an explicit issue; neither finding nor pattern decisions can overwrite it. `src/drift/drift.ts` includes that issue in report unknowns. Existing explicit rules, approved/mined patterns, grouping, review decisions and graph analysis remain in place. This audit did not change severity calibration or claim to establish semantic architecture correctness for every project.

### Project Health

`src/health/coverage.ts` exposes the existing artifact path catalog. `src/visualization/health/service.ts` observes those artifacts at repository and manifest roots, configured coverage paths, and source timestamps in its cache signature. Creating, replacing or deleting a coverage artifact refreshes the report without source reindexing. Existing structural-versus-runtime distinctions, unknown dimensions, advisory opt-in and execution approval remain intact. Timestamps plus size remain a cache heuristic; replacement preserving both can evade invalidation.

### Prompt Intelligence

- `src/scanner.ts`, `src/prompts/discovery.ts`, `python.ts`, and new `assets.ts`: include test fixtures, retain unresolved named definitions, assign distinct same-line IDs, retain referenced constants, recognize static file loads from indexed sources, traverse JSON prompt fields and role/content structures, and retain additional text/config/Python definitions. Repeated definitions remain individual source records; shared call-site references connect them.
- `types.ts` and `report.ts`: expose environment classification, definition references, analysis status and exclusion policy. A failed analyzer leaves the record visible and excludes its score from the average.
- `optimization.ts` and new `proposals.ts`: editable proposals, exact placeholder checks, sensitive-value rejection, separate atomic proposal persistence, stale-original checks, explicit storage limits, and refusal to overwrite corrupt proposal storage. Existing semantic/behavioral regression gates remain mandatory before recommendation. Conservative intent gates can reject legitimate rewrites; this is not a semantic equivalence proof.
- `src/visualization/prompts/service.ts`, `routes.ts`, `ui/main.ts`: pagination without inventory truncation, origin/unresolved/error filters, shared-definition links, source links, editing/checking/saving/export, saved proposal inspection, and saved-version selection for recorded-output evaluation/comparison. Saving a generated revision also retains the proposal. Selected candidate mode is captured instead of reading a later selector value. Saved candidates from an older original are rejected at evaluation. Refresh requests ignore stale responses.
- Existing global application navigation and unrelated report/architecture work were preserved.

## Discovery coverage and boundaries

| Source | Method / limits |
|---|---|
| JavaScript, TypeScript and JSX/TSX | Compiler AST, scoped/imported constants, recognized model/agent calls, messages, named definitions, template builders and static indexed file references. Dynamic branches/mutations remain partial. |
| Python | Conservative lexical extraction of supported calls, agent configuration, strings/f-strings, constants and named definitions. Not a Python semantic parser. |
| JSON | Syntax-tree traversal of nested prompt/instruction/template keys and role/content pairs; malformed prompt-like input retained as unresolved. |
| YAML/TOML | Lexical quoted/block/triple-string extraction; complex anchors, expressions and complete format semantics are not supported. |
| TXT/Markdown/MDX/Jinja/prompt assets | Prompt-oriented paths/names, instruction files and explicit instructional opening cues. Ordinary text is not automatically classified as a prompt. |
| Tests/examples/development | Included, classified by path. “Application candidate” means outside those path categories, not proven production execution. |
| Other languages/runtime-only sources | No claim of complete extraction. Reflection, remote prompt registries, environment-loaded content, computed paths, unsupported language builders and arbitrary DSLs can remain undiscovered. |

The shared scanner applies root ignore rules, dependency/generated/cache exclusions, hidden-path policy, binary checks, symlink exclusion and its default 1 MB file limit. The report exposes exclusion policy, not a per-file exclusion ledger. It scans eligible local untracked files too. Discovery never evaluates repository expressions or starts application tools. Secrets retain the existing redaction behavior; edited proposals reject detected sensitive values before persistence. Secret detection is heuristic, not a guarantee of sanitization.

IDs are deterministic for an unchanged scan and unique for distinct same-line records. They include source location and can change after line movement; cross-refactor identity migration is not implemented. Discovery coverage counts indicate analyzed files and candidate records, not recall against an unknowable runtime inventory.

## Verification

- Baseline: 48 existing Drift/Health/Prompt tests passed before changes.
- Focused regression: 52 tests passed, including four new fixtures in `test/engineering-audit.test.ts` for discovery retention/identity, separate proposal persistence, corrupt drift-state protection and coverage cache invalidation.
- Full repository suite: 307 tests passed, including scanner, server, graph, briefing, architecture and existing prompt regression gates.
- Final proposal/preservation refinements: build and 24 affected tests passed afterward.
- TypeScript check and production build passed.
- Chrome browser fixture: 56 prompt records, first-page limit, loading remaining records, test filter, selecting a prompt, generating/editing/saving/reopening a proposal, evaluating the saved version, Drift and Health page rendering, no page errors, and unchanged source all passed. Screenshot inspected at `/tmp/fehm-audit-prompts.png`. Browser harness: `/tmp/fehm-engineering-audit-browser.mjs` (temporary local verification artifact).

## Remaining risks and highest-priority follow-up

1. Expand independently labeled multi-language fixtures before claiming complete prompt discovery. Add format-aware YAML/TOML parsing only with a demonstrated benefit; no new dependency was added here.
2. Add an explicit candidate-classification review workflow and cross-edit identity migration. Lexical configuration/Python and role/content detection can produce false positives.
3. Recorded-output checks do not prove model execution, semantic equivalence or production quality. UI results are exportable but evaluation runs are not a durable run-history system; live provider interfaces remain opt-in library integration.
4. The browser offers reviewed patch export, not automatic source application. Existing library-level apply still requires approval, matching source and evaluation evidence, and validation/rollback.
5. Proposal storage is local, capped explicitly at 1,000 entries / 8 MB; no eviction or management UI is supplied. Multi-process concurrent writes are not serialized.
6. Validate cross-feature findings and drift severity on larger real-world reference repositories before recalibrating scores. This change fixes demonstrated correctness gaps; it is not an exhaustive proof of all requested analysis categories or all UI/device combinations.
