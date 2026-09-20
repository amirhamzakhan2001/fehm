# System design

fehm runs as a local CLI/library and optionally a long-lived HTTP or MCP process. Its durable boundary is a repository plus local `.fehm` state. The design serves a developer or trusted team; it is not an isolated multi-tenant execution platform.

The user installation boundary is an isolated uv tool environment. Its wheel includes the built JavaScript engine and runtime assets; `nodejs-wheel-binaries` supplies a pinned Node executable. The Python console entry point forwards arguments, working directory, and stdio without shell interpolation or npm bootstrap. The developer build still uses npm. Assistant registration copies a versionable skill to the client's supported scope and protects customized or symlinked destinations. See [INTEGRATIONS.md](INTEGRATIONS.md).

## Analysis pipeline

1. The scanner walks supported source files, applies directory and size exclusions, and computes content hashes.
2. The analyzer creates structural nodes and relationships with evidence. TypeScript/JavaScript use a compiler program; other supported languages use deterministic extraction.
3. The indexer compares file hashes with the previous graph, invalidates affected reverse dependencies, and reuses compatible per-file units.
4. Graph queries and intelligence modules compute context, changes, risk, tests, history, AI, and readiness reports.
5. CLI, MCP, and HTTP adapters return structured data or formatted reports. The cockpit presents the same results.

Non-source evidence such as CI files, lockfiles, deployment manifests, and documentation is read by the relevant intelligence modules. Such reports can change without a changed source-graph fingerprint.

## Facts, inference, and policy

| Information | Meaning | Limits |
| --- | --- | --- |
| Filesystem/AST/type-checker evidence | An observed structure or resolved relationship | Resolution is limited by supported language constructs and compiler settings. |
| Risk/readiness/practice signal | A deterministic inference or artifact match | It does not prove runtime correctness, completeness, or standards compliance. |
| Approved architecture policy | Project-defined dependency rules | It can only evaluate relationships the graph resolves. |
| Approved practices policy | Project-defined required/warning/exempt controls | Required controls establish explicit review gates, not formal assurance. |
| Model/evaluator output | An execution record with provider/model context | It can be incorrect; retain responses, failures, and evaluation evidence. |

## Retrieval and context

Retrieval combines lexical, symbol, semantic-concept, intent, and graph scores. Packet generation reuses the retrieved source snapshot for excerpts. It reserves space for architecture, tests, history, recommended nodes, relationships, and excerpts, then trims and recomputes quality.

Packet recommendations preserve the three highest-ranked anchors, then apply Graft-derived file-first round-robin selection to remaining retrieved candidates before existing count and token limits. Standalone retrieval scores and ordering are unchanged. Codebase Memory-derived identifier boundaries support acronym matching; Everything Claude Code-derived memory ranking prioritizes query and technology matches with stable ties and unchanged stored confidence. See [source provenance and scope](OPEN_SOURCE_INTEGRATIONS.md).

Token accounting uses `ceil(characters / 4)`. The limit applies to rendered Markdown; JSON carries additional structure and preserves the original query. This is not a model-tokenizer guarantee. Semantic-concept expansion is deterministic and is not learned embedding search.

Relationship queries build adjacency once, preserve traversal direction and paths, and compound edge confidence. Bounded queries disclose omissions. Graph slices distinguish semantic filtering from capacity truncation.

## Architecture and engineering-practice governance

Architecture proposals remain unapproved until a deliberate approval action. Import checks evaluate layer allow-lists and explicit forbidden dependencies. Drift compares violations between graphs; any new violation yields degradation.

The practices engine reads current artifacts once per audit and evaluates 31 catalog rules. Each rule has an area, applicability, scoped checks, remediation, and a reference. Runtime source checks exclude test fixtures and prose. Findings expose source paths and line numbers rather than content snippets.

An active practice policy must contain a valid approval record matching a canonical hash of its version, profile, and sorted rule settings. Changes after approval cause an error. Exemptions require reasons. Proposals never enforce themselves.

A saved report is the practice baseline. Comparison requires the same repository root, catalog version, and policy hash. The report separately identifies lost signals, improved signals, and incompatible baselines. It records current artifact and graph fingerprints. Missing signals remain explicit even when a baseline is saved.

Preflight includes approved required practice gaps alongside understanding, protected zones, risk, and affected architecture violations. Explicit invocation approval can override approval-requiring findings and is recorded in report evidence. Invalid policy is an error. Tools that do not call preflight are not automatically governed.

## Persistence

