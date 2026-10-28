# Feature 3.12 — Change Impact & Risk Analysis

**Status:** Researched implementation proposal; not implemented or approved for implementation.
**Repository audit and documentation research:** 27 October 2026.

## 1. Executive summary and developer problem

**Recommendation: build a shared change-impact engine and integrate its first user interface into Feature 3.10, Change Verification & Review. Do not add another dashboard initially.**

A developer changing unfamiliar code needs to know which consumers deserve inspection, why they are connected to the change, and which existing checks could reveal a regression. FEHM already lists reverse file dependencies and recommends checks. The valuable increment is narrower: revision-correct changed symbols, inspectable dependency paths, and actionable findings that distinguish observed relationships from possible behavioral consequences.

For example, changing a function declaration should identify indexed callers and link their call sites. Removing the function must retain evidence from the base revision, even though the function is absent from the current graph. Neither finding proves that a caller is broken: the caller may have changed too, or the declaration change may be compatible. A compiler result, contract checker, or behavioral test supplies stronger evidence.

The product should answer “inspect these consumers and run these checks because of this evidence.” It should not answer “this change has a 78% chance of failure.” Success means fewer overlooked consumers and less investigation time than the existing 3.10 report plus IDE navigation. That advantage remains to be measured.

## 2. Research findings and comparison

These findings come from official documentation and the local implementation, not comparative benchmarks. Tool claims are not independent evidence of prediction accuracy.

