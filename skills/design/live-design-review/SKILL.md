---
name: live-design-review
description: 'Designer''s eye QA: finds visual inconsistency, spacing issues, hierarchy problems, AI slop patterns,
  and slow interactions — then fixes them. (gstack)'
category: design
sources:
- repository: gstack
  original_path: design-review/SKILL.md
  sha256: 7db71c5aa086121f9475d16742f14f80e50d0772fb6d6370fecc741017d259ef
principles: []
---

> **Library use:** Apply the [compatibility and execution contract](../../COMPATIBILITY.md). Source roles, memory claims, command names, hooks, and integrations are instructions or prerequisites—not installed capabilities.

# Live Design Review

Designer's eye QA: finds visual inconsistency, spacing issues, hierarchy problems, AI slop patterns, and slow interactions — then fixes them. (gstack)

## Required procedure

Read [the complete methodology](references/methodology.md) before performing this skill. It retains the full procedure, examples, constraints, and failure handling.

Procedure topics: When to invoke this skill; /design-review: Design Audit → Fix → Verify; Setup; BROWSER SETUP (Aside — run this check BEFORE any browser step); Rules for driving a real browser; Browser fallback: gstack's own headless browser; Find the `$B` binary; Translate the Aside scripts step by step; What changes without Aside; Test Framework Bootstrap; Definitive ecosystem markers (presence = ecosystem, NOT a command to run); Detect sub-frameworks; Existing test path — config files, declared scripts, AND test FILES.; A project with real tests and no config file is the common miss..

## Runtime prerequisites

See [the dependency ledger](../../DEPENDENCIES.md) and this skill’s records in [dependencies.json](../../dependencies.json). Native gstack/ECC CLIs, browsers, hooks, model tools, credentials, and memory stores must be available before invoking their steps. No runtime installation or execution has been performed. CSO requires its trusted helper; do not emulate that helper on the host.

## Related skills and principles

- [core/gstack-operating-protocol](../../core/gstack-operating-protocol/SKILL.md)
- [design/design-consultation](../design-consultation/SKILL.md)
- [design/plan-design-review](../plan-design-review/SKILL.md)
- [developer-experience/browse](../../developer-experience/browse/SKILL.md)
- [developer-experience/plan-tune](../../developer-experience/plan-tune/SKILL.md)
- [developer-experience/setup-browser-cookies](../../developer-experience/setup-browser-cookies/SKILL.md)
- [documentation/document-generate](../../documentation/document-generate/SKILL.md)
- [engineering/codex](../../engineering/codex/SKILL.md)
- [engineering/review](../../engineering/review/SKILL.md)
- [memory/context-restore](../../memory/context-restore/SKILL.md)
- [memory/context-save](../../memory/context-save/SKILL.md)
- [memory/learn](../../memory/learn/SKILL.md)
- [project-management/retro](../../project-management/retro/SKILL.md)
- [release/ship](../../release/ship/SKILL.md)
- [testing/qa-only](../../testing/qa-only/SKILL.md)

## Source provenance

- `gstack/design-review/SKILL.md`
