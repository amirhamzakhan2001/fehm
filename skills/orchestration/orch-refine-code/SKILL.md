---
name: orch-refine-code
description: Orchestrate a behavior-preserving refactor — confirm tests are green, restructure without changing
  behavior, keep tests green, review, and gated commit. Use when the structure should improve but behavior must
  not change.
category: orchestration
sources:
- repository: ecc
  original_path: skills/orch-refine-code/SKILL.md
  sha256: 5f0f468ffa4e220bd8f76684b3df6a14b67b34333e1ae52e0de49ed2c16fa17b
- repository: ecc
  original_path: commands/orch-refine-code.md
  sha256: 2f282b49d84b15cfcd5a0c75c31d03f7f30a8ba4936bac1029ad246402d94af8
principles:
- core/think-before-coding
- core/simplicity-first
- core/surgical-changes
- core/goal-driven-execution
---

> **Library use:** Apply the [compatibility and execution contract](../../COMPATIBILITY.md). Source roles, memory claims, command names, hooks, and integrations are instructions or prerequisites—not installed capabilities.

# orch-refine-code

Actor · action · target: **orch · refine · code**. Thin wrapper over the shared
engine in [`orch-pipeline`](../orch-pipeline/SKILL.md).

## When to Use

- Same behavior, **better structure**: extract modules, remove duplication, kill
  dead code, reduce nesting, rename for clarity.
- Distinguish from siblings: if behavior is meant to change at all, this is the
  wrong skill (`orch-change-feature` / `orch-fix-defect`).

## Operation settings

- **Default size floor:** standard — restructures touch multiple files.
- **Phase mask:** 0 → 2 (plan the restructure) → 4 (keep green) → 5 → 6. No new
  behavior tests are written — the existing suite is the safety net.
- **First move (phase 4):** confirm the relevant tests exist and are **green
  before** touching code; if coverage is thin, add characterization tests first.
  Then restructure in small steps, re-running tests after each.

## How It Works

1. Run the `orch-pipeline` engine with the settings above.
2. For dead-code / duplication sweeps, delegate to the `refactor-cleaner` agent
   (it runs knip / depcheck / ts-prune and removes safely).
3. Stop at **Gate 1** (restructure plan) and **Gate 2** (pre-commit).
4. Commit as `refactor:` — the diff must be behavior-neutral.

## Example

```
orch-refine-code: extract the NWS HTTP client out of poller.py
→ confirm tests green → plan extraction  [GATE 1: approve]
→ move in small steps, tests green throughout → code-review
→ commit refactor:  [GATE 2: confirm]
```

## Command variant

- [Original orch-refine-code command procedure](references/orch-refine-code-command.md) — load for slash-command input/outputs and gates; canonical skill is the default.

## Supporting material

See the [selective resource index](references/INDEX.md) for checklists, templates, examples, and reference implementations.

## Related skills and principles

- [core/goal-driven-execution](../../core/goal-driven-execution/SKILL.md)
- [core/simplicity-first](../../core/simplicity-first/SKILL.md)
- [core/surgical-changes](../../core/surgical-changes/SKILL.md)
- [core/think-before-coding](../../core/think-before-coding/SKILL.md)
- [engineering/refactor-cleaner](../../engineering/refactor-cleaner/SKILL.md)
- [orchestration/orch-change-feature](../orch-change-feature/SKILL.md)
- [orchestration/orch-fix-defect](../orch-fix-defect/SKILL.md)
- [orchestration/orch-pipeline](../orch-pipeline/SKILL.md)

## Source provenance

- `ecc/skills/orch-refine-code/SKILL.md`
- `ecc/commands/orch-refine-code.md`
