# Feature audit and verification record

This audit distinguishes implementation from representative testing and environment-specific assurance. fehm's earlier 103-entry inventory described implementation surfaces with overlap. The current documentation groups them into seven capabilities and adds engineering-practice policy/drift as part of architecture governance. Neither count establishes universal completion.

## Scope of the current update

Current verdict: **ready for controlled local beta testing and a GitHub source release**, with the limits below made explicit. This is not a claim that every feature is correct for every workload, fully optimized, or production-qualified. Use [REAL_TESTING.md](REAL_TESTING.md) to collect the remaining acceptance evidence.

Reviewed the README and all maintained Markdown documents, architecture/drift checks, preflight, practice/readiness signals, CLI/MCP/API interfaces, cockpit request handling, and localhost lifecycle. Added a 31-rule practice catalog, approved policy/exemptions, evidence baselines, drift, and preflight integration. Rewrote documentation around the actual workflows and their limits.

## Capability evidence

| Capability | Implementation evidence | Representative verification | Remaining qualification |
| --- | --- | --- | --- |
| Understand the system | Scanner, analyzer, indexer, graph, system map | Indexer, graph, system-map suites | Fixed TypeScript compiler settings; shallower polyglot resolution; unresolved dynamic relationships |
| Focused agent context | Context, universal search, MCP | Context, advanced-feature, MCP subprocess suites | Estimated tokens rather than model tokenizers; full MCP-client compatibility needs broader testing |
| Architecture and engineering practices | Contracts, architecture intent, drift, 31-rule practice engine, preflight | Architecture, intelligence, engineering-practices, advanced-feature suites | Static evidence is not implementation proof or certification; rules must be selected for the project |
| Review and verify changes | Diff, impact, verification, test selection, mutations, bug replay | Change, verification, mutation, bug-lifecycle suites | Execution trusts the repository; native polyglot runners are not comprehensive |
| Quality and reliability | Dependencies, dead code, coverage, contracts, infrastructure, security flow, runtime, health | Code-risk, partial-completion, cross-repository, advanced-feature suites | Heuristic recall and trace-format breadth need more fixtures; large-repository load not certified |
| AI engineering | Prompt analysis/runtime/optimization, AI topology, claims, agent analytics | Prompt, optimizer, governance suites | Provider behavior uses deterministic doubles; no real model endpoint qualified in this audit |
| Local operation and sharing | Cockpit, HTTP, CLI watch, synchronization, history, onboarding/export, OS-service code | Server/history/readiness suites, API and localhost smoke scripts | No connected browser or native OS-service lifecycle run available |

## Engineering-practice regressions covered

- Advisory results do not enforce unapproved policies.
- Proposal, explicit approval, profiles, required rules, and reasoned exemptions work through library and CLI.
- Missing approved requirements block preflight until resolved or explicitly overridden; overrides remain visible.
- Unknown rule IDs, malformed settings, unapproved/edited policy, and corrupt baselines fail closed.
- Documentation cannot impersonate executable test/source evidence.
- Service and AI applicability is inferred from implementation signals, with source locations.
- Removed evidence creates drift; improvements do not hide a simultaneous regression.
- Policy changes invalidate comparison with an old baseline.
- MCP returns practice results through an actual stdio subprocess.

## Localhost checks

The release gate exercises real HTTP and actual CLI processes on ephemeral loopback ports. The dedicated localhost script covers:

- Default loopback binding, remote unauthenticated refusal, and short-token rejection.
- Hostname-rebinding guard using a raw HTTP request with an unrelated Host header.
- Static assets and project pages.
- Multi-project listing and scoped overview data.
- Practices API and invalid context-query types.
- Watch refresh into a custom graph output directory.
- SIGTERM shutdown.

The authenticated API script separately covers probes, authentication, security headers, readiness/intelligence routes, malformed/oversized bodies, invalid graph shape, recovery, and unknown projects.