| State | Purpose | Recovery policy |
| --- | --- | --- |
| `graph.json`, `analysis-cache.json` | Current source graph and per-file units | Rebuildable from source. |
| `architecture.proposed.json` | Inferred/reviewable architecture | Regenerable; review before approval. |
| `architecture.json` | Approved dependency contract | Back up and review changes. |
| `practices.proposed.json` | Editable practices proposal | Regenerable; re-proposal replaces the draft. |
| `practices.json` | Approved practice modes and exemptions | Back up; changing content requires approval again. |
| `practices-baseline.json` | Reviewed practice evidence checkpoint | Back up; replace deliberately after reviewing drift. |
| Prompt/evaluation/agent/mistake/checkpoint/history artifacts | Decisions and execution evidence | Treat as durable, potentially sensitive records. |
| Onboarding and Obsidian outputs | Shared documentation | Regenerable, but preserve human edits separately. |

`atomicWriteFile` writes to a unique temporary name and renames into place. This protects individual files; it is not a transaction across all state. Graph/cache reuse requires matching fingerprints and repository roots, so an interrupted pair of writes triggers full analysis. Keep one active writer per project state directory.

The source index schema and practice policy/report/catalog have their own versions. Schema validation should be expanded as new external import paths are introduced.

## Long-lived processes

The synchronizer coalesces overlapping refresh requests and schedules the next polling run after completion. Polling still reads/hashes sources; incremental analysis is not an operating-system change stream. CLI `serve --watch` points each synchronizer at the graph directory supplied by the operator.

The HTTP server caches parsed graphs using mtime and size and invalidates them after writes. Expensive command/provider jobs have a bounded active-job set. Synchronous analysis still shares a Node process with request handling; large repositories need load measurement before remote deployment.

MCP processes newline-delimited requests serially. Invalid JSON and invalid envelopes receive protocol errors without terminating the process. Tool arguments and end-to-end client compatibility remain areas for broader coverage.

## Localhost HTTP boundary

The CLI defaults to `127.0.0.1:7331`. A remote bind requires a sufficiently long bearer token unless explicitly bypassed. Token validation uses a constant-time comparison after length checking. In-process library users configure and listen on their own server; CLI bind safeguards do not automatically govern arbitrary library embedding.

Unauthenticated loopback requests must name a loopback host, reducing hostname-rebinding exposure. Authenticated reverse proxies can use their own hostnames. API routes require the bearer token when configured; static cockpit assets are public. The browser stores a supplied token for the session and retries an unauthorized request after prompting.

The API sets security headers and request IDs, rejects unsupported body types and oversized payloads, and hides internal error details. `GET /api/live` is public process liveness; `GET /api/ready` is public graph-load/shape/source-root readiness. Readiness is not an assertion that all engineering policies pass.

`GET /api/practices` is project-scoped and read-only. Policy approval and baseline creation use explicit CLI/library calls. GET intelligence routes in the wider API can refresh persisted reports; treat `.fehm` as writable service state.

See [DEPLOYMENT.md](DEPLOYMENT.md) for configuration and the localhost test contract.

## Cockpit state

Project IDs scope requests. A request captures the selected project and view generation; a response from a superseded selection is discarded. Failed requests produce an actionable view with retry. Graph dragging, semantic zoom, specialized views, prompt forms, and responsive layout still need a connected browser for visual verification.

## Execution and providers

Project verification invokes detected commands with time/output bounds. Mutation and historical bug workflows use isolated copies or Git checkouts but are not a security sandbox for malicious repositories. Analyze and execute only repositories you trust.

Model adapters require explicit endpoints/configuration and invocation. Prompt evaluation retains outcomes and errors. The evaluator itself is a model, so scores are evidence for review, not proof. Held-out optimization uses fixed candidate strategies and disjoint case sets; real-provider behavior requires separate integration runs.

## Failure and recovery

| Failure | Behavior / action |
| --- | --- |
| Missing/invalid graph or unavailable source root | Readiness returns 503; rebuild the index. |
| Graph/cache mismatch | Full analysis replaces unsafe cache reuse. |
| Invalid practice policy or approval hash | Audit/preflight fail closed; repair the proposal and approve again. |
| Incompatible practice baseline | Review new policy/context and save a new baseline deliberately. |
| Unknown project or invalid context input | Return a client error, preserving other projects. |
| Bind failure | Report the error and stop watch timers. |
| SIGTERM/SIGINT | Stop scheduling refreshes, close HTTP connections, and bound lingering connections. |
| Provider or test failure | Retain failed evidence; do not report a successful verification. |

## Scaling and future boundaries

Adjacency indexing, grouped cache serialization, shared context reads, and per-file reuse remove known repeated scans. Remaining costs include compiler work, source hashing, report-specific artifact scans, historical Git operations, and graph/report serialization. Multiple service processes should not write the same state directory.

A public SaaS would need identity, tenant authorization, isolated workers, storage boundaries, durable jobs, quotas, abuse controls, retention/deletion, and a separate threat model. Those capabilities are not implemented by the local bearer-token server.