| Approach | What it does well | Limits relevant to FEHM | Product decision |
| --- | --- | --- | --- |
| Git and PR diffs | Precise changed content and selectable comparisons. Git distinguishes index, working tree, endpoint and merge-base comparisons. GitHub PR comparisons use merge-base semantics. | A diff does not explain downstream behavior; choosing the wrong base changes the question. | Reuse Git; expose exact comparison semantics and resolved revisions. [Git diff](https://git-scm.com/docs/git-diff), [GitHub branches](https://docs.github.com/en/pull-requests/reference/branches). |
| Precise code navigation | Language indexes support definition/reference navigation. Sourcegraph uses language-specific SCIP indexers. | Precision depends on language support, indexing inputs and freshness; static references do not establish runtime effects. | Reuse FEHM's graph with its actual provenance; do not claim compiler precision for heuristic edges. [Sourcegraph](https://sourcegraph.com/docs/code-navigation/precise-code-navigation). |
| Build-system affected analysis | Nx combines changed files with task inputs and dependencies; current Nx 24 documentation describes task-based analysis. Turborepo supports affected package/task selection. | Useful build boundaries are not necessarily function or behavioral boundaries; configuration, lockfiles and incomplete Git history require conservative treatment. | Recommend a repository's existing affected/check scripts when configured. Do not recreate its build graph or silently override its selection. [Nx](https://nx.dev/docs/features/ci-features/affected), [Turborepo](https://turborepo.dev/docs/reference/run). |
| Test-impact analysis | Datadog links previously observed test/suite coverage to changed code and tracked files to select tests. | Requires execution-derived mapping and suitable history; FEHM's aggregate line coverage is insufficient for equivalent safe skipping. | Rank tests as candidates; retain required suites. Add per-test coverage only if demand justifies instrumentation. [Datadog](https://docs.datadoghq.com/tests/test_impact_analysis/how_it_works/). |
| Ownership routing | CODEOWNERS assigns review responsibility through explicit repository rules. | Ownership is not proof of expertise, defect likelihood, or behavioral impact. | Optional later review routing; no author, churn, or ownership-based risk score. [GitHub CODEOWNERS](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-code-owners). |
| API compatibility checking | oasdiff compares explicit OpenAPI contracts with request/response-specific rules. | Requires contract artifacts; a changed route or interface alone cannot prove incompatible wire behavior. | Recommend existing configured contract checks. Do not reproduce OpenAPI compatibility analysis in the MVP. [oasdiff](https://www.oasdiff.com/docs/breaking-changes). |
| Migration analysis | Atlas provides migration linting and dedicated analyzers for schema changes. | Schema/dialect/state information matters; source filenames alone do not establish deploy compatibility. | Surface changed migrations and configured checks; no database connection or migration execution in impact analysis. [Atlas lint](https://www.atlasgo.io/versioned/lint), [analyzers](https://www.atlasgo.io/lint/analyzers). |
| AI-assisted review | Review assistants can explain diffs and suggest issues across code. | False positives and omissions still require review; fluent explanation is not dependency evidence. | No LLM in the MVP. Optional later summaries must cite deterministic evidence and cannot add confirmed findings. [GitHub responsible use](https://docs.github.com/en/copilot/responsible-use/agents). |

The realistic gap is a local, cross-feature evidence trail between a particular change, its indexed consumers, existing findings, and verification choices. Mature language servers, build tools and CI remain better authorities for their respective tasks. FEHM should bring their relevant evidence together rather than compete by adding more analysis categories.

## 3. Audit of reusable FEHM capabilities

The following describes the checked-out implementation, including uncommitted work, rather than assuming that feature specifications are fully shipped.

| Existing capability | Implementation evidence | Reuse and genuine gap |
| --- | --- | --- |
| Context engine and graph, 1/3.1 | [engine.ts](../src/engine.ts), [graph.ts](../src/graph.ts), [model.ts](../src/model.ts) | Reuse indexing, symbol locations, graph adjacency and provenance. Add change-specific inverse traversal with witness paths and revision identities. Static graph coverage varies by language. |
| Briefing / Explain, 3.2 | [facts.ts](../src/codebase-briefing/facts.ts) | Reuse modules, routes, manifests, test inventory and file associations. `fileDeps` collapses nonstructural edges into file pairs, only includes source/test files and loses individual edge identity. It is not sufficient as the sole impact evidence model. |
| Architecture / Drift, 3.3–3.4 | [model.ts](../src/architecture/model.ts), [contract.ts](../src/drift/contract.ts), [drift.ts](../src/drift/drift.ts) | Group affected components and reuse approved architecture-contract findings. Inferred module boundaries are not policy violations. Missing contracts mean unknown policy, not conformity. |
| Health / Coverage, 3.5 | [build.ts](../src/health/build.ts), [tests.ts](../src/health/tests.ts), [coverage.ts](../src/health/coverage.ts), [types.ts](../src/health/types.ts) | Reuse discovered checks, test links and coverage evidence. Aggregate line hits do not establish per-test coverage. Artifact age alone does not bind coverage to a revision. |
| Security, 3.6 | [types.ts](../src/security/types.ts), [service.ts](../src/visualization/security/service.ts) | Reuse existing finding severity, source evidence, traces and remediation. No second scanner; findings must match the analyzed content before being attached as current evidence. |
| Prompts, 3.7 | [service.ts](../src/visualization/prompts/service.ts), [specification](FEATURE_3_7.md) | Link prompt/tool-contract evidence when those assets change. Prompt intelligence is not a generic risk-estimation or LLM-review service. |
| Git Memory, 3.8 | [git.ts](../src/git-memory/git.ts), [semantic.ts](../src/git-memory/semantic.ts), [snapshots.ts](../src/git-memory/snapshots.ts) | Reuse validated revisions, rename-aware diffs, bounded blobs and historical materialization. Existing TS/JS declaration fingerprints identify syntactic changes, not ABI compatibility. Compact historical snapshots discard locations/provenance needed for full impact paths. |
| Concepts / Ontology, 3.9 | [specification](FEATURE_3_9.md) | This is engineering-concept evidence and a catalog, not change analysis. Optional explanatory vocabulary; not a required dependency or risk signal source by itself. |
| Change Verification, 3.10 | [change.ts](../src/guardrails/change.ts), [workflow.ts](../src/guardrails/workflow.ts), [specification](FEATURE_3_10.md) | Already detects working-tree scope, traverses reverse file dependencies, finds tests, suggests package checks, records approved execution and security evidence. It lacks retained dependency paths and matched before/after symbol graphs. There is overlapping traversal in analysis and reporting. Extend this workflow rather than duplicate it. |
| Debugging, 3.11 | [investigate.ts](../src/debugging/investigate.ts), [verification.ts](../src/debugging/verification.ts), [specification](FEATURE_3_11.md) | Reuse evidence/context conventions and verification links. Failure-centered investigation remains distinct from downstream change analysis; share graph primitives without forcing both into one traversal algorithm. |
| Local dashboard | [server.ts](../src/server.ts), [guardrails page](../src/visualization/guardrails/page.ts), [routes](../src/visualization/guardrails/routes.ts) | Reuse navigation, report presentation, source links and request protection. Add a focused panel and contextual entry points. |

Additional constraints found during inspection:

- Current 3.10 working-tree discovery treats renames as delete/add pairs; Git Memory already has rename-aware comparison utilities.
- Current path-based security/configuration/persistence categories are hints, not evidence of incompatible behavior.
- Historical snapshot construction currently also builds architecture, health, security, drift and prompt reports. Extract content materialization for impact indexing rather than running every feature on every comparison.
- `configures` edges run from configuration to configured entities. Call/import/reference edges generally run from consumer to dependency. `handles` orientation varies between analyzers. A generic “reverse every edge” traversal is incorrect.
- A `writes` edge identifies a static write relationship; chaining it through readers does not establish runtime dataflow.
- Engine freshness, Health fingerprints and Guardrails execution fingerprints serve different purposes. Do not compare them as interchangeable identities.

## 4. Functional and non-functional requirements

This capability matrix is also the justification for scope. Every row requires a measurable benefit beyond existing functionality.

| Capability | Developer problem / existing gap | Required evidence | Validation |
| --- | --- | --- | --- |
| Exact comparison scope | “Which version am I reviewing?” 3.10 currently covers combined working changes. | Resolved commits or captured index/worktree manifests, diff semantics and content digests. | Staged/unstaged isolation, rename, deleted and merge-base fixtures. |
| Changed-symbol localization | File-level reach overstates impact of a small edit. | Before/after source spans, hunks and supported parser declarations. | Separate declaration/body/comment changes; fall back explicitly when unresolved. |
| Explainable affected consumers | Existing lists do not show why a file appears. | Same-revision graph edge chains with original locations/provenance. | Each witness independently reconstructs from the graph; deleted-symbol consumers retained. |
| Actionable findings | Existing categories do not consistently connect concern to action. | Explicit rule, changed entity, relevant dependency or existing finding. | Reviewer accepts reason/action; harmless changes produce few unnecessary warnings. |
| Test recommendations | Developers need a useful first check; graph links cannot prove sufficient coverage. | Static test path, configured suite mapping or revision-bound observed coverage. | Relevant tests rank above unrelated tests; required suites never disappear. |
| Cross-feature evidence | Related security/drift/health evidence is scattered. | Compatible report versions and source identities. | Stale/unavailable reports remain explicit; no duplicate scan or contradictory status. |
| Contextual UI and export | Developers need to inspect evidence without another graph dashboard. | Shared report and existing source/feature navigation. | Finding-to-source navigation and bounded export usability tests. |

Non-functional requirements:

- Local and deterministic by default; no network, model invocation, code execution, package installation or repository mutation during analysis.
- Bounded work with cancellation, partial-result reporting, deterministic ordering and explicit truncation counts.
- Provenance on every dependency, finding, test association and verification reference.
- No “safe to merge” conclusion from an empty report, passing checks or missing evidence.
- Preserve existing mandatory checks, policy enforcement and execution ledger behavior.
- Stable versioned JSON output; errors distinguish invalid scope, unavailable evidence, partial analysis and internal failure.
- Reuse existing parsers and graph storage. Add no new database, service or multi-agent orchestration.

## 5. Change-analysis workflow and scope semantics

1. Select a comparison or a code location. Show its exact meaning before analysis.
2. Pin revisions or capture local content identities; enumerate changed paths, statuses and hunks.
3. Match changed declarations on both sides; resolve ambiguous or unsupported edits at file granularity.
4. Traverse permitted dependency relationships separately in each revision.
5. Group affected components, attach relevant compatible evidence, and apply a small set of explainable rules.
6. Present significant findings, candidate tests, existing check recommendations and limitations.
7. Inspect code or hand the current-content check plan to 3.10. Record execution there; refresh impact after edits.

| Scope | Exact proposed semantics | Release placement |
| --- | --- | --- |
| Working tree | HEAD versus captured disk content: staged + unstaged tracked changes and eligible untracked files. | MVP. |
| Staged | HEAD versus the Git index, including index-only contents. Never substitute disk contents for staged blobs. | MVP after snapshot isolation tests pass; otherwise explicitly unavailable, not approximated. |
| Branch | Resolved merge base of explicit base and head versus resolved head. Show both commits. | MVP thin wrapper over committed comparisons. |
| Commit | Explicit parent versus commit; root commit uses empty base. Require parent selection for merge commits. | MVP. |
| Two revisions | Exact endpoint comparison. Distinguish this from branch merge-base semantics. | MVP. |
| File/function/symbol | Potential consumers of a selected entity in one indexed revision. No invented diff or claim that an edit occurred. | MVP lightweight entry from graph/source. |

Do not hardcode `main` or fetch remote history. Suggest an available upstream/base from repository metadata, display it, and require an explicit base if ambiguous. Multiple merge bases need an explicit comparison decision. Invalid or unavailable revisions fail with a recovery action; no silent fallback to the whole repository. In a repository without Git, selection mode remains available and diff mode is unavailable. An unborn repository uses an explicit empty base.

Unmerged index entries block staged comparison until resolved. Capture index and source manifests before and after analysis; reject or label raced results stale. Git rename similarity is an alignment hint; retain old/new paths and ambiguous symbol matches. Deleted declarations seed the before graph; added declarations seed the after graph. Binary files, generated files, submodules, LFS pointers, symlinks and ignored paths appear as excluded/unresolved scope with a reason. Do not parse a pointer as its target content or follow a symlink outside the root. Generated contracts can matter: link their generator/configured checks without treating generated noise as many independent findings.

## 6. Risk indicators and prioritization

A finding describes a possible consequence and the evidence needed to establish it. Dependency presence is a repository fact; behavioral breakage is normally unconfirmed.

| Signal | Required basis and interpretation | Recommended action / false-positive control |
| --- | --- | --- |
| Declaration/interface shape changed | Supported declaration comparison plus indexed consumers. Export status indicates possible external exposure, not a proven stable public API. | Inspect affected call sites; run existing compiler/build and relevant tests. Label “signature changed,” not “breaking change,” without stronger diagnostics. |
| Shared model/serializer change | Changed field/type and actual references/import paths to serializers or queries. | Inspect mapping, serialization and read/write assumptions; run contract/integration checks. File imports are coarse evidence, not proof that a particular field is used. |
| API contract changed | Explicit contract artifact or route/handler evidence with changed request/response declarations. | Run configured schema compatibility/consumer checks. Route-name or filename matches alone remain hints. |
| Security-sensitive behavior changed | Changed authorization/validation handler with supporting code or existing security evidence. | Inspect negative-path tests and policy enforcement. A path named `auth` alone does not justify a high-severity finding. |
| Migration/schema changed | Changed migration/schema artifact, source excerpt and any resolvable consumers. | Review compatibility and deployment order; recommend configured migration lint. No destructive-operation certainty from a filename. |
| Configuration changed | Changed key/artifact plus explicit `configures`/reference evidence where available. | Inspect consumers/defaults and configuration checks. Missing links mean unknown reach; do not implicate every module. |
| Error handling/validation changed | Changed supported declaration/body locations, linked callers and relevant existing evidence. | Inspect error-contract/negative tests. MVP groups this under behavioral review unless a reliable parser rule already supplies evidence; no keyword-only defect warning. |
| Many consumers | Actual bounded path set and distinct component count. | Group inspection by component. Fan-out is reach, not severity or probability; disclose lower-bound counts when truncated. |
| Limited test evidence | No linked tests, unmapped changed lines, or compatible coverage showing unexecuted lines. | Explain precisely which evidence is missing and recommend suite/manual checks. Absence of a link is not absence of testing. |
| Architecture contract violation | Existing explicit contract rule and matching drift evidence. | Link 3.4's finding. Compare compatible before/after results to label newly introduced versus pre-existing; otherwise “baseline unknown.” |

Ordering is deterministic: existing applicable high-severity security/contract evidence first; changed declarations with consumers and concrete compatibility questions next; behavioral inspection/test gaps next; informational reach last. Preserve source severity for imported findings. Do not invent a common numeric score or escalate merely because a diff is large.

Deduplicate using rule family, changed entity, affected entity, revision side and consequence. Merge equivalent witness paths and actions; retain distinct source evidence IDs. A security finding should appear once with both its originating feature and change relationship. Group file-level imports below precise symbol evidence, but preserve uncertainty rather than laundering heuristic links into confirmed dependencies.

## 7. Test-impact analysis and verification

Rank test candidates using transparent evidence tiers:

1. Indexed test call/reference to a changed symbol.
2. Test connected through a bounded symbol or module path.
3. Existing Health association or package check covering the containing project.
4. Naming/proximity suggestion, explicitly heuristic and not a dependency fact.

The report states which tier produced each recommendation. The same test is displayed once with its supporting paths. A passing test, an existing test file and aggregate line coverage answer different questions and must have different labels.

Reuse Health's configured command discovery. Prefer existing package-specific or affected-test scripts when their configured scope matches. Do not manufacture runner-specific arguments, expand shell globs or infer that an arbitrary `npm test -- file` command selects that file. A candidate test can be shown without an executable command. Framework adapters and measured per-test coverage can come later.

Show coverage as revision-bound only when source identities establish that relationship. Otherwise show its age and uncertain applicability. Preserve missing mappings for reflection, fixtures, generated code and integration behavior. Keep required full suites in 3.10 regardless of candidate ranking.

Analysis recommends; 3.10 executes only under its existing approval and frozen-command protocol. Attach result references with content fingerprint, command, time and actual status: not run, passed, failed, inconclusive, timed out or stale. Never apply a current worktree run to a committed/staged snapshot with different contents. Running tests against historical materializations is excluded from the MVP; dependencies and environment would require separate preparation and authorization. Passing checks do not confirm every impact was found.

## 8. UI/UX specification

Add an **Impact** section to the existing `/guardrails` Change Verification page. Keep existing visual language, compact report rows, source navigation and keyboard interaction.

- Top row: scope selector, explicit base/head or captured local identity, Analyze/Refresh, freshness/partial status.
- Summary: changed files/symbols and affected component counts; no aggregate risk badge. Empty state says “No supported findings detected” with scope and limitations.
- Main list: a small set of deduplicated actionable findings. Each row names the changed entity, affected component, reason and recommended check.
- Expand a row to inspect the dependency path as a textual sequence, source excerpts, provenance and revision side. Default to one shortest strong witness; allow bounded alternatives.
- Tests/checks section: candidate test reasons, existing check plan and links to actual 3.10 results. Selecting recommendations does not approve execution.
- Limitations stay visible near the summary; detail lists excluded files, unresolved relationships, unsupported language evidence, stale reports and budget cutoffs.

Before-revision links open a read-only revision excerpt using Git blobs, with commit/path/line visible. Current-file links use existing navigation only when content still matches. Deleted files must not open a similarly named current file. Preserve analysis selection when moving to Security, Drift or Health.

Git Memory comparison views can pass validated scope to this panel. Graph/source selections can open selection mode. Use a shared render model; do not add another graph visualization. Only add a dedicated `/impact` route later if usability testing shows the 3.10 location prevents discovery; the engine and panel must remain identical.

Loading, cancellation, unsupported comparison, stale analysis, partial results and no-change states need distinct presentation. Accessibility acceptance includes keyboard traversal, readable source links, focus retention after refresh and no color-only distinction between facts and inferred effects.

## 9. Technical architecture and data flow

Proposed modules, not existing APIs:

```text
CLI / Guardrails panel / Git comparison / graph selection
  -> src/impact/scope.ts          resolve and capture exact comparison
  -> src/impact/revisions.ts      reuse Git materialization + FehmEngine
  -> src/impact/changes.ts        hunks and changed declarations
  -> src/impact/traverse.ts       side-specific, typed witness paths
  -> src/impact/evidence.ts       compatible existing-feature evidence
  -> src/impact/rules.ts          deduplicated findings and recommendations
  -> src/impact/service.ts        immutable report, cache and cancellation
  -> src/impact/context.ts        bounded optional context export
  -> shared panel / JSON / 3.10 check-plan adapter
```

### Revision construction

Extract the safe content-materialization portion of `git-memory/snapshots.ts` so both features can use it without invoking every analysis report. Reuse `FehmEngine` and its existing analyzers for materialized revisions. Historical compact `MemorySnapshot` objects cannot substitute for full symbol graphs.

Use validated immutable commit IDs and argument-array Git invocation, NUL-delimited paths, literal pathspec handling, and disabled external diff/textconv. For staged scope, materialize indexed blobs and modes rather than copying the disk. For local scope, capture eligible contents and verify they remained unchanged. Retain relevant manifests, ignore rules and compiler configuration; report unavailable external resolution. Never install dependencies to improve precision automatically.

A changed-file-only index cannot discover unchanged inbound callers. Build or reuse a complete eligible graph for each relevant side, subject to explicit budgets. Initial materialization can reuse existing limits of 5,000 files, 20 MiB total and bounded individual blobs; these are completeness limits, not performance guarantees. Provide clear partial results for larger repositories and measure before raising limits. Clean temporary materializations on completion, cancellation and failure.

### Changed-symbol mapping

Use diff hunk old/new ranges to find enclosing graph declarations. Refactor the existing TS/JS semantic helper where useful; it already distinguishes declaration identities and source changes. Add normalized supported declaration-shape comparison separately from body changes. Normalize trivia but retain meaningful parameter/type/export changes. Overloads, anonymous expressions, re-exports and ambiguous matches must remain candidate sets or file-level fallback.

Identifiers include revision side and source identity. Do not assume graph IDs survive renames. Align before/after symbols only with sufficient declaration/path evidence; preserve unresolved matches. Return deleted, added, body-changed, declaration-changed, moved and unknown categories without equating any category with a defect.

### Typed traversal

Define and fixture-test an edge-semantics adapter:

| Graph relation | Impact traversal |
| --- | --- |
| calls / references / uses / imports | From changed dependency to indexed consumers; preserve symbol versus file granularity. |
| extends / implements | From changed base/interface to derived/implementing entities; compatibility still unproven. |
| configures | From changed configuration to its configured targets. |
| handles | Normalize route/handler endpoints by node kinds and analyzer behavior before traversing. Unsupported combinations stay unknown. |
| contains / defines | Locate enclosing declarations/files only; never treat all containment as behavioral reach. |
| writes | Retain as related evidence. Do not infer writer-to-reader causal propagation in the MVP. |

Traverse before and after independently. Never concatenate an old edge with a new edge to fabricate a path that existed in neither revision. Merge displayed entities only after preserving side-specific witnesses. A before-only consumer may itself have been deleted; show that fact rather than claiming it is currently broken.

Start with bounded breadth-first traversal, depth 3, 1,000 visited entities, 2,000 traversed edges and at most 3 witness paths per affected entity. These are proposed defaults to tune through evaluation. Report depth/size cutoffs and unresolved frontier counts. Apply cycle detection, stable sorting and cancellation between bounded batches. Skip unrelated structural/external expansion; identify the boundary rather than silently terminating it.

### Report contract

Use a schema-versioned immutable report with these records:

| Record | Minimum fields |
| --- | --- |
| `ChangeScope` | mode, requested refs, resolved refs, comparison semantics, selected entities |
| `RevisionIdentity` | side, commit/index/worktree kind, content manifest digest, analyzer/config versions, completeness |
| `SymbolDelta` | before/after entity references, old/new spans, change category, match method, ambiguity |
| `EvidenceRef` | origin, revision side, source digest, path, line span, symbol/edge/report ID, provenance |
| `ImpactPath` | seed, affected entity, ordered evidence-backed steps, side, direct/indirect classification, inference notes |
| `RiskFinding` | rule/version, changed entity, affected component, rationale, evidence IDs, source priority, missing evidence, action IDs |
| `TestLink` | test, relationship tier, evidence IDs, coverage applicability |
| `CheckRecommendation` | existing check ID, reason, scope applicability, required/suggested status, execution reference if any |
| `ImpactReport` | ID, identities, findings, paths, counts, limits, unknowns, timestamps, report dependencies |

Do not use an edge's numeric extraction confidence as a probability of failure. Repository observations, imported tool results and optional model interpretation require separate origins. Future model text cannot overwrite deterministic fields.

### Integration and failure handling

Expose one service to `fehm impact` (read-only text/JSON), Guardrails and dashboard routes. Proposed endpoints: analyze a validated scope and retrieve a report by ID. Bound request bodies, reject invalid paths/refs and apply existing Host/Origin/nonce protections to requests that create local report state. Avoid arbitrary file-read or command endpoints.

3.10 consumes impact reach and recommendations, preserving its policy and ledger. Remove duplicate reverse-impact implementations only after parity tests, keeping a documented file-level fallback. 3.11 may reuse revision/evidence primitives while retaining failure-oriented traversal. Health/Security/Drift adapters are optional: missing or stale reports must not block basic graph analysis or be silently treated as clean.

Invalid scope is an error. Missing graph evidence produces partial analysis. Missing optional feature reports produce explicit unavailable evidence. Internal errors never become an empty successful assessment. Recheck local identities before displaying cached results or approving downstream checks.

## 10. Shared engine versus dedicated feature

| Option | Advantages | Costs / decision |
| --- | --- | --- |
| A: independent workspace and implementation | Obvious product entry point; independent comparison experience. | Duplicates 3.10 scope, impact, test recommendations and review flow; more state and navigation. Reject independent implementation. |
| B: shared engine with 3.10 presentation | One source of impact truth; reusable from Git/graph/debugging; execution remains where it already exists. | Requires careful extraction and compatibility tests; “impact” must be discoverable within verification. Recommended. |
| Shared engine plus dedicated page later | Keeps reuse while improving discovery if demonstrated necessary. | Additional navigation/UI cost without proven benefit today. Defer pending usability evidence. |

“Shared” means a small typed service, revision adapter and report contract. It does not mean a new platform, plugin framework, distributed graph service or redesign of every feature.

## 11. Token efficiency, caching and performance

The MVP uses no LLM tokens. Provide an optional export for a developer's existing assistant: changed declarations, the most important findings, complete short witness chains, relevant test/check references and limitations. Default to an estimated 4,000-token budget, configurable downward; label the estimate and actual byte count. Deduplicate source ranges. Drop lower-priority findings before dropping the evidence that explains a retained conclusion. Include IDs for omitted evidence rather than filling the budget with repository inventory.

Cache keys include both revision content identities, comparison mode, analyzer/rule/schema versions, configuration and ignore-rule digests, traversal limits and attached report identities. HEAD alone is insufficient for staged or dirty work. First implement conservative invalidation; incremental affected-subgraph recomputation is deferred until correctness and profiling justify it. Persist bounded metadata/reports only in the existing local state conventions; do not create another execution ledger or retain whole repository snapshots indefinitely.

Warm graph traversal should target p95 under 2 seconds on a disclosed reference fixture within the default limits. Cold revision indexing must be timed and reported separately; it may dominate runtime. This is an acceptance target, not a measured result. Instrument file/edge counts, materialization time, index time, traversal time, peak memory and cache hit rate. If cold cost outweighs saved review time, ship current-revision selection/working scope first and keep expensive comparisons explicitly on demand. Do not silently downgrade revision correctness to meet latency goals.

## 12. Accuracy, safety and false-positive controls

- Static dependency existence does not establish execution, value flow or failure. Label both extraction provenance and the inferred consequence.
- Dynamic dispatch, reflection, runtime injection, generated code and external consumers remain explicit blind spots. No dependencies found means unknown reach where indexing is incomplete.
- Match imported findings to compatible source identities. Only label “new” when comparable baseline/current analyses exist; otherwise baseline status is unknown.
- Prefer exact symbol edges to file imports, and file imports to name/proximity suggestions. Never present name matches as confirmed callers.
- Ordinary comments/docs-only fixtures should avoid behavioral warnings. Do not assume every `.md` or text file is harmless: executable docs, templates and configuration-like text may feed tools.
- Redact source excerpts and exports using existing secret handling, and avoid reading ignored environment secrets merely to explain configuration reach. Show key names and consumers, not secret values.
- Parse repository content as data. Disable Git external diff/textconv; do not invoke hooks, build scripts, generators, tools downloaded from manifests or commands embedded in source/model output.
- Use argument arrays, bounded subprocess output/time, rooted paths and validated Git refs. Historical materialization must reject traversal, unsupported modes and unsafe symlinks; cleanup cannot escape its allocated directory.
- Impact recommendations never authorize execution. Existing Guardrails approval freezes argv/cwd/policy/content; project scripts can execute arbitrary project code and its runner is not an OS sandbox.
- No automatic patching, database execution, network scanning, dependency installation, CI publication or reviewer messaging.

## 13. MVP implementation phases

Each phase ends in a reviewable acceptance gate; no application implementation is part of this document.

1. **Extract and define.** Add report/scope contracts, typed edge semantics and safe reusable revision materialization. Characterize 3.10's existing behavior before replacing traversal. Gate: no regression to required checks, content attestation or execution approval.
2. **Capture accurate changes.** Implement working/committed comparisons and symbol/hunk localization; then exact staged and merge-base wrappers. Gate: staged isolation, deletions, renames, root/merge commits, missing history and concurrent edits behave explicitly. Unsupported modes stay unavailable.
3. **Produce witness paths.** Traverse both sides with bounds, provenance and deduplication. Gate: every path reconstructs from one matching graph and reference fixtures retain deleted-symbol consumers without inventing cross-revision paths.
4. **Attach actionable evidence.** Add declaration-change, affected-consumer, migration/configuration and test-gap review signals plus compatible existing security/drift/health evidence. Gate: each finding has evidence, uncertainty and an actionable next step; no duplicate scanner or score.
5. **Integrate delivery.** Add read-only CLI/API, Guardrails panel and Git/graph entry points; adapt 3.10 to the shared report. Gate: source/revision links work, historical/staged evidence cannot attach to mismatched test runs, accessibility and failure states pass browser checks.
6. **Evaluate and decide release.** Run scenario fixtures, real-repository comparisons and developer tasks below. Gate: demonstrable usefulness over existing FEHM and acceptable runtime; simplify or defer unsupported language/rule classes rather than promote noisy claims.

Later: per-test execution-derived coverage, additional precise language adapters, existing external contract-check result ingestion, ownership routing, measured incremental indexing, optional evidence-only LLM summaries and a dedicated page if navigation research supports it.

Excluded: autonomous refactoring, generic CI orchestration, debugger/observability replacement, full interprocedural runtime dataflow, universal API compatibility checks, database migration execution, safe-test-skipping claims and defect-probability scoring.

## 14. Acceptance criteria and evaluation scenarios

| Scenario | Required behavior | Failure / false-positive check |
| --- | --- | --- |
| Signature change with direct callers | Identify supported changed declaration and exact caller paths; recommend existing compiler/tests. | Do not call compatible optional-parameter changes broken. |
| Shared model with serializer/query | Show supported field/symbol paths or explicitly coarse module links. | Do not claim field-level flow from a file import. |
| Authorization edit | Show changed handler, applicable existing security evidence and negative-path checks. | Auth-like filename alone cannot create a high-severity conclusion. |
| Shared utility with limited tests | Show consumers, linked tests and missing mapping honestly. | No assertion that a test file's existence means coverage. |
| Configuration edit | Follow correct configuration-edge direction; identify known consumers and unknown reach. | Do not reverse every edge or implicate every component. |
| Dynamic dependency | Preserve unresolved dependency limitation and recommend appropriate integration inspection. | Empty graph reach cannot yield a safe conclusion. |
| Harmless comment/docs edit | No unsupported behavioral risk warning; show no substantive supported change when established. | Include executable-doc/template counterexamples. |
| Deleted/renamed symbol | Retain before-side consumers and old source links; distinguish callers also removed. | No fabricated path assembled across revisions or current file linked at an old line. |
| Staged change with unrelated disk edits | Analyze exact index contents only. | Disk-only edits cannot leak into staged graph or findings. |
| Branch comparison with dirty worktree | Use resolved committed comparison; show captured semantics. | No accidental dirty graph reuse. |
| Migration/API contract | Show changed artifacts, evidence limits and configured compatibility checks. | No inferred compatibility guarantee or automatic database command. |
| Missing base, conflicts, stale index, huge/binary files | Error or partial state with cause, excluded scope and recovery action. | Never silently report complete/no-impact. |
| Overlapping Security/Drift findings | Preserve provenance and baseline status, deduplicate presentation. | Existing findings are not automatically newly introduced. |
| Checks pass on different contents | Mark results inapplicable/stale. | No passing badge attached to mismatched staged/historical changes. |

Build a versioned initial corpus of at least 40 cases across supported precise and heuristic language paths. Include cycles, overloads, re-exports, fixtures, generated artifacts and multi-package repositories. Ground truth must distinguish manually confirmed static edges from observed behavioral effects; do not measure runtime-impact recall against a static graph as though it were exhaustive.

Proposed release gates, to measure rather than claim achieved:

- 100% of displayed factual paths reconstruct from their declared revision and existing edge/source evidence.
- Zero cross-revision or staged-content leakage in scope tests; zero bypasses of required-check policy.
- At least 95% precision for paths labeled precise in curated supported-language fixtures; report heuristic precision separately. Report every missed expected static consumer, with a target of at least 90% recall within declared bounds.
- No high-priority unsupported warning on the harmless-change fixture set. Report actionable-finding precision separately from graph-edge precision, with reviewer reasons for rejected findings.
- Report test recommendation relevance, mapping gaps and required-check retention. Do not present skipped-test safety metrics without execution-derived ground truth.
- Publish warm/cold p50/p95 timing, resource use and truncation rates on disclosed repository sizes and hardware; investigate material regressions against current 3.10.
- Conduct paired tasks with 6–10 developers using current 3.10 plus IDE navigation versus the new panel, counterbalancing order. Measure time to locate relevant consumers, missed important checks and explanation usefulness. A provisional target is 20% lower median investigation time without more missed critical checks; small-sample findings remain exploratory.

If traceability passes but usefulness does not, retain the shared path primitive and defer the expanded UI/rules. If precision fails for a language or relationship, downgrade the label, narrow its scope or disable the rule. Do not tune a global score to conceal false positives.

## 15. Risks, trade-offs and explicit exclusions

The biggest engineering cost is revision-correct indexing. Reusing a current graph is cheap but misleading for deletions and staged changes; matched graphs cost time and storage. Bounded materialization and on-demand comparisons are preferable to incorrect speed.

Static precision varies by language and available dependency resolution. Historical trees may not have their original installed dependencies. Record this difference and downgrade precision instead of implying reproducible builds. Full dependency/environment reconstruction is outside scope.

Integrating with 3.10 reduces duplicate workflows but risks making verification busy. Default to a concise summary and expandable evidence; use usability results to decide whether a separate entry point is warranted. Preserve strict verification semantics while adding advisory impact evidence.

Cross-feature reuse can increase latency or mislabel old findings. Optional adapters, source compatibility checks and baseline-unknown states are required; running every feature eagerly is rejected.

Path heuristics for security, migrations and configuration are useful orientation but noisy risk evidence. Keep them as inspection hints unless stronger evidence supports a finding. Do not add speculative rules simply to fill the report.

No automatic review approval, merge decision, statistical defect prediction, author scoring, general observability platform, new graph renderer, independent test dashboard, security scanner, architecture-policy engine or autonomous patch loop is included.

## 16. Final recommendation

**Build the shared evidence capability; merge its initial experience into Change Verification; defer the standalone dashboard and predictive features.**

The MVP earns its place only if it improves on today's reverse-file list: exact comparison scope, changed declarations, inspectable same-revision consumer paths, relevant existing checks and honest limitations. Those additions solve a concrete navigation and verification problem without claiming to predict failures.

Proceed to implementation only after review of this plan. The first implementation checkpoint should prove scope isolation and deleted-symbol path correctness before adding risk rules or UI polish.
