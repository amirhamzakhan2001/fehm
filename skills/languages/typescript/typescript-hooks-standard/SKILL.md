---
name: typescript-hooks-standard
description: TypeScript/JavaScript Hooks. Use this standard for typescript hooks standard.
category: languages/typescript
sources:
- repository: ecc
  original_path: rules/typescript/hooks.md
  sha256: 930bbe5d5a66e0022a55c87d5a17765d1633669620f9a3be6815f3ab4ddcd6b4
principles:
- core/think-before-coding
- core/simplicity-first
- core/surgical-changes
- core/goal-driven-execution
---

> **Library use:** Apply the [compatibility and execution contract](../../../COMPATIBILITY.md). Source roles, memory claims, command names, hooks, and integrations are instructions or prerequisites—not installed capabilities.

# TypeScript/JavaScript Hooks

> This file extends [common/hooks.md](../../../core/common-hooks-standard/SKILL.md) with TypeScript/JavaScript specific content.

## PostToolUse Hooks

Configure in `~/.claude/settings.json`:

- **Prettier**: Auto-format JS/TS files after edit
- **TypeScript check**: Run `tsc` after editing `.ts`/`.tsx` files
- **console.log warning**: Warn about `console.log` in edited files

## Stop Hooks

- **console.log audit**: Check all modified files for `console.log` before session ends

## Runtime prerequisites

See [the dependency ledger](../../../DEPENDENCIES.md) and this skill’s records in [dependencies.json](../../../dependencies.json). Native gstack/ECC CLIs, browsers, hooks, model tools, credentials, and memory stores must be available before invoking their steps. No runtime installation or execution has been performed. CSO requires its trusted helper; do not emulate that helper on the host.

## Related skills and principles

- [core/goal-driven-execution](../../../core/goal-driven-execution/SKILL.md)
- [core/simplicity-first](../../../core/simplicity-first/SKILL.md)
- [core/surgical-changes](../../../core/surgical-changes/SKILL.md)
- [core/think-before-coding](../../../core/think-before-coding/SKILL.md)

## Source provenance

- `ecc/rules/typescript/hooks.md`
