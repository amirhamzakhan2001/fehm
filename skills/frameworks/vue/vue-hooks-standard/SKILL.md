---
name: vue-hooks-standard
description: Vue Hooks. Use this standard for vue hooks standard.
category: frameworks/vue
sources:
- repository: ecc
  original_path: rules/vue/hooks.md
  sha256: f73294ea23030ded563f2907996f5bb53d9b297eb152d3e866be25ba00adaef8
principles:
- core/think-before-coding
- core/simplicity-first
- core/surgical-changes
- core/goal-driven-execution
---

> **Library use:** Apply the [compatibility and execution contract](../../../COMPATIBILITY.md). Source roles, memory claims, command names, hooks, and integrations are instructions or prerequisites—not installed capabilities.

# Vue Hooks

> This file extends [common/hooks.md](../../../core/common-hooks-standard/SKILL.md) with Vue specific content.

## PostToolUse Targets

Run on `*.vue`, `*.ts`, and `*.tsx` after edits. Scope to changed files where possible.

## Typecheck

- Use `vue-tsc --noEmit` for SFC plus TypeScript checking. Plain `tsc` cannot read `.vue` single-file components, so it must not be the typecheck hook for this project.
- Typecheck is project-wide. Debounce or scope it so a save-on-every-keystroke loop does not stall the editor.

## Lint and Format

- `eslint --fix` with `eslint-plugin-vue` (flat-config `vue/vue3-recommended`) covers both template and script lint.
- `prettier --write` for formatting. Prefer Prettier-via-ESLint over a separate Prettier pass to avoid double formatting and fight loops.

## Architecture Boundaries

- Optional: enforce Feature-Sliced Design slice boundaries with `@feature-sliced/steiger` or `eslint-plugin-boundaries` to block deep cross-slice imports.

## Sequencing

```bash
# changed files only
eslint --fix "$FILE"
prettier --write "$FILE"
# project-wide, debounced
vue-tsc --noEmit
```

- Run lint and format per-file first, then the project-wide typecheck last so type errors reflect the formatted source.

## Reference

- ECC skills: `frontend-patterns`, `vite-patterns`.
- Docs: <https://github.com/vuejs/language-tools> (vue-tsc) · <https://eslint.vuejs.org/> · <https://github.com/feature-sliced/steiger>

## Related skills and principles

- [core/goal-driven-execution](../../../core/goal-driven-execution/SKILL.md)
- [core/simplicity-first](../../../core/simplicity-first/SKILL.md)
- [core/surgical-changes](../../../core/surgical-changes/SKILL.md)
- [core/think-before-coding](../../../core/think-before-coding/SKILL.md)
- [frameworks/vite/vite-patterns](../../vite/vite-patterns/SKILL.md)
- [frontend/frontend-patterns](../../../frontend/frontend-patterns/SKILL.md)

## Source provenance

- `ecc/rules/vue/hooks.md`
