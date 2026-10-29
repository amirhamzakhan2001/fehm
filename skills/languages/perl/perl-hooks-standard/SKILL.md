---
name: perl-hooks-standard
description: Perl Hooks. Use this standard for perl hooks standard.
category: languages/perl
sources:
- repository: ecc
  original_path: rules/perl/hooks.md
  sha256: a71f48f8b6068436a5b47c4f32291208ebd5d6b311b2ad1d393c1a0ad96c764d
principles:
- core/think-before-coding
- core/simplicity-first
- core/surgical-changes
- core/goal-driven-execution
---

> **Library use:** Apply the [compatibility and execution contract](../../../COMPATIBILITY.md). Source roles, memory claims, command names, hooks, and integrations are instructions or prerequisites—not installed capabilities.

# Perl Hooks

> This file extends [common/hooks.md](../../../core/common-hooks-standard/SKILL.md) with Perl-specific content.

## PostToolUse Hooks

Configure in `~/.claude/settings.json`:

- **perltidy**: Auto-format `.pl` and `.pm` files after edit
- **perlcritic**: Run lint check after editing `.pm` files

## Warnings

- Warn about `print` in non-script `.pm` files — use `say` or a logging module (e.g., `Log::Any`)

## Runtime prerequisites

See [the dependency ledger](../../../DEPENDENCIES.md) and this skill’s records in [dependencies.json](../../../dependencies.json). Native gstack/ECC CLIs, browsers, hooks, model tools, credentials, and memory stores must be available before invoking their steps. No runtime installation or execution has been performed. CSO requires its trusted helper; do not emulate that helper on the host.

## Related skills and principles

- [core/goal-driven-execution](../../../core/goal-driven-execution/SKILL.md)
- [core/simplicity-first](../../../core/simplicity-first/SKILL.md)
- [core/surgical-changes](../../../core/surgical-changes/SKILL.md)
- [core/think-before-coding](../../../core/think-before-coding/SKILL.md)

## Source provenance

- `ecc/rules/perl/hooks.md`
