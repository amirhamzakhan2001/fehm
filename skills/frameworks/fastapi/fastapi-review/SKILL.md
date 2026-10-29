---
name: fastapi-review
description: Review a FastAPI application for architecture, async correctness, dependency injection, Pydantic schemas,
  security, performance, and testability.
category: frameworks/fastapi
sources:
- repository: ecc
  original_path: commands/fastapi-review.md
  sha256: 758f6c55befc3255e5b1c1dc6df41453b21543a93b6aa9df0fb1be9e334831a8
principles:
- core/think-before-coding
- core/simplicity-first
- core/surgical-changes
- core/goal-driven-execution
---

> **Library use:** Apply the [compatibility and execution contract](../../../COMPATIBILITY.md). Source roles, memory claims, command names, hooks, and integrations are instructions or prerequisites—not installed capabilities.

# FastAPI Review

Invoke the `fastapi-reviewer` agent for a focused FastAPI review.

## Usage

```text
/fastapi-review [file-or-directory]
```

## Review Areas

- App factory, router boundaries, middleware, and exception handlers.
- Pydantic request and response schema separation.
- Dependency injection for database sessions, auth, pagination, and settings.
- Async database and external HTTP patterns.
- CORS, auth, rate limits, logging, and secret handling.
- OpenAPI metadata and documented response models.
- Test client setup and dependency overrides.

## Expected Output

```text
[SEVERITY] Short issue title
File: path/to/file.py:42
Issue: What is wrong and why it matters.
Fix: Concrete change to make.
```

## Related

- Agent: `fastapi-reviewer`
- Skill: `fastapi-patterns`
- Command: `/python-review`
- Skill: `security-scan`

## Related skills and principles

- [core/goal-driven-execution](../../../core/goal-driven-execution/SKILL.md)
- [core/simplicity-first](../../../core/simplicity-first/SKILL.md)
- [core/surgical-changes](../../../core/surgical-changes/SKILL.md)
- [core/think-before-coding](../../../core/think-before-coding/SKILL.md)
- [frameworks/fastapi/fastapi-patterns](../fastapi-patterns/SKILL.md)
- [frameworks/fastapi/fastapi-reviewer](../fastapi-reviewer/SKILL.md)
- [languages/python/python-review](../../../languages/python/python-review/SKILL.md)
- [security/security-scan](../../../security/security-scan/SKILL.md)

## Source provenance

- `ecc/commands/fastapi-review.md`
