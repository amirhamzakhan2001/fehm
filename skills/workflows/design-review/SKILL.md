---
name: design-review
description: Combine design direction, accessibility-aware UX, and live visual verification.
category: workflows
sources:
- repository: gstack
  original_path: plan-design-review/SKILL.md
  sha256: 6ac6315b969e7ad267197bc62c40b578dca6e63ae7f692e6b984a16a154c4c30
- repository: agency-agents
  original_path: design/design-ux-researcher.md
  sha256: 25f59c4333df2d0f1170ff7a1b11ea8415fd3d0ef80c3e0985209aeb4018680f
- repository: gstack
  original_path: design-review/SKILL.md
  sha256: 7db71c5aa086121f9475d16742f14f80e50d0772fb6d6370fecc741017d259ef
principles:
- core/think-before-coding
- core/simplicity-first
- core/surgical-changes
- core/goal-driven-execution
---

> **Library use:** Apply the [compatibility and execution contract](../../COMPATIBILITY.md). Source roles, memory claims, command names, hooks, and integrations are instructions or prerequisites—not installed capabilities.

# Design Review

## When to use

Combine design direction, accessibility-aware UX, and live visual verification.

## Inputs

User objective, project constraints, relevant source or evidence, and explicit success criteria.

## Procedure and handoffs

1. Load [the plan-design-review procedure](../../design/plan-design-review/SKILL.md). Record dimensions, gaps, and target quality in the plan.
2. Load [the ux-researcher procedure](../../design/ux-researcher/SKILL.md). Validate design assumptions against user research and usability evidence.
3. Load [the live-design-review procedure](../../design/live-design-review/SKILL.md). Audit the implementation with available browser tools, fix authorized defects, and re-check screenshots and interactions.

## Verification and output

Produce the artifacts required by the selected procedures and an evidence-backed status: completed, failed, skipped with reason, or blocked on a named prerequisite. Carry unresolved findings forward. Do not treat an unavailable tool, an unrun check, or a reviewer failure as a pass.

## Scope and compatibility

Select stages proportionate to the task. Preserve required gates of the chosen variant; record exceptions. Read the [compatibility policy](../../COMPATIBILITY.md) before combining conflicting variants. These instructions do not grant tool access or authorize publishing, commits, deployment, or communications.

## Runtime prerequisites

See [the dependency ledger](../../DEPENDENCIES.md) and this skill’s records in [dependencies.json](../../dependencies.json). Native gstack/ECC CLIs, browsers, hooks, model tools, credentials, and memory stores must be available before invoking their steps. No runtime installation or execution has been performed. CSO requires its trusted helper; do not emulate that helper on the host.

## Related skills and principles

- [core/goal-driven-execution](../../core/goal-driven-execution/SKILL.md)
- [core/simplicity-first](../../core/simplicity-first/SKILL.md)
- [core/surgical-changes](../../core/surgical-changes/SKILL.md)
- [core/think-before-coding](../../core/think-before-coding/SKILL.md)
- [design/design-consultation](../../design/design-consultation/SKILL.md)
- [design/design-shotgun](../../design/design-shotgun/SKILL.md)
- [design/live-design-review](../../design/live-design-review/SKILL.md)
- [design/plan-design-review](../../design/plan-design-review/SKILL.md)
- [design/ux-researcher](../../design/ux-researcher/SKILL.md)
- [developer-experience/plan-tune](../../developer-experience/plan-tune/SKILL.md)
- [documentation/document-generate](../../documentation/document-generate/SKILL.md)
- [engineering/codex](../../engineering/codex/SKILL.md)
- [engineering/review](../../engineering/review/SKILL.md)
- [memory/context-restore](../../memory/context-restore/SKILL.md)
- [memory/context-save](../../memory/context-save/SKILL.md)
- [memory/learn](../../memory/learn/SKILL.md)
- [project-management/retro](../../project-management/retro/SKILL.md)
- [release/ship](../../release/ship/SKILL.md)
- [testing/qa-only](../../testing/qa-only/SKILL.md)
- [workflows/gstack-workflow-router](../gstack-workflow-router/SKILL.md)

## Source provenance

- `gstack/plan-design-review/SKILL.md`
- `agency-agents/design/design-ux-researcher.md`
- `gstack/design-review/SKILL.md`
