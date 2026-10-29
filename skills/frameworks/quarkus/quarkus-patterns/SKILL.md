---
name: quarkus-patterns
description: Quarkus 3.x LTS architecture patterns with Camel for messaging, RESTful API design, CDI services, data
  access with Panache, and async processing. Use for Java Quarkus backend work with event-driven architectures.
  Use when building or reviewing a Quarkus service, especially with Camel messaging or Panache data access.
category: frameworks/quarkus
sources:
- repository: ecc
  original_path: skills/quarkus-patterns/SKILL.md
  sha256: 5f91bed186170a23837452508fc731ec4cada0a337ae95b1327f80311fa6ab6b
principles:
- core/think-before-coding
- core/simplicity-first
- core/surgical-changes
- core/goal-driven-execution
---

> **Library use:** Apply the [compatibility and execution contract](../../../COMPATIBILITY.md). Source roles, memory claims, command names, hooks, and integrations are instructions or prerequisites—not installed capabilities.

# Quarkus Patterns

Quarkus 3.x LTS architecture patterns with Camel for messaging, RESTful API design, CDI services, data access with Panache, and async processing. Use for Java Quarkus backend work with event-driven architectures. Use when building or reviewing a Quarkus service, especially with Camel messaging or Panache data access.

## Required procedure

Read [the complete methodology](references/methodology.md) before performing this skill. It retains the full procedure, examples, constraints, and failure handling.

Procedure topics: Quarkus Development Patterns; When to Activate; Service Layer with Multiple Dependencies; Custom Logging Context Pattern (Logback); Event Service Pattern; Camel Message Publishing (RabbitMQ); Camel Direct Routes (In-Memory); Camel File Processing; Camel Bean Invocation; REST API Structure; Repository Pattern (Panache Repository); Service Layer with Transactions; DTOs and Validation; Exception Mapping.

## Related skills and principles

- [core/goal-driven-execution](../../../core/goal-driven-execution/SKILL.md)
- [core/simplicity-first](../../../core/simplicity-first/SKILL.md)
- [core/surgical-changes](../../../core/surgical-changes/SKILL.md)
- [core/think-before-coding](../../../core/think-before-coding/SKILL.md)

## Source provenance

- `ecc/skills/quarkus-patterns/SKILL.md`
