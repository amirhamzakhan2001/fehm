---
name: plan-design-review
description: Designer's eye plan review — interactive, like CEO and Eng review. (gstack)
category: design
sources:
- repository: gstack
  original_path: plan-design-review/SKILL.md
  sha256: 6ac6315b969e7ad267197bc62c40b578dca6e63ae7f692e6b984a16a154c4c30
principles: []
---

> **Library use:** Apply the [compatibility and execution contract](../../COMPATIBILITY.md). Source roles, memory claims, command names, hooks, and integrations are instructions or prerequisites—not installed capabilities.

# Plan Design Review

Designer's eye plan review — interactive, like CEO and Eng review. (gstack)

## Required procedure

Read [the complete methodology](references/methodology.md) before performing this skill. It retains the full procedure, examples, constraints, and failure handling.

Procedure topics: When to invoke this skill; /plan-design-review: Designer's Eye Plan Review; Scope gate (FIRST — overrides everything below). This is a hard STOP.; Preamble (after scope gate); Plan Mode Safe Operations; Skill Invocation During Plan Mode; AskUserQuestion Format; Tool resolution (read first); When AskUserQuestion is unavailable or a call fails; Format; Handling 5+ options — split, never drop; Self-check before emitting; Artifacts Sync (skill start); Model-Specific Behavioral Patch (claude).

## Supporting material

See the [selective resource index](references/INDEX.md) for checklists, templates, examples, and reference implementations.

## Runtime prerequisites

See [the dependency ledger](../../DEPENDENCIES.md) and this skill’s records in [dependencies.json](../../dependencies.json). Native gstack/ECC CLIs, browsers, hooks, model tools, credentials, and memory stores must be available before invoking their steps. No runtime installation or execution has been performed. CSO requires its trusted helper; do not emulate that helper on the host.

## Related skills and principles

- [design/design-consultation](../design-consultation/SKILL.md)
- [design/design-shotgun](../design-shotgun/SKILL.md)
- [design/live-design-review](../live-design-review/SKILL.md)
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
- [workflows/gstack-workflow-router](../../workflows/gstack-workflow-router/SKILL.md)

## Source provenance

- `gstack/plan-design-review/SKILL.md`
