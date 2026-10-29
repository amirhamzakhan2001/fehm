# Native Superpowers workflows

## Audit and integration decision (before implementation)

FEHM already ships 13 Superpowers-derived skills in its existing manifest-based catalog. Creating another namespace or registry would duplicate them. The main gap is packaging: the installer copies only SKILL.md, while the catalog already contains supporting files that are not exposed as resources. Existing descriptions, canonical routing and skill IDs must remain compatible.

| Upstream capability | FEHM overlap | Decision and dependency boundary |
|---|---|---|
| Brainstorming | Context engine, architecture retrieval, existing brainstorming skill | Refresh existing skill; preserve questions/design workflow and builder-check reference. Replace optional upstream visual server with host-provided visual tools; no server or telemetry installation. |
| Writing plans | Existing plan skills, bounded agent context, change analysis | Refresh existing ID; source/interfaces/tests informed by FEHM. Adapt mandatory orchestration handoff to native execution; worktrees and delegation remain optional host capabilities. |
| TDD | Existing TDD skill; health test-command discovery; guardrail red/green evidence | Refresh detailed upstream workflow and writing-good-tests reference. Use existing guardrails; never infer TDD from a passing final test. |
| Systematic debugging | Existing debug skill; investigation, graph, Git and related tests | Refresh four-phase workflow and tracing/waiting/defense references. Do not promote static relationships to proven causes. Exclude polluter executable (runner-specific unapproved execution); retain manual diagnostic guidance. |
| Verification | Existing verification skill and guardrail ledger | Refresh instructions; invoke existing approved checks and reports. No second verification engine. |
| Bootstrap/hooks/platform adapters | Existing registry, router, installer and context budget | Exclude: compulsory invocation and host hooks conflict with optional task routing. |
| Execution, worktrees, review, parallel agents, skill authoring | Eight additional existing catalog entries | Leave unchanged; no new orchestrator, automatic dependency expansion or installation. Selected workflows use native execution and on-demand skill references. |

The source is a downloaded 7.0.1 snapshot (plugin metadata), without a .git directory. A release version is not proof of a commit. Record per-file SHA-256 and mark revision unpinned. MIT copyright is Jesse Vincent, 2025; retain the complete license with every installed selected skill.

Existing architecture: SkillRegistry/catalogAdapter → routeSkills → buildAgentContext → code retrieval. Existing manageSkill handles seven assistant directory conventions and protects customized entrypoints. Extend that installer with declared, bounded resource files and managed inventories. At the time of this workflow refresh MCP was absent; the subsequent integration release adds read-only code-query tools. Skill routing over MCP remains future work.

Resource graph: brainstorming → builder-check; planning → native host execution; TDD → writing-good-tests; debugging → root-cause-tracing → manual polluter procedure, condition-based-waiting → example TypeScript, defense-in-depth; verification → guardrails. Cross-workflow transitions resolve through existing FEHM skill IDs on demand, not unconditional dependency loading. Each selected skill gets a local FEHM evidence reference and MIT license, so installed copies do not refer to catalog-relative ../../ files.

Implementation: refresh these five existing entries, declare their installation resources, add safe resource reading/copying/removal to existing APIs, expose exclusion through existing routing flags, and test routing, budgeting, evidence workflows and packaging. Do not install skills into the user's actual assistants during development. Validate with isolated temporary homes/projects, then move the downloaded source outside FEHM and run final checks again.

## Using the integration

Bundled does not mean installed. The five refreshed workflows retain their existing IDs:

- `workflows/brainstorming`
- `workflows/writing-plans`
- `testing/test-driven-development`
- `debugging/systematic-debugging`
- `verification/verification-before-completion`

```sh
fehm skills list --source superpowers
fehm skills show debugging/systematic-debugging --level full --json
fehm skills resource debugging/systematic-debugging root-cause-tracing.md
fehm agent-context "Investigate the failing authentication test" --skill debugging/systematic-debugging --skill-budget 2500
fehm skills route "Plan the new API" --skill workflows/writing-plans --budget 2500
fehm skills route "Debug the API" --exclude-source superpowers
fehm agent-context "Explain the API" --no-skills
fehm skills install debugging/systematic-debugging --platform codex --project --dry-run
fehm skills install debugging/systematic-debugging --platform codex --project
fehm skills status debugging/systematic-debugging --platform codex --project
fehm skills uninstall debugging/systematic-debugging --platform codex --project
```

