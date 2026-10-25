---
name: common-security-standard
description: Security Guidelines. Use this standard for common security standard.
category: core
sources:
- repository: ecc
  original_path: rules/common/security.md
  sha256: 58f0acc56331b8d554dd036b8a1d5b2305a908e3960ff1e2d7e55223d5918bc3
principles:
- core/think-before-coding
- core/simplicity-first
- core/surgical-changes
- core/goal-driven-execution
---

> **Library use:** Apply the [compatibility and execution contract](../../COMPATIBILITY.md). Source roles, memory claims, command names, hooks, and integrations are instructions or prerequisites—not installed capabilities.

# Security Guidelines

## Mandatory Security Checks

Before ANY commit:
- [ ] No hardcoded secrets (API keys, passwords, tokens)
- [ ] All user inputs validated
- [ ] SQL injection prevention (parameterized queries)
- [ ] XSS prevention (sanitized HTML)
- [ ] CSRF protection enabled
- [ ] Authentication/authorization verified
- [ ] Rate limiting on all endpoints
- [ ] Error messages don't leak sensitive data

## Secret Management

- NEVER hardcode secrets in source code
- ALWAYS use environment variables or a secret manager
- Validate that required secrets are present at startup
- Rotate any secrets that may have been exposed

## Security Response Protocol

If security issue found:
1. STOP immediately
2. Use **security-reviewer** agent
3. Fix CRITICAL issues before continuing
4. Rotate any exposed secrets
5. Review entire codebase for similar issues

## Related skills and principles

- [core/goal-driven-execution](../goal-driven-execution/SKILL.md)
- [core/simplicity-first](../simplicity-first/SKILL.md)
- [core/surgical-changes](../surgical-changes/SKILL.md)
- [core/think-before-coding](../think-before-coding/SKILL.md)
- [security/security-reviewer](../../security/security-reviewer/SKILL.md)

## Source provenance

- `ecc/rules/common/security.md`
