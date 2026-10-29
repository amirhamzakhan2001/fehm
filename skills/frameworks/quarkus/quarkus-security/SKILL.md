---
name: quarkus-security
description: Quarkus Security best practices for authentication, authorization, JWT/OIDC, RBAC, input validation,
  CSRF, secrets management, and dependency security. Use when reviewing Quarkus authn/authz, JWT or OIDC, RBAC,
  validation, or secrets.
category: frameworks/quarkus
sources:
- repository: ecc
  original_path: skills/quarkus-security/SKILL.md
  sha256: 61e25b00d47d64f0685219988c2605c95a87146bfe0bbb52f1a28d877456d07f
principles:
- core/think-before-coding
- core/simplicity-first
- core/surgical-changes
- core/goal-driven-execution
---

> **Library use:** Apply the [compatibility and execution contract](../../../COMPATIBILITY.md). Source roles, memory claims, command names, hooks, and integrations are instructions or prerequisites—not installed capabilities.

# Quarkus Security

Quarkus Security best practices for authentication, authorization, JWT/OIDC, RBAC, input validation, CSRF, secrets management, and dependency security. Use when reviewing Quarkus authn/authz, JWT or OIDC, RBAC, validation, or secrets.

## Required procedure

Read [the complete methodology](references/methodology.md) before performing this skill. It retains the full procedure, examples, constraints, and failure handling.

Procedure topics: Quarkus Security Review; When to Activate; Authentication; JWT Authentication; OIDC; Custom Authentication Filter; Authorization; Role-Based Access Control; Programmatic Security; Input Validation; Bean Validation; Custom Validators; SQL Injection Prevention; Panache Active Record (Safe by Default).

## Related skills and principles

- [core/goal-driven-execution](../../../core/goal-driven-execution/SKILL.md)
- [core/simplicity-first](../../../core/simplicity-first/SKILL.md)
- [core/surgical-changes](../../../core/surgical-changes/SKILL.md)
- [core/think-before-coding](../../../core/think-before-coding/SKILL.md)

## Source provenance

- `ecc/skills/quarkus-security/SKILL.md`
