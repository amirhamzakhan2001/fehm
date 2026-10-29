---
name: refactoring
description: Refactor within an explicit scope while preserving observable behavior.
category: workflows
sources:
- repository: andrej-karpathy-skills
  original_path: skills/karpathy-guidelines/SKILL.md
  sha256: 6e22cc54cb02a5e98ae42d06d9d7292db0c1b43894831b32879beb0166b2aea7
- repository: ecc
  original_path: agents/refactor-cleaner.md
  sha256: 13704c3aee163bcbf6bcbf7a7933630a70d6c312ff3ee5a29bff63b8800484cc
- repository: ecc
  original_path: skills/verification-loop/SKILL.md
  sha256: f0d56107f79e607d4de6c5543b8edfb1b58ab9ae4019b39831689cd91116543e
principles:
- core/think-before-coding
- core/simplicity-first
- core/surgical-changes
- core/goal-driven-execution
---

> **Library use:** Apply the [compatibility and execution contract](../../COMPATIBILITY.md). Source roles, memory claims, command names, hooks, and integrations are instructions or prerequisites—not installed capabilities.

# Refactoring

## When to use

Refactor within an explicit scope while preserving observable behavior.

## Inputs

User objective, project constraints, relevant source or evidence, and explicit success criteria.

## Procedure and handoffs

1. Load [the think-before-coding procedure](../../core/think-before-coding/SKILL.md). Define success and baseline behavior; load simplicity-first and surgical-changes.
2. Load [the refactor-cleaner procedure](../../engineering/refactor-cleaner/SKILL.md). Check callers and evidence before removing code; unrelated cleanup requires separate scope.
3. Load [the verification-loop procedure](../../verification/verification-loop/SKILL.md). Compare checks before and after; record any intentional behavior change.

## Verification and output

Produce the artifacts required by the selected procedures and an evidence-backed status: completed, failed, skipped with reason, or blocked on a named prerequisite. Carry unresolved findings forward. Do not treat an unavailable tool, an unrun check, or a reviewer failure as a pass.

## Scope and compatibility

Select stages proportionate to the task. Preserve required gates of the chosen variant; record exceptions. Read the [compatibility policy](../../COMPATIBILITY.md) before combining conflicting variants. These instructions do not grant tool access or authorize publishing, commits, deployment, or communications.

## Related skills and principles

- [core/goal-driven-execution](../../core/goal-driven-execution/SKILL.md)
- [core/simplicity-first](../../core/simplicity-first/SKILL.md)
- [core/surgical-changes](../../core/surgical-changes/SKILL.md)
- [core/think-before-coding](../../core/think-before-coding/SKILL.md)
- [engineering/refactor-cleaner](../../engineering/refactor-cleaner/SKILL.md)
- [verification/verification-loop](../../verification/verification-loop/SKILL.md)

## Source provenance

- `andrej-karpathy-skills/skills/karpathy-guidelines/SKILL.md`
- `ecc/agents/refactor-cleaner.md`
- `ecc/skills/verification-loop/SKILL.md`
