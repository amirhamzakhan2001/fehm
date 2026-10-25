---
name: devex-review
description: Live developer experience audit. (gstack)
category: developer-experience
sources:
- repository: gstack
  original_path: devex-review/SKILL.md
  sha256: 7208d0db9c02caca325a82c41ec6032a2bad214af6d327ed78306c6377d68c3c
principles:
- core/think-before-coding
- core/simplicity-first
- core/surgical-changes
- core/goal-driven-execution
---

> **Library use:** Apply the [compatibility and execution contract](../../COMPATIBILITY.md). Source roles, memory claims, command names, hooks, and integrations are instructions or prerequisites—not installed capabilities.

# Devex Review

Live developer experience audit. (gstack)

## Required procedure

Read [the complete methodology](references/methodology.md) before performing this skill. It retains the full procedure, examples, constraints, and failure handling.

Procedure topics: When to invoke this skill; Step 0: Detect platform and base branch; BROWSER SETUP (Aside — run this check BEFORE any browser step); Rules for driving a real browser; Browser fallback: gstack's own headless browser; Find the `$B` binary; Translate the Aside scripts step by step; What changes without Aside; Cookbook (verified against Aside CLI 1.26 — use these shapes, not memory); /devex-review: Live Developer Experience Audit; DX First Principles; The Seven DX Characteristics; Cognitive Patterns — How Great DX Leaders Think; DX Scoring Rubric (0-10 calibration).

## Runtime prerequisites

See [the dependency ledger](../../DEPENDENCIES.md) and this skill’s records in [dependencies.json](../../dependencies.json). Native gstack/ECC CLIs, browsers, hooks, model tools, credentials, and memory stores must be available before invoking their steps. No runtime installation or execution has been performed. CSO requires its trusted helper; do not emulate that helper on the host.

## Related skills and principles

- [core/goal-driven-execution](../../core/goal-driven-execution/SKILL.md)
- [core/gstack-operating-protocol](../../core/gstack-operating-protocol/SKILL.md)
- [core/simplicity-first](../../core/simplicity-first/SKILL.md)
- [core/surgical-changes](../../core/surgical-changes/SKILL.md)
- [core/think-before-coding](../../core/think-before-coding/SKILL.md)
- [design/plan-design-review](../../design/plan-design-review/SKILL.md)
- [developer-experience/browse](../browse/SKILL.md)
- [developer-experience/plan-devex-review](../plan-devex-review/SKILL.md)
- [developer-experience/plan-tune](../plan-tune/SKILL.md)
- [developer-experience/setup-browser-cookies](../setup-browser-cookies/SKILL.md)
- [documentation/document-generate](../../documentation/document-generate/SKILL.md)
- [engineering/codex](../../engineering/codex/SKILL.md)
- [engineering/plan-eng-review](../../engineering/plan-eng-review/SKILL.md)
- [engineering/review](../../engineering/review/SKILL.md)
- [memory/context-restore](../../memory/context-restore/SKILL.md)
- [memory/context-save](../../memory/context-save/SKILL.md)
- [memory/learn](../../memory/learn/SKILL.md)
- [product/plan-ceo-review](../../product/plan-ceo-review/SKILL.md)
- [project-management/retro](../../project-management/retro/SKILL.md)
- [release/ship](../../release/ship/SKILL.md)
- [testing/qa-only](../../testing/qa-only/SKILL.md)
- [workflows/autoplan](../../workflows/autoplan/SKILL.md)

## Source provenance

- `gstack/devex-review/SKILL.md`
