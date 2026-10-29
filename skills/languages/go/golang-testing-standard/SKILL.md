---
name: golang-testing-standard
description: Go Testing. Use this standard for golang testing standard.
category: languages/go
sources:
- repository: ecc
  original_path: rules/golang/testing.md
  sha256: b0fcde8be4ce98e34fe872cc2ecca63cab8c8cd87d5faa1e1667ee82f3707d74
principles:
- core/think-before-coding
- core/simplicity-first
- core/surgical-changes
- core/goal-driven-execution
---

> **Library use:** Apply the [compatibility and execution contract](../../../COMPATIBILITY.md). Source roles, memory claims, command names, hooks, and integrations are instructions or prerequisites—not installed capabilities.

# Go Testing

> This file extends [common/testing.md](../../../core/common-testing-standard/SKILL.md) with Go specific content.

## Framework

Use the standard `go test` with **table-driven tests**.

## Race Detection

Always run with the `-race` flag:

```bash
go test -race ./...
```

## Coverage

```bash
go test -cover ./...
```

## Reference

See skill: `golang-testing` for detailed Go testing patterns and helpers.

## Related skills and principles

- [core/goal-driven-execution](../../../core/goal-driven-execution/SKILL.md)
- [core/simplicity-first](../../../core/simplicity-first/SKILL.md)
- [core/surgical-changes](../../../core/surgical-changes/SKILL.md)
- [core/think-before-coding](../../../core/think-before-coding/SKILL.md)
- [languages/go/golang-testing](../golang-testing/SKILL.md)

## Source provenance

- `ecc/rules/golang/testing.md`
