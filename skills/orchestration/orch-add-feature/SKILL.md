---
name: orch-add-feature
description: Orchestrate building a brand-new feature end to end — research, plan, TDD implementation, review, and
  gated commit — by delegating each phase to the matching ECC agent. Use when adding a capability that does not
  exist yet.
category: orchestration
sources:
- repository: ecc
  original_path: skills/orch-add-feature/SKILL.md
  sha256: 6ba858d94cfaa05f3b1e63ad09656285a4a33009e9cd837ebcaf093d39d29a25
- repository: ecc
  original_path: commands/orch-add-feature.md
  sha256: e46c1d23fc4f269713c6743b0ba403f13916c0c617ca2e4e0526efc897c133ed
principles:
- core/think-before-coding
- core/simplicity-first
- core/surgical-changes
- core/goal-driven-execution
---

> **Library use:** Apply the [compatibility and execution contract](../../COMPATIBILITY.md). Source roles, memory claims, command names, hooks, and integrations are instructions or prerequisites—not installed capabilities.

# orch-add-feature

Actor · action · target: **orch · add · feature**. Thin wrapper over the shared
engine in [`orch-pipeline`](../orch-pipeline/SKILL.md).

## When to Use

- The user wants a capability that does **not exist yet** ("add", "build",
  "implement", "support …").
- It is net-new behavior — not a correction (`orch-fix-defect`) and not an
  alteration of existing behavior (`orch-change-feature`).

## Operation settings

- **Default size floor:** standard — run Research + Plan unless clearly small.
- **Phase mask:** 0 → 1 → 2 → 4 → 5 → 6 (skip 3 Scaffold; that is MVP-only).
- **First move (phase 4):** write *new* failing tests for the new behavior, then
  implement to green.

## How It Works

1. Run the `orch-pipeline` engine with the settings above.
2. Classify size first; small / trivial features collapse toward 4 → 5 → 6.
3. Stop at **Gate 1** (plan approval) and **Gate 2** (pre-commit).
4. Add `security-reviewer` if the feature touches a security trigger.

> Related: `/feature-dev` is a standalone version of this flow. `orch-add-feature`
> differs by sharing the `orch-pipeline` engine — the size classifier and the two
> gates — with the rest of the family, so it right-sizes trivial features to 4 → 5 → 6.

## Example

```
orch-add-feature: add OAuth2 login to nws-poller
→ research existing auth libs → plan task_list  [GATE 1: approve]
→ TDD each task → code-review (+ security-reviewer: auth path)
→ commit  [GATE 2: confirm]
```

## Command variant

- [Original orch-add-feature command procedure](references/orch-add-feature-command.md) — load for slash-command input/outputs and gates; canonical skill is the default.

## Supporting material

See the [selective resource index](references/INDEX.md) for checklists, templates, examples, and reference implementations.

## Related skills and principles

- [core/goal-driven-execution](../../core/goal-driven-execution/SKILL.md)
- [core/simplicity-first](../../core/simplicity-first/SKILL.md)
- [core/surgical-changes](../../core/surgical-changes/SKILL.md)
- [core/think-before-coding](../../core/think-before-coding/SKILL.md)
- [orchestration/orch-change-feature](../orch-change-feature/SKILL.md)
- [orchestration/orch-fix-defect](../orch-fix-defect/SKILL.md)
- [orchestration/orch-pipeline](../orch-pipeline/SKILL.md)
- [security/security-reviewer](../../security/security-reviewer/SKILL.md)
- [workflows/feature-dev](../../workflows/feature-dev/SKILL.md)

## Source provenance

- `ecc/skills/orch-add-feature/SKILL.md`
- `ecc/commands/orch-add-feature.md`
