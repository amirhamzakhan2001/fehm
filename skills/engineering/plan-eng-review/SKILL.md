---
name: plan-eng-review
description: Eng manager-mode plan review. (gstack)
category: engineering
sources:
- repository: gstack
  original_path: plan-eng-review/SKILL.md
  sha256: c03907fc011811cad44228050939b99aa253cacee45e3fffefda4c55cdf0367d
principles:
- core/think-before-coding
- core/simplicity-first
- core/surgical-changes
- core/goal-driven-execution
---

> **Library use:** Apply the [compatibility and execution contract](../../COMPATIBILITY.md). Source roles, memory claims, command names, hooks, and integrations are instructions or prerequisites—not installed capabilities.

# Plan Eng Review

Eng manager-mode plan review. (gstack)

## Required procedure

Read [the complete methodology](references/methodology.md) before performing this skill. It retains the full procedure, examples, constraints, and failure handling.

Procedure topics: When to invoke this skill; Plan Review Mode; Scope gate (FIRST — overrides everything below). This is a hard STOP.; Preamble (after scope gate); Plan Mode Safe Operations; Skill Invocation During Plan Mode; AskUserQuestion Format; Tool resolution (read first); When AskUserQuestion is unavailable or a call fails; Format; Handling 5+ options — split, never drop; Self-check before emitting; Artifacts Sync (skill start); Model-Specific Behavioral Patch (claude).

## Supporting material

See the [selective resource index](references/INDEX.md) for checklists, templates, examples, and reference implementations.

## Runtime prerequisites

See [the dependency ledger](../../DEPENDENCIES.md) and this skill’s records in [dependencies.json](../../dependencies.json). Native gstack/ECC CLIs, browsers, hooks, model tools, credentials, and memory stores must be available before invoking their steps. No runtime installation or execution has been performed. CSO requires its trusted helper; do not emulate that helper on the host.

## Related skills and principles

- [core/goal-driven-execution](../../core/goal-driven-execution/SKILL.md)
- [core/simplicity-first](../../core/simplicity-first/SKILL.md)
- [core/surgical-changes](../../core/surgical-changes/SKILL.md)
- [core/think-before-coding](../../core/think-before-coding/SKILL.md)
- [developer-experience/plan-tune](../../developer-experience/plan-tune/SKILL.md)
- [documentation/document-generate](../../documentation/document-generate/SKILL.md)
- [engineering/codex](../codex/SKILL.md)
- [engineering/review](../review/SKILL.md)
- [memory/context-restore](../../memory/context-restore/SKILL.md)
- [memory/context-save](../../memory/context-save/SKILL.md)
- [memory/learn](../../memory/learn/SKILL.md)
- [product/office-hours](../../product/office-hours/SKILL.md)
- [project-management/retro](../../project-management/retro/SKILL.md)
- [release/ship](../../release/ship/SKILL.md)
- [testing/qa-only](../../testing/qa-only/SKILL.md)
- [workflows/gstack-workflow-router](../../workflows/gstack-workflow-router/SKILL.md)

## Source provenance

- `gstack/plan-eng-review/SKILL.md`
