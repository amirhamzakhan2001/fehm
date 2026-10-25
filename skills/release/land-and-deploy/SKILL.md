---
name: land-and-deploy
description: Land and deploy workflow. (gstack)
category: release
sources:
- repository: gstack
  original_path: land-and-deploy/SKILL.md
  sha256: f623d7b9285a907245cd5bfbea0429fabcba05bbfc57e23bc72e87c91cf169a4
principles:
- core/think-before-coding
- core/simplicity-first
- core/surgical-changes
- core/goal-driven-execution
---

> **Library use:** Apply the [compatibility and execution contract](../../COMPATIBILITY.md). Source roles, memory claims, command names, hooks, and integrations are instructions or prerequisites—not installed capabilities.

# Land And Deploy

Land and deploy workflow. (gstack)

## Required procedure

Read [the complete methodology](references/methodology.md) before performing this skill. It retains the full procedure, examples, constraints, and failure handling.

Procedure topics: When to invoke this skill; Third-Party Web Actions; BROWSER SETUP (Aside — run this check BEFORE any browser step); Rules for driving a real browser; Browser fallback: gstack's own headless browser; Find the `$B` binary; Translate the Aside scripts step by step; What changes without Aside; Step 0: Detect platform and base branch; /land-and-deploy — Merge, Deploy, Verify; User-invocable; Arguments; Non-interactive philosophy (like /ship) — with one critical gate; Voice & Tone.

## Supporting material

See the [selective resource index](references/INDEX.md) for checklists, templates, examples, and reference implementations.

## Runtime prerequisites

See [the dependency ledger](../../DEPENDENCIES.md) and this skill’s records in [dependencies.json](../../dependencies.json). Native gstack/ECC CLIs, browsers, hooks, model tools, credentials, and memory stores must be available before invoking their steps. No runtime installation or execution has been performed. CSO requires its trusted helper; do not emulate that helper on the host.

## Related skills and principles

- [core/goal-driven-execution](../../core/goal-driven-execution/SKILL.md)
- [core/gstack-operating-protocol](../../core/gstack-operating-protocol/SKILL.md)
- [core/simplicity-first](../../core/simplicity-first/SKILL.md)
- [core/surgical-changes](../../core/surgical-changes/SKILL.md)
- [core/think-before-coding](../../core/think-before-coding/SKILL.md)
- [developer-experience/browse](../../developer-experience/browse/SKILL.md)
- [developer-experience/plan-tune](../../developer-experience/plan-tune/SKILL.md)
- [developer-experience/setup-browser-cookies](../../developer-experience/setup-browser-cookies/SKILL.md)
- [documentation/document-generate](../../documentation/document-generate/SKILL.md)
- [engineering/codex](../../engineering/codex/SKILL.md)
- [engineering/review](../../engineering/review/SKILL.md)
- [memory/context-restore](../../memory/context-restore/SKILL.md)
- [memory/context-save](../../memory/context-save/SKILL.md)
- [memory/learn](../../memory/learn/SKILL.md)
- [performance/benchmark-gstack](../../performance/benchmark-gstack/SKILL.md)
- [project-management/retro](../../project-management/retro/SKILL.md)
- [release/canary](../canary/SKILL.md)
- [release/document-release](../document-release/SKILL.md)
- [release/ship](../ship/SKILL.md)
- [testing/qa-only](../../testing/qa-only/SKILL.md)

## Source provenance

- `gstack/land-and-deploy/SKILL.md`
