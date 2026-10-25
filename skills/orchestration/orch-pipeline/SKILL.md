---
name: orch-pipeline
description: Shared orchestration engine for the orch-* skill family. Defines the gated Research-Plan-TDD-Review-Commit
  pipeline, the size classifier, the agent map, and the two human gates that the orch-* operation skills delegate
  to. Not usually invoked directly. Not usually invoked directly; it applies when an orch-* skill delegates its
  gated Research-Plan-TDD-Review-Commit pipeline.
category: orchestration
sources:
- repository: ecc
  original_path: skills/orch-pipeline/SKILL.md
  sha256: a0e647de4f8486cc5d12cf470c1d8c468f7b44ca5e3dc26cd65e50f9012d9cb2
principles:
- core/think-before-coding
- core/simplicity-first
- core/surgical-changes
- core/goal-driven-execution
---

> **Library use:** Apply the [compatibility and execution contract](../../COMPATIBILITY.md). Source roles, memory claims, command names, hooks, and integrations are instructions or prerequisites—not installed capabilities.

# Orchestrator Pipeline (shared engine)

The `orch-*` skills are thin wrappers. They do not re-implement any work — they
classify the request, choose which phases of *this* pipeline run, and delegate
each phase to an existing ECC agent or command. This file is that pipeline.

> Invoke an operation skill (`orch-add-feature`, `orch-fix-defect`, …) rather
> than this engine directly. This file is the reference they point at.

## When to Use

- Loaded indirectly whenever an `orch-*` operation skill runs.
- Read directly only when adding a new operation to the family or tuning the
  shared phases, gates, or agent map.

## The operation family

| Skill | Operation | Trigger | First move |
|-------|-----------|---------|------------|
| `orch-add-feature` | feature | capability does not exist yet | research + plan a new slice |
| `orch-change-feature` | tweak | works, but desired behavior differs | amend existing behavior *and its tests* |
| `orch-fix-defect` | fix | broken; behavior is wrong | reproduce as a failing test, then fix |
| `orch-refine-code` | refactor | behavior stays, structure improves | restructure while keeping tests green |
| `orch-build-mvp` | mvp | bootstrap from a design/spec doc | ingest doc → vertical slices |

> These wrappers **compose** existing ECC commands rather than replace them:
> `/feature-dev`, `/plan`, `/code-review`, `/build-fix`, `/refactor-clean`, and
> `/gan-build`, plus the `tdd-workflow` skill. The orch-* family adds the shared
> size classifier and the two gates
> on top of them, so one umbrella covers all five operations consistently.

## Step 0 — Classify size (right-sizing)

Ceremony scales to blast radius. Score the request on three signals, take the
**highest** tier any signal reaches, and state the result in one line so the user
can override:

| Tier | Files touched | New dependency / contract | Design ambiguity | Phases that run |
|------|---------------|---------------------------|------------------|-----------------|
| trivial | 1, a few lines | none | none — the change is obvious | 4 → 5 → 6 |
| small | 1 file / 1 function | none | clear once you read the code | (1 light) → 4 → 5 → 6 |
| standard | 2–5 files | maybe a new internal module | one real choice to make | 1 → 2 → 4 → 5 → 6 |
| large | many / cross-cutting | new external dep, public API, or a spec doc | multiple open questions | 1 → 2 → (3) → 4 → 5 → 6 |

Phase 0 (Intake) always runs and is omitted from the mask column above. The
tie-breaker: anything touching a security trigger (below) or a public API /
contract is **at least** standard, regardless of file count.

## The phases

Each phase delegates — it does not do the work inline.

- **0. Intake** — restate the request. For `orch-build-mvp`, read the spec/design
  doc and extract scope, locked decisions, and a feature list.
- **1. Research & Reuse** — per `../../core/common-development-workflow-standard/SKILL.md`: `gh search repos` /
  `gh search code`, then Context7 / vendor docs, then package registries, then
  Exa. Prefer adopting a proven implementation over net-new code.
- **2. Plan** — delegate to the `planner` agent (or `architect` /
  `code-architect` for structural decisions). Output a `task_list` ordered as
  thin vertical slices. → **GATE 1.**
- **3. Scaffold** — `orch-build-mvp` only: stand up the first end-to-end slice.
- **4. Implement (TDD)** — drive each task through the `tdd-guide` agent (or the `tdd-workflow` skill):
  red → green → refactor. Honor the operation's first-move rule.
- **5. Review** — `code-reviewer` agent / `/code-review`. Add `security-reviewer`
  whenever the diff touches a security trigger (below).
