---
name: nuxt-patterns-standard
description: Nuxt Patterns. Use this standard for nuxt patterns standard.
category: frameworks/nuxt
sources:
- repository: ecc
  original_path: rules/nuxt/patterns.md
  sha256: 752177f220353824ae7c7a6eb9ecaa9e2638bb20233fcb8cb37d1bad0bbc79d2
principles:
- core/think-before-coding
- core/simplicity-first
- core/surgical-changes
- core/goal-driven-execution
---

> **Library use:** Apply the [compatibility and execution contract](../../../COMPATIBILITY.md). Source roles, memory claims, command names, hooks, and integrations are instructions or prerequisites—not installed capabilities.

# Nuxt Patterns

> This file extends [common/patterns.md](../../../core/common-patterns-standard/SKILL.md) with Nuxt specific content.

## Data-fetch selection

Load-bearing. Pick by render timing, not habit.

- `useFetch(url)` = SSR-safe, URL-first initial/first-paint data. The default. Forwards the server result through the payload so there is no hydration double-fetch.
- `useAsyncData(key, fn)` = SSR-safe, custom async logic (SDK / GraphQL / combined calls). The explicit key shares the result across components.
- `$fetch` = client interactions only (form submit, button click, POST/PUT/DELETE). NOT SSR-safe, double-fetches if used for first paint.
- Rule: `useFetch` / `useAsyncData` for anything rendered on first paint, `$fetch` only for event-driven mutations.

## Shared state

- `useState('key', () => init)` for SSR-safe shared state. Values must be JSON-serializable.
- NEVER `export const x = ref()` at module scope. One shared instance leaks across concurrent SSR requests and causes a memory leak.
- With `@pinia/nuxt`: Pinia for domain state, `useState` for small cross-component primitives.
- Async server-side init goes in `callOnce(async () => {...})`, not as a side effect inside `useAsyncData`.

## Nitro server routes

- `server/api/*.{get,post}.ts` auto-register by path + method. Handler is `defineEventHandler((event) => ...)`.
- Errors via `throw createError({ status, statusText })`. Prefer the Web-API `status` / `statusText` over deprecated `statusCode` / `statusMessage`.
- `server/middleware/` must NOT return a response. Only mutate `event.context` or set headers.

## Route middleware

- `app/middleware/*.ts` with `defineNuxtRouteMiddleware((to, from) => ...)`.
- Use the `to` / `from` args. Do NOT call `useRoute()` inside middleware.
- `.global` suffix runs on every route. Return `navigateTo()` to redirect, `abortNavigation()` to stop.

## Hydration-safe rendering

- Route off `status` (`idle | pending | success | error`) for lazy fetches.
- `useAsyncData` payload uses `devalue` (Date/Map/Set/refs survive). A `server/api` response is `JSON.stringify`-only, so define `toJSON()` for non-JSON types.
- Shrink payload with `pick` / `transform`. This reduces serialized size, it does not skip the fetch.

## Reference

- ECC skills: `nuxt4-patterns`, `vite-patterns`, `frontend-patterns`.
- [Nuxt data fetching](https://nuxt.com/docs/getting-started/data-fetching)
- [Nuxt state management](https://nuxt.com/docs/getting-started/state-management)
- [Nuxt server engine (Nitro)](https://nuxt.com/docs/guide/directory-structure/server)

## Related skills and principles

- [core/goal-driven-execution](../../../core/goal-driven-execution/SKILL.md)
- [core/simplicity-first](../../../core/simplicity-first/SKILL.md)
- [core/surgical-changes](../../../core/surgical-changes/SKILL.md)
- [core/think-before-coding](../../../core/think-before-coding/SKILL.md)
- [frameworks/nuxt/nuxt4-patterns](../nuxt4-patterns/SKILL.md)
- [frameworks/vite/vite-patterns](../../vite/vite-patterns/SKILL.md)
- [frontend/frontend-patterns](../../../frontend/frontend-patterns/SKILL.md)

## Source provenance

- `ecc/rules/nuxt/patterns.md`
