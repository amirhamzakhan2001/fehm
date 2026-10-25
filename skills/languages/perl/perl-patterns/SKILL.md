---
name: perl-patterns
description: Modern Perl 5.36+ idioms, best practices, and conventions for building robust, maintainable Perl applications.
  Use when writing or reviewing modern Perl 5.36+ code.
category: languages/perl
sources:
- repository: ecc
  original_path: skills/perl-patterns/SKILL.md
  sha256: 617ced86628e866a6242ef763ec736d5f7ee3fa0a5afc34236d808db6de9c4b3
principles:
- core/think-before-coding
- core/simplicity-first
- core/surgical-changes
- core/goal-driven-execution
---

> **Library use:** Apply the [compatibility and execution contract](../../../COMPATIBILITY.md). Source roles, memory claims, command names, hooks, and integrations are instructions or prerequisites—not installed capabilities.

# Perl Patterns

Modern Perl 5.36+ idioms, best practices, and conventions for building robust, maintainable Perl applications. Use when writing or reviewing modern Perl 5.36+ code.

## Required procedure

Read [the complete methodology](references/methodology.md) before performing this skill. It retains the full procedure, examples, constraints, and failure handling.

Procedure topics: Modern Perl Development Patterns; When to Activate; How It Works; Core Principles; 1. Use `v5.36` Pragma; Good: Modern preamble; Bad: Legacy boilerplate; 2. Subroutine Signatures; Good: Signatures with defaults; Good: Slurpy parameter for variable args; Bad: Manual argument unpacking; 3. Context Sensitivity; 4. Postfix Dereferencing; Good: Postfix dereferencing.

## Related skills and principles

- [core/goal-driven-execution](../../../core/goal-driven-execution/SKILL.md)
- [core/simplicity-first](../../../core/simplicity-first/SKILL.md)
- [core/surgical-changes](../../../core/surgical-changes/SKILL.md)
- [core/think-before-coding](../../../core/think-before-coding/SKILL.md)
- [languages/perl/perl-patterns-standard](../perl-patterns-standard/SKILL.md)

## Source provenance

- `ecc/skills/perl-patterns/SKILL.md`
