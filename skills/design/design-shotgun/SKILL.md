---
name: design-shotgun
description: 'Design shotgun: generate multiple AI design variants, open a comparison board, collect structured
  feedback, and iterate. (gstack)'
category: design
sources:
- repository: gstack
  original_path: design-shotgun/SKILL.md
  sha256: e33e0da6b44e2eb7de75fe77148bcfbc25c55ae28a3c747f320ef22b2bdb983c
principles: []
---

> **Library use:** Apply the [compatibility and execution contract](../../COMPATIBILITY.md). Source roles, memory claims, command names, hooks, and integrations are instructions or prerequisites—not installed capabilities.

# Design Shotgun

Design shotgun: generate multiple AI design variants, open a comparison board, collect structured feedback, and iterate. (gstack)

## Required procedure

Read [the complete methodology](references/methodology.md) before performing this skill. It retains the full procedure, examples, constraints, and failure handling.

Procedure topics: When to invoke this skill; /design-shotgun: Visual Design Exploration; Section index — Read each section when its situation applies; DESIGN SETUP (run this check BEFORE any design mockup command); Step 0: Session Detection; Step 1: Context Gathering; Step 2: Taste Memory; Step 3: Generate Variants; Step 3a: Concept Generation; Step 3b: Concept Confirmation; Step 3c: Parallel Generation; Step 3d: Results; Step 4: Comparison Board + Feedback Loop; Comparison Board + Feedback Loop.

## Supporting material

See the [selective resource index](references/INDEX.md) for checklists, templates, examples, and reference implementations.

## Runtime prerequisites

See [the dependency ledger](../../DEPENDENCIES.md) and this skill’s records in [dependencies.json](../../dependencies.json). Native gstack/ECC CLIs, browsers, hooks, model tools, credentials, and memory stores must be available before invoking their steps. No runtime installation or execution has been performed. CSO requires its trusted helper; do not emulate that helper on the host.

## Related skills and principles

- [core/gstack-operating-protocol](../../core/gstack-operating-protocol/SKILL.md)
- [design/design-html](../design-html/SKILL.md)
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

## Source provenance

- `gstack/design-shotgun/SKILL.md`
