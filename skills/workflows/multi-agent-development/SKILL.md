---
name: multi-agent-development
description: Coordinate bounded specialist work with explicit ownership, handoffs, and verified integration.
category: workflows
sources:
- repository: agency-agents
  original_path: strategy/coordination/handoff-templates.md
  sha256: 297dff8ea47b35e02b5d53cefb31aa05e1d880a1440c4c90ef9dec6156b68931
- repository: ecc
  original_path: skills/orch-pipeline/SKILL.md
  sha256: a0e647de4f8486cc5d12cf470c1d8c468f7b44ca5e3dc26cd65e50f9012d9cb2
- repository: ecc
  original_path: workflows/README.md
  sha256: 0abec58a3874782541a8cb298447df712d4282f1f30cb8eb8de04aa26c7316a3
principles:
- core/think-before-coding
- core/simplicity-first
- core/surgical-changes
- core/goal-driven-execution
---

> **Library use:** Apply the [compatibility and execution contract](../../COMPATIBILITY.md). Source roles, memory claims, command names, hooks, and integrations are instructions or prerequisites—not installed capabilities.

# Multi Agent Development

## When to use

Coordinate bounded specialist work with explicit ownership, handoffs, and verified integration.

## Inputs

User objective, project constraints, relevant source or evidence, and explicit success criteria.

## Procedure and handoffs

1. Load [the handoff-templates procedure](../../orchestration/handoff-templates/SKILL.md). Define shared artifacts, owners, dependencies, and handoff acceptance criteria.
2. Load [the orch-pipeline procedure](../../orchestration/orch-pipeline/SKILL.md). Choose size and phase mask; preserve Gate 1 and Gate 2 when using this variant.
3. Load [the adversarial-review-orchestration procedure](../../orchestration/adversarial-review-orchestration/SKILL.md). Deduplicate review findings before adversarial verification; failed dimensions and uncertain blockers remain blocking. Native orchestration requires its host tool.

## Verification and output

Produce the artifacts required by the selected procedures and an evidence-backed status: completed, failed, skipped with reason, or blocked on a named prerequisite. Carry unresolved findings forward. Do not treat an unavailable tool, an unrun check, or a reviewer failure as a pass.

## Scope and compatibility

Select stages proportionate to the task. Preserve required gates of the chosen variant; record exceptions. Read the [compatibility policy](../../COMPATIBILITY.md) before combining conflicting variants. These instructions do not grant tool access or authorize publishing, commits, deployment, or communications.

## Related skills and principles

- [core/goal-driven-execution](../../core/goal-driven-execution/SKILL.md)
- [core/simplicity-first](../../core/simplicity-first/SKILL.md)
- [core/surgical-changes](../../core/surgical-changes/SKILL.md)
- [core/think-before-coding](../../core/think-before-coding/SKILL.md)
- [orchestration/adversarial-review-orchestration](../../orchestration/adversarial-review-orchestration/SKILL.md)
- [orchestration/handoff-templates](../../orchestration/handoff-templates/SKILL.md)
- [orchestration/orch-pipeline](../../orchestration/orch-pipeline/SKILL.md)

## Source provenance

- `agency-agents/strategy/coordination/handoff-templates.md`
- `ecc/skills/orch-pipeline/SKILL.md`
- `ecc/workflows/README.md`