Omit `--exclude-source superpowers` to restore existing routing behavior; use repeatable `--exclude-skill ID` to disable individual workflows. These are per-invocation options, not new persistent project configuration. API callers use `RouteOptions.excludeSources` / `exclude`; `include` selects a workflow explicitly but never overrides exclusion or budgets. No new global default is imposed. Generic planning may select FEHM's other planning skills; explicit selection chooses the requested Superpowers workflow. Existing overlap handling still controls redundant automatic selections. On-demand transitions avoid loading five long workflows at once. Compressed sections disclose omissions; full instructions remain available explicitly.

Installation uses the existing `fehm-<flattened-id>/SKILL.md` directory convention. Supported platform keys: claude, cursor, codex, gemini, copilot, vscode, generic. Installation tests validate files and lifecycle in temporary homes/projects, not behavior inside signed-in external assistant sessions. No assistant was installed or configured on the developer's machine.

Only declared resources are copied; no recursive copy of neighbors. Paths must stay within the skill directory, be ordinary files, and not follow symlinks. Limits: 64 files, 1 MiB per file, 4 MiB total. Resources are exposed on demand, not inserted automatically into context. `.fehm-resources.json` records installed hashes; the existing entrypoint marker remains compatible. Installation/status/removal preflight all destinations. Customized files are preserved unless explicitly forced (with backups). Unknown sibling files survive removal; obsolete managed resources are removed on upgrade. Invalid inventories stop with an actionable error. Writes are atomic per file, not a filesystem transaction across the bundle; interruption can require inspection/retry. Resource bytes are read fresh for installation; catalog skill-body hashes still detect stale indexed entrypoints.

## Evidence integration and limitations

Each selected workflow includes `fehm-evidence.md`, an on-demand guide to existing commands. `buildAgentContext` supplies bounded repository evidence already; no second context loader or automatic expensive report collection is added. The guide links `guardrails analyze/plan/start/run/report/context` and `debug analyze/context` with their actual argument contracts. A workflow being present or selected does not prove compliance. Only the existing guardrail ledger's observed execution and freshness/policy checks substantiate a verification claim. The integration's regression fixture discovers tests, builds a debugging investigation, records blocked execution, then records a real Node TAP failing assertion followed by a passing fix through Guardrails.

At the time of this workflow refresh, no native MCP endpoint, production telemetry, network bootstrap, daemon, separate settings dashboard, agent runner, or universal test-runner TDD verifier is added. The subsequent integration release adds read-only MCP code queries; MCP skill routing remains future work. Host visual tools, subagents, Git worktrees and native review are optional and require the user's normal permissions. Existing older catalog resources for the visual companion and polluter remain for historical catalog compatibility, but are not declared installation resources of these five refreshed skills and are not executed by this integration.

## Provenance and updates

`skills/superpowers-provenance.json` is the authoritative inventory for this refresh, including upstream and adapted hashes, modification notes, date, and the unpinned 7.0.1 snapshot version. Other existing Superpowers-derived entries are not refreshed or relabeled as 7.0.1. The upstream MIT license remains at `skills/licenses/superpowers-LICENSE.txt` and is copied as `LICENSE.txt` into every selected workflow installation. FEHM-authored integration text is distinguished in `fehm-evidence.md`. Existing catalog routing descriptions/frontmatter remain FEHM adaptations, while detailed upstream bodies/examples are retained except for documented host/dependency changes.

For an update, obtain a source checkout outside FEHM, verify its license and revision, compare only selected paths and their reference graph, and review changed instructions before replacing them. Use `fehm skills freshness --upstream superpowers=/path/to/checkout` as a comparison aid (older unrefreshed skills may also differ). Preserve existing IDs and local adaptations, review new external commands/network use, and update both source-map and provenance hashes. Re-run discovery, routing, context, installer lifecycle, guardrail, full-suite, build/typecheck and packed-artifact tests. Never run an automatic upstream pull during normal operation. There is no claim of upstream behavioral evaluation parity after FEHM adaptations.

## Validation record — 2026-10-28

- `npm run check`: passed after the temporary checkout was moved out.
- `npm run build`: passed after the temporary checkout was moved out.
- `npm test`: **370 passed, 0 failed, 0 skipped** on the final run, including eight new integration tests. Initial sandbox runs could not bind localhost (EPERM); rerunning with localhost access passed. No failing baseline test was hidden or weakened.
- `node --import tsx --test test/superpowers.test.ts`: eight passed on the final selected-workflow/resource revision.
- `git diff --check`: passed.
- No lint script exists in package.json; lint was not run.
- `npm pack --ignore-scripts --pack-destination /tmp --json`: passed. The initial cache write was sandbox-blocked; the approved rerun succeeded.
- An earlier development tarball passed isolated catalog/resource lifecycle checks. Current package validation is recorded in [release status](../RELEASE_STATUS.md).
