# Capability guide

fehm is organized around seven workflows. Shared engines, API endpoints, report formats, and UI panels are described together instead of being counted as independent product features. The earlier 103-entry inventory remains historical scope context; new practice rules are controls within one capability, not dozens of new headline features.

## 1. Understand the system

The scanner fingerprints supported source files and builds repository, directory, file, package, and symbol nodes. Relationships include containment, definitions, imports, calls, references, uses, inheritance, and implementation. Each relationship retains its provenance, confidence, and available source location.

TypeScript and JavaScript use AST/type-checker analysis. Python, Go, Rust, and Java use deterministic declaration, import, and unambiguous-call extraction with less resolution depth. Focus, callers, dependencies, and path-preserving relationship queries help explain local behavior. System maps add entry points, execution flows, architecture/DNA summaries, risk signals, onboarding, and explicit unknowns. Connectivity reports expose disconnected components without inventing edges.

The scanner excludes common generated/dependency directories, including `node_modules`, `dist`, `.venv`, and `__pycache__`. It does not implement general `.gitignore` matching; inspect the graph inventory when testing custom output or environment directories.

Commands: `scan`, `stats`, `focus`, `relationships`, `what-breaks`, `system-map`, `flow`, `explain`, `connectivity`.

Implementation: `scanner.ts`, `analyzer.ts`, `indexer.ts`, `graph.ts`, `system-map.ts`, `project-readiness.ts`.

## 2. Give agents focused context

Hybrid retrieval combines lexical matches, symbol names, deterministic semantic concepts, intent, and graph relationships. Context packets include ranked nodes, relationship evidence, source excerpts, architecture, relevant tests, recent history, and decision memory. Quality reflects the evidence retained after trimming.

Context memory uses task and technology relevance ranking with stable ties. Acronym identifiers such as HTTPServer are split for word-based retrieval. These are attributed adaptations from Everything Claude Code and Codebase Memory; see [integration decisions](OPEN_SOURCE_INTEGRATIONS.md).

Rendered packets have a character-estimated token budget. Full queries remain in JSON; long rendered query headings are shortened. The packet builder shares source reads with retrieval. MCP exposes this knowledge to coding agents through stdio tools and a graph resource, while API and library consumers use the same engine.

Commands: `search`, `query`, `context`, `search-all`, `mcp`.

Implementation: `context.ts`, `mcp.ts`, `project-intelligence.ts`.

## 3. Keep engineering practices consistent

Architecture proposals infer likely layers and technologies. Developer approval creates the project contract used by dependency checks. Architecture-intent auditing asks about responsibility, rationale, dependency direction, flows, invariants, extension points, and escalation. Architecture drift compares import-rule violations before and after changes; a new violation is always reported as degradation.

The engineering-practices catalog adds 31 checks covering architecture/ownership, development, tests, CI, dependencies, security, APIs/data, reliability, operations, deployment, accessibility, and AI controls. Profiles scope applicability. Policy modes distinguish warnings, approved requirements, and reasoned exceptions. Saved evidence baselines detect practice regressions independently of source-graph changes.

Approved missing requirements participate in preflight approval gates. Neither practice matching nor a production-readiness score establishes standards compliance. The [policy guide](ENGINEERING_PRACTICES.md) explains the full catalog and limitations.

Commands: `architecture`, `architecture-audit`, `drift`, `practices`, `capabilities`, `production-audit`.

Implementation: `architecture.ts`, `engineering-practices.ts`, `verification.ts`, `intelligence.ts`, `project-readiness.ts`, `agent-control.ts`.

## 4. Review and verify changes

Git working-tree, staged, base-reference, and unified-patch inputs are projected onto graph files and symbols. Reports include direct and transitive blast radius, affected tests and routes, hidden dependencies, risk reasons, and inspection order.

Preflight evaluates understanding, protected zones, architecture, engineering policy, and risk. Fix-test-verify executes selected tests and checks the refreshed graph. Verification includes built-in graph/freshness checks, project commands, security rules, and architecture contracts. Mutation testing executes supported AST mutants in isolated copies. Historical bug replay compares parent/fix checkouts and fix verification adds regression, static, and mutation gates.

Commands: `impact`, `preflight`, `fix-verify`, `verify`, `verify-change`, `mutation-test`, `bug-reproduce`, `bug-fix-verify`.

Implementation: `change.ts`, `agent-control.ts`, `verification.ts`, `testing-intelligence.ts`, `mutation-testing.ts`, `bug-lifecycle.ts`.

Optional model review: `fehm review` previews an Open Code Review invocation; `--allow-provider` runs the bundled Open Code Review engine. Optional `--context` supplies Fehm context; `--graph-report` links validated findings to indexed locations while preserving unverified provenance. See [Open Code Review](OPEN_CODE_REVIEW.md).

