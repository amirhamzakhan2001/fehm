---
name: goal-driven-execution
description: Apply goal driven execution when writing, reviewing, or refactoring code.
category: core
sources:
- repository: andrej-karpathy-skills
  original_path: skills/karpathy-guidelines/SKILL.md
  sha256: 6e22cc54cb02a5e98ae42d06d9d7292db0c1b43894831b32879beb0166b2aea7
  section: '## 4. Goal-Driven Execution'
principles:
- core/think-before-coding
- core/simplicity-first
- core/surgical-changes
---

> **Library use:** Apply the [compatibility and execution contract](../../COMPATIBILITY.md). Source roles, memory claims, command names, hooks, and integrations are instructions or prerequisites—not installed capabilities.

These guidelines bias toward caution over speed. For trivial tasks, use judgment.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

## Related skills and principles

- [core/simplicity-first](../simplicity-first/SKILL.md)
- [core/surgical-changes](../surgical-changes/SKILL.md)
- [core/think-before-coding](../think-before-coding/SKILL.md)

## Source provenance

- `andrej-karpathy-skills/skills/karpathy-guidelines/SKILL.md` — ## 4. Goal-Driven Execution
