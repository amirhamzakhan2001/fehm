---
name: verification-first
description: Define observable acceptance criteria and require evidence before completion claims.
category: core
sources:
- repository: andrej-karpathy-skills
  original_path: skills/karpathy-guidelines/SKILL.md
  sha256: 6e22cc54cb02a5e98ae42d06d9d7292db0c1b43894831b32879beb0166b2aea7
- repository: ecc
  original_path: skills/verification-loop/SKILL.md
  sha256: f0d56107f79e607d4de6c5543b8edfb1b58ab9ae4019b39831689cd91116543e
- repository: gstack
  original_path: AGENTS.md
  sha256: cad8ca1eadf3e04cbf8047faabae4f1a3ac7f4c454adda6f349553aa230f5801
principles:
- core/think-before-coding
- core/simplicity-first
- core/surgical-changes
- core/goal-driven-execution
---

> **Library use:** Apply the [compatibility and execution contract](../../COMPATIBILITY.md). Source roles, memory claims, command names, hooks, and integrations are instructions or prerequisites—not installed capabilities.

# Verification First

## When to use

Define observable acceptance criteria and require evidence before completion claims.

## Inputs

User objective, project constraints, relevant source or evidence, and explicit success criteria.

## Procedure and handoffs

1. Load [the think-before-coding procedure](../think-before-coding/SKILL.md). Define verifiable goals before editing.
2. Load [the verification-loop procedure](../../verification/verification-loop/SKILL.md). Run applicable checks and retain pass/fail/skip outcomes.
3. Load [the gstack-validation-discipline procedure](../../verification/gstack-validation-discipline/SKILL.md). Keep failure inventory, revision, environment, focused proof, and incomplete coverage explicit.

## Verification and output

Produce the artifacts required by the selected procedures and an evidence-backed status: completed, failed, skipped with reason, or blocked on a named prerequisite. Carry unresolved findings forward. Do not treat an unavailable tool, an unrun check, or a reviewer failure as a pass.

## Scope and compatibility

Select stages proportionate to the task. Preserve required gates of the chosen variant; record exceptions. Read the [compatibility policy](../../COMPATIBILITY.md) before combining conflicting variants. These instructions do not grant tool access or authorize publishing, commits, deployment, or communications.

## Related skills and principles

- [core/goal-driven-execution](../goal-driven-execution/SKILL.md)
- [core/simplicity-first](../simplicity-first/SKILL.md)
- [core/surgical-changes](../surgical-changes/SKILL.md)
- [core/think-before-coding](../think-before-coding/SKILL.md)
- [verification/gstack-validation-discipline](../../verification/gstack-validation-discipline/SKILL.md)
- [verification/verification-loop](../../verification/verification-loop/SKILL.md)

## Source provenance

- `andrej-karpathy-skills/skills/karpathy-guidelines/SKILL.md`
- `ecc/skills/verification-loop/SKILL.md`
- `gstack/AGENTS.md`
