---
name: django-security
description: Django security best practices, authentication, authorization, CSRF protection, SQL injection prevention,
  XSS prevention, and secure deployment configurations. Use when reviewing Django authentication, authorization,
  input handling, or deployment settings.
category: frameworks/django
sources:
- repository: ecc
  original_path: skills/django-security/SKILL.md
  sha256: e043c9d300695aea5a9bb4c72a6f47e47ba1f2c7ddc1e82b8191acd0ad70c54a
principles:
- core/think-before-coding
- core/simplicity-first
- core/surgical-changes
- core/goal-driven-execution
---

> **Library use:** Apply the [compatibility and execution contract](../../../COMPATIBILITY.md). Source roles, memory claims, command names, hooks, and integrations are instructions or prerequisites—not installed capabilities.

# Django Security

Django security best practices, authentication, authorization, CSRF protection, SQL injection prevention, XSS prevention, and secure deployment configurations. Use when reviewing Django authentication, authorization, input handling, or deployment settings.

## Required procedure

Read [the complete methodology](references/methodology.md) before performing this skill. It retains the full procedure, examples, constraints, and failure handling.

Procedure topics: Django Security Best Practices; When to Activate; Core Security Settings; Production Settings Configuration; settings/production.py; Security headers; HTTPS and Cookies; Secret key (must be set via environment variable); Password validation; Authentication; Custom User Model; apps/users/models.py; settings/base.py; Password Hashing.

## Related skills and principles

- [core/goal-driven-execution](../../../core/goal-driven-execution/SKILL.md)
- [core/simplicity-first](../../../core/simplicity-first/SKILL.md)
- [core/surgical-changes](../../../core/surgical-changes/SKILL.md)
- [core/think-before-coding](../../../core/think-before-coding/SKILL.md)

## Source provenance

- `ecc/skills/django-security/SKILL.md`
