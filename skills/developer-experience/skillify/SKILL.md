---
name: skillify
description: Codify the most recent successful /scrape flow into a permanent browser-skill on disk. (gstack)
category: developer-experience
sources:
- repository: gstack
  original_path: skillify/SKILL.md
  sha256: ea91f4fdba474626ba8ee88f68f04f13799756fbc509457a4c571175f80ec771
principles:
- core/think-before-coding
- core/simplicity-first
- core/surgical-changes
- core/goal-driven-execution
---

> **Library use:** Apply the [compatibility and execution contract](../../COMPATIBILITY.md). Source roles, memory claims, command names, hooks, and integrations are instructions or prerequisites—not installed capabilities.

# Skillify

Codify the most recent successful /scrape flow into a permanent browser-skill on disk. (gstack)

## Required procedure

Read [the complete methodology](references/methodology.md) before performing this skill. It retains the full procedure, examples, constraints, and failure handling.

Procedure topics: When to invoke this skill; /skillify — codify the last scrape into a permanent skill; Iron contract — never write a half-broken skill to disk; Step 1 — Provenance guard (D1); Step 2 — Propose name + triggers; Step 3 — Synthesize `script.ts` (D2); Step 4 — Capture the fixture; Step 5 — Write `script.test.ts`; Step 6 — Resolve the canonical SDK path + read it; Step 7 — Stage the skill (D3 atomic write); <Name> scraper; Usage; Step 8 — Run `$B skill test` against the staged dir; Step 9 — Approval gate.

## Runtime prerequisites

See [the dependency ledger](../../DEPENDENCIES.md) and this skill’s records in [dependencies.json](../../dependencies.json). Native gstack/ECC CLIs, browsers, hooks, model tools, credentials, and memory stores must be available before invoking their steps. No runtime installation or execution has been performed. CSO requires its trusted helper; do not emulate that helper on the host.

## Related skills and principles

- [core/goal-driven-execution](../../core/goal-driven-execution/SKILL.md)
- [core/gstack-operating-protocol](../../core/gstack-operating-protocol/SKILL.md)
- [core/simplicity-first](../../core/simplicity-first/SKILL.md)
- [core/surgical-changes](../../core/surgical-changes/SKILL.md)
- [core/think-before-coding](../../core/think-before-coding/SKILL.md)
- [developer-experience/browse](../browse/SKILL.md)
- [developer-experience/plan-tune](../plan-tune/SKILL.md)
- [developer-experience/scrape](../scrape/SKILL.md)
- [documentation/document-generate](../../documentation/document-generate/SKILL.md)
- [engineering/codex](../../engineering/codex/SKILL.md)
- [engineering/review](../../engineering/review/SKILL.md)
- [memory/context-restore](../../memory/context-restore/SKILL.md)
- [memory/context-save](../../memory/context-save/SKILL.md)
- [memory/learn](../../memory/learn/SKILL.md)
- [project-management/retro](../../project-management/retro/SKILL.md)
- [release/ship](../../release/ship/SKILL.md)
- [research/hackernews-frontpage](../../research/hackernews-frontpage/SKILL.md)
- [testing/qa-only](../../testing/qa-only/SKILL.md)

## Source provenance

- `gstack/skillify/SKILL.md`
