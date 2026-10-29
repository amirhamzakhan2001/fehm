---
name: rust-patterns
description: Idiomatic Rust patterns, ownership, error handling, traits, concurrency, and best practices for building
  safe, performant applications. Use when writing or reviewing Rust code and ownership, error handling, traits,
  or concurrency is in question.
category: languages/rust
sources:
- repository: ecc
  original_path: skills/rust-patterns/SKILL.md
  sha256: 51379df2bd92a482309e109e5a210210842594f660cceeb2d68d18e995108edf
principles:
- core/think-before-coding
- core/simplicity-first
- core/surgical-changes
- core/goal-driven-execution
---

> **Library use:** Apply the [compatibility and execution contract](../../../COMPATIBILITY.md). Source roles, memory claims, command names, hooks, and integrations are instructions or prerequisites—not installed capabilities.

# Rust Patterns

Idiomatic Rust patterns, ownership, error handling, traits, concurrency, and best practices for building safe, performant applications. Use when writing or reviewing Rust code and ownership, error handling, traits, or concurrency is in question.

## Required procedure

Read [the complete methodology](references/methodology.md) before performing this skill. It retains the full procedure, examples, constraints, and failure handling.

Procedure topics: Rust Development Patterns; When to Use; How It Works; Core Principles; 1. Ownership and Borrowing; Use `Cow` for Flexible Ownership; Error Handling; Use `Result` and `?` — Never `unwrap()` in Production; Library Errors with `thiserror`, Application Errors with `anyhow`; `Option` Combinators Over Nested Matching; Enums and Pattern Matching; Model States as Enums; Exhaustive Matching — No Catch-All for Business Logic; Traits and Generics.

## Related skills and principles

- [core/goal-driven-execution](../../../core/goal-driven-execution/SKILL.md)
- [core/simplicity-first](../../../core/simplicity-first/SKILL.md)
- [core/surgical-changes](../../../core/surgical-changes/SKILL.md)
- [core/think-before-coding](../../../core/think-before-coding/SKILL.md)
- [languages/rust/rust-patterns-standard](../rust-patterns-standard/SKILL.md)

## Source provenance

- `ecc/skills/rust-patterns/SKILL.md`
