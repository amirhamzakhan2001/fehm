---
name: php-patterns-standard
description: PHP Patterns. Use this standard for php patterns standard.
category: languages/php
sources:
- repository: ecc
  original_path: rules/php/patterns.md
  sha256: f370b0af1e12d067fb4263ad829f62fedbc37e6e9aedf698d3939b6ee69cd1ea
principles:
- core/think-before-coding
- core/simplicity-first
- core/surgical-changes
- core/goal-driven-execution
---

> **Library use:** Apply the [compatibility and execution contract](../../../COMPATIBILITY.md). Source roles, memory claims, command names, hooks, and integrations are instructions or prerequisites—not installed capabilities.

# PHP Patterns

> This file extends [common/patterns.md](../../../core/common-patterns-standard/SKILL.md) with PHP specific content.

## Thin Controllers, Explicit Services

- Keep controllers focused on transport: auth, validation, serialization, status codes.
- Move business rules into application/domain services that are easy to test without HTTP bootstrapping.

## DTOs and Value Objects

- Replace shape-heavy associative arrays with DTOs for requests, commands, and external API payloads.
- Use value objects for money, identifiers, date ranges, and other constrained concepts.

## Dependency Injection

- Depend on interfaces or narrow service contracts, not framework globals.
- Pass collaborators through constructors so services are testable without service-locator lookups.

## Boundaries

- Isolate ORM models from domain decisions when the model layer is doing more than persistence.
- Wrap third-party SDKs behind small adapters so the rest of the codebase depends on your contract, not theirs.

## Reference

See skill: `api-design` for endpoint conventions and response-shape guidance.
See skill: `laravel-patterns` for Laravel-specific architecture guidance.

## Related skills and principles

- [backend/api-design](../../../backend/api-design/SKILL.md)
- [core/goal-driven-execution](../../../core/goal-driven-execution/SKILL.md)
- [core/simplicity-first](../../../core/simplicity-first/SKILL.md)
- [core/surgical-changes](../../../core/surgical-changes/SKILL.md)
- [core/think-before-coding](../../../core/think-before-coding/SKILL.md)
- [frameworks/laravel/laravel-patterns](../../../frameworks/laravel/laravel-patterns/SKILL.md)

## Source provenance

- `ecc/rules/php/patterns.md`
