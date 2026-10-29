---
name: quarkus-tdd
description: Test-driven development for Quarkus 3.x LTS using JUnit 5, Mockito, REST Assured, Camel testing, and
  JaCoCo. Use when adding features, fixing bugs, or refactoring event-driven services.
category: frameworks/quarkus
sources:
- repository: ecc
  original_path: skills/quarkus-tdd/SKILL.md
  sha256: 556d1c2d04e3e0ef10f474ed413013646088ff057f9be02d3a3c4f833ccc33c5
principles:
- core/think-before-coding
- core/simplicity-first
- core/surgical-changes
- core/goal-driven-execution
---

> **Library use:** Apply the [compatibility and execution contract](../../../COMPATIBILITY.md). Source roles, memory claims, command names, hooks, and integrations are instructions or prerequisites—not installed capabilities.

# Quarkus Tdd

Test-driven development for Quarkus 3.x LTS using JUnit 5, Mockito, REST Assured, Camel testing, and JaCoCo. Use when adding features, fixing bugs, or refactoring event-driven services.

## Required procedure

Read [the complete methodology](references/methodology.md) before performing this skill. It retains the full procedure, examples, constraints, and failure handling.

Procedure topics: Quarkus TDD Workflow; When to Use; Workflow; Unit Tests with @Nested Organization; Key Testing Patterns; Testing Camel Routes; Testing Event Services; Testing CompletableFuture; Resource Layer Tests (REST Assured); Integration Tests with Real Database; Coverage with JaCoCo; Maven Configuration (Complete); Report at: target/site/jacoco/index.html; Test Dependencies.

## Related skills and principles

- [core/goal-driven-execution](../../../core/goal-driven-execution/SKILL.md)
- [core/simplicity-first](../../../core/simplicity-first/SKILL.md)
- [core/surgical-changes](../../../core/surgical-changes/SKILL.md)
- [core/think-before-coding](../../../core/think-before-coding/SKILL.md)

## Source provenance

- `ecc/skills/quarkus-tdd/SKILL.md`
