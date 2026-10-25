---
name: orch-change-feature
description: Orchestrate altering an existing, working feature to new desired behavior — update its tests to the
  new spec, change the implementation to match, review, and gated commit. Use when behavior is not broken but should
  be different.
category: orchestration
sources:
- repository: ecc
  original_path: skills/orch-change-feature/SKILL.md
  sha256: d35ee5dfdf5f64e60e8905124eccf73267bc59852e7d11ba5ca5acf7d765c6f8
- repository: ecc
  original_path: commands/orch-change-feature.md
  sha256: 9315a445ddeeb50410e5a3893f930a2db3a19ca14ec5121b3071fe4b834375e8
principles:
- core/think-before-coding
- core/simplicity-first
- core/surgical-changes
- core/goal-driven-execution
---

> **Library use:** Apply the [compatibility and execution contract](../../COMPATIBILITY.md). Source roles, memory claims, command names, hooks, and integrations are instructions or prerequisites—not installed capabilities.

# orch-change-feature

Actor · action · target: **orch · change · feature**. Thin wrapper over the
shared engine in [`orch-pipeline`](../orch-pipeline/SKILL.md).

## When to Use

- An existing feature **works**, but the desired behavior is different ("change",
  "adjust", "make it also …", "instead of X do Y").
- Distinguish from siblings:
  - **not** broken → not `orch-fix-defect` (no bug to reproduce).
  - **not** new → not `orch-add-feature` (the capability already exists).

## Operation settings

- **Default size floor:** small — most tweaks are a function or two.
- **Phase mask:** 0 → (1 only if the new behavior needs research) → light 2 →
  4 → 5 → 6.
- **First move (phase 4):** update the *existing* tests to express the new
  desired behavior, then change the implementation until they pass. Changing the
  tests first is what separates a tweak from a fix.

## How It Works

1. Run the `orch-pipeline` engine with the settings above.
2. Keep the plan light — only `standard`+ size warrants the full `planner` pass.
3. Stop at **Gate 1** (plan / changed-test approval) and **Gate 2** (pre-commit).
4. Add `security-reviewer` if the change touches a security trigger.

## Example

```
orch-change-feature: make nws-poller alert at 2 warnings instead of 3
→ update threshold tests to new spec → change impl to green
→ code-review → commit  [GATE 2: confirm]
```

## Command variant

- [Original orch-change-feature command procedure](references/orch-change-feature-command.md) — load for slash-command input/outputs and gates; canonical skill is the default.

## Supporting material

See the [selective resource index](references/INDEX.md) for checklists, templates, examples, and reference implementations.

## Related skills and principles

- [core/goal-driven-execution](../../core/goal-driven-execution/SKILL.md)
- [core/simplicity-first](../../core/simplicity-first/SKILL.md)
- [core/surgical-changes](../../core/surgical-changes/SKILL.md)
- [core/think-before-coding](../../core/think-before-coding/SKILL.md)
- [orchestration/orch-add-feature](../orch-add-feature/SKILL.md)
- [orchestration/orch-fix-defect](../orch-fix-defect/SKILL.md)
- [orchestration/orch-pipeline](../orch-pipeline/SKILL.md)
- [security/security-reviewer](../../security/security-reviewer/SKILL.md)
- [workflows/planner](../../workflows/planner/SKILL.md)

## Source provenance

- `ecc/skills/orch-change-feature/SKILL.md`
- `ecc/commands/orch-change-feature.md`
