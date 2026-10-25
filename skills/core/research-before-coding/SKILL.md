---
name: research-before-coding
description: Find existing implementation and reliable documentation before inventing a solution.
category: core
sources:
- repository: ecc
  original_path: skills/search-first/SKILL.md
  sha256: d66d744228b9cf860acf35f8a90cbbe8195e61367860da9d3632f9fc65706733
- repository: ecc
  original_path: rules/common/development-workflow.md
  sha256: 54beaad49cd4cdde7ae6b8c730c4f7acf599d16f4b11e1cb7602ff1f0867c85d
principles:
- core/think-before-coding
- core/simplicity-first
- core/surgical-changes
- core/goal-driven-execution
---

> **Library use:** Apply the [compatibility and execution contract](../../COMPATIBILITY.md). Source roles, memory claims, command names, hooks, and integrations are instructions or prerequisites—not installed capabilities.

# Research Before Coding

## When to use

Find existing implementation and reliable documentation before inventing a solution.

## Inputs

User objective, project constraints, relevant source or evidence, and explicit success criteria.

## Procedure and handoffs

1. Load [the search-first procedure](../../research/search-first/SKILL.md). Search for reusable code and compare fit, maintenance, and constraints.
2. Load [the common-development-workflow-standard procedure](../common-development-workflow-standard/SKILL.md). Verify APIs in project-relevant primary documentation; use named search integrations only if available.

## Verification and output

Produce the artifacts required by the selected procedures and an evidence-backed status: completed, failed, skipped with reason, or blocked on a named prerequisite. Carry unresolved findings forward. Do not treat an unavailable tool, an unrun check, or a reviewer failure as a pass.

## Scope and compatibility

Select stages proportionate to the task. Preserve required gates of the chosen variant; record exceptions. Read the [compatibility policy](../../COMPATIBILITY.md) before combining conflicting variants. These instructions do not grant tool access or authorize publishing, commits, deployment, or communications.

## Related skills and principles

- [core/common-development-workflow-standard](../common-development-workflow-standard/SKILL.md)
- [core/goal-driven-execution](../goal-driven-execution/SKILL.md)
- [core/simplicity-first](../simplicity-first/SKILL.md)
- [core/surgical-changes](../surgical-changes/SKILL.md)
- [core/think-before-coding](../think-before-coding/SKILL.md)
- [research/search-first](../../research/search-first/SKILL.md)

## Source provenance

- `ecc/skills/search-first/SKILL.md`
- `ecc/rules/common/development-workflow.md`