## 5. Improve quality and reliability

Engineering reports combine complexity, coupling, churn, warning markers, refactoring candidates, and performance heuristics. Dependency intelligence correlates manifests, imports, and lockfile metadata. Dead-code analysis considers entry points and test-only reachability. Bug-history analysis mines Git fix evidence.

Coverage ingestion uses supported measured artifacts; otherwise static test reachability is explicitly labeled. Test-quality reports assess assertions, coverage, isolation, reliability, and maintainability. API discovery covers supported framework patterns and OpenAPI, including consumer matching and breaking-contract comparison. Infrastructure analysis reads environment, container, orchestration, Terraform, and source artifacts. Security graphs trace supported AST sources, transforms, sanitizers, and sinks.

Runtime ingestion accepts supported OpenTelemetry, Chrome, or generic trace shapes and maps spans to code for bottleneck aggregation. Cross-repository graphs connect package and API evidence. Unified health and search bring these reports together.

Commands: `intelligence`, `dependency-risk`, `dead-code`, `bug-history`, `coverage`, `test-quality`, `api-contract`, `infrastructure`, `security-graph`, `runtime`, `cross-repo`, `health`.

Implementation: `intelligence.ts`, `code-risk-intelligence.ts`, `testing-intelligence.ts`, `contract-intelligence.ts`, `security-graph.ts`, `runtime-intelligence.ts`, `cross-repository.ts`, `project-intelligence.ts`.

## 6. Engineer AI systems

Prompt analysis produces structure and quality scorecards, ambiguity/conflict findings, instruction-hierarchy and security findings, evaluation cases, and code-aware tool contracts. Prompt diff and evolution preserve versions, reasons, execution outputs, failures, and evaluator evidence.

Explicit provider adapters support single- and multi-model evaluations, adversarial cases, latency/security comparisons, and failure diagnosis. Optimization generates bounded candidates, selects using training evidence, and applies a separate held-out promotion gate. It is not unrestricted prompt search.

AI system/evaluation graphs connect repository agents, prompts, tools, model executions, datasets, tests, and outcomes. Claim verification checks concrete graph-backed statements while leaving unsupported absolutes unverified. Persisted agent analytics and mistake memory track outcomes, recurrence, prevention, and resolution.

Commands: `prompt`, `summaries`, `hallucination-verify`, `agent`, `ai-evaluations`.

Implementation: `prompt-engine.ts`, `prompt-runtime.ts`, `prompt-optimizer.ts`, `semantic-summary.ts`, `ai-governance.ts`.

## 7. Operate and share the codebase brain

End users can install the release wheel through uv without a separate npm/Node installation. The `install`, `integrations`, and `uninstall` commands manage personal or project skills for Claude Code, Cursor, Codex, Gemini CLI, Copilot CLI/VS Code, and generic Agent Skills clients. Registration supports previews, repeat installation, custom-file protection, and backup-producing forced updates. `query` is an accessible alias for evidence-based context retrieval. See [INTEGRATIONS.md](INTEGRATIONS.md) for discovery and verification limits.

The localhost cockpit serves progressive graph views, project switching, engineering reports, practices/drift, context simulation, and Prompt Lab. Multiple indexed repositories share one local process through project-aware URLs. Authentication, request limits, security headers, health probes, bounded expensive jobs, and graceful shutdown support trusted private use.

Persistent file units and reverse-dependency invalidation support incremental indexing. The synchronizer serializes polling refreshes. CLI watch mode keeps the supplied graph path updated, including custom output directories. OS-service code supports user-level platform installation, but native lifecycle validation remains a separate requirement.

Architecture timelines, ADR maintenance, Git archaeology, blame, local PR/merge evidence, team knowledge, checkpoints, and change digests preserve context. JSON/Markdown reports, durable onboarding, and Obsidian-compatible notes support sharing and review.

Commands: `serve`, `watch`, `service`, `timeline`, `adr`, `archaeology`, `team`, `checkpoint`, `onboarding`, `export-obsidian`.

Implementation: `server.ts`, `public/`, `synchronizer.ts`, `service-manager.ts`, `history-intelligence.ts`, `project-readiness.ts`, `persistence.ts`.

## What “implemented” means

A command, report, or detector exists and has an implementation path. This does not imply exhaustive language support, browser validation, real-provider qualification, platform certification, or production suitability for every deployment. See [FEATURE_AUDIT.md](FEATURE_AUDIT.md) for evidence and [ROADMAP.md](ROADMAP.md) for unfinished work.

### Context selection across files

Budgeted context packets retain their top three ranked anchors, then use Graft-derived file-first round-robin selection for the remaining recommendations. This reduces repeated-file crowding within the retrieved candidate pool while preserving search scores and token limits. See [source attribution](OPEN_SOURCE_INTEGRATIONS.md).
