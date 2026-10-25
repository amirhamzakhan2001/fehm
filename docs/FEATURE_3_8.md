# Feature 3.8 — Git Memory & Logs

Git Memory adds a local, searchable engineering history above native Git. It
indexes commit evidence and semantic changes, follows file renames, compares
revisions, reconstructs selected historical FEHM analyses, and exports compact
context. It works offline without a hosting account, network calls or models.

## Use

```sh
npm run build
fehm git-memory --root /path/to/project
fehm git-memory authentication --json
fehm git-memory --ref release/v1 --limit 500 --category dependencies --json
fehm git-memory --path src/auth.ts --entity authenticate --json
fehm git-memory --from main --to feature/auth --json
fehm git-memory --from HEAD~1 --to HEAD --raw
fehm git-memory --blame --path src/auth.ts --line 1
fehm git-memory --snapshot --ref HEAD --json
fehm git-memory --from v1 --to v2 --snapshot --json
fehm git-memory authentication --budget 1500 > FEHM_PROJECT_MEMORY.md
fehm serve --root /path/to/project
```

The dashboard entry is **Git memory**, `/#/git-memory`; the standalone route is
`/git-memory`. Graph node inspectors have a History link prefiltered to the file.
The page includes a filtered timeline, commit detail and parent navigation,
rename lineage, raw diffs, blame, current graph references, churn, monthly
category groups, endpoint comparisons, on-demand snapshots, existing recorded
measurements and context export. A branch/tag selector controls reachability.
Author, date, file/folder, category and free-text filters narrow the timeline.
Activity groups describe the whole selected commit window, not inferred projects.

The default window is the latest 100 commits reachable from HEAD, including
merged parents. `--limit` accepts 1–2000. The report exposes total reachable
commits, shallow status, omitted history and analysis limits. Other branches are
only included when reachable from the selected revision. The ref inventory lists
local/remote-tracking branches and tags; remote repositories are never contacted.
The default branch is only reported when the local origin/HEAD symbolic ref
records it. It is not guessed from a branch name. Detached and unborn HEAD and
non-Git folders have explicit states.

## Evidence and semantic events

* Commit objects retain all actual parent IDs, author identity, author timestamp,
  original message and Git file status/line counts. In shallow clones, formatted
  log output can hide parents; FEHM reads raw commit headers to preserve them.
* Git rename detection links old and new paths, including unusual whitespace in
  filenames. Rename lineage follows those links within the indexed window.
* TypeScript/JavaScript declarations are parsed with the existing TypeScript
  dependency. Functions, classes, methods, interfaces, types, enums and variables
  produce creation, deletion, modification and rename-associated movement events.
  Fingerprints compare exact declaration source; formatting changes count too.
* Parsed `package.json` dependency groups produce additions, removals and declared
  version changes. A range change is not called an upgrade/downgrade, and does not
  claim a resolved installed version.
* Paths suggest architecture, API, database, AI, prompt, security, test,
  documentation and configuration categories. These are explicitly **heuristic**
  file-change hints, not proof that behavior, security posture or architecture
  changed. Conventional-message labels are separately prefixed `message:`.
* Versioned `adr/` and `decisions/` documents create documented-decision-change
  references. Their actual rationale remains in Git; FEHM does not invent it.
* Standard revert messages retain their declared target commit. This is a message
  association, not verification that the patch exactly reverses the target.
* Merges preserve the DAG and compare their tree to the first parent. Changes
  visible against another parent are available through an explicit comparison.

Events have stable IDs, commit references, category/type, path, entity,
before/after values or fingerprints, provenance, confidence and evidence. Git
facts and syntax facts are distinct from heuristic interpretations. Creation
means creation in that compared tree, not proven first occurrence anywhere.

A missing shallow parent produces an unavailable comparison rather than an
invented root creation event. A later deepening retries those comparisons.
Truncated or failed analysis is reported. Source blobs are bounded to 512 KB;
binary blobs are not parsed. Semantic analysis covers at most 300 files per
comparison. Git subprocesses have time and output limits. Large history requests
may take time; the CLI and server currently perform this bounded work synchronously.

## Historical measurements and cross-feature integration

Snapshots are **explicitly requested**, not automatically generated for every
commit. FEHM reads regular blobs into a disposable temporary directory and runs
the existing code graph, architecture, drift, health, security and prompt
analyzers there. It never checks out, resets, commits, executes project scripts,
runs tests or evaluates models. The user's working tree and index stay untouched.
Symlinks, submodules and stored FEHM state are not followed. A committed
architecture contract and drift decisions are used for that revision. Untracked
current contracts are not silently imposed on old code.

A snapshot retains:

