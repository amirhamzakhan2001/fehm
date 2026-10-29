---
name: python-coding-style-standard
description: Python Coding Style. Use this standard for python coding style standard.
category: languages/python
sources:
- repository: ecc
  original_path: rules/python/coding-style.md
  sha256: f9d6d7a39c5f5ea809579fecac591f390fa9264c088c7e209d464d5244747003
principles:
- core/think-before-coding
- core/simplicity-first
- core/surgical-changes
- core/goal-driven-execution
---

> **Library use:** Apply the [compatibility and execution contract](../../../COMPATIBILITY.md). Source roles, memory claims, command names, hooks, and integrations are instructions or prerequisites—not installed capabilities.

# Python Coding Style

> This file extends [common/coding-style.md](../../../core/common-coding-style-standard/SKILL.md) with Python specific content.

## Standards

- Follow **PEP 8** conventions
- Use **type annotations** on all function signatures

## Immutability

Prefer immutable data structures:

```python
from dataclasses import dataclass

@dataclass(frozen=True)
class User:
    name: str
    email: str

from typing import NamedTuple

class Point(NamedTuple):
    x: float
    y: float
```

## Formatting

- **black** for code formatting
- **isort** for import sorting
- **ruff** for linting

## Reference

See skill: `python-patterns` for comprehensive Python idioms and patterns.

## Related skills and principles

- [core/goal-driven-execution](../../../core/goal-driven-execution/SKILL.md)
- [core/simplicity-first](../../../core/simplicity-first/SKILL.md)
- [core/surgical-changes](../../../core/surgical-changes/SKILL.md)
- [core/think-before-coding](../../../core/think-before-coding/SKILL.md)
- [languages/python/python-patterns](../python-patterns/SKILL.md)

## Source provenance

- `ecc/rules/python/coding-style.md`
