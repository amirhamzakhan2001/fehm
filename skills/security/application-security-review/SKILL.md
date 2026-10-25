---
name: application-security-review
description: Use this skill when adding authentication, handling user input, working with secrets, creating API
  endpoints, or implementing payment/sensitive features. Provides comprehensive security checklist and patterns.
category: security
sources:
- repository: ecc
  original_path: skills/security-review/SKILL.md
  sha256: b9eb6416eebc8dda046674f0a2dbb3be88aff526d182b60a0f55998d3d6d0d8d
principles:
- core/think-before-coding
- core/simplicity-first
- core/surgical-changes
- core/goal-driven-execution
---

> **Library use:** Apply the [compatibility and execution contract](../../COMPATIBILITY.md). Source roles, memory claims, command names, hooks, and integrations are instructions or prerequisites—not installed capabilities.

# Application Security Review

Use this skill when adding authentication, handling user input, working with secrets, creating API endpoints, or implementing payment/sensitive features. Provides comprehensive security checklist and patterns.

## Required procedure

Read [the complete methodology](references/methodology.md) before performing this skill. It retains the full procedure, examples, constraints, and failure handling.

Procedure topics: Security Review Skill; When to Activate; Security Checklist; 1. Secrets Management; 2. Input Validation; 3. SQL Injection Prevention; 4. Authentication & Authorization; 5. XSS Prevention; 6. CSRF Protection; 7. Rate Limiting; 8. Sensitive Data Exposure; 9. Blockchain Security (Solana); 10. Dependency Security; Check for vulnerabilities.

## Supporting material

See the [selective resource index](references/INDEX.md) for checklists, templates, examples, and reference implementations.

## Related skills and principles

- [core/goal-driven-execution](../../core/goal-driven-execution/SKILL.md)
- [core/simplicity-first](../../core/simplicity-first/SKILL.md)
- [core/surgical-changes](../../core/surgical-changes/SKILL.md)
- [core/think-before-coding](../../core/think-before-coding/SKILL.md)

## Source provenance

- `ecc/skills/security-review/SKILL.md`
