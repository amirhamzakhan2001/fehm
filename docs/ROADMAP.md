# Roadmap

Implementation, automated evidence, and deployment confidence are separate milestones. A detector or endpoint being present does not establish exhaustive correctness.

## Available workflows

| Area | Current implementation |
| --- | --- |
| Code understanding | Typed source graph, supported language extraction, entry points, flows, relationship queries, explicit unknowns |
| Agent context | Hybrid retrieval, evidence-linked packets, intent, estimated-token budgets, CLI/library/MCP access |
| Architecture and practices | Reviewed architecture contracts; 31 practice checks; approval, exemptions, baselines, drift, preflight gates |
| Change verification | Diff projection, blast radius, affected tests, static/security/architecture checks, mutations, historical bug replay |
| Quality and reliability | Dependency/dead-code/bug intelligence, coverage, API/infrastructure/security graphs, runtime evidence, health/search |
| AI engineering | Prompt analysis/history, explicit evaluations, multi-model comparison, held-out optimization, agent and claim intelligence |
| Operation and knowledge | Localhost cockpit, project scoping, polling sync, OS-service implementation, ownership/history, onboarding and linked exports |

See [FEATURES.md](FEATURES.md) for the grouped guide and [FEATURE_AUDIT.md](FEATURE_AUDIT.md) for test evidence.

## Completed in the current improvement pass

- Incorporated selected MIT source adaptations from Everything Claude Code, gstack, Agency Agents, Codebase Memory and Graft for memory relevance, review freshness, optional review guidance, acronym retrieval and file diversity in context packets. Full provenance is in the integration decisions document.

- Bundled pinned Open Code Review 1.12.7 in platform-specific uv wheels, with vendored source provenance and attribution; optional diff context handoff and validated graph-linked findings. Local macOS ARM64 installation verified; provider quality and other operating systems remain unqualified.

- Added per-analysis TypeScript compiler-host caching and bounded context-file/Git-blame concurrency while retaining existing commands and report schemas. See [integration decisions](OPEN_SOURCE_INTEGRATIONS.md#internal-optimization-pass).

- Added uv wheel/source-archive distribution with a private Node runtime; npm remains a developer build dependency.
- Added scoped assistant skill registration, status, safe removal, and `query` alias.
- Tested the installed wheel without global Node/npm; added a Linux/macOS/Windows wheel CI job. Actual proprietary-client discovery and non-local OS results remain separate validation.
- Excluded Python virtual environments/cache artifacts from scans, corrected shell test discovery, and added a real-repository beta acceptance checklist.
- Added engineering-practice policy and evidence drift across the development and operational lifecycle.
- Exposed practices through CLI, library, MCP, HTTP, and the cockpit.
- Integrated approved required practice gaps into preflight with visible override evidence.
- Corrected architecture drift so fixing an old violation cannot hide a new one.
- Added validation for non-string context queries and malformed graph readiness.
- Corrected custom-output watch refresh and stopped timers on server bind failure.
- Added a loopback hostname guard, richer localhost CLI/network tests, stale-response rejection, and visible UI request failures.
- Reorganized README and documentation around capabilities, actual behavior, and known limits.

## Next: analysis depth and policy evidence

1. Load project TypeScript configuration, aliases, references, and relevant build settings with cache invalidation and fixtures.
2. Add language-specific compiler/LSP adapters where needed rather than claiming type resolution from syntax heuristics.
3. Strengthen practice evidence with parsed configuration and executable checks; retain manual review for controls that cannot be inferred statically.
4. Add richer architecture patterns and custom-rule extension APIs with deterministic validation and migration semantics.
5. Extend native test/mutation execution beyond the current supported package-script workflows.

## Next: integration confidence

1. Add browser automation for graph interactions, navigation races, authentication, forms, and responsive/accessibility behavior.
2. Exercise each supported trace format with representative exporter fixtures.
3. Run opt-in integration suites against real model providers, including timeout, retry, rate-limit, and evaluation failure behavior.
4. Validate installation, restart, status, and removal on macOS, Linux, and Windows; correct platform quoting and path edge cases.
5. Run large-repository benchmarks, concurrent reads, interrupted writes, and state-recovery tests.

## Next: distribution and optional integrations

The initial public marketing/documentation website is implemented in `website/`, with static pages, SEO metadata, and optional consent-based analytics. Domain/hosting, browser qualification, a live analytics property, and public deployment remain pending. Public package/container publication requires an explicit release. Optional analyzer/SARIF adapters, learned retrieval, and additional external integrations are future work, not implied dependencies.

Public multi-tenant SaaS remains outside the current product boundary. It needs a separate architecture for identity, tenant isolation, execution sandboxes, jobs, quotas, retention, and abuse control.

## Acceptance rule

A feature is ready for its stated scope when its behavior and limits are documented, representative success/failure tests pass, its public interfaces work, and environment-dependent validation is recorded honestly. Counts are not a substitute for that evidence.
