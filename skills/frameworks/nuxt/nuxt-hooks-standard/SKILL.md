---
name: nuxt-hooks-standard
description: Nuxt Hooks. Use this standard for nuxt hooks standard.
category: frameworks/nuxt
sources:
- repository: ecc
  original_path: rules/nuxt/hooks.md
  sha256: ccfc501f38cc67d82d3aaf646f1aa97d7d09eee907e31679027c99abb3b18872
principles:
- core/think-before-coding
- core/simplicity-first
- core/surgical-changes
- core/goal-driven-execution
---

> **Library use:** Apply the [compatibility and execution contract](../../../COMPATIBILITY.md). Source roles, memory claims, command names, hooks, and integrations are instructions or prerequisites—not installed capabilities.

# Nuxt Hooks

> This file extends [common/hooks.md](../../../core/common-hooks-standard/SKILL.md) with Nuxt specific content.

These are Claude Code harness hooks for Nuxt work. They run via the harness, not Claude.

## Typecheck

- `nuxi typecheck` wraps `vue-tsc`. Requires `vue-tsc` + `typescript` dev deps.
- Run on `.vue` / `.ts` edit or pre-commit. Typecheck is project-wide, so debounce it and wrap it in a timeout (mirror `web/hooks.md`, for example `timeout 60 nuxi typecheck`) so a hung type-check is reaped instead of accumulating across fast edits.

## Lint

- Use the `@nuxt/eslint` module (flat-config, project-aware, generates `.nuxt/eslint.config.mjs`).
- Run `eslint .` or `eslint --fix`. This is the Nuxt-official ESLint integration, prefer it over hand-rolled configs.

## Format

- `prettier --write`, or enable stylistic rules in `@nuxt/eslint` to avoid a Prettier/ESLint conflict.
- Pick one formatting authority. Do not run both Prettier and ESLint stylistic at once.

## Suggested PostToolUse chain

- On Edit to `app/**` and `server/**`: run `eslint --fix` then `timeout 60 nuxi typecheck`.
- Order matters: lint-fix first (mutates the file), the timed typecheck second (verifies the result). Debouncing still applies.

## Reference

- ECC skills: `nuxt4-patterns`, `vite-patterns`.
- [@nuxt/eslint module](https://eslint.nuxt.com/)
- [nuxi typecheck](https://nuxt.com/docs/api/commands/typecheck)

## Related skills and principles

- [core/goal-driven-execution](../../../core/goal-driven-execution/SKILL.md)
- [core/simplicity-first](../../../core/simplicity-first/SKILL.md)
- [core/surgical-changes](../../../core/surgical-changes/SKILL.md)
- [core/think-before-coding](../../../core/think-before-coding/SKILL.md)
- [frameworks/nuxt/nuxt4-patterns](../nuxt4-patterns/SKILL.md)
- [frameworks/vite/vite-patterns](../../vite/vite-patterns/SKILL.md)

## Source provenance

- `ecc/rules/nuxt/hooks.md`
