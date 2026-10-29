---
name: perl-testing
description: Perl testing patterns using Test2::V0, Test::More, prove runner, mocking, coverage with Devel::Cover,
  and TDD methodology. Use when writing Perl tests with Test2::V0 or Test::More, or measuring coverage.
category: languages/perl
sources:
- repository: ecc
  original_path: skills/perl-testing/SKILL.md
  sha256: 17723ed2249fa98d4ee7affc53bb479898725eb1a7466d46871bf215317fb79e
principles:
- core/think-before-coding
- core/simplicity-first
- core/surgical-changes
- core/goal-driven-execution
---

> **Library use:** Apply the [compatibility and execution contract](../../../COMPATIBILITY.md). Source roles, memory claims, command names, hooks, and integrations are instructions or prerequisites—not installed capabilities.

# Perl Testing

Perl testing patterns using Test2::V0, Test::More, prove runner, mocking, coverage with Devel::Cover, and TDD methodology. Use when writing Perl tests with Test2::V0 or Test::More, or measuring coverage.

## Required procedure

Read [the complete methodology](references/methodology.md) before performing this skill. It retains the full procedure, examples, constraints, and failure handling.

Procedure topics: Perl Testing Patterns; When to Activate; TDD Workflow; Step 1: RED — Write a failing test; t/unit/calculator.t; Step 2: GREEN — Write minimal implementation; lib/Calculator.pm; Step 3: REFACTOR — Improve while tests stay green; Run: prove -lv t/unit/calculator.t; Test::More Fundamentals; Basic Assertions; Plan upfront or use done_testing; plan tests => 5;  # Fixed plan (optional); Equality.

## Related skills and principles

- [core/goal-driven-execution](../../../core/goal-driven-execution/SKILL.md)
- [core/simplicity-first](../../../core/simplicity-first/SKILL.md)
- [core/surgical-changes](../../../core/surgical-changes/SKILL.md)
- [core/think-before-coding](../../../core/think-before-coding/SKILL.md)
- [languages/perl/perl-testing-standard](../perl-testing-standard/SKILL.md)

## Source provenance

- `ecc/skills/perl-testing/SKILL.md`
