# Feature 2 — Skill Intelligence & Automatic Skill Router

Feature 1 answers *what code does the agent need?* Feature 2 answers *which skills (instructions) does the agent need?* Together, `buildAgentContext` answers *which skills + which code*.

Feature 2 consumes Feature 1; it has no scanner, parser, graph or code retrieval of its own. It reuses Feature 1's tokenizer (`tokenize`, incl. the Codebase-Memory identifier splitter), BM25 index (`LexicalIndex`), token estimator, persistence helpers, `commandProvider`, and the engine's `systemMap()` for the repository profile.

```
task ─► profileTask ─► scoreCandidates (metadata only) ─► gates ─► greedy selection
                                                                    │  conflicts (explicit precedence)
                                                                    │  redundancy / coverage
                                                                    ▼
                         roles ─► resolveDependencies (bounded) ─► budget plan ─► progressive load
                                                                                    │ (hash-verified)
                                                                                    ▼
                                                               composeSkillContext ─► SkillRoutingResult
buildAgentContext = task section + skill context (Feature 2) + code context (Feature 1, FehmEngine.context)
```

## Modules

| Module | Responsibility |
|---|---|
| `src/skill-model.ts` | `SkillRecord`, `SkillSource`, `TaskProfile`, `SkillRoutingResult`, levels, roles, feedback types. `SKILL_SCHEMA_VERSION`, `SKILL_INDEX_VERSION`. |
| `src/skill-vocabulary.ts` | Deterministic intent/domain/technology vocabulary shared by skills and tasks; style, capability and risk inference; section classification; trigger extraction. |
| `src/skill-adapters.ts` | Frontmatter parser, `catalogAdapter` (Fehm's `skills/manifest.json`), `directoryAdapter` (upstream `**/SKILL.md` trees + `agents/*.md`), `normalizeSkill`. |
| `src/skill-registry.ts` | `SkillRegistry`: incremental index cached in `.fehm/skills-registry.json`, metadata search, level-0…4 loading with hash verification, upstream freshness check. |
| `src/skill-profile.ts` | `profileTask`, repository profile from Feature 1. |
| `src/skill-router.ts` | Scoring, gates, selection, conflicts, redundancy, roles, dependencies, budget, optional reranker. |
| `src/skill-compose.ts` | Structured *Active Skill Context* with provenance. |
| `src/skill-feedback.ts` | Skill memory (`.fehm/skill-feedback.json`) and the bounded historical signal. |
| `src/skill-eval.ts`, `bench/skills.ts` | FEHM-Skill-Bench metrics, ablation, performance. |
| `src/agent-context.ts` | The single combined agent-context builder. |
| `src/integrations.ts` | Installation mode (restored from git 15a4f01, generalized to any registry skill). |

## SkillRecord

`id name description kind category source sourceRepository sourceCommit sourcePath sources[] license version domains tasks taskEvidence languages frameworks triggers useWhen doNotUseWhen dependencies resources conflicts style principles crossCutting canonicalFor priority invocationMode capabilities riskFlags tokens{metadata,summary,full} sections[] signature path contentHash indexedAt metadataProvenance`.

The body is **not** in the record: `registry.load(id, level)` reads it after selection (the spec's `content` field is served by the loader). `metadataProvenance` labels every field `upstream` (verbatim upstream frontmatter), `catalog` (Fehm's curated catalog: category, principles, frontmatter `intents`, `routing.json`) or `inferred` (Fehm heuristics). A renamed skill (`Surgical Changes` vs upstream `karpathy-guidelines`) is `catalog`, never presented as upstream-authored.

Ids: catalog skills keep catalog ids (`testing/test-driven-development`); directory sources are scoped (`matt-pocock:tdd`), duplicates get a path-qualified id.

## Registry, freshness, progressive disclosure

- Levels: `metadata` (0) · `routing` (1) · `summary` (2: description + lead paragraph + section list) · `sections` (3) · `full` (4). Levels 0–1 never read the file; `registry.bodyReads` makes this observable and tests assert it.
- Refresh: a skill is reused without reading when size, mtime and adapter descriptor are unchanged; a touched-but-identical file is reused after a hash check; only changed skills are re-derived (`report.changed`, `report.reindexed`). Version bumps, source changes and malformed caches force a full rebuild.
- Loading re-hashes the file; content changed since indexing raises `StaleSkillError`. The router then keeps the skill at metadata level, marks it `stale`, and does not put the changed text in context.
- `checkUpstreamFreshness(registry, repo, checkout)` / `fehm skills freshness --upstream REPO=DIR` compares every recorded upstream SHA-256 with a newer checkout and lists changed skills to re-import.

## Routing algorithm

**Profile** (no model): phrase rules on lower-cased, stemmed whole tokens give intents with strength 1 (decisive) or 0.5 (supporting). Compound phrases weighted > 1 claim their tokens (“SQL injection” is security, not database). Matches right after *since/after/before/last* are halved (“since yesterday's deploy”). Generic verbs (plan, explain, review, research, add…) are decisive only with engineering context (technology, domain, code identifier or engineering noun); in engineering context a weak-only task is promoted (“Add rate limiting to the API”). Ambiguous = fewer than two task-specific terms. Style requests (“keep it brief”, “smallest change”) are recorded as user-instruction authority.

**Discovery** from metadata only: BM25 over name/id (×4), triggers (×3), description (×2), tags, section headings; plus every skill whose tasks match an intent or whose trigger appears in the task. Task text is expanded with acronyms (“retrieval augmented generation” → rag).

**Score** (`DEFAULT_SKILL_WEIGHTS`, overridable):

```
base  = .28·task + .16·lexical + .12·name + .24·canonical + .04·domain + .07·technology + .04·repository + .05·priority
score = clamp(base + .25·trigger + .10·style + .08·history − .05·cost − .10·purposeMismatch)
```

- task: intent overlap weighted by task strength (primary ×1.5) and skill evidence (catalog/category/name 1, description-only 0.5)
- name: share of the skill's distinctive name words used by the task
- canonical: rank in the catalog's curated `routing.json` list for a matched intent
- purposeMismatch: the skill's *name* states an activity (e.g. “…-reviewer”) the task does not ask for
- cost: full size relative to 4× the skill budget

**Gates** (reject regardless of score): technology-specific skill (catalog `languages/*`, `frameworks/*`) whose technology is in neither task nor repository; explicit-invocation skills (description says *Use for “…”*/*Trigger:*) unless named — style-bearing ones (Caveman) additionally need a slash command or the matching style request; no intent/trigger/domain evidence.

**Selection** (greedy, score order, default ≤ 4 skills, threshold 0.35; ambiguous: ≤ 2, threshold +0.1, and nothing when no intent is decisive — suggestions go in `clarification`):

1. Conflicts first: style dimensions (communication terse/verbose, scope minimal/expansive, review fix-first/report-only) and declared conflicts. Precedence: **user instruction → project instruction (`projectInstructions`) → task requirement (debug/refactor/verify favour minimal scope) → skill priority (primary role, then kind) → score.** The loser is rejected with the rule and reason; both are never loaded.
2. Coverage/redundancy: a candidate must add an uncovered *need* — a decisive intent it has strong evidence for, or a technology the task names that is the skill's subject. Otherwise it is rejected, with semantic (metadata cosine) and instructional (bottom-k Jaccard over body terms) overlap reported. `identical: true` only for equal content hashes.
3. At most one cross-cutting principle (kind `principle`, e.g. Karpathy) as `reference`, only if it serves the primary intent.

**Roles**: primary = best skill with strong evidence for the primary intent; secondary = covers another decisive intent; supporting = testing/technology/other; reference = principles.

**Dependencies**: DFS, depth ≤ 3, ≤ 12 nodes, cycles reported with their path and the back-edge skipped, missing ids reported; dependencies load at metadata level.

## Budget and progressive loading

Default skill budget 2 500 (estimator `fehm-approx-v1`, same as Feature 1). Targets: primary full if ≤ 60 % of budget else sections (50 %); secondary sections (25 %); supporting/reference summary; dependencies metadata; “too-verbose” history caps at summary. The plan is downgraded from the least important item (dependency → reference → supporting → secondary → primary; full → sections → summary → metadata → dropped) until it fits; leftover budget is then given to section-level skills, primary first. The composed Markdown is measured; overflow first returns that slack, then downgrades again. `usedTokens ≤ maximumTokens` always holds; below the header size the context is empty and every skill is listed as dropped.

Sections level: whole sections by priority *activation → constraints → workflow → output → examples → background*, task-term matches first, emitted in original order. The most important section that does not fit may be included up to a line boundary outside code fences, followed by an explicit “section continues” marker; omitted headings are listed with the command to load them.

## Composition

`# Active Skill Context` → authority notice → `## Primary Skill` → `## Supporting Skills` → `## Constraints` (incl. resolved conflicts) → `## Workflow` → `## Testing` → `## Technology-specific guidance` → `## Output contract` → `## References` → `## Capability requirements (not permissions)`. Skill text is not rewritten: headings are nested two levels down, the catalog's per-file “Library use” line and trailing related-skills link list are removed, and paragraphs repeated verbatim across skills are emitted once. Every block carries `id · repo:path@commit · license · sha256 · level`.

## Feature 1 integration

`buildAgentContext(engine, task, { registry, totalBudget 16 000, skillBudget 2 500, codeBudget 8 000, taskBudget 1 000 })` validates the split, profiles the repository from `engine.systemMap()`, routes skills, maps the primary intent to Feature 1's retrieval intent, and calls `engine.context()` with the code budget plus any skill budget routing did not use (`reallocatedFromSkills`). Output: `# Task` + skill context + Feature 1 packet Markdown, with per-part usage and `reserved` tokens. `registry: null` gives code-only context.

## Security

Skill content is data. The composed context opens with the precedence/no-permission notice before any skill text. `capabilities` (shell, git, network, browser) are reported as requirements, never grants. `riskFlags` (instruction-override, autonomy-escalation, remote-script-execution, destructive-command, secret-access) are informational: in the real catalog they fire on 25 skills, mostly security skills *describing* these patterns, so they do not block. Nothing is executed or installed by routing. Installation refuses symlinked destinations, preserves customized files (backup only with `--force`), writes atomically, and refuses `license: unknown` skills without `--allow-unknown-license`. The optional reranker receives ≤ 8 candidates' metadata, may only reorder them, and invented ids are reported and ignored. Superpowers' `using-superpowers` “invoke a skill before any action” policy is catalog content, not router policy.

## Skill memory

`fehm skills feedback <id> useful|neutral|irrelevant|conflicting|too-verbose|missing --task "…"`. For a new task, entries from similar tasks (0.6·term Jaccard + 0.4·intent Jaccard ≥ 0.3) update a confidence from 0.5 with AgentMemory's bounded `c + 0.1(1 − c)` (and `c − 0.1c` for negative), weighted by similarity and `1/(1 + days·0.01)`. Weight 0.08, applied only to candidates that passed the evidence gates: history can break near-ties, cannot admit a skill, and cannot outvote strong current evidence (tests assert all three).

## CLI

```
fehm skills index [--force]            fehm skills list [--category C] [--source S] [--kind K]
fehm skills search "<q>"               fehm skills show <id> [--level metadata|routing|summary|sections|full]
fehm skills route "<task>" [--budget N] [--max N] [--skill ID]... [--no-repo] [--context] [--rerank-command CMD] [--json]
fehm skills feedback <id> <value> --task "<task>"
fehm skills install|uninstall|status <id>... --platform claude|cursor|codex|gemini|copilot|vscode|generic [--project] [--dry-run] [--force]
fehm skills install --task "<task>" --platform P
fehm skills freshness [--upstream REPO=DIR]...   fehm skills eval [--file F]
fehm agent-context "<task>" [--total-budget N] [--skill-budget N] [--code-budget N] [--no-skills] [--json]
--skills DIR (catalog)   --skill-source NAME=DIR (extra upstream SKILL.md tree)
```

## Sources

The catalog in `skills/` (1 018 skills) was assembled before this feature from local snapshots; it holds per-file SHA-256 (`source-map.json`), original frontmatter (`manifest.json` → `source_metadata`) and license texts (`skills/licenses/`). **None of the snapshots carried git metadata, so every catalog skill has `sourceCommit: "unpinned"`**; content hashes are the identity.

| Source | Skills | License | Used for | Not imported |
|---|---|---|---|---|
| ECC (affaan-m/ECC) | 609 | MIT | skills, agents, commands as SKILL.md | installer, hooks, global memory, agent runtime, sessions |
| Agency Agents (msitarzewski/agency-agents) | 307 | MIT | specialist agent definitions | installer, conversion scripts, generated platform files |
| gstack (garrytan/gstack) | 137 | MIT (NOTICE lists Apache-2.0-derived files) | planning, review, QA, investigation, release workflows | CLI, browser automation, deploy/publish runtime |
| Matt Pocock skills (mattpocock/skills) | 23 | MIT | small composable engineering skills | — |
| Superpowers (obra/superpowers) | 13 | MIT | TDD, debugging, planning; skill-testing method | global invocation policy |
| Caveman (JuliusBrussee/caveman) | 10 | MIT (skills/ only) | terse communication, compression, review | BSL-1.1 engine/proxy/mcp/shrink/browse |
| Karpathy skills (multica-ai/andrej-karpathy-skills) | 7 | MIT declared in frontmatter; no LICENSE file in snapshot | four cross-cutting principles | — |
| Ponytail (DietrichGebert/ponytail) | 4 | MIT | anti-over-engineering skills | runtime, installer |
| AgentMemory (rohitg00/agentmemory @ bcf4f0d) | — | Apache-2.0 | `lessons.ts` reinforcement + recency (vendored, hash-verified) | server, KV, vectors, hooks |
| Codebase Memory (DeusData @ 92abefa) | — | MIT | Feature 1's identifier splitter, reused as is | AST engine, SQLite graph, MCP, daemon, UI |

Upstream code adapted in this feature: only AgentMemory `src/functions/lessons.ts` (attribution in `THIRD_PARTY_NOTICES.md`). `src/integrations.ts` is Fehm's own earlier code restored from git.

## Evaluation (`npm run bench:skills` → `bench/skills-results.json`)

Labels: `required` groups (any member satisfies), `optional`, `forbidden`, empty = abstain, `ambiguous` = confidence < 0.5, ≤ 2 skills, clarification.

**Protocol.** Weights and rules were tuned on the seed set only. Each held-out set was written *before* the changes it measures and never edited: held-out 1 before the router existed; held-out 2 after held-out 1's run and before the fixes it motivated; held-out 3 before held-out 2's fixes. Once a set's failures were inspected it is marked *contaminated*.

| Set | Cases | Measured when | Recall | Precision | F1 | Top-1 | Top-3 |
|---|---|---|---|---|---|---|---|
| seed (tuned) — untuned baseline | 39 | before any tuning | 0.686 | 0.512 | 0.586 | 0.686 | 0.886 |
| seed (tuned) — final | 39 | final | 0.914 | 0.957 | 0.935 | 0.886 | 1.000 |
| held-out 1 — untuned baseline | 24 | before any tuning | 0.528 | 0.454 | 0.488 | 0.556 | 0.778 |
| **held-out 1 — first clean run** | 24 | after seed tuning | **0.861** | **0.806** | **0.832** | 0.889 | 0.944 |
| held-out 1 — final (contaminated) | 24 | final | 0.944 | 0.917 | 0.930 | 0.944 | 1.000 |
| **held-out 2 — clean, before round-2 fixes** | 14 | after held-out 1 fixes | **0.500** | **0.444** | **0.471** | 0.700 | 0.800 |
| held-out 2 — final (contaminated) | 14 | final | 0.700 | 0.700 | 0.700 | 0.700 | 0.800 |
| **held-out 3 — clean, measures round-2 fixes** | 10 | final | **0.667** | **0.714** | **0.690** | 0.667 | 0.667 |

The clean held-out numbers (0.83, 0.47, 0.69 F1) are the fair estimate of routing quality on unseen tasks: useful, not solved. Forbidden-skill rate is 0 on every set except one held-out-3 case (“Set up Jenkins to build and test…” also selects a TDD skill). Ambiguity handling is correct on all 7 labelled ambiguous cases; abstention on 10 of 11 non-engineering cases (held-out 3's “Draft a bug report for the checkout crash” selects a debugging skill). Latency p50 ≈ 2–4 ms, p95 ≈ 8–17 ms per task with a warm index; the lexical index build on first use costs ~150 ms.

**Tokens.** Loading every skill would cost 2 339 721 estimated tokens; routed skill context averages ~1 400 (max 2 500 by construction).

**Registry.** Full index of 1 018 skills 2.25 s; cache-hit 33 ms; one edited skill 53 ms with 1 skill re-indexed.

**Ablation** (held-out 1–3 combined, 48 cases, 2 of 3 sets contaminated; routing-level only):

| | Recall | Precision | F1 | Skill tokens |
|---|---|---|---|---|
| A no skills | 0 | — | 0 | 0 |
| B all skills | 1 | ≈ 0.003 | — | 2 339 721 (does not fit) |
| C manual (oracle labels) | 1 | 1 | 1 | ~1 388 |
| D automatic routing | 0.824 | 0.814 | 0.819 | ~1 416 |
| E D + Feature 1 code context | = D | = D | = D | skills 1 098–2 461 + code 2 469–3 070 per task on bench/corpus, 5–22 ms |
| F D + history (from seed labels) | 0.824 | 0.814 | 0.819 | ~1 416 |

F shows **no measurable effect**: feedback from seed tasks rarely clears the similarity gate for held-out tasks. The mechanism is tested for correctness, not shown to improve routing. **Task completion, tests passed, tool calls, errors and rework were not measured**: no agent was run. Superpowers' baseline → skill → verify method would require agent runs; it is applied here only in the weaker form of writing a failing test for each routing bug before fixing it.

## Known limitations

- Vocabulary-driven profiling: unseen phrasing (“bug report template” read as debugging, “tickets” as data vs planning) misroutes; clean held-out F1 0.47–0.83.
- Coverage-based redundancy keeps one skill per need, so complementary skills for the same intent (e.g. a second debugging method) are not combined.
- Style inference reads names/descriptions only; body-level style positions are not detected.
- All catalog commits are `unpinned`; freshness against upstream needs a checkout passed explicitly.
- The labels were written by the implementer; there is one annotator and no inter-rater check.
- `package.json` now ships `skills/` (~28 MB) because routing needs the catalog at runtime.
- Installed skills keep their catalog-relative links (e.g. to `COMPATIBILITY.md`), which do not resolve outside the catalog.

## Deferred

- Agent-level evaluation (completion, tests, tool calls, rework) and Superpowers-style behavioural skill tests.
- Embedding-based semantic matching; a trained or model reranker beyond the command hook.
- MCP exposure of routing; persisted lexical index for the registry.
- Feature 3.x work (visual graph, drift, security review, prompt intelligence incl. Caveman-style output compression, git memory) is out of scope.