Cockpit unit tests execute the request helper in a JavaScript test environment to check project/view scoping, stale-response rejection, errors, and cancelled authentication. This is not a browser rendering test. The browser runtime reported no available browser during the audit, so canvas interactions, layout, keyboard accessibility, dialogs, and complete navigation workflows remain unverified visually.

## Defects corrected

The earlier optimization pass bounded initial focus matches, corrected truncation, indexed relationship adjacency, reused context source reads, bounded long rendered queries, recomputed retained-evidence quality, hardened malformed MCP/API input, grouped cache serialization, and rejected mismatched graph/cache snapshots.

The current pass additionally fixes:

1. New architecture violations being masked by equal or greater resolved counts.
2. Invalid architecture policy being ignored by preflight when no violation array could be produced.
3. Non-string context queries causing downstream server failures.
4. Readiness accepting a structurally invalid graph object.
5. Watch mode updating the default graph instead of the supplied custom output.
6. Bind errors leaving watch timers running.
7. Unauthenticated loopback requests accepting unrelated hostnames.
8. Late project/view responses and unhandled request failures confusing cockpit state.
9. The project’s saved graph still pointing at the previous `RepoMind` directory. The local index was rebuilt for the current Fehm path; missing roots now fail readiness and practice audits instead of producing misleading gaps.
10. Mere framework/database names in source catalogs triggering capability applicability. Detection now looks for relevant calls, package evidence, or migration artifacts.

## Validation boundary

The 20 September 2026 readiness recheck passed **66 tests with zero failures and zero skips**, strict TypeScript validation, production build, both authenticated API and localhost CLI smoke scripts, and the npm package dry run. The assistant integration tests cover every platform and both scopes, repeat installation, custom-file preservation/backups, safe removal, and symlink refusal. A new scanner regression excludes `.venv` and `__pycache__` artifacts. Test scripts now use the actual flat test-file layout so POSIX shells expand the paths for older supported Node versions. Temporary PDF images are excluded from the GitHub candidate files.

The uv wheel was installed into temporary tool directories on macOS and exercised with system Node/npm removed from the command PATH. Scan, query, practices, each project skill registration, stdio MCP, cockpit assets, process shutdown, and failing-command exit codes passed. Both wheel and source archive are built; the wheel is rebuilt from the source archive by `uv build`. CI now defines Linux/macOS/Windows package jobs, but those remote jobs and discovery in the proprietary assistants were not executed in this local session.

`npm run release:check` is the engine gate: strict types, the test suite, production build, authenticated API smoke, localhost CLI smoke, and npm package dry run. The uv release additionally requires `npm run build:python` and `python3 scripts/python-smoke.py`. Neither gate publishes, installs an OS service, launches an external model job, or validates a public deployment. Sandboxed listener restrictions produce `EPERM`; network checks must run where loopback listening is allowed.

The earlier coverage snapshot (before this practices update) was 86.56% lines, 77.52% branches, and 87.24% functions with one sandbox-blocked HTTP test. Those numbers are historical and are not presented as coverage of the new implementation.

## Open work

- Project TypeScript configuration/alias/reference support and language-specific compiler integrations.
- Broader parser-backed practice evidence, custom rule extension, and native polyglot verification.
- Browser automation and native macOS/Linux/Windows service lifecycle tests, including path quoting.
- The Linux service writer currently interpolates paths into `ExecStart` without systemd quoting; paths containing spaces are a known limitation. Prefer foreground watch/serve until native service handling is qualified.
- Real-provider qualification, failure handling, and runtime cost/quality evaluation.
- Large-repository performance, concurrency, crash recovery, and stronger multi-file persistence semantics.
- Public website browser qualification, hosting/domain/analytics configuration, deployment, and explicitly authorized package/container publication. Initial website code is now in `website/` with a separate build and test job.

The local server is not public multi-tenant SaaS. See [ROADMAP.md](ROADMAP.md) and [DEPLOYMENT.md](DEPLOYMENT.md) for the remaining scope and operating model.
