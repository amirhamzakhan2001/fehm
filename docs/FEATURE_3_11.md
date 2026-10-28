# Feature 3.11 — Root-Cause Debugging & Failure Investigation

Status: experimental MVP implemented after approval. The research plan below remains the broader design; the implementation record distinguishes shipped behavior from deferred work.
Research date: 27 October 2026. Repository audit: current working tree, including the new change-derived 3.10 workflow, rather than an assumed release snapshot.

## 1. Recommendation and developer problem

**Build a small, evidence-first investigation layer, subject to a time-saving evaluation gate. Defer autonomous diagnosis and patch generation.**

The useful problem is the time spent translating a failure into the right code, relevant changes, a discriminating experiment, and a trustworthy handoff. FEHM already retrieves code and runs checks. A separate feature is justified only if connecting those steps saves time compared with an editor, existing FEHM context retrieval, or the developer's coding assistant.

The proposed promise is: “Here is the relevant evidence, these explanations remain plausible, and this next observation would distinguish them.” It is not “FEHM found the root cause.” A well-supported response may contain no hypothesis and ask for the failing input, deployed revision, or actual response.

Initial sweet spot: local JavaScript/TypeScript failures, unfamiliar multi-file code, and failed checks already captured by FEHM. Python trace ingestion can supply locations without implying TS-level graph precision. Production-only incidents without runtime evidence are primarily a handoff problem.

For a clear one-line exception, an IDE may already be faster. For database state, races, deployment configuration, and distributed failures, FEHM cannot substitute repository structure for runtime observations. Do not require an investigation record before ordinary debugging.

## 2. Research and competitive comparison

This is a documentation and source audit, not a hands-on comparative benchmark. Product documentation establishes available mechanisms, not diagnostic accuracy. The opportunity and limitations below are engineering judgments that require evaluation.

