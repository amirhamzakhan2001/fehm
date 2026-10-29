---
name: think-before-coding
description: Apply think before coding when writing, reviewing, or refactoring code.
category: core
sources:
- repository: andrej-karpathy-skills
  original_path: skills/karpathy-guidelines/SKILL.md
  sha256: 6e22cc54cb02a5e98ae42d06d9d7292db0c1b43894831b32879beb0166b2aea7
  section: '## 1. Think Before Coding'
principles:
- core/simplicity-first
- core/surgical-changes
- core/goal-driven-execution
---

> **Library use:** Apply the [compatibility and execution contract](../../COMPATIBILITY.md). Source roles, memory claims, command names, hooks, and integrations are instructions or prerequisites—not installed capabilities.

These guidelines bias toward caution over speed. For trivial tasks, use judgment.

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.


Read [worked examples of all four principles](references/EXAMPLES.md) when a concrete illustration is useful.

## Supporting material

See the [selective resource index](references/INDEX.md) for checklists, templates, examples, and reference implementations.

## Related skills and principles

- [core/goal-driven-execution](../goal-driven-execution/SKILL.md)
- [core/simplicity-first](../simplicity-first/SKILL.md)
- [core/surgical-changes](../surgical-changes/SKILL.md)

## Source provenance

- `andrej-karpathy-skills/skills/karpathy-guidelines/SKILL.md` — ## 1. Think Before Coding
