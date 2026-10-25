---
name: ruby-patterns-standard
description: Ruby Patterns. Use this standard for ruby patterns standard.
category: languages/ruby
sources:
- repository: ecc
  original_path: rules/ruby/patterns.md
  sha256: 93060ad41a3f84daeceb05333e35fb84cf5982f39251f9f6d17fedb090988721
principles:
- core/think-before-coding
- core/simplicity-first
- core/surgical-changes
- core/goal-driven-execution
---

> **Library use:** Apply the [compatibility and execution contract](../../../COMPATIBILITY.md). Source roles, memory claims, command names, hooks, and integrations are instructions or prerequisites—not installed capabilities.

# Ruby Patterns

> This file extends [common/patterns.md](../../../core/common-patterns-standard/SKILL.md) with Ruby and Rails specific content.

## Rails Way First

- Start with plain Rails MVC and Active Record conventions for small and medium features.
- Introduce service objects, query objects, form objects, decorators, or presenters when the model/controller boundary is carrying multiple responsibilities.
- Name extracted objects after the business operation they perform, not after generic layers like `Manager` or `Processor`.

## Persistence

- Prefer PostgreSQL for multi-host production Rails apps unless the existing platform has a clear reason for MySQL or SQLite.
- Treat Rails 8 SQLite-backed defaults as viable for single-host or modest deployments, not as an automatic fit for shared multi-service systems.
- Keep raw SQL behind query objects or model scopes and parameterize every dynamic value.

## Background Jobs And Runtime Services

- Use **Solid Queue** for greenfield Rails 8 apps with modest throughput and simple deployment needs.
- Use **Sidekiq** when the app needs mature observability, high throughput, existing Redis infrastructure, or Pro/Enterprise features.
- Use **Solid Cache** and **Solid Cable** when their deployment model matches the app; use Redis when shared cross-service behavior, high fanout, or advanced data structures matter.

## Frontend

- Prefer **Hotwire** with Turbo, Stimulus, Importmap, and Propshaft for server-rendered Rails apps.
- Use React, Vue, Inertia.js, or a separate SPA when interaction complexity, existing product architecture, or team ownership justifies the extra client surface.
- Keep view components, partials, and presenters focused on rendering decisions; keep persistence and authorization out of templates.

## Authentication

- Use the Rails 8 authentication generator for straightforward session auth and password reset needs.
- Use Devise or another established auth system when requirements include OAuth, MFA, confirmable/lockable flows, multi-model auth, or a large existing Devise footprint.

## Reference

See skill: `backend-patterns` for service boundaries and adapter patterns.

## Related skills and principles

- [backend/backend-patterns](../../../backend/backend-patterns/SKILL.md)
- [core/goal-driven-execution](../../../core/goal-driven-execution/SKILL.md)
- [core/simplicity-first](../../../core/simplicity-first/SKILL.md)
- [core/surgical-changes](../../../core/surgical-changes/SKILL.md)
- [core/think-before-coding](../../../core/think-before-coding/SKILL.md)

## Source provenance

- `ecc/rules/ruby/patterns.md`
