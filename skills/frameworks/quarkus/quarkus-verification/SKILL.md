---
name: quarkus-verification
description: 'Verification loop for Quarkus projects: build, static analysis, tests with coverage, security scans,
  native compilation, and diff review before release or PR.'
category: frameworks/quarkus
sources:
- repository: ecc
  original_path: skills/quarkus-verification/SKILL.md
  sha256: 567633c745c497a8b8f5489d806244772d0c20289b9ff8e26e790f8e6398ff5c
principles:
- core/think-before-coding
- core/simplicity-first
- core/surgical-changes
- core/goal-driven-execution
---

> **Library use:** Apply the [compatibility and execution contract](../../../COMPATIBILITY.md). Source roles, memory claims, command names, hooks, and integrations are instructions or prerequisites—not installed capabilities.

# Quarkus Verification

Verification loop for Quarkus projects: build, static analysis, tests with coverage, security scans, native compilation, and diff review before release or PR.

## Required procedure

Read [the complete methodology](references/methodology.md) before performing this skill. It retains the full procedure, examples, constraints, and failure handling.

Procedure topics: Quarkus Verification Loop; When to Activate; Phase 1: Build; Maven; Gradle; Phase 2: Static Analysis; Checkstyle, PMD, SpotBugs (Maven); SonarQube (if configured); Common Issues to Address; Phase 3: Tests + Coverage; Run all tests; Generate coverage report; Enforce coverage threshold (80%); Or with Gradle.

## Related skills and principles

- [core/goal-driven-execution](../../../core/goal-driven-execution/SKILL.md)
- [core/simplicity-first](../../../core/simplicity-first/SKILL.md)
- [core/surgical-changes](../../../core/surgical-changes/SKILL.md)
- [core/think-before-coding](../../../core/think-before-coding/SKILL.md)

## Source provenance

- `ecc/skills/quarkus-verification/SKILL.md`
