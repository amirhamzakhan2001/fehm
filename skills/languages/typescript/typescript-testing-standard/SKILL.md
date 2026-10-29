---
name: typescript-testing-standard
description: TypeScript/JavaScript Testing. Use this standard for typescript testing standard.
category: languages/typescript
sources:
- repository: ecc
  original_path: rules/typescript/testing.md
  sha256: 92e3d02b4fff30899bc1a2af043d74941adbf3b2c0e972d2fcd2c68c9c2ea70b
principles:
- core/think-before-coding
- core/simplicity-first
- core/surgical-changes
- core/goal-driven-execution
---

> **Library use:** Apply the [compatibility and execution contract](../../../COMPATIBILITY.md). Source roles, memory claims, command names, hooks, and integrations are instructions or prerequisites—not installed capabilities.

# TypeScript/JavaScript Testing

> This file extends [common/testing.md](../../../core/common-testing-standard/SKILL.md) with TypeScript/JavaScript specific content.

## E2E Testing

Use **Playwright** as the E2E testing framework for critical user flows.

## Agent Support

- **e2e-runner** - Playwright E2E testing specialist

## Related skills and principles

- [core/goal-driven-execution](../../../core/goal-driven-execution/SKILL.md)
- [core/simplicity-first](../../../core/simplicity-first/SKILL.md)
- [core/surgical-changes](../../../core/surgical-changes/SKILL.md)
- [core/think-before-coding](../../../core/think-before-coding/SKILL.md)
- [testing/e2e-runner](../../../testing/e2e-runner/SKILL.md)

## Source provenance

- `ecc/rules/typescript/testing.md`