- **6. Commit** — conventional commits (`feat:` / `fix:` / `refactor:` / …), one
  per logical chunk. → **GATE 2.**

## The two gates

This family is **gated, not autonomous**:

1. **GATE 1 — after Plan.** Present the `task_list`; do not write implementation
   code until the user approves.
2. **GATE 2 — before Commit.** Present the diff summary and proposed messages;
   do not commit until the user confirms.

Everything between the gates flows without stopping.

## Agent / command map

| Phase | Primary | Fallback / escalation |
|-------|---------|----------------------|
| Intake / understand | `code-explorer` | trace existing paths before a tweak, fix, or refactor |
| Plan | `planner` | `architect`, `code-architect` for structural calls |
| Implement | `tdd-guide` (or `tdd-workflow` skill) | `build-error-resolver` / `/build-fix` on build breaks |
| Review | `code-reviewer` / `/code-review` | language reviewer (`python-reviewer`, `typescript-reviewer`, …) |
| Security | `security-reviewer` | — |
| MVP inner loop | `/gan-build "<brief>" --skip-planner` | drives `gan-generator` → `gan-evaluator`; tune `--max-iterations` / `--pass-threshold` |

Match the language reviewer to the repo (see the repo's own `CLAUDE.md`).

## Security-review trigger

Pull in `security-reviewer` when the diff touches any of: authentication or
authorization, user-input handling, database queries, file-system paths,
external API calls, cryptography, or secrets / credentials. (Per `../../core/common-security-standard/SKILL.md`.)

## Handoff artifacts

The pipeline carries no hidden state — the planning docs *are* the handoff:

- `task_list` (from Plan) drives the Implement loop.
- Larger work may also emit PRD / architecture / system_design under the repo's
  `docs/` per `../../core/common-development-workflow-standard/SKILL.md`.
- Review findings (CRITICAL / HIGH) must be resolved before Gate 2.

## Verification

- size tier was stated and matched the work
- Gate 1 (plan) and Gate 2 (commit) were both honored
- `security-reviewer` ran iff a security trigger was touched
- commits are conventional and scoped to one logical change
- new / changed behavior has tests; coverage ≥ 80% per `../../core/common-testing-standard/SKILL.md`

## Related skills and principles

- [architecture/architect](../../architecture/architect/SKILL.md)
- [architecture/code-architect](../../architecture/code-architect/SKILL.md)
- [code-intelligence/code-explorer](../../code-intelligence/code-explorer/SKILL.md)
- [core/goal-driven-execution](../../core/goal-driven-execution/SKILL.md)
- [core/simplicity-first](../../core/simplicity-first/SKILL.md)
- [core/surgical-changes](../../core/surgical-changes/SKILL.md)
- [core/think-before-coding](../../core/think-before-coding/SKILL.md)
- [debugging/build-error-resolver](../../debugging/build-error-resolver/SKILL.md)
- [debugging/build-fix](../../debugging/build-fix/SKILL.md)
- [engineering/code-reviewer-ecc](../../engineering/code-reviewer-ecc/SKILL.md)
- [engineering/local-and-pr-code-review](../../engineering/local-and-pr-code-review/SKILL.md)
- [engineering/refactor-clean](../../engineering/refactor-clean/SKILL.md)
- [languages/python/python-reviewer](../../languages/python/python-reviewer/SKILL.md)
- [languages/typescript/typescript-reviewer](../../languages/typescript/typescript-reviewer/SKILL.md)
- [orchestration/gan-build](../gan-build/SKILL.md)
- [orchestration/gan-evaluator](../gan-evaluator/SKILL.md)
- [orchestration/gan-generator](../gan-generator/SKILL.md)
- [orchestration/orch-add-feature](../orch-add-feature/SKILL.md)
- [orchestration/orch-build-mvp](../orch-build-mvp/SKILL.md)
- [orchestration/orch-change-feature](../orch-change-feature/SKILL.md)
- [orchestration/orch-fix-defect](../orch-fix-defect/SKILL.md)
- [orchestration/orch-refine-code](../orch-refine-code/SKILL.md)
- [security/security-reviewer](../../security/security-reviewer/SKILL.md)
- [testing/tdd-guide](../../testing/tdd-guide/SKILL.md)
- [testing/tdd-workflow](../../testing/tdd-workflow/SKILL.md)
- [workflows/feature-dev](../../workflows/feature-dev/SKILL.md)
- [workflows/plan](../../workflows/plan/SKILL.md)
- [workflows/planner](../../workflows/planner/SKILL.md)

## Source provenance

- `ecc/skills/orch-pipeline/SKILL.md`
