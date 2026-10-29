---
name: laravel-security
description: Laravel security best practices — authentication, authorization, Eloquent safety, CSRF, XSS prevention,
  API security, and secure deployment configurations. Use when reviewing Laravel auth, Eloquent safety, CSRF, XSS,
  API security, or deployment configuration.
category: frameworks/laravel
sources:
- repository: ecc
  original_path: skills/laravel-security/SKILL.md
  sha256: 0440ddff450c63a9338f15b765ec35486f3f3266b321e0b27128faa3c29784fe
principles:
- core/think-before-coding
- core/simplicity-first
- core/surgical-changes
- core/goal-driven-execution
---

> **Library use:** Apply the [compatibility and execution contract](../../../COMPATIBILITY.md). Source roles, memory claims, command names, hooks, and integrations are instructions or prerequisites—not installed capabilities.

# Laravel Security

Laravel security best practices — authentication, authorization, Eloquent safety, CSRF, XSS prevention, API security, and secure deployment configurations. Use when reviewing Laravel auth, Eloquent safety, CSRF, XSS, API security, or deployment configuration.

## Required procedure

Read [the complete methodology](references/methodology.md) before performing this skill. It retains the full procedure, examples, constraints, and failure handling.

Procedure topics: Laravel Security Best Practices; When to Activate; Production Configuration; Essential Production Settings; Environment File Security; NEVER commit .env to version control; .gitignore already includes .env by default; Use .env.example with placeholders instead; Validate required variables at boot; HTTPS Enforcement; Authentication; Sanctum (API Token Authentication); Password Security; Session Management.

## Related skills and principles

- [backend/backend-patterns](../../../backend/backend-patterns/SKILL.md)
- [core/goal-driven-execution](../../../core/goal-driven-execution/SKILL.md)
- [core/simplicity-first](../../../core/simplicity-first/SKILL.md)
- [core/surgical-changes](../../../core/surgical-changes/SKILL.md)
- [core/think-before-coding](../../../core/think-before-coding/SKILL.md)
- [frameworks/laravel/laravel-patterns](../laravel-patterns/SKILL.md)
- [frameworks/laravel/laravel-tdd](../laravel-tdd/SKILL.md)

## Source provenance

- `ecc/skills/laravel-security/SKILL.md`
