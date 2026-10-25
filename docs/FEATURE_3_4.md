# Feature 3.4 — Architecture Drift

`fehm serve` → `http://127.0.0.1:4317/drift` (dashboard: `/#/drift`), and `fehm drift` on the command line.

> **Where has the codebase drifted away from established practice for its technology, project type and framework, and from its own conventions?**

3.4 never says "your architecture is wrong". It says: *this part differs from a pattern established elsewhere in this project* (or from a framework convention, or common practice). For each deviation it shows what was observed, what it differs from, why Fehm detected it, the exact code evidence, the confidence, the possible impact, when it appeared (with git), and a *possible* restructuring. The developer decides. No model is called; the engine is deterministic.

```
inventory → project context (language · frameworks · project type · style · scale · workspaces)   context.ts
  → comparable units: one per source file, with role and features                                  units.ts
  → project convention mining: patterns, frequencies, outliers                                     mining.ts
  → framework conventions and industry practices, filtered by context                              knowledge.ts
  → explicit project rules (optional .fehm/architecture.json)                                      rules.ts
  → AI-associated structural signals                                                               signals.ts
  → deduplication · confidence · attention · map anchors                                           group.ts
  → findings → dated against a baseline or the git window                                          history.ts
  → /api/drift/* → page (overview · drift map · findings · patterns · history · evidence drawer)
```

## The baseline ladder

When sources disagree, the highest rung decides; the lower rungs are still shown as reasons ("why detected").

| Rung | Basis | Source | Where it comes from |
|---|---|---|---|
| 1 | `explicit-rule` | project | `.fehm/architecture.json`, written and committed by the team (optional) |
| 2 | `approved-pattern` | project | a mined pattern the developer approved (`.fehm/drift-decisions.json`) |
| 3 | `project-pattern` | project | a pattern mined from this codebase, strong enough to be established |
| 4 | `framework` | framework | a convention of a detected framework (Express, NestJS, Django, FastAPI, Spring, …) |
| 5 | `industry` | industry | a practice that applies to the detected project type |
| 6 | `heuristic` | heuristic | provisional names, AI-associated structural signals |

## Context before judgment

`context.ts` detects, each with evidence:

- **Languages:** from indexed source files.
- **Frameworks:** imported packages, marker files (`manage.py`, `Gemfile`, `*.csproj`, `pubspec.yaml`) or imports.
- **Project types:** each scored from independent signals.
  - Types: web application, backend service, microservice, CLI, library, ML project, research, data pipeline, mobile, game, infrastructure, monorepo.
  - Signals: routes, bins, notebooks, ML/data frameworks, Terraform/Helm, workspaces.
- **Architecture signals:** layered, MVC, hexagonal, clean, component-based, event-driven, or modular.
- **Scale and workspaces.**

The **primary project type decides which industry practices apply**: an ML repository is not measured against a layered backend. The business domain is not inferred, and the page says so.

## Comparable units and mining

A **unit** is a source file. Its role comes from its name first (`user_controller.py`, `UserService.ts`, `user.repository.ts`), then its directory (`controllers/`), then code evidence (route registrations, SQL, JSX, CLI dispatch). Features:

- **Dependencies:** 3.3's file-level code links, plus the stores and systems the unit reaches.
- **Responsibilities**, each with a line: HTTP, validation, database, outbound HTTP, email, payments, messaging, cloud, AI, file I/O, auth, logging, configuration, rendering.
- **Other features:**
  - DI style: constructor or framework injection vs `new XService()`;
  - logging mechanism and environment reads;
  - hard-coded connection strings, local error formatting;
  - naming template, size, test counterpart and its layout;
  - route handlers and their size.

**Mining** groups comparable units and measures each pattern (spec §34). An outlier is only a candidate. It becomes a signal when the pattern is **established** and was not rejected. Confidence (spec §36):

| Confidence | Project evidence |
|---|---|
| high | ≥ 5 comparable units, ≥ 80% agree |
| medium | ≥ 3 comparable units, ≥ 66% agree — or a framework convention standing in |
| low | not established — only an industry practice standing in |

Detectors (pattern ids in parentheses):

