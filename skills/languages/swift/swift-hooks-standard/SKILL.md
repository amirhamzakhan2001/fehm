---
name: swift-hooks-standard
description: Swift Hooks. Use this standard for swift hooks standard.
category: languages/swift
sources:
- repository: ecc
  original_path: rules/swift/hooks.md
  sha256: 654da388192df405927c5e4cea2f588d01cd349ba7ba30a813a4aa7c3d3a4661
principles:
- core/think-before-coding
- core/simplicity-first
- core/surgical-changes
- core/goal-driven-execution
---

> **Library use:** Apply the [compatibility and execution contract](../../../COMPATIBILITY.md). Source roles, memory claims, command names, hooks, and integrations are instructions or prerequisites—not installed capabilities.

# Swift Hooks

> This file extends [common/hooks.md](../../../core/common-hooks-standard/SKILL.md) with Swift specific content.

## PostToolUse Hooks

Configure in `~/.claude/settings.json`:

- **SwiftFormat**: Auto-format `.swift` files after edit
- **SwiftLint**: Run lint checks after editing `.swift` files
- **swift build**: Type-check modified packages after edit

## Warning

Flag `print()` statements — use `os.Logger` or structured logging instead for production code.

## Runtime prerequisites

See [the dependency ledger](../../../DEPENDENCIES.md) and this skill’s records in [dependencies.json](../../../dependencies.json). Native gstack/ECC CLIs, browsers, hooks, model tools, credentials, and memory stores must be available before invoking their steps. No runtime installation or execution has been performed. CSO requires its trusted helper; do not emulate that helper on the host.

## Related skills and principles

- [core/goal-driven-execution](../../../core/goal-driven-execution/SKILL.md)
- [core/simplicity-first](../../../core/simplicity-first/SKILL.md)
- [core/surgical-changes](../../../core/surgical-changes/SKILL.md)
- [core/think-before-coding](../../../core/think-before-coding/SKILL.md)

## Source provenance

- `ecc/rules/swift/hooks.md`
