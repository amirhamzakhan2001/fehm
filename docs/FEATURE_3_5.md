# Feature 3.5 — Project Health & Test Coverage

`fehm serve` → `http://127.0.0.1:4317/health` (dashboard: `/#/health`), and `fehm health` on the command line.

3.5 answers one question: **how healthy is this codebase, where are its weak points, and how much confidence do we have that important behaviour is actually protected?**

There is no health score. Health is eleven explainable **dimensions**, each with a status and, only where it is a real measurement, a number with a stated definition. Missing data is **unknown**, never zero. Every finding carries evidence. No model is called; the only network access is the advisory lookup, and only when you ask for it.

```
FehmEngine (graph, files) ─┬─ per-file analysis (metrics.ts; TypeScript AST / line heuristics; cached by content hash)
3.2 BriefingFacts ─────────┤  tests.ts · coverage.ts (artifacts) · git.ts (history)
                           ├─ quality.ts · dead-code.ts · 3.4 signals (reused) · AI-code indicators
                           ├─ dependencies.ts (lockfiles, licenses, SBOM) · advisories.ts (OSV.dev, opt-in)
                           ├─ build.ts (detected checks, run only on request) · ci.ts (gates)
                           └─ debt.ts (Skylos debt scoring + git churn + test protection)
                                            │
            findings (shared model: src/findings) + dimensions + provenance → /health, fehm health
```

## Dimensions and status

Statuses: **healthy**, **attention**, **degraded**, **critical**, **unknown**.

| Dimension | Number shown (only if measured) | Status rule |
|---|---|---|
| Build | % of detected checks whose last run *through Fehm* passed on the current code | unknown until a check is run; stale results cap at attention |
| Tests | % of symbols with a test relationship (runtime line data where available, otherwise graph reachability from test code, ≤ 4 calls deep) | no tests → critical; otherwise from findings |
| Coverage | line (or statement) coverage from the artifact | **unknown without an artifact**; ≥ 80 healthy, ≥ 60 attention, ≥ 40 degraded, else critical; stale artifact caps at attention |
| Code quality | % of functions within every threshold | ≥ 85 % healthy, ≥ 70 % attention, else degraded; also from findings |
| Maintainability | — | from findings (large classes, cycles, duplication, large files, markers) |
| Dead code | definitely + likely unused symbols | 0 healthy, > 50 degraded, otherwise attention |
| Dependencies | component count | from findings; says so when vulnerabilities were not checked |
| Reliability | — | from findings |
| Technical debt | high-priority hotspots | 0 healthy, ≤ 3 attention, else degraded |
| AI-code indicators | — | from findings |
| CI | gates detected | from findings |

"From findings": critical if any open critical finding; degraded if any high or ≥ 10 medium; attention if any medium or ≥ 5 low; otherwise healthy. A dimension's status is the worse of its own rule and this one.

**Overall status** is the worst status among the dimensions that could be measured. The page lists the reasons and the dimensions that were not measured.

## Findings

All findings use the model in `src/findings/model.ts`, shared with Feature 3.6: id (stable, used by baselines and reviews), rule id, the Skylos rule it was adapted from (`upstream`), category, **severity and confidence as separate axes**, location, metric vs threshold, evidence rows (typed: ast, test, coverage, git, config, dependency, runtime, pattern, absence …), what was *not* established, why it matters, what to do, and how to verify the fix.

Confidence uses Fehm's evidence vocabulary (verified, strong, inferred, unknown) as in 3.3 and 3.4, not a percentage.

### Rules

The catalog is `src/health/rules.ts`.

- **Quality**, adapted from Skylos:
  - cyclomatic complexity (SKY-Q301), cognitive complexity (Q306), nesting (Q302), function length (C304), parameters (C303), duplicate branches (Q305);
  - compiler suppressions (T104), blanket lint disables (L035), debug leftovers (L009).
