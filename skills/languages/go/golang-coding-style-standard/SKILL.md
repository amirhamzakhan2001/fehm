---
name: golang-coding-style-standard
description: Go Coding Style. Use this standard for golang coding style standard.
category: languages/go
sources:
- repository: ecc
  original_path: rules/golang/coding-style.md
  sha256: c32f6a2715297a1637b35567bb2e65054b4b28064b4d91fad26ad688f758243d
principles:
- core/think-before-coding
- core/simplicity-first
- core/surgical-changes
- core/goal-driven-execution
---

> **Library use:** Apply the [compatibility and execution contract](../../../COMPATIBILITY.md). Source roles, memory claims, command names, hooks, and integrations are instructions or prerequisites—not installed capabilities.

# Go Coding Style

> This file extends [common/coding-style.md](../../../core/common-coding-style-standard/SKILL.md) with Go specific content.

## Formatting

- **gofmt** and **goimports** are mandatory — no style debates

## Design Principles

- Accept interfaces, return structs
- Keep interfaces small (1-3 methods)

## Error Handling

Always wrap errors with context:

```go
if err != nil {
    return fmt.Errorf("failed to create user: %w", err)
}
```

## Reference

See skill: `golang-patterns` for comprehensive Go idioms and patterns.

## Related skills and principles

- [core/goal-driven-execution](../../../core/goal-driven-execution/SKILL.md)
- [core/simplicity-first](../../../core/simplicity-first/SKILL.md)
- [core/surgical-changes](../../../core/surgical-changes/SKILL.md)
- [core/think-before-coding](../../../core/think-before-coding/SKILL.md)
- [languages/go/golang-patterns](../golang-patterns/SKILL.md)

## Source provenance

- `ecc/rules/golang/coding-style.md`
