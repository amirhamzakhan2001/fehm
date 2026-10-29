---
name: fastapi-patterns
description: FastAPI best practices covering project structure, Pydantic v2 schemas, dependency injection, async
  handlers, authentication, authorization, transactional service layers, and testing with httpx and pytest. Use
  when building or reviewing FastAPI apps — Pydantic schemas, dependencies, async handlers, auth, or tests.
category: frameworks/fastapi
sources:
- repository: ecc
  original_path: skills/fastapi-patterns/SKILL.md
  sha256: f54c2bf5a61eeda47c939da265b1431d609c231611e71b688b0b734a064b18f3
principles:
- core/think-before-coding
- core/simplicity-first
- core/surgical-changes
- core/goal-driven-execution
---

> **Library use:** Apply the [compatibility and execution contract](../../../COMPATIBILITY.md). Source roles, memory claims, command names, hooks, and integrations are instructions or prerequisites—not installed capabilities.

# Fastapi Patterns

FastAPI best practices covering project structure, Pydantic v2 schemas, dependency injection, async handlers, authentication, authorization, transactional service layers, and testing with httpx and pytest. Use when building or reviewing FastAPI apps — Pydantic schemas, dependencies, async handlers, auth, or tests.

## Required procedure

Read [the complete methodology](references/methodology.md) before performing this skill. It retains the full procedure, examples, constraints, and failure handling.

Procedure topics: FastAPI Patterns; Project Structure; App Factory and Lifespan; app/main.py; Configuration with pydantic-settings; app/config.py; Pydantic Schemas (v2); app/schemas/user.py; Dependency Injection; app/dependencies.py; Router and Endpoint Design; app/routers/users.py; Service Layer; app/services/user_service.py.

## Related skills and principles

- [core/goal-driven-execution](../../../core/goal-driven-execution/SKILL.md)
- [core/simplicity-first](../../../core/simplicity-first/SKILL.md)
- [core/surgical-changes](../../../core/surgical-changes/SKILL.md)
- [core/think-before-coding](../../../core/think-before-coding/SKILL.md)

## Source provenance

- `ecc/skills/fastapi-patterns/SKILL.md`
