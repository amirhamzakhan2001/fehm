# Integration decisions

fehm keeps analysis local and makes external execution explicit. An integration should close an observed capability gap while preserving provenance, bounded execution, licensing, and a clear trust boundary.

## Current integration surface

| Surface | Current behavior |
| --- | --- |
| TypeScript compiler | Runtime dependency for JavaScript/TypeScript AST and type-checker analysis |
| uv / Python packaging | User-facing tool installation; wheel carries the compiled engine and TypeScript dependency |
| nodejs-wheel-binaries | Pinned private Node runtime for uv users; unofficial distribution with upstream licenses included in its wheel |
| Agent Skills | Scoped, repeatable registration for Claude Code, Cursor, Codex, Gemini CLI, Copilot CLI/VS Code, and compatible generic clients |
| Open Code Review | Pinned bundled Open Code Review engine; optional Fehm context and graph-linked findings; explicit provider opt-in; see [setup](OPEN_CODE_REVIEW.md) |
| Git CLI | Local history, diffs, blame, snapshots, and isolated historical replay |
| Project package managers | Explicit verification/test command execution when supported scripts exist |
| MCP stdio | fehm tools and graph resource for compatible clients |
| HTTP API | Local/private project-scoped reports and explicit actions |
| Model HTTP endpoints | Opt-in configured provider calls for summaries, evaluations, and optimization |
| Coverage and runtime files | Supported artifact ingestion, with provenance and format limitations |
| Obsidian-compatible Markdown | Local linked export; no Obsidian account or plugin is required |

The repository bundles Open Code Review for explicit model-based review, but does not bundle a general scanner farm, language-server farm, hosted vector database, or cloud telemetry collector.

See [INTEGRATIONS.md](INTEGRATIONS.md) for supported skill paths and verification boundaries. Graphify's install/register/query workflow informed the user experience; Fehm does not install Graphify or copy its graph engine. uv provides isolated installation and upgrade handling, while npm continues building the existing TypeScript engine. The packaged runtime increases download size and adds a release dependency to monitor; it does not eliminate Node internally.

## Previous project comparisons

Earlier notes considered Skylos, Graft, codebase-memory-mcp, agency-agents, gstack, and Everything Claude Code as sources of possible analysis, linked-document, agent-workflow, or release-workflow ideas. Those earlier comparisons were design history. Selected source adaptations from Everything Claude Code, gstack, Agency Agents, Codebase Memory and Graft are now implemented as described below; the other projects remain references.

The adopted local concepts are linked Markdown export, graph-backed agent context, explicit review/verification workflows, and visible uncertainty. An actual adapter must be separately implemented and verified. Unrelated media tooling is outside fehm's code-intelligence scope.

## Engineering reference frameworks

The practice catalog links to published software-security, application-security, AI-risk, reliability, and accessibility guidance. These references inform review questions; they are not software dependencies, complete standards implementations, or certification claims. The authoritative links and scope are in [ENGINEERING_PRACTICES.md](ENGINEERING_PRACTICES.md).

## Adapter contract

A future adapter should identify the tool and version, the invocation and authorization boundary, accepted output schema, repository scope, source locations, confidence, and original evidence. Preserve the difference between an external heuristic and a compiler-resolved fact.

Execute external commands only through an explicit operation with time/output bounds. Do not install dependencies or transmit proprietary code silently. Validate imported paths and schemas, redact sensitive output, and define error/retry behavior. Review licensing and redistribution before bundling code or binaries.

## Priorities

The most useful future adapters are project-config-aware compiler/LSP services, optional SARIF imports, richer coverage/trace readers, and environment-specific verification. Add them in response to real gaps with fixtures and documented limits rather than increasing a feature count.

## Internal optimization pass

Existing commands and report schemas remain unchanged. The following improvements are internal to the shared engines, so CLI, Model Context Protocol, and localhost consumers use the same paths:

