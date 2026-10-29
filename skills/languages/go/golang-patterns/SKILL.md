---
name: golang-patterns
description: Idiomatic Go patterns, best practices, and conventions for building robust, efficient, and maintainable
  Go applications. Use when writing or reviewing Go code and idiomatic structure or conventions are in question.
category: languages/go
sources:
- repository: ecc
  original_path: skills/golang-patterns/SKILL.md
  sha256: d643e354683167727cfeb76934855db988468cd15b3ca01db9a32db43902edf7
principles:
- core/think-before-coding
- core/simplicity-first
- core/surgical-changes
- core/goal-driven-execution
---

> **Library use:** Apply the [compatibility and execution contract](../../../COMPATIBILITY.md). Source roles, memory claims, command names, hooks, and integrations are instructions or prerequisites—not installed capabilities.

# Golang Patterns

Idiomatic Go patterns, best practices, and conventions for building robust, efficient, and maintainable Go applications. Use when writing or reviewing Go code and idiomatic structure or conventions are in question.

## Required procedure

Read [the complete methodology](references/methodology.md) before performing this skill. It retains the full procedure, examples, constraints, and failure handling.

Procedure topics: Go Development Patterns; When to Activate; Core Principles; 1. Simplicity and Clarity; 2. Make the Zero Value Useful; 3. Accept Interfaces, Return Structs; Error Handling Patterns; Error Wrapping with Context; Custom Error Types; Error Checking with errors.Is and errors.As; Never Ignore Errors; Concurrency Patterns; Worker Pool; Context for Cancellation and Timeouts.

## Related skills and principles

- [core/goal-driven-execution](../../../core/goal-driven-execution/SKILL.md)
- [core/simplicity-first](../../../core/simplicity-first/SKILL.md)
- [core/surgical-changes](../../../core/surgical-changes/SKILL.md)
- [core/think-before-coding](../../../core/think-before-coding/SKILL.md)
- [languages/go/golang-patterns-standard](../golang-patterns-standard/SKILL.md)

## Source provenance

- `ecc/skills/golang-patterns/SKILL.md`