- **Maintainability:** large classes (Q502), dependency cycles (SKY-CIRC, from 3.2's file cycles), and 3.4's duplicate and near-duplicate implementations, pass-through wrappers, very large files and TODO markers (reused from `src/drift/signals.ts`).
- **Dead code:** unused symbols (U001), unused files, unused imports (U002), unreachable statements (UC002), unused dependencies (U005, from 3.4).
- **Reliability:**
  - empty catch (L007), bare except (L002), swallowed exceptions (L030), missing network timeouts (L031), missing cleanup (L008);
  - async `forEach` (Q406), async Promise executor (Q405), discarded `map(async …)` (Q407), await in loop (Q402).
- **Tests:**
  - no tests;
  - focused, skipped, empty and assertion-less tests;
  - mock-heavy files;
  - critical test gaps (cf. A102);
  - entry paths with untested steps;
  - sensitive symbols tested only on the success path.
- **Coverage:** files under 50 % line coverage; stale artifact.
- **Dependencies:** no lockfile, unpinned versions, license denied or needing review (SCA-LIC001), license undeclared, duplicate versions, known vulnerabilities.
- **AI-code indicators:**
  - imports of files that do not exist (cf. L012);
  - undeclared npm packages (D223);
  - placeholders (L026);
  - always-true assertions (A101);
  - disabled TLS or CSRF controls (L011);
  - placeholder data (L032).
- **Build and CI:** failed checks, TypeScript not strict, no CI, missing gates (tests, build, security).
- **Debt:** high-priority hotspots.

### How deep each language is analysed

| Check | TypeScript / JavaScript | Python | Go, Java, Rust |
|---|---|---|---|
| Complexity, nesting, parameters | TypeScript compiler AST | line heuristics over Feature 1 function ranges | line heuristics |
| Cognitive complexity, unreachable code | AST | — | — |
| Unused imports | AST | heuristic | — |
| Reliability | AST | heuristic | heuristic (Go timeouts, Java empty catch; Rust none) |
| Test facts | AST (cases, empty and assertion-less bodies) | heuristic | heuristic |
| Dead code | graph + AST resolution | graph (heuristic) | graph (heuristic) |

The page's **Analysis** section shows this matrix for the languages actually present. A heuristic metric says "estimated" in the finding.

## Tests and test protection

- **Inventory:**
  - cases, assertions, skipped, focused, empty, assertion-less and always-true tests, mocks, setup hooks, failure-path expectations, framework;
  - a category (unit, integration, e2e, component, api, contract, database, security, performance, smoke, regression). The category comes from the path when a folder or file name says so; otherwise it is marked **inferred** (from imports) or defaulted to unit.
- **Protection of each function, method and class:**
  - *runtime*: a line inside it was executed, when a coverage artifact has line data for the file;
  - *direct*: test code calls or references it;
  - *transitive*: reached through calls from a directly tested symbol;
  - *none*.

  Runtime data overrides the graph in both directions: a symbol whose instrumented lines were never executed is unprotected even if a test references it.
- **Critical test gaps.** Unprotected symbols ranked by a published risk sum:
  - fan-in from other files (up to 10);
  - route or CLI handler +4;
  - security-sensitive name or path +4;
  - contains a dangerous call +3;
  - reachable from an entry point +2;
  - complexity +2 or +3;
  - changed in the last 30 days +2;
  - exported +1.

  Listed at 6 or more.
- **Entry paths.** For each route and CLI handler, the call tree (depth 3, via `engine.flow`) with each step's protection: "POST /payment → validate ✓ → charge ✗".

## Coverage artifacts

Fehm reads what the project's own tooling wrote. It never runs the tests to produce coverage. It searches the repository root and every manifest directory, plus paths listed in `.fehm/health.json`.

| Format | Files |
|---|---|
| LCOV | `coverage/lcov.info`, `lcov.info` |
| Istanbul | `coverage/coverage-final.json`, `coverage/coverage-summary.json` |
| Cobertura (coverage.py, Istanbul) | `coverage.xml`, `coverage/cobertura-coverage.xml` |
| JaCoCo | `target/site/jacoco/jacoco.xml`, `build/reports/jacoco/test/jacocoTestReport.xml` |
| Go | `coverage.out`, `cover.out` |
| coverage.py JSON | `coverage.json` |

- **Which artifact is used.** Line-level formats are preferred. When several artifacts exist, one is used and the others are listed.
- **Path matching.** Artifact paths may be absolute, relative or module-qualified (Go, JaCoCo). They are matched to indexed files by exact or unique-suffix match; records that match nothing are counted.
- **Staleness.** A file modified after the artifact makes the artifact stale for that file: shown, flagged, and its evidence downgraded to inferred.
- **Unreadable data.** `.coverage` (SQLite) and JaCoCo `.exec` files are detected and explained.

## Dead code

A symbol with no inbound graph edge is judged by Skylos-style keep-alive checks, in order. The first that holds decides its state:

1. **Framework entry point**:
   - a route or CLI handler;
   - a decorator (`@app.route`, `@Get`, `#[…]`) or `override`;
   - a convention name (lifecycle methods, `main`, dunder methods, Next.js exports, `ServeHTTP` …);
   - a method of a class that extends or implements something.
2. **External API**: exported from a package entry, a `main`/`bin` file or a barrel.
3. **Dynamic reference**: the name appears in a string literal or a configuration file.
4. **Possibly unused**: the name occurs elsewhere in code, but the graph did not resolve it.
5. **Definitely unused**: not exported and parsed with an AST.
6. Otherwise **likely unused**.

Each candidate shows the checklist (✓/✗). Unused files have no inbound dependency from any file, are not entry points, and are named by no string or configuration.

## Dependencies, licenses, SBOM, advisories

- **Lockfiles:**
  - npm `package-lock.json` v1–v3 (with dependency depth), `yarn.lock`, `pnpm-lock.yaml`;
  - `poetry.lock`, `uv.lock`, `pdm.lock`, `Pipfile.lock`;
  - `Cargo.lock`, `go.sum`.

  Without a lockfile, the manifest's direct dependencies are used.
- **Licenses:** only as declared, by the lockfile (npm) or the installed package's own `package.json`. Otherwise `NOASSERTION`, never guessed from a name.
- **License policy:**
  - from `.fehm/health.json` (`licenses.deny`, `licenses.review`);
  - by default strong copyleft and source-available licenses need review;
  - `A OR B` is allowed when one option is allowed; `A AND B` takes the worst.
- **SBOM:** CycloneDX 1.5 and SPDX 2.3 JSON (`fehm health --sbom cyclonedx|spdx`, or the page's download links).
- **Advisories (network, opt-in):** `fehm health --advisories` or the page button (with a confirmation) queries `api.osv.dev` with package names and versions only.
  - Severity comes from the advisory's GHSA label, else the CVSS v3 base score computed from the vector.
  - Results are cached in `health-advisories.json` with a hash of the component set; when the lockfile changes they show as **stale**.
  - Until checked, the page says *not checked*, never "no vulnerabilities".

## Build and CI

- **Detection.** Build, test, lint, type-check and coverage commands come from:
  - npm scripts (with the package manager from the lockfile);
  - tsconfig plus a TypeScript dependency;
  - pytest, ruff and mypy declarations;
  - `go` and `cargo`, Maven and Gradle;
  - Makefile targets.
- **Running.**
  - Fehm **never runs them on its own**. They run on request only: `fehm health --run all|test,lint|<check id>`, or the page's Run button, which shows the exact command and working directory first.
  - A check runs without a shell, from the detected argv only (the request carries only the check id), with a 10-minute limit and the output tail kept.
  - Results live in `health-runs.json` with the index fingerprint; after files change, a result is **stale**.
- **CI gates.** Detected from the CI files by the command each step runs, with the matching line as evidence: build, tests, lint, type check, coverage, security scan, dependency updates (Dependabot or Renovate config) and deployment approval. Pipeline security (permissions, untrusted checkouts) belongs to 3.6.

## Technical debt

Hotspots are files where signals converge. Scoring ports Skylos' `skylos debt`:

- signal points = severity weight × dimension weight × magnitude over threshold;
- plus a breadth bonus per extra dimension.

Fehm adds to priority:

- commits in the last 180 days;
- fix commits (subject says fix, bug, hotfix, regression or revert). This is a proxy for defect history and is labelled so;
- working-tree changes;
- no test protection.

Levels are relative, because priorities grow with codebase size: high = top 5 % (at most 10) with priority ≥ 40; medium = top 25 % with priority ≥ 15. The formulas are published with the report.

The **change × complexity quadrant** splits files at the median into hotspots, maintain, legacy and stable. It needs git history.

## History, baseline, review, scope

- **Baseline** (`health-baseline.json`): findings accepted at a point in time. Later findings are marked **new** or existing, and the page lists what was **fixed**.
- **Review** (`findings-review.json`, shared with 3.6), per finding:
  - reviewed, false positive, accepted risk, suppressed, each with an optional note;
  - anything but "reviewed" leaves the open counts and the dimension statuses.
- **Trend** (`health-history.json`):
  - one point per distinct analysis (digest), up to 200;
  - key metrics are recorded: findings, critical/high, coverage, test relationship, test cases, complex functions, dead code, hotspots, dependencies, vulnerabilities;
  - trends build up as the project is analysed and are not back-filled from git.
- **Changed-files scope** (`--changed`, or the page's Changed toggle): only findings in files changed since HEAD, including untracked files.
- **Cache** (`health-cache.json`): per-file analysis keyed by content hash and `HEALTH_VERSION`. A second run of Fehm on itself takes about 0.5 s.

## Provenance

Every report carries:

- the Fehm version and `HEALTH_VERSION`;
- the commit and dirty flag;
- a **SHA-256 digest** over every analysed input: file hashes, configuration, coverage artifacts, run results, the advisory check time, and the scope. The same inputs always give the same digest;
- what the inputs were and what was excluded;
- where the rules come from.

## Configuration: `.fehm/health.json`

Committed with the code (`.gitignore` allows it). Validated before use: a malformed file is reported with JSON paths, and the defaults are used.

```jsonc
{
  "ignore": ["src/generated/**"],
  "thresholds": { "cyclomatic": 10, "cognitive": 15, "nesting": 3, "functionLines": 50, "params": 5,
                  "classMethods": 20, "classFields": 15, "classLines": 500 },   // Skylos' defaults
  "coverage": ["reports/lcov.info"],
  "licenses": { "deny": ["AGPL-*"], "review": ["GPL-*", "LGPL-*"] }
}
```

## Page

A scrolling report with a TOC. Each TOC entry carries the status colour of its dimension.

1. **Overview.**
   - Status pill and reasons; the eleven dimension cards (metric, definition on hover, first reason);
   - open findings by severity (click to filter);
   - baseline controls and the fixed list.
2. **Attention required.** Critical and high findings, top hotspots.
3. **Tests.** Inventory, protection bar, critical gaps, entry paths, test files.
4. **Coverage.** Totals and least-covered files, or an explicit UNKNOWN card saying how to produce an artifact.
5. **Quality.** Complexity distribution, a heatmap (one tile per file: width by size, colour by most complex function, click opens 3.1), most complex functions.
6. **Dead code.** State counts, candidates with checklists, unused files, why others were kept.
7. **Dependencies.** Counts, manifests and lockfiles, advisories box, SBOM downloads, licenses with policy, a filterable component table.
8. **Reliability**, then **AI-code indicators** with the authorship disclaimer.
9. **Technical debt.** Hotspot table, quadrant, formulas.
10. **Build & CI.** Checks with last result, output and Run; TypeScript strictness; CI gates with evidence lines.
11. **Trends.** Sparklines per metric.
12. **Findings.** Search, severity, category and review-state filters, "new since baseline". Each finding expands to:
    - detection, measurement and evidence (source excerpt, 3.1 graph, editor);
    - what was not established, why it matters, action and verification;
    - the rule (with its Skylos id) and review buttons.
13. **Analysis.** Analyzer runs (complete, partial, skipped, unsupported, error, with reasons and timings), the language coverage matrix, provenance, and what was not determined.

Deep link: `#finding=<id>`. The page stacks at 900 px and has no horizontal scroll at phone width.

## API

| Route | |
|---|---|
| `GET /health` | Page |
| `GET /api/health[?scope=changed]` | Page payload (the report plus `writable`) |
| `GET /api/health/report[?scope=changed]` | Full report (Export) |
| `POST /api/health/review?id=&status=reviewed\|false-positive\|accepted-risk\|suppressed\|clear[&note=]` | Review a finding |
| `POST /api/health/baseline[?clear=1]` | Set or clear the baseline |
| `POST /api/health/run?check=<id>` | Run one detected check |
| `POST /api/health/advisories` | OSV.dev lookup (network) |
| `GET /api/health/sbom?format=cyclonedx\|spdx` | SBOM download |
| `GET /api/health/source?path=&line=` | Excerpt of an indexed file |
| `POST /api/health/refresh` | Incremental re-index |

Writes need POST **and** an `x-fehm: 1` header, as in 3.4. Dry-run servers refuse writes, runs and network lookups. The service shares 3.3's per-engine `BriefingFacts`.

## CLI

```
fehm health [--all] [--json] [--changed]
fehm health --run all|build,test,lint|<check id>      # run detected checks, then report
fehm health --advisories                               # OSV.dev lookup (network), then report
fehm health --baseline                                 # accept the current findings
fehm health --sbom cyclonedx|spdx > sbom.json
fehm health --fail-on critical|high|medium|new         # CI gate; new = not in the baseline
```

## Deviations from the spec, and deferred items

- **Modules the spec reuses no longer exist.** `testing-intelligence.ts`, `project-readiness.ts`, `source-quality.ts`, `mutation-testing.ts` and `security-graph.ts` were removed in the rebuild (they survive only in commit 15a4f01). 3.5 builds on `FehmEngine`, 3.2's facts and 3.4's signals instead.
  - Two ideas carry over from the old testing engine: the separation of artifact coverage from static test relationships, and critical gaps.
  - Its weighted "test quality score" does not carry over: it was an invented number.
- **No overall number.** The spec's mock-up shows "78 HEALTHY". Following its own rule 3.5.3, the overall indicator is a status derived from the dimensions, and only measured dimensions show numbers. The same goes for a debt percentage: Skylos' `score_pct` is not reproduced; hotspots and points are.
- **Confidence** uses Fehm's vocabulary instead of percentages (as 3.3 and 3.4).
- **Skylos integration** is the spec's option C (hybrid): its rules and thresholds re-implemented in TypeScript on Fehm's graph, with attribution. Nothing runs Python. See `THIRD_PARTY_NOTICES.md`.
- **Deferred:**
  - mutation testing;
  - test duplication detection;
  - boundary-value test analysis;
  - Python dependency-name mapping for undeclared-package detection (import names differ from distribution names, so only npm is checked);
  - phantom *member* calls into installed packages (Skylos' API-hallucination checks need installed type information);
  - GPU and deployment preflight (not applicable to most projects);
  - time-series back-fill from git;
  - per-finding patch application and remediation verification (the verify step is "run again: the finding disappears");
  - LLM explanations (the core must work without a model, and does).

## Changes made with Feature 3.6

- Source excerpts (`/api/health/source`) now pass through 3.6's secret redaction.
- The page stylesheet moved to `src/visualization/report-css.ts`, shared with `/security`.
- The baseline and trend helpers in `history.ts` take a file name, so 3.6 keeps `security-baseline.json` and `security-history.json` with the same code.
- The review store (`findings-review.json`) is shared: a finding reviewed on either page stays reviewed.

Bump `HEALTH_VERSION` whenever findings or metrics change for the same code: it keys the per-file cache and marks trend points.
