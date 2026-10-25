---
name: vue-security-standard
description: Vue Security. Use this standard for vue security standard.
category: frameworks/vue
sources:
- repository: ecc
  original_path: rules/vue/security.md
  sha256: 4f2abdce6ac21dfd3afb9b4e847ac4496a7896c169cf42083bfdd7c360601ca6
principles:
- core/think-before-coding
- core/simplicity-first
- core/surgical-changes
- core/goal-driven-execution
---

> **Library use:** Apply the [compatibility and execution contract](../../../COMPATIBILITY.md). Source roles, memory claims, command names, hooks, and integrations are instructions or prerequisites—not installed capabilities.

# Vue Security

> This file extends [common/security.md](../../../core/common-security-standard/SKILL.md) with Vue specific content.

## What Vue Escapes Automatically

- Text interpolation `{{ }}` and dynamic attribute bindings (`:title`) are auto-escaped. The vectors below are NOT protected.

## Rule No.1: Templates from Trusted Sources Only

- Never use non-trusted content as a component template. No runtime template compilation from user input.
- No user-controlled `:is` that resolves a component from an arbitrary string.

## v-html and Render Functions

- `v-html` bypasses escaping and is a direct XSS vector. Avoid it on user content.
- If unavoidable, sanitize with DOMPurify (allowlist config) before binding, or render in a sandboxed iframe. Vue itself recommends sanitizing on the backend before persisting.
- Render-function and scoped-slot output carry the same risk. Passing user HTML through `h()` with `innerHTML` is `v-html` by another name. Sanitize first.

## URL, Style, and Event Injection

- `:href` and `:src` are not escaped. `javascript:` URLs execute. Validate the scheme, allow `http` / `https` / `mailto` only. Vue docs reference `@braintree/sanitize-url`, but sanitize on the backend before persisting.
- `:style` with user input is unsafe (CSS exfiltration). Use object syntax with whitelisted properties, never a raw user string.
- Never bind user input to `onclick`, `onfocus`, or any event attribute.

## Client Bundle Secrets

- Anything in `import.meta.env.VITE_*` ships to the browser. Keep API keys and tokens server-side.
- Use httpOnly cookies for session tokens. Never bundle credentials into the client.

```vue
<!-- unsafe -->
<div v-html="userBio" />
<!-- safe -->
<div v-html="sanitize(userBio)" />
```

## Reference

- ECC skills: `frontend-patterns`, `vite-patterns`.
- Docs: <https://vuejs.org/guide/best-practices/security.html> · <https://github.com/cure53/DOMPurify> · <https://github.com/braintree/sanitize-url>

## Related skills and principles

- [core/goal-driven-execution](../../../core/goal-driven-execution/SKILL.md)
- [core/simplicity-first](../../../core/simplicity-first/SKILL.md)
- [core/surgical-changes](../../../core/surgical-changes/SKILL.md)
- [core/think-before-coding](../../../core/think-before-coding/SKILL.md)
- [frameworks/vite/vite-patterns](../../vite/vite-patterns/SKILL.md)
- [frontend/frontend-patterns](../../../frontend/frontend-patterns/SKILL.md)

## Source provenance

- `ecc/rules/vue/security.md`
