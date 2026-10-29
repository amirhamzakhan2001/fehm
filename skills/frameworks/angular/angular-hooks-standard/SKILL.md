---
name: angular-hooks-standard
description: Angular Hooks. Use this standard for angular hooks standard.
category: frameworks/angular
sources:
- repository: ecc
  original_path: rules/angular/hooks.md
  sha256: 321620abd2771d766149f5d38edc6b0f6a70fc49cdf4467bf3d81985668fa088
principles:
- core/think-before-coding
- core/simplicity-first
- core/surgical-changes
- core/goal-driven-execution
---

> **Library use:** Apply the [compatibility and execution contract](../../../COMPATIBILITY.md). Source roles, memory claims, command names, hooks, and integrations are instructions or prerequisites—not installed capabilities.

# Angular Hooks

> This file extends [common/hooks.md](../../../core/common-hooks-standard/SKILL.md) with Angular specific content.

## PostToolUse Hooks

Configure in `~/.claude/settings.json`:

- **Prettier**: Auto-format `.ts` and `.html` files after edit
- **ESLint / ng lint**: Run `ng lint` after editing Angular source files to catch decorator misuse, template errors, and style violations
- **TypeScript check**: Run `tsc --noEmit` after editing `.ts` files
- **Build check**: Run `ng build` after generating or significantly changing Angular code to catch template and type errors early

## Stop Hooks

- **Lint audit**: Run `ng lint` across modified files before session ends to catch any outstanding violations

## Runtime prerequisites

See [the dependency ledger](../../../DEPENDENCIES.md) and this skill’s records in [dependencies.json](../../../dependencies.json). Native gstack/ECC CLIs, browsers, hooks, model tools, credentials, and memory stores must be available before invoking their steps. No runtime installation or execution has been performed. CSO requires its trusted helper; do not emulate that helper on the host.

## Related skills and principles

- [core/goal-driven-execution](../../../core/goal-driven-execution/SKILL.md)
- [core/simplicity-first](../../../core/simplicity-first/SKILL.md)
- [core/surgical-changes](../../../core/surgical-changes/SKILL.md)
- [core/think-before-coding](../../../core/think-before-coding/SKILL.md)

## Source provenance

- `ecc/rules/angular/hooks.md`
