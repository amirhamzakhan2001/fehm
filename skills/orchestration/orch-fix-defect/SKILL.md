---
name: orch-fix-defect
description: Orchestrate fixing a bug — reproduce it as a failing regression test, fix to green, review, and gated
  commit — by delegating each phase to the matching ECC agent. Use when existing behavior is broken or wrong.
category: orchestration
sources:
- repository: ecc
  original_path: skills/orch-fix-defect/SKILL.md
  sha256: 399e142bbf3751b5a0fdec1ae450f5673bd1a038304a221748c865280e885b2d
- repository: ecc
  original_path: commands/orch-fix-defect.md
  sha256: 9f1269a9103f49425fa24303b82846a170093e2ddf32d95b4dc12b14690652a0
principles:
- core/think-before-coding
- core/simplicity-first
- core/surgical-changes
- core/goal-driven-execution
---

> **Library use:** Apply the [compatibility and execution contract](../../COMPATIBILITY.md). Source roles, memory claims, command names, hooks, and integrations are instructions or prerequisites—not installed capabilities.

# orch-fix-defect

Actor · action · target: **orch · fix · defect**. Thin wrapper over the shared
engine in [`orch-pipeline`](../orch-pipeline/SKILL.md).

## When to Use

- Something is **broken**: wrong output, an error, a crash, a regression.
- Distinguish from siblings:
  - behavior is correct but you want it different → `orch-change-feature`.
  - the capability does not exist yet → `orch-add-feature`.

## Operation settings

- **Default size floor:** small (often trivial).
- **Phase mask:** 0 → (light 2 only if root cause is non-obvious or standard+) →
  4 → 5 → 6. Research (1) is usually skipped.
- **First move (phase 4):** reproduce the bug as a **new failing** test
  (regression test), then fix until it goes green. Proving the bug exists first
  is what separates a fix from a tweak.

## How It Works

1. Run the `orch-pipeline` engine with the settings above.
2. If the root cause is unclear, scope it with `code-explorer` before the red
   test; escalate build breaks to `build-error-resolver` / `/build-fix`.
3. Stop at **Gate 1** (only if a plan was produced) and **Gate 2** (pre-commit).
4. Add `security-reviewer` if the defect sits in a security-sensitive path.

## Example

```
orch-fix-defect: poller crashes on empty NWS response
→ write failing test reproducing the crash → fix to green
→ code-review → commit  [GATE 2: confirm]   (commit: fix:)
```

## Command variant

- [Original orch-fix-defect command procedure](references/orch-fix-defect-command.md) — load for slash-command input/outputs and gates; canonical skill is the default.

## Supporting material

See the [selective resource index](references/INDEX.md) for checklists, templates, examples, and reference implementations.

## Related skills and principles

- [code-intelligence/code-explorer](../../code-intelligence/code-explorer/SKILL.md)
- [core/goal-driven-execution](../../core/goal-driven-execution/SKILL.md)
- [core/simplicity-first](../../core/simplicity-first/SKILL.md)
- [core/surgical-changes](../../core/surgical-changes/SKILL.md)
- [core/think-before-coding](../../core/think-before-coding/SKILL.md)
- [debugging/build-error-resolver](../../debugging/build-error-resolver/SKILL.md)
- [debugging/build-fix](../../debugging/build-fix/SKILL.md)
- [orchestration/orch-add-feature](../orch-add-feature/SKILL.md)
- [orchestration/orch-change-feature](../orch-change-feature/SKILL.md)
- [orchestration/orch-pipeline](../orch-pipeline/SKILL.md)
- [security/security-reviewer](../../security/security-reviewer/SKILL.md)

## Source provenance

- `ecc/skills/orch-fix-defect/SKILL.md`
- `ecc/commands/orch-fix-defect.md`