* architecture nodes and their source file references;
* code relationship edges;
* health, security and drift finding identities/titles;
* prompt identities, source locations, content digests, static scores, model/tool
  metadata;
* finding counts, detected test-file counts and prompt static scores;
* analyzer version, analysis time, commit timestamp, materialization coverage and
  explicit unknowns.

No raw source or full repository copies are persisted. Limits are 5,000 text
files and approximately 20 MB of materialized content. The existing scanner's
language/ignore rules still apply; materialized and indexed file counts differ.
Skipped materialization is listed. The snapshot coverage flag only describes
materialization, not universal semantic support or full analyzer coverage.

Snapshot comparisons report observed appearances and findings no longer detected,
architecture identities and relationship changes. They do not claim that a
finding was introduced or fixed at an exact commit when only two snapshots were
measured. Finding ID changes can reflect source movement. Prompt comparisons use
unique path/name pairs; ambiguous matches and cross-file moves are not inferred.
A static score regression is not a behavioral regression. Coverage percentages
and passing-test counts are `null`; no runtime outcomes are fabricated.

Recorded health/security trends and saved prompt revisions are also accessible,
separately labelled. They may refer to dirty trees or unapplied candidates;
`sourceCommit` does not turn those observations into committed measurements.
Current graph impact lists nodes in changed files and their incoming references,
explicitly labelled as the **current working-tree graph**, not historical impact.

## Storage and retrieval

The configurable state directory contains:

```text
.fehm/git-memory-index.json
.fehm/git-memory-snapshots/<commit>.json
```

The commit cache is keyed by immutable IDs and a schema/analysis version and keeps
a bounded union of 4,000 records for branch switching. Reports re-enumerate current
reachability, so rewritten refs do not make orphaned commits look current. New
commits alone need semantic extraction; a force refresh rebuilds the selected
window. Snapshot caches include analyzer versions; change the snapshot pipeline
version when upgrading prompt/security analysis behavior. Writes are atomic.
`--dry-run` and server read-only mode suppress persistence.

`renderGitMemory` retrieves matching commits before emitting a compact Markdown
index with evidence references. Its budget is a UTF-8 byte/4 token estimate, not
model-specific tokenization. Search is deterministic lexical matching across
messages, authors, files, entities and categories. It does not call an LLM or
claim to understand arbitrary natural-language causal questions.

## API and library

GET endpoints:

* `/api/git-memory` or `/report` — branch-aware indexed report
* `/search?query=...&category=...&path=...&author=...&since=...&until=...`
* `/entity?path=...&entity=...` — rename-aware history within the window
* `/commit?id=<full hash>` — detail and current graph references
* `/compare?from=...&to=...` — semantic endpoint tree comparison
* `/diff?from=...&to=...` — raw native Git diff
* `/blame?ref=...&path=...&start=1&end=50` — line-porcelain evidence
* `/context?query=...&budget=3000` — Markdown context
* `/observations` — previously recorded health/security/prompt measurements

POST endpoints require `x-fehm: 1`:

* `/refresh` — re-read reachable history and incrementally index new commits
* `/snapshot?ref=...` — reconstruct or reuse a selected snapshot
* `/snapshot-compare?from=...&to=...` — compare two reconstructed analyses

`ref` and `limit` select the indexed history window. Invalid revisions, numeric
limits and blame ranges are rejected. Git runs with argument arrays, no shell,
no external diff or textconv drivers. API/page output is local; page code renders
repository text with DOM text nodes under the shared same-origin CSP.

Public library exports: `indexGitMemory`, `searchGitMemory`, `entityGitHistory`,
`compareGitMemory`, `renderGitMemory`, `historicalSnapshot`,
`compareMemorySnapshots`, `historyBlame`, `rawHistoryDiff`, and domain types.
There is no new MCP server; the library/API provide structured agent access.

## Boundaries and follow-on work

This delivers the local historical index, query, comparison and selected-snapshot
foundation. The broader design's automatic release/major-change snapshot
scheduler, event replay slider, arbitrary historical architecture diagram UI,
verified cross-file symbol splits/merges, non-JS/TS declaration history,
semantic change clustering, patch-equivalence/cherry-pick detection, automatic
exact finding-introduction bisection, runtime regression attribution, Git hooks,
remote PR/issue enrichment and MCP transport remain future work. File activity is
not a developer score, and undocumented design intent remains unknown.

Tests in `test/git-memory.test.ts` use real temporary Git repositories to verify
root commits, semantic changes, renames, dependency changes, filtering, cache
reuse, branch reachability, merges, unusual paths, detached HEAD, shallow/deepened
clones, read-only storage, symlink handling, committed snapshot isolation,
CLI/API behavior and protected mutation routes.
