---
name: surgical-changes
description: Apply surgical changes when writing, reviewing, or refactoring code.
category: core
sources:
- repository: andrej-karpathy-skills
  original_path: skills/karpathy-guidelines/SKILL.md
  sha256: 6e22cc54cb02a5e98ae42d06d9d7292db0c1b43894831b32879beb0166b2aea7
  section: '## 3. Surgical Changes'
principles:
- core/think-before-coding
- core/simplicity-first
- core/goal-driven-execution
---

> **Library use:** Apply the [compatibility and execution contract](../../COMPATIBILITY.md). Source roles, memory claims, command names, hooks, and integrations are instructions or prerequisites—not installed capabilities.

These guidelines bias toward caution over speed. For trivial tasks, use judgment.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.


## Related skills and principles

- [core/goal-driven-execution](../goal-driven-execution/SKILL.md)
- [core/simplicity-first](../simplicity-first/SKILL.md)
- [core/think-before-coding](../think-before-coding/SKILL.md)

## Source provenance

- `andrej-karpathy-skills/skills/karpathy-guidelines/SKILL.md` — ## 3. Surgical Changes
