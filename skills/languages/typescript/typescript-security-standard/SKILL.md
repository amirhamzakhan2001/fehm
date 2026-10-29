---
name: typescript-security-standard
description: TypeScript/JavaScript Security. Use this standard for typescript security standard.
category: languages/typescript
sources:
- repository: ecc
  original_path: rules/typescript/security.md
  sha256: 86b14a5a56f4e61750ab30ca50bd264f52f90f5358303f3028d41030a4c50f18
principles:
- core/think-before-coding
- core/simplicity-first
- core/surgical-changes
- core/goal-driven-execution
---

> **Library use:** Apply the [compatibility and execution contract](../../../COMPATIBILITY.md). Source roles, memory claims, command names, hooks, and integrations are instructions or prerequisites—not installed capabilities.

# TypeScript/JavaScript Security

> This file extends [common/security.md](../../../core/common-security-standard/SKILL.md) with TypeScript/JavaScript specific content.

## Secret Management

```typescript
// NEVER: Hardcoded secrets
const apiKey = "sk-proj-xxxxx"

// ALWAYS: Environment variables
const apiKey = process.env.API_KEY

if (!apiKey) {
  throw new Error('API_KEY not configured')
}
```

## Agent Support

- Use **security-reviewer** skill for comprehensive security audits

## Related skills and principles

- [core/goal-driven-execution](../../../core/goal-driven-execution/SKILL.md)
- [core/simplicity-first](../../../core/simplicity-first/SKILL.md)
- [core/surgical-changes](../../../core/surgical-changes/SKILL.md)
- [core/think-before-coding](../../../core/think-before-coding/SKILL.md)
- [security/security-reviewer](../../../security/security-reviewer/SKILL.md)

## Source provenance

- `ecc/rules/typescript/security.md`