- **Microsoft TypeScript:** Fehm uses the installed compiler's `CompilerHost` API to reuse scanned text and cache repeated filesystem reads/existence checks for one analysis. Missing files are cached too; the cache is discarded after each analysis to avoid stale cross-scan state. Reference: [Compiler API](https://github.com/microsoft/TypeScript/wiki/Using-the-Compiler-API).
- **Git:** ownership analysis retains the same first 120 files, blame arguments, parsing and fallback behavior, but runs at most four blame processes concurrently. Results are assembled in input order.
- **Context retrieval:** up to eight source reads run concurrently, preserving stale-file handling, graph ordering, scoring and context budgets.
- **Open Code Review:** its documented separation of deterministic orchestration and bounded independent work informed the execution approach. Fehm's queue is an original implementation; no upstream Go source or binary was copied. Its bundled model-based review remains an opt-in operation and does not replace deterministic checks.

Tests cover bounded execution, out-of-order completion, draining in-flight work on failure, negative filesystem caching, and cache refresh between analyses. These are targeted optimizations, not a claim that all features are faster or that model accuracy improved. No new dependency, network call, report field, or user installation step is introduced by this pass.

## Selected source integrations (September 21, 2026)

These are implemented adaptations of pinned MIT-licensed source, not installations of whole products. Original files, SHA-256 hashes, licenses and commits are retained under `third_party/` and included in distributions.

| Project and pinned commit | Source inspected and adopted | Fehm feature and behavior |
| --- | --- | --- |
| [Everything Claude Code](https://github.com/affaan-m/ECC/tree/9ac593b55cba44c8b20152a5c7f28d300a67ec7e) | `scripts/lib/instinct-relevance.js`: whole-token matching and additive relevance ranking | Context memory selection prioritizes task matches and detected technologies before its existing budget trim. Stable ties preserve previous order; stored confidence is unchanged. Filesystem detection, installers, hooks and global memory are not imported. |
| [gstack](https://github.com/garrytan/gstack/tree/a6b3a57512ca6d5c6aa5b68f74f736195021f96e) | `lib/review-evidence.ts`: start/end binding and stale-review classification | `fehm review --graph-report` captures indexed-file fingerprints before and after review and adds `sourceFreshness`. It does not certify a clean review. New/unindexed files, Git-ref changes, external dependencies and files changed then restored during execution are outside this snapshot check. No shipping, browser or publishing automation is installed. |
| [Agency Agents](https://github.com/msitarzewski/agency-agents/tree/ad9264e309bd5e5422c04784372d7841b1e5d604) | `engineering/engineering-code-reviewer.md`: mission, critical rules and review checklist | Optional `--profile code-review` adds correctness/security/testing priorities and evidence requirements to diff review. This is adapted prompt content, not executable code or a new autonomous agent. No fabricated expertise, mandatory praise or finding quota is included. |
| [Codebase Memory](https://github.com/DeusData/codebase-memory-mcp/tree/92abefa3f57a94591a92bcecd6a6f102da373575) | `src/store/store.c`: `camel_should_split` identifier-boundary logic | TypeScript port improves retrieval for acronym identifiers such as `HTTPServer` and `XMLParser`. Fehm keeps its existing tokenizer contract, digit handling and OAuth behavior; no SQLite store, language grammars, daemon or alternative MCP server is installed. |

Implementation: `src/upstream-adaptations.ts`, `src/review-freshness.ts`, `src/context.ts`, and `src/open-code-review.ts`. CLI/library/Model Context Protocol consumers of the shared context engine benefit from retrieval changes. Review guidance stays opt-in; the raw review output path is unchanged without `--graph-report`.

Graft’s MIT-licensed `src/ask/file-selection.ts` is pinned at [`8c05769618d413041ea2c8891f82d566f0461b3c`](https://github.com/trailhq/Graft/tree/8c05769618d413041ea2c8891f82d566f0461b3c). Its file-first round-robin algorithm now selects context packet recommendations across files before taking additional symbols from the same file. Existing retrieval scores, standalone search order, token limits and commands remain unchanged. Selection operates within the retrieved candidate pool; it does not guarantee every relevant file fits. Original source, checksum and MIT license are in `third_party/graft/` and included in npm and Python packages. Graft services, hooks and telemetry are not installed.

These improvements do not establish upstream benchmark parity, a guaranteed accuracy increase or integration of every upstream feature. Tests cover retrieval, stable memory ranking, indexed-source changes/deletions, and explicit profile handoff.

Fehm preserves the three highest-ranked anchors before rotating the remaining candidates across files, protecting focused context under small budgets. This is a Fehm-specific adaptation; file diversity is not guaranteed when only those anchors fit.
