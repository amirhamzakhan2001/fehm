---
name: nuxt-testing-standard
description: Nuxt Testing. Use this standard for nuxt testing standard.
category: frameworks/nuxt
sources:
- repository: ecc
  original_path: rules/nuxt/testing.md
  sha256: 2c1c9fd0006083515eb8ace54007602f1091df0b0fa35ff5d231ba64109cecbc
principles:
- core/think-before-coding
- core/simplicity-first
- core/surgical-changes
- core/goal-driven-execution
---

> **Library use:** Apply the [compatibility and execution contract](../../../COMPATIBILITY.md). Source roles, memory claims, command names, hooks, and integrations are instructions or prerequisites—not installed capabilities.

# Nuxt Testing

> This file extends [common/testing.md](../../../core/common-testing-standard/SKILL.md) with Nuxt specific content.

Package: `@nuxt/test-utils`. Vitest-first for unit and component tests, with built-in Playwright browser E2E support. nuxt-vitest and vitest-environment-nuxt are superseded and folded into it.

## Setup

- Install dev deps: `@nuxt/test-utils vitest @vue/test-utils happy-dom playwright-core`.
- Config: `defineVitestConfig({ test: { environment: 'nuxt' } })` from `@nuxt/test-utils/config`. Use `defineVitestProject` for multi-project (separate unit / nuxt / e2e environments).
- Add `@nuxt/test-utils/module` to `nuxt.config`. Per-file opt-in via `// @vitest-environment nuxt`.

## Runtime helpers

Import from `@nuxt/test-utils/runtime`.

- `mountSuspended(component, opts)` mounts in the Nuxt env with async setup + plugin injection (accepts `@vue/test-utils` mount options + `route`).
- `renderSuspended(component, opts)` is the Testing Library variant (needs `@testing-library/vue`).
- `mockNuxtImport(name, factory)` mocks auto-imports (e.g. `useState`). Once per import per file, use `vi.hoisted()`.
- `mockComponent(name, factory)` mocks by PascalCase name or path.
- `registerEndpoint(path, handler|opts)` mocks a Nitro endpoint to test server routes or stub the backend. Supports method + `once`.

## E2E helpers

Import from `@nuxt/test-utils/e2e`.

- `await setup({ rootDir, server, browser, ... })` inside the describe block (manages beforeAll/afterAll).
- Then `$fetch(url)` (rendered HTML), `fetch(url)` (response object), `url(path)` (full URL with port), `createPage(url)` (Playwright).
- Playwright integration: import `expect` / `test` from `@nuxt/test-utils/playwright`.

## What to test how

- Composables: mock auto-imports with `mockNuxtImport`, mount a host component via `mountSuspended` to exercise `useState` / `useFetch` in the Nuxt runtime.
- Server routes: `registerEndpoint` to stub, or e2e `$fetch` / `fetch` against the real Nitro server.

## Reference

- ECC skills: `nuxt4-patterns`, `e2e-testing`, `vite-patterns`.
- [Nuxt testing docs](https://nuxt.com/docs/getting-started/testing)
- [@nuxt/test-utils npm](https://www.npmjs.com/package/@nuxt/test-utils)

## Related skills and principles

- [core/goal-driven-execution](../../../core/goal-driven-execution/SKILL.md)
- [core/simplicity-first](../../../core/simplicity-first/SKILL.md)
- [core/surgical-changes](../../../core/surgical-changes/SKILL.md)
- [core/think-before-coding](../../../core/think-before-coding/SKILL.md)
- [frameworks/nuxt/nuxt4-patterns](../nuxt4-patterns/SKILL.md)
- [frameworks/vite/vite-patterns](../../vite/vite-patterns/SKILL.md)
- [testing/e2e-testing](../../../testing/e2e-testing/SKILL.md)

## Source provenance

- `ecc/rules/nuxt/testing.md`
