---
name: simplicity-first
description: Apply simplicity first when writing, reviewing, or refactoring code.
category: core
sources:
- repository: andrej-karpathy-skills
  original_path: skills/karpathy-guidelines/SKILL.md
  sha256: 6e22cc54cb02a5e98ae42d06d9d7292db0c1b43894831b32879beb0166b2aea7
  section: '## 2. Simplicity First'
principles:
- core/think-before-coding
- core/surgical-changes
- core/goal-driven-execution
---

> **Library use:** Apply the [compatibility and execution contract](../../COMPATIBILITY.md). Source roles, memory claims, command names, hooks, and integrations are instructions or prerequisites—not installed capabilities.

These guidelines bias toward caution over speed. For trivial tasks, use judgment.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.


## Related skills and principles

- [core/goal-driven-execution](../goal-driven-execution/SKILL.md)
- [core/surgical-changes](../surgical-changes/SKILL.md)
- [core/think-before-coding](../think-before-coding/SKILL.md)

## Source provenance

- `andrej-karpathy-skills/skills/karpathy-guidelines/SKILL.md` — ## 2. Simplicity First