| Tool/category | Documented strengths | Implication for FEHM |
|---|---|---|
| VS Code debugger | Breakpoints, stepping, variables, expressions and call-stack navigation. [Official documentation](https://code.visualstudio.com/docs/debugtest/debugging) | Runtime values answer questions a static graph cannot. Recommend a precise breakpoint/variable inspection; do not build another debugger. |
| Copilot in Visual Studio | Debugger-aware assistance uses stacks, frames and variable values; documented Debugger Agent workflows reproduce, instrument and validate bugs. This is Visual Studio functionality, not a claim about every Copilot surface. [Microsoft documentation](https://learn.microsoft.com/en-us/visualstudio/debugger/debug-with-copilot?view=visualstudio) | “AI explains exceptions” is not differentiation. A portable, local evidence packet may help developers outside this integrated environment. |
| Cursor Debug mode | Accepts errors and stacks, generates hypotheses, instruments code and uses runtime information before fixes. [Cursor documentation](https://prod.cursor.com/help/ai-features/debug-mode) | Hypothesis cards and an instrumentation loop are already available elsewhere. FEHM should complement such tools with provenance, repository context and verification references. |
| Claude Code | Documents workflows for locating relevant code, investigating bugs, planning and making changes. [Common workflows](https://code.claude.com/docs/en/common-workflows) | An agent can already search and edit. FEHM must beat repeated manual context assembly, not duplicate an agent conversation. No comparative quality claim is established here. |
| Sentry Seer | Its issue-fix API supports root-cause, solution, code-change, PR and agent-handoff stages, with explicit stopping points. [Sentry API](https://docs.sentry.io/api/seer/start-seer-issue-fix/) | An issue-oriented service already coordinates diagnosis through fixes. FEHM's smaller opportunity is local repository investigation without requiring a hosted issue workflow. Do not compete on production telemetry. |
| Playwright Trace Viewer | Replays recorded actions with DOM snapshots, errors, console and other trace evidence; supports local inspection. [Trace Viewer](https://playwright.dev/docs/trace-viewer) | For UI failures, point to existing traces. A repository-only explanation is weaker than captured browser state. No trace viewer clone. |
| Node test runner | Supports structured reporting and test selection mechanisms. [Node documentation](https://nodejs.org/api/test.html) | Use runner evidence and version-tested adapters. Do not assume arbitrary package scripts forward filters correctly or infer success from exit zero alone. |
| Git bisect | Narrows a regression using good/bad revisions and a repeatable test; supports skipping untestable revisions. [Git documentation](https://git-scm.com/docs/git-bisect) | Recent edits are leads; controlled reproduction across revisions is stronger evidence. Recommend bisect when appropriate; defer automated checkout/build orchestration. |
| CodeQL | Path queries explain modeled data flow between sources and sinks. [CodeQL documentation](https://codeql.github.com/docs/writing-codeql-queries/creating-path-queries/) | Static paths are valuable but require models. FEHM's call/import graph is not general runtime data flow; reuse existing security traces when pertinent. |

The realistic differentiation is a bounded, revision-aware evidence bundle that works with several development tools. Local-first operation and token budgets help, but neither proves developer value. Avoid unsupported “more accurate than agents” claims and do not turn anecdotal reports into quantitative evidence.

## 3. Repository audit and reuse map

The requested code-review-graph MCP tools were unavailable in this session. Inspection therefore used local implementation and specifications. No new graph, scanner, execution engine or LLM service is proposed.

| Existing implementation | Verified capability | Reuse and boundary |
|---|---|---|
| [Feature 1](FEATURE_1.md); `src/engine.ts`, `src/indexer.ts`, `src/model.ts` | Incremental hashes/indexing; symbol resolution with ambiguity; source access; graph relationships with provenance; outgoing flow bounded to depth 6. TS/JS compiler-based analysis; other language relationships can be heuristic. | Resolve anchors and traverse existing edges. Keep unresolved references visible. Graph confidence describes an edge, not the probability of a root cause. |
| `src/retrieval.ts`, `src/context.ts`, `src/agent-context.ts` | Debug retrieval intent, lexical/symbol/graph ranking, budgeted context and deduplication. Generic intent detection checks test words before debug words. | Explicitly request `intent: debug` and separately retain test anchors. No new retrieval engine. Exact stack locations must survive generic relevance ranking. |
| 3.1 graph; `src/visualization/graph/service.ts` | Node detail, relationships, excerpts and graph navigation. | Open existing graph nodes. Exact failure-line excerpts need a small validated location adapter; symbol excerpts are not guaranteed to include the failing line. |
| 3.2 briefing; `src/codebase-briefing/facts.ts` | Shared source/config/manifest facts, file dependencies and route/entry-point signals. | Use lazily around anchors; do not generate an entire briefing per failure. |
| 3.3 architecture and 3.4 drift | Evidence-backed component projections and convention/rule deviations. | Link existing reports only when an affected boundary matters. A drift finding is not evidence that it caused this incident. |
| 3.5 health; `src/health/build.ts`, `tests.ts`, `coverage.ts` | Command discovery, test inventory and direct/transitive/coverage associations. | Discover existing commands and related tests. Test association and historical coverage do not prove reproduction or current execution. `analyzeTests` requires broader inputs; prefer existing cached reports or graph associations rather than invoking full health analysis. |
| 3.6 security; `src/security/security.ts`, `taint.ts` | Static findings, bounded modeled flows, confidence, limitations and remediation. | Relevant finding references only. No fresh whole-repository security scan for every ordinary exception. |
| 3.7 prompts; `src/prompts/evaluation.ts`, visualization routes | Prompt discovery, evaluation adapters and recorded-output comparison. | Reuse explicit provenance/evaluation conventions. This is not a general-purpose diagnostic model provider. |
| 3.8 Git Memory; `src/git-memory/git.ts`, `history.ts`, `semantic.ts` | Safe Git wrappers, path/history filtering, diffs, blame and semantic-change evidence; bounded history with shallow-clone warnings. | Retrieve small relevant change sets. `indexGitMemory` defaults to a broad recent window; do not run its whole semantic history pipeline on every investigation. Prefer cached results and bounded path-specific Git reads. |
| 3.9 concepts; [actual specification](FEATURE_3_9.md) | Concept/ontology intelligence and evidence adapters; not a debugging engine. | Optional terminology explanations only. Do not load the ontology or SQLite just to diagnose an exception. |
| 3.10; `src/guardrails/change.ts`, `workflow.ts`, `types.ts`, `snapshot.ts` | Working-tree planning; approved command execution; status/evidence ledger; snapshots, stale checks, explicit baseline/TDD and bounded remediation APIs. | Reuse execution and evidence. `verifyChange` selects broad existing suites; `execute` supports an exact check. Neither currently supplies structured failure identity or proves that the original failing test passed later. |
| `src/semantic-summary.ts` | Explicit summary-provider interface and user-configured shell command provider. | Optional context export is immediately reusable. The shell provider is a trusted configuration mechanism, not a safe executor for model-generated diagnostics. Do not silently repurpose it. |
| `src/server.ts`, `visualization/http.ts`, `features.ts`, `report-css.ts` | Shared engine, modular page routes, CSP, embedded dashboard, localhost binding, common styling. | Add one small view module. Existing mutation-header conventions are not a complete origin/authentication boundary. |

Important limits: `SourceReader` is a memoized reader, not a path authorization layer; `engine.sourceLines` restricts reads to indexed paths but does not itself attest that the disk still matches the index. Guardrails snapshots and index fingerprints have different inclusion rules. Preserve both scopes rather than treating their hashes as interchangeable. The current runner's test classifier expects positive TAP summaries, and error-text classification is coarse; a syntax error classified as blocked is not a trustworthy causal diagnosis.

## 4. Missing capabilities and scope decisions

Each proposed addition must solve a problem not already answered by the reuse map.

| Addition | Developer problem / existing gap | Required evidence | Decision |
|---|---|---|---|
| Failure normalization and location resolution | Pasted failures are not first-class engine inputs; paths and line numbers get lost in search. | Input spans, parser kind/version, indexed candidate paths, line validity, optional originating revision. | MVP: Node/V8 and Python frames, explicit location and plain text fallback. |
| Bounded investigation packet | Developers manually combine code, tests, diffs and observations. Existing packets lack failure anchors and experiment history. | Anchors, actual edges, source hashes, relevant hunks and check references. | MVP; compose existing retrieval. |
| Up to three testable hypotheses | Relevant code alone does not tell the developer what to investigate next. | Supporting evidence IDs, counterevidence, missing observation and falsifying action. | MVP: narrow deterministic rules; allow zero results. Optional model interpretation later. |
| Ranked next action | Lists of generic tests waste time. 3.10 plans verification, not discrimination between causes. | Existing command/test identity or exact location; expected confirming and rejecting observations. | MVP: one primary action, at most two alternatives. |
| Reproduction/verification linkage | A passing suite does not prove the original failure disappeared. | Same named test/reproducer, assertion, revision, environment description and before/after outcomes. | MVP for supported Node TAP; other evidence explicitly limited. Extend 3.10, not a second ledger. |
| Local investigation history/export | Repeated handoffs lose observations and their revisions. | Immutable analysis versions and execution IDs. | MVP: explicit Save, JSON/text export; ephemeral by default. |
| Patch generation/application | Often requires domain intent and an existing agent already edits code. | Confirmed expectations, failing reproducer, proposed diff and new execution evidence. | Defer generation; no direct edits in MVP. Provide focused handoff. |
| Instrumentation and automatic bisect | Can obtain stronger evidence but changes code/state and broadens execution risks. | Authorized runtime, reproducible test and isolated worktree/environment. | Later only if evaluation shows need. |

Essential input: at least one of failure text, an existing guardrails evidence ID, or a selected indexed location with unexpected behavior. Expected versus actual behavior is strongly encouraged for non-exception failures, not an obligatory form for a useful trace. Optional fields: test name, failure revision, execution environment label, reproduction steps and good/bad commit IDs. Logs are bounded pasted text, not a new logging integration.

Postpone source maps, minified/browser bundle resolution, Java/Go/Rust-specific trace parsing, JUnit ingestion, trace ZIP ingestion, multiple repositories and CI log imports. Unsupported formats remain text with explicit limitations. Do not silently map a production path to the current checkout.

## 5. Minimum useful workflow

1. Paste an error or select **Investigate failure** beside a failed 3.10 check. A graph node can open the same view with its ID. Health links are contextual leads unless their result includes usable revision provenance.
2. Normalize input; show recognized frames, unmatched locations and revision status. Auto-resolve only unique safe mappings. Ask for disambiguation only when alternatives would change the investigation.
3. Collect a small set of code excerpts, callers/callees, tests and relevant changes. Distinguish supplied observations from FEHM execution and static facts.
4. Show the best-supported explanation or “Cause not established,” plus one next diagnostic action. Expand alternatives and evidence on demand.
5. Developer runs a supported exact check through 3.10 with approval, inspects the recommended variable in their debugger, or supplies another observation. Recompute affected hypotheses without rewriting the earlier record.
6. Developer or coding agent makes a fix. FEHM refreshes context and links the original reproducer and relevant regression checks through 3.10. Report the precise observed outcome and remaining gaps.

Examples of appropriate stopping: a trace points outside the repository; the deployed commit is unknown; two runtime inputs explain the same branch; the missing fact is the database's applied migration version. Stop expanding static neighbors and ask for that fact.

## 6. Requirements and evidence semantics

Mandatory behavior:

- Every displayed causal claim is a hypothesis until its confirmation condition is met. Never promote a model response or user assertion to tool-observed evidence.
- Preserve frame order, nested exception groups where supported, parser warnings and original input offsets. Do not assume the first frame is the defect location.
- Map absolute paths only within the repository or through an explicit/unique indexed suffix mapping. Ambiguous basenames stay ambiguous. Validate lines; never clamp an invalid stack line into an unrelated symbol.
- Associate each read with a source hash, and each execution with command, cwd, timestamps, status, exit code, bounded output and fingerprint.
- Include negative evidence and unmodeled boundaries. “No test found” means within the searched scope, not proof no test exists.
- Show `passed`, `failed`, `blocked`, `skipped`, `not run`, `inconclusive`, and `stale`; adapt existing `pending` presentation to `not run` without migrating old ledgers unnecessarily.
- Separate reproducibility from explanation: `not attempted`, `reproduced`, `not reproduced in this run`, `blocked`, `inconclusive`, `stale`. A one-off pass is not proof of resolution.
- A confirmed observation can be “the named test failed with this assertion.” Confirming a cause additionally needs a discriminating observation or controlled intervention; broad passing tests alone do not qualify.

Ranking uses an inspectable ordering, not a probability score: matching reproduction evidence; exact anchored code plus directly relevant observed values; related changed hunk with compatible symptom; static-path explanation; lexical-only lead. Recency only breaks ties. Do not rank a recent unrelated commit above a directly evidenced configuration error.

Hypothesis confidence is qualitative: strong, tentative or insufficient, with an explanation. Keep it separate from status (`proposed`, `supported`, `rejected`, `confirmed`) and freshness. Static-only candidates cannot become confirmed. Duplicated facts or multiple edges from the same parser are not independent corroboration.

Non-functional targets, to validate rather than advertise: no network/model calls by default; no new runtime dependencies for MVP; deterministic output ordering; bounded memory/output; cancellation between collection stages; warm-index analysis target p95 under two seconds on a declared 10,000-file fixture. Cold indexing is reported separately. If this target fails, reduce scope or move expensive stages off the HTTP thread before release.

## 7. UI/UX specification

Use a dedicated compact `/debug` page, title **Failure investigation**, registered as 3.11. It provides a stable shareable destination but is entered primarily through contextual links from checks and code. Do not create an investigation manager, project board or second graph.

Default layout:

- Input area: paste text; optional location; Analyze. “Use failed check” passes a validated run/evidence ID. Failure text belongs in a POST body, never a URL.
- Summary: observed symptom, revision match/unknown badge, and whether the failure was reproduced. Show a stale warning before the current recommendation when necessary.
- One recommended action with its purpose, exact target, expected observation and execution status. Execution uses a copyable CLI handoff in MVP; avoid pretending that the read-only guardrails HTTP API can run checks.
- At most three collapsible hypothesis rows. Each shows cause, confidence rationale, supporting and contradicting evidence, unknowns, and what would reject it.
- Expandable evidence: line-numbered code, reported frames, static paths, small diff hunks, test references and check output. Label reported stack frames separately from statically inferred calls.
- Compact before/after reproduction row and links to the existing verification report. Explicit Save and Export; no account or task setup.

Clicking `path:line` opens a bounded local excerpt with the exact line emphasized; a separate link opens the existing graph node. A copied location works even when no symbol exists. Optional editor deep links are later, configurable and escaped. No arbitrary OS file-opening endpoint.

Reuse report CSS, navigation, page headers, route/assets pattern and text-safe DOM construction. Use responsive single-column order, keyboard-operable details, status text rather than color alone, and no auto-scrolling narration. Show raw JSON only as an export/detail fallback, not the default explanation.

## 8. Technical architecture and data flow

Suggested files, all proposed:

| Module | Responsibility |
|---|---|
| `src/debugging/types.ts` | Versioned investigation, evidence, hypothesis and action contracts. |
| `src/debugging/input.ts` | Bounded failure parsing, normalization and indexed location resolution. |
| `src/debugging/investigate.ts` | Compose engine/facts/history retrieval; rank evidence and deterministic hypotheses. |
| `src/debugging/store.ts` | Optional local persistence and analysis-version history. |
| `src/visualization/debugging/{routes,service,page}.ts`, `ui/main.ts` | Thin dashboard adapter and presentation. |
| Existing guardrails modules | Add structured Node test outcome extraction and evidence linking; preserve current APIs. |

Pipeline:

`input → normalized observations → indexed anchors → bounded evidence → hypotheses + next action → optional 3.10 execution → new observations → reassessment`

Proposed data contracts:

- **Investigation**: schema/analysis version, UUID, root identity, created/updated time, normalized input digest, sanitized observations, optional failure commit, analysis HEAD, index digest, referenced source hashes, scope limits, unresolved anchors, evidence, hypotheses, actions, verification links and freshness.
- **EvidenceRef**: stable ID; origin (`user-input`, `repository`, `git`, `execution`, `model`); kind; optional path/line/endLine/node/edge IDs; source hash or commit; bounded text; observation time; execution ID where applicable; redaction/truncation metadata; freshness and coverage limitations.
- **Hypothesis**: ID, cause statement, generator/rule version, rank rationale, confidence rationale, supporting/contradicting evidence IDs, alternatives, missing evidence, confirmation/rejection conditions, status and diagnostic action IDs. Model-authored interpretation never counts as supporting evidence by itself.
- **DiagnosticAction**: kind (`inspect`, `supply-observation`, `run-check`, `compare-change`); target; reason; expected discriminating outcomes; optional immutable check reference; approval/execution state. No executable free-form model command field.
- **VerificationLink**: guardrails run/check/evidence IDs; reproducer/test identity; assertion or failure signature; before/after fingerprints; environment description/digest of non-secret declared metadata; original-failure outcome; separate regression outcomes.

Evidence collection algorithm:

1. Validate input and synchronize the existing index once. Use the same engine snapshot for the investigation; do not reopen an engine in every helper.
2. Resolve up to eight anchors from supplied locations, named tests, exact symbols and failure tokens. Prefer exact locations; fallback to explicit debug-intent retrieval.
3. Walk relevant incoming/outgoing calls, references, imports, handles, writes and configures edges with depth 2 and a 60-node cap. `flow()` is outgoing only; incoming callers require `relationships()`/graph edges. Never infer a data-flow chain merely from successive calls.
4. Fetch at most 12 files with bounded exact excerpts; combine overlapping line ranges. Include the assertion and failing line before expanding neighbors. Collect pertinent exception handlers/guards from those excerpts without inventing a new exception-flow graph.
5. Query existing test associations and check records. Read available cached health reports only if their scope and freshness are known.
6. Retrieve up to ten relevant commits and three small hunks around anchored paths. Use the failing revision when supplied. Show unmapped historical frames separately; defer historical graph rebuilding. No checkout is needed for blob/diff inspection.
7. Run a small rule set: explicit missing-module/configuration signal with matching code; named assertion mismatch with assertion/callee evidence; changed anchored branch with compatible error; boundary mismatch visible in caller/callee excerpts. All are leads unless observations discriminate. If none fit, return evidence plus an information request.
8. Check disk/index freshness again before publishing. If reads raced with edits, discard affected conclusions and retry once or return stale/partial. Refresh reads through a fresh engine because `SourceReader` caches lines.

HTTP/CLI proposal:

- `POST /api/debug/investigate`: bounded JSON, optional existing evidence reference; returns an ephemeral report. No execution or implicit save.
- `GET /api/debug/:id`: explicitly saved report, with freshness metadata.
- `POST /api/debug/save`: persist validated server-generated analysis; do not trust a submitted report as attestation.
- `DELETE /api/debug/:id`: explicit deletion of that investigation only.
- `fehm debug --input failure.txt --json`, `fehm debug --run-id ID --evidence-id ID`, `fehm debug context --id ID --tokens 4000`.
- A proposed `fehm debug run --id ID --action-id ID --approve` delegates an immutable selected check to 3.10. It must not call `verifyChange` blindly or auto-run all suites. No generic HTTP command endpoint in MVP.

Use `stateDir(root, options.stateDirectory)/debugging/` and existing atomic JSON persistence. Default analysis is ephemeral. Save sanitized bounded input only; exclude raw logs by default. Repository-local `.fehm` is already excluded by guardrail snapshot rules except selected config files; alternate state directories need explicit scan exclusion to avoid self-invalidating evidence. Scope history by root identity. Store immutable analysis versions, references to ledger records, and missing-ledger errors, not duplicate raw command logs.

## 9. LLM strategy and token efficiency

MVP works without a model. Export a compact evidence packet for the user's existing assistant. This permits agent-assisted diagnosis without building another agent runtime.

Later optional `DiagnosticProvider` accepts only a frozen packet and returns schema-validated hypotheses referencing known evidence IDs. One request per explicit user action; no tools, autonomous loop, arbitrary code execution or silent external transmission. Show destination/model and the redacted payload before the first transmission under a chosen policy. Schema validation can verify references, not the truth of the interpretation.

Default export budget: 4,000 estimated tokens including metadata and instructions, not 4,000 per source. Reserve approximately 15% for failure/unknowns, 50% for anchored code, 20% for tests/diffs and 15% for relationships/actions. These are packing preferences, not hard partitions. Reuse `context.ts` estimation and packing where possible, but preserve exact failure anchors and line numbers; do not assume its generic compressed excerpt is sufficient. If essential anchors exceed the cap, report what was omitted and ask to select scope.

Deduplicate by source hash and overlapping range. Cache evidence with input digest, source/graph/config hashes, HEAD, parser/rule versions and referenced execution IDs. The first release should conservatively invalidate the investigation when the indexed repository digest changes; optimize dependency-sensitive invalidation only after measuring benefit. Execution freshness remains governed by 3.10's broader snapshot and explicit environment limitations.

Stop when an action requires runtime evidence unavailable locally, no new relevant evidence appears, or a bound is reached. A user-selected additional observation permits one new stage. No vector store, full-repository prompt, ontology dump, parallel agents or repeated model retries.

## 10. Execution, privacy and verification safeguards

Treat logs, source comments, test output and model text as data. Strip terminal escape/control sequences; cap UTF-8 input at 128 KiB, frame candidates at 100 and stored analysis at 1 MiB. Reject oversized HTTP bodies early. Do not read files or fetch URLs merely because a trace names them.

Repository source requests must map to indexed paths, pass realpath containment and symlink policy, and retain hash consistency. Display unknown external frames as text. Do not read `.env`, process credentials or the FEHM server's environment to “verify” a production variable. Ask for the variable's presence/type in the failing environment, never its secret value. Pattern redaction is best-effort; preview exported material and avoid retaining raw input unnecessarily.

Use server-side repository identity, loopback binding, Host/Origin validation, same-origin JSON requests and a session nonce for mutations. Retain CSP and render text safely. Do not rely on a custom request header alone. No wildcard CORS or arbitrary output-file paths.

Reuse 3.10's exact argv/cwd, timeout, output bound, minimal environment, snapshot and repository execution lock. Approval is for the concrete selected action; unchanged authorization can cover that approved action's bounded before/after rerun. Changed command, source scope or privileges require renewed review. Package scripts can execute arbitrary code despite `shell:false`; approval is not sandboxing. Network, filesystem and memory isolation are not currently enforced. An isolated request must stay blocked, not silently run on the host.

MVP targeted execution is limited to an existing frozen check or a version-tested Node runner adapter that preserves project setup. If a package script cannot safely be narrowed, recommend the discovered suite and disclose its scope. No generated shell snippets, database writes, production request replay, dependency installation or runtime instrumentation.

Add a structured Node TAP outcome adapter to 3.10: recognize test identities/assertion outcomes and incomplete/truncated streams, retain exit status, and require the original named test to actually execute. Test the adapter against supported Node versions; preserve conservative handling for unsupported output. Use literal/escaped filters only where the adapter understands argument placement. No unconditional script rewriting.

Post-fix wording: “Original test reproduced at A and passed at B; two regression checks passed; integration environment unavailable.” If only a suite passes, say so and keep original-failure resolution unknown. A missing, renamed, skipped or weakened test cannot establish a fix. Flaky failures need repeated controlled observations; no retry-until-green. Passing after several simultaneous changes supports an outcome, not attribution to one change.

## 11. MVP phases and delivery gates

| Phase | Concrete deliverables | Exit condition |
|---|---|---|
| 0. Prove need | Curated failure fixtures; baseline timings using existing FEHM context, IDE and chosen assistant; annotated causes and unknown cases. | Evidence-assembly work is a material bottleneck in at least two target scenarios. Otherwise ship only improved context/trace navigation. |
| 1. Normalize and resolve | Input contracts, safe Node/Python trace parsing, selected-location and check-evidence ingestion, exact excerpts, read-only CLI. | Ambiguity, external paths, stale revisions and malformed traces behave correctly; no execution/network side effects. |
| 2. Compose evidence | Engine/facts/Git/test adapters, bounds, evidence lineage, deterministic hypothesis rules, next-action selection, export. | Every claim cites retrievable evidence; unknown cases abstain; packet fits its declared budget. |
| 3. Link verification | Minimal 3.10 structured test adapter and diagnostic check handoff; before/after identity, stale and blocked states. | A suite that omits the original failing test cannot claim resolution; existing guardrails behavior remains compatible. |
| 4. Small workspace | `/debug`, contextual entry points, exact-line viewer, explicit save/delete, shared styling and security controls. | Keyboard/mobile checks and real browser validation pass; no duplicate graph or checklist UI. |
| 5. Evaluate and decide | Blinded fixture scoring, paired developer trials, false-positive review and performance profiles. | Meets the release gates below. Optional model interpretation is a separate proposal after this result. |

No calendar estimate is reliable until Phase 0 and the structured-output adapter spike reveal workload. Keep these as reviewable increments; do not start a provider framework, broad language adapter family or orchestration system in parallel.

## 12. Acceptance criteria and evaluation

Use at least 30 cases across multiple small repositories: five cases in each required scenario below, plus adversarial and unsupported cases. Include real historical failures where an independent engineer can establish the cause. Hide ground-truth fixes and future commit messages from retrieval. Separate rule-development fixtures from held-out evaluation. Synthetic cases validate mechanics; they do not establish productivity gains.

| Scenario | Expected useful result | Failure/false-positive check |
|---|---|---|
| Clear exception with useful trace | Resolve exact application line and caller; explain the missing value assumption; recommend inspecting the value or running the reproducer. | Do not blame a library frame solely because it appears first. Test duplicate basenames, async frames, path spaces and invalid lines. |
| Recent-commit regression | Show relevant changed hunk and a comparison/reproduction action. | Recent unrelated commits must not become “the cause.” Include shallow history, renames, dirty tree and failure revision mismatch. |
| Failing test with plausible alternatives | Preserve assertion and test identity; show implementation/fixture/environment alternatives with a discriminating check. | Do not assume the implementation is wrong or suggest weakening assertions. A different passing test is not a fix. |
| Configuration/missing variable | Connect error to actual configuration read and recommend checking presence/type in the failing process. | Never infer deployment state from the server environment or expose a secret. Include dependency/import errors with misleading messages. |
| Insufficient evidence | Explicitly say the cause is not established and request one useful observation. | No invented calls, execution, database state, confidence percentages or automatic patch. |
| Cross-file API/database boundary | Resolve handler, caller and relevant contract/model excerpt; request actual response/schema state when absent. | Static schema files cannot establish applied migrations; framework dispatch may remain unresolved. |

Release targets are proposed gates, not achieved results:

- 100% of displayed repository/edge/commit references resolve to captured evidence; zero fabricated tool outcomes in the evaluation set.
- At least 90% exact anchor resolution on supported, unambiguous trace fixtures; ambiguous cases must remain explicitly ambiguous.
- Causal location or an agreed useful upstream/downstream anchor appears in the first five evidence locations for at least 80% of solvable held-out cases.
- At least 70% of solvable held-out cases include the accepted explanation among at most three hypotheses; report abstentions separately so withholding everything cannot inflate precision.
- At least 90% appropriate abstention on deliberately underdetermined cases; zero unsupported “confirmed” or “resolved” claims in the adversarial set.
- Two reviewers judge at least 80% of primary actions specific, feasible and capable of reducing uncertainty. Report disagreements and examples.
- Every fixture involving changed source, missing/skipped original tests, interrupted execution or truncated logs preserves the corresponding stale/inconclusive/blocked state.
- Budget enforcement covers the complete exported packet. Report bytes and estimated tokens; measure actual provider usage only if a provider is later enabled.
- No network calls or repository writes during default analysis; explicit cache/index writes are disclosed if enabled. Privacy fixtures cover secrets, malicious instructions and path escapes.

Developer-value trial: recruit 6–10 developers for a counterbalanced paired study on matched tasks. Compare (A) existing editor + current FEHM context and (B) that workflow + investigation; separately compare assistant-only versus assistant + FEHM packet with the same model/configuration. Avoid solving the identical bug twice. Measure time to first useful diagnostic action, time to correct explanation, unnecessary commands, incorrect changes, packet preparation effort and total model tokens. Report medians, spread and unresolved tasks, not just successful examples.

Provisional go/no-go: at least 20% lower median time to a useful action on target multi-file/handoff cases, no material worsening of incorrect diagnoses or total time, and no serious safety failures. Treat the small study as directional; do not claim universal improvement. If only navigation improves, simplify to a stack resolver/context export. If structured hypotheses fail to improve outcomes, remove them.

## 13. Risks, trade-offs and exclusions

- **Static evidence is incomplete:** reflection, dependency internals, callbacks and external services may be unresolved. Preserve those gaps instead of constructing plausible paths.
- **Wrong revision:** a correct line number on the wrong revision is misleading. Unknown revisions stay unverified; historical mapping and source maps are later additions.
- **Environment blind spots:** dependency installations, services and excluded generated files are not attested by current snapshots. Before/after comparisons disclose these limits.
- **Noisy ranking:** common error handlers and recent commits can dominate relevance. Evaluate against unrelated recent-change distractors and failure-specific anchors.
- **Cost of reuse:** full health/security/history analysis can be expensive despite being existing code. Invoke bounded adapters/cached reports, profile cold paths and disclose partial results.
- **Too much workflow:** saved records, repeated approval prompts and required forms can erase time savings. Ephemeral analysis, contextual entry and narrowly reusable authorization are defaults.
- **Sensitive artifacts:** logs can contain customer data and secrets. Local storage is not encryption or access control. Minimize collection, persistence and export.
- **New inference errors:** a syntactically valid model citation can still misinterpret evidence. Keep provider output optional and unconfirmed.

Later candidates: Python/pytest and JUnit result adapters; source maps; imported local Playwright artifacts as links/metadata; explicit debugger observation ingestion; structured optional model interpretation; isolated worktree bisect; patch proposals with diff review. Each requires a measured use case and separate safeguards.

Explicit exclusions: production telemetry collection, hosted log management, APM, debugger protocol implementation, a second static analyzer or graph, autonomous patch application, multi-agent repair loops, automatic production/database operations, new test frameworks, a new CI system, hidden background model calls, and certainty guarantees.

## 14. Final decision

**Simplify and build the evidence-to-next-action MVP only after a short evaluation spike.** Its strongest integration is a failed 3.10 check opening a targeted 3.11 investigation, followed by a precise diagnostic action and revision-linked reproduction evidence.

Keep writing code and operating the runtime in the developer's existing tools. FEHM should contribute the context and evidence they otherwise assemble repeatedly. If that does not measurably reduce investigation effort, fold stack resolution and failure-aware context into Feature 1/3.10 and defer a standalone 3.11 page.

The sections above describe the design and evaluation targets. The implementation record below is authoritative for current capabilities. Productivity gains and the proposed developer-study targets have not been measured.


## Implementation record

The initial implementation is an experimental evidence-navigation and verification bridge. It does not satisfy the proposed human-productivity release gate yet.

### Usage

```sh
fehm debug --input failure.txt --root .
fehm debug --location src/service.ts --line 42 --root .
fehm debug --run-id RUN --evidence-id EVIDENCE --save --root .
fehm debug report --id INVESTIGATION --root .
fehm debug context --id INVESTIGATION --tokens 4000 --root .
fehm debug run --id INVESTIGATION --action-id ACTION --approve --root .
fehm debug delete --id INVESTIGATION --root .
fehm serve --root .
# Open /debug, or Investigate from a failed check or graph node.
```

Use `--json` for machine-readable output. Analysis is ephemeral unless `--save` is supplied or Save is clicked. `--failure-revision HASH` records a supplied commit. A rerun returns a new analysis; add `--save` to persist it. All runtime values and causes remain unknown unless the supplied observations establish them. The dashboard never executes project commands.

### Implemented

- Node/V8 and Python stack-location parsing, explicit location inputs, and recorded 3.10 evidence inputs. Unique indexed suffix mappings are labeled; ambiguous names, invalid lines, traversal, unsupported external paths and `.env` reads do not resolve silently.
- Existing engine relationships, exact line excerpts, static test references and bounded local Git evidence. Bounds: 100 parsed frames, eight anchors, two relationship hops, 60 nodes, 12 source files, 80 evidence items and 6,000 characters per item. Source lines are bounded to 300 characters; all collection truncation is reported. Failure input is limited to 128 KiB, with a sanitized 32,000-character retained tail.
- Narrow tentative rules for configuration reads, missing-value/type errors and assertion failures. The system may produce no hypothesis. These rules identify useful diagnostic categories; they do not infer arbitrary program semantics or replace runtime debugging.
- Separate provenance for user input, repository facts, local Git output and recorded command execution. Old execution frames are marked historical and do not generate current-source hypotheses after source changes.
- Existing-check CLI reruns through the 3.10 runner, with explicit approval. No generated commands or additional execution engine.
- Conservative top-level Node TAP test identities recorded alongside new 3.10 executions. Before/after comparison requires unchanged test snapshot, policy, command/cwd and complete named test outcomes. Missing, skipped, renamed, duplicate, nested, cancelled, truncated or altered-test evidence cannot establish that the original test passed. Older ledgers without structured outcomes remain inconclusive.
- Local immutable saved analyses, deletion and bounded context/JSON export. Refreshing analysis produces a new ID. Saved reports recheck index freshness; execution freshness uses the separate guardrail fingerprint. Storage uses the configured state directory; repository-internal overrides outside `.fehm` are rejected to prevent indexing the reports themselves. Local records are not tamper-proof attestations.
- `/debug` page and dashboard entry, exact-line highlights, graph links, contextual check/graph entry points, progressive evidence disclosure, same-origin/Host checks and session nonce for mutations. Saves reference server-generated analyses rather than trusting submitted report bodies. The in-memory analysis cache retains at most 20 reports.

CLI analysis uses a dry-run engine. The dashboard shares the server's indexing behavior and may update its index cache on refresh. Neither analysis surface modifies project source or executes project checks; bounded local Git reads are used. No dependencies or model providers were added.

### Deferred or limited

- No autonomous patching, optional diagnostic LLM provider, instrumentation, source maps, historical symbol remapping, arbitrary diagnostic commands, nested TAP suite identities, pytest/JUnit adapters, environment introspection, or automatic bisect.
- The graph/health interfaces are reused for static test associations; no guarantee of a safe minimal test subset is made. Reruns use an existing frozen check, which may be a full suite.
- Exact call-site line mapping is strongest for indexed TS/JS. Python stack parsing does not improve the engine's heuristic relationship guarantees.
- Runtime environment/dependency changes are outside content attestation. Matching HEAD does not establish that a dirty working tree matches the failing build. One pass is not evidence that an intermittent bug is fixed.
- New and changed source invalidate prior analysis conservatively. Selecting an old recorded failure does not manufacture a baseline at the current revision.
- Human paired trials, held-out diagnostic-quality benchmarks and the proposed 10,000-file latency target remain unmeasured. These are release/promotion gates, not claimed results.

### Validation record

Automated tests exercise parsing, ambiguity, path restrictions, secret redaction, stale reads, bounded exports, immutable persistence, real failing/passing Node checks, approval enforcement, original-test identity, skipped/renamed/modified tests, CLI behavior, HTTP protections, server-generated saves and feature-registry compatibility. Browser visual validation could not be completed because no browser connection was available in the session; HTTP/module checks are not a substitute for visual QA. Validation on this working tree: `npm run build` passed; the complete Node test suite passed 348/348 with no skips or cancellations. The scoped whitespace check also passed.