| Category | Detector |
|---|---|
| Dependency direction, layer bypass, pattern (`dependency:<role>`, `dependency:<role>:<target>`) | per role: what comparable units depend on; a rare dependency on a store, SDK or filesystem, an upward role, or a repository skipped past the usual service. Upward and bypass checks only in role-layered projects |
| Database access, abstraction (`db-access`) | which role owns database access; others reaching it (the client the owners build on is part of the boundary) |
| External service boundary (`sdk-access`) | which role owns third-party SDK access |
| API boundary (`api-handler`) | route handlers ≥ 3× the median handler size |
| File placement (`location:<role>`, `assets`) | role files outside the directory their peers live in; static assets outside the dominant asset root |
| Naming (`naming:<role>`) + provisional names | naming template per role; `…Final`, `…New`, `…Copy`, `…2` names (heuristic) |
| File granularity (`size:<role>`) | ≥ 3× median and ≥ 90th percentile among comparable units (no fixed limit); directories of tiny files |
| Responsibility concentration (`responsibility:<role>`) | a unit holding ≥ median + 3 responsibilities |
| Module boundary (`module-scope`, `module-api`) | a module spanning far more responsibility kinds than others; imports into another module's internals where the project uses entry files |
| Responsibility duplication | validation or auth performed in 3+ layers (backends, heuristic) |
| Dependency injection (`di:<role>`) | manual construction where comparable units receive their collaborators |
| Logging / observability (`logging`) | a mechanism other than the dominant one (distribution shown) |
| Configuration (`config`) | environment reads outside configuration modules when the project centralises them; hard-coded connection strings (industry) |
| Error handling (`errors`) | local error formatting when a central handler exists and most handlers use it |
| Testing organisation (`tests:<role>`, `test-layout`) | units without a test where comparable units have one. This is not a claim that the code is untested (coverage is 3.5's job) |
| Security boundary (`auth`) | route modules that reach no authentication where most do. Critical when they also reach the database (details are 3.6's job) |
| Circular dependency (`cycles`) | module cycles, shown as an actual cycle path |
| Monorepo boundary (`monorepo`) | app → app imports where apps otherwise use packages |
| Framework convention | framework-backed fallbacks when project evidence is too thin |
| AI-associated signals | repeated / near-identical implementations, placeholders, pass-through wrappers, unused abstractions and dependencies, TODO markers, sudden structural change (history), unusual naming, inconsistent layering |

## Findings

A finding follows spec §66:
- identity and baseline: id, category, group, source, basis, confidence, attention;
- what: observed, baseline ("common / established"), explanation (why detected), impact, suggestion (always "Possible …");
- the expected-vs-observed chains;
- unit, target, pattern and stats;
- reasons (every baseline behind it), evidence with lines, related signals;
- drift-map anchors, status, introduction and decision.

- **Deduplication (spec §72).** Detectors that see the same deviation share a subject (`<unit>|<target>`). The highest rung becomes the finding and the rest become its related signals. A controller running SQL is one finding, not four.
- **Attention (spec §37)** is potential impact, not a quality score: informational, low, moderate, high, critical.
  - It rises one step when the unit has ≥ 10 dependents and the category is about coupling.
  - Critical is reserved for a route outside the authentication boundary that also reaches the database.
- **Wording.** Tests assert that no finding says wrong, invalid, violation or "written by AI", and that every suggestion starts with "Possible".

## Developer decisions

`.fehm/drift-decisions.json` lives at the repository root; commit it to share decisions. `.gitignore` allows it.

- **Findings:**
  - Mark intentional, accept or dismiss, with a required reason, plus who and when.
  - Decided findings move to "Decided" and are not reported again.
  - Decisions also apply when history is analysed.
- **Patterns:** approve (rung 2, high confidence), reject or ignore (no findings from it).

## History

- **Git window.**
  - The whole analysis runs on the code of the last 8 commits (`git archive` into a temp dir), measured against *today's* rules and decisions.
  - Points are cached per commit and per hash of the rules and decisions in `.fehm/drift-history.json`.
  - The page analyses them progressively, with a Stop button.
- **Dating.**
  - A finding present in the oldest analysed commit is **existing**.
  - One that appears later is **new**, with the introducing commit, the unit's dependencies before and after, and the commit's diff for that file.
  - Findings gone since the comparison point are **resolved**.
  - Without git or a baseline, findings are **not dated**. Nothing is called new without a comparison point.
- **Baseline.** An explicit baseline (`.fehm/drift-baseline.json` in the state dir) takes precedence as the comparison point.
- **Trend.** The number of detected deviations per commit (spec §50), not a quality score. A commit that grows the source by ≥ 30% or 20 files is flagged as a sudden structural change.

## Page

- **Header:** search across files, findings, patterns and commits. A file result opens its role, patterns, deviations and history.
- **Context bar:** context, plus a baseline chip per rung.
- **Tabs:**
  1. **Overview:**
     - cards: findings · new · high attention · patterns detected · categories affected (counts, not a score);
     - the reference baseline with its evidence;
     - drift clusters by group and by component;
     - AI-associated signals, with the authorship disclaimer;
     - highest-attention findings, and what was not determined.
  2. **Drift map:**
     - 3.3's validated component or module layout; nodes holding findings carry a count badge, and edges carrying deviations are marked.
     - Selecting a finding brightens its nodes and edge and dims the rest (3.1's interaction).
     - Selecting a node lists its drift by category.
     - "Observed vs common practice" chains appear side by side.
  3. **Findings:** cards grouped by dimension, or a table. Filters: category, status (new, existing, not dated, decided), confidence, attention, source.
  4. **Patterns:**
     - industry vs project vs observed;
     - explicit rules with their results;
     - every mined pattern with its distribution bars, examples, deviations and approve / reject / ignore.
  5. **History:** analyse / stop, baseline set / move / clear, trend chart (hover and focus tooltips), and the introduced/resolved timeline.
- **Evidence drawer** (right side, no navigation away):
  - observed vs common, why detected (every basis), pattern statistics;
  - evidence rows (source excerpt · 3.1 graph · editor), possible impact, suggested restructuring;
  - introduction commit with before/after and "View commit", related signals;
  - the decision form, "Show on map", and "Copy LLM context".
- **LLM context (spec §59):** the finding, its baseline, pattern statistics and ±3 lines around each evidence line — never the repository. No model is called by Fehm.

Diagrams sit in bounded, pannable boxes. Wheel scrolling passes through to the page; pinch or Ctrl/⌘+wheel zooms. The layout stacks at 1200, 980 and 620px, with no horizontal scroll on a phone.

## API

| Route | |
|---|---|
| `GET /api/drift` | Page payload (report without per-unit dependency lists, map views, history summary). |
| `GET /api/drift/report` | Full report (Export, CI). |
| `GET /api/drift/finding/context?id=` | Compact LLM context (Markdown). |
| `POST /api/drift/decision` `{id, kind: intentional\|accepted\|dismissed\|clear, reason}` | Finding decision. |
| `POST /api/drift/pattern` `{id, decision: approved\|rejected\|ignored\|clear}` | Pattern decision. |
| `POST /api/drift/baseline[?clear=1]` | Set or clear the baseline. |
| `GET /api/drift/history/point?ref=` | Analyse one commit (cached). |
| `GET /api/drift/commit?ref=&path=` | Commit details and a file's diff (revision validated; path after `--`). |
| `GET /api/drift/source?path=&line=` | Excerpt of an indexed file. |
| `POST /api/drift/refresh` | Incremental re-index. |

Writes need POST **and** `x-fehm: 1` (no CORS is granted, so another site cannot write). Dry-run servers refuse writes. Changing the rules, decisions or baseline is picked up on the next request without re-indexing.

CLI: `fehm drift [--all] [--json] [--history] [--baseline] [--fail-on new|high|any]`. `--history` analyses the window so findings are dated. `--fail-on new` needs a comparison point and ignores AI-associated signals.

## Explicit project rules (optional)

`.fehm/architecture.json` declares:
- layers (globs, first match wins) and layering: relaxed, strict or none;
- rules: `from` + `allow`/`forbid`, or `to` + `onlyFrom`;
- cycles, `allowUnassigned`, structure policies and `ignore`.

It is validated before use; a malformed file is reported with JSON paths and skipped. The pre-rebuild `config.layers[].patterns` / `allowedDependencies` format is still read. Nothing writes this file for you: the first version of 3.4 inferred and "approved" layers, which the redesign replaced with project-pattern approval.

## Changes outside 3.4

- **3.3:**
  - `handles` links aggregate route file → handler file (`ARCHITECTURE_VERSION` 3).
  - Label room on crowded node sides and a finer label sweep (`LAYOUT_VERSION` 2).
  - The layout cache moved to `.fehm/architecture-layout.json`.
  - `withCommitTree`, `modelAtCommit` and `resolveCommit` are exported for history.
  - Shared `diagram-css.ts`; the canvas's `{ wheel: "modifier" }` option and `drift` edge marks.
- **3.5:** the code-pattern detectors in `src/drift/signals.ts` stay a shared API (`qualitySignals()` → `CodeSignal`, including large files). 3.5's only change is its type import.
- **Known, not changed:** 3.2's `fileDeps` still records `handles` as handler file → route file. 3.4 uses 3.3's corrected links instead. 3.2's file cycles (and 3.5's cycle rule built on them) can therefore include a route/handler pair as a false cycle; fixing it means bumping `BRIEFING_VERSION`.

## Deferred

- **Framework structures:** framework-specific structural checks (Django app layout, Next.js routing folders) beyond the conventions catalog.
- **Incremental re-evaluation:** the analysis re-runs in full per index change. It takes about 0.5 s on this repository; commits are cached.
- **Finer granularity:** class- and function-level cycles, and symbol-level responsibility attribution ("which symbols belong to which responsibility"); responsibility detection stays at unit level.
- **Optional LLM explanations:** only the context export exists.
- **Decision scopes:** scoped exceptions (a rule for a directory) — decisions apply to one finding id.

Bump `DRIFT_VERSION` when findings change for the same code; it invalidates cached history points.
