---
name: django-verification
description: 'Verification loop for Django projects: migrations, linting, tests with coverage, security scans, and
  deployment readiness checks before release or PR.'
category: frameworks/django
sources:
- repository: ecc
  original_path: skills/django-verification/SKILL.md
  sha256: cb1b6c5938c8c41dffb1f7bb752e307df6ced2577af2fc40786bde4c53799cea
principles:
- core/think-before-coding
- core/simplicity-first
- core/surgical-changes
- core/goal-driven-execution
---

> **Library use:** Apply the [compatibility and execution contract](../../../COMPATIBILITY.md). Source roles, memory claims, command names, hooks, and integrations are instructions or prerequisites—not installed capabilities.

# Django Verification

Verification loop for Django projects: migrations, linting, tests with coverage, security scans, and deployment readiness checks before release or PR.

## Required procedure

Read [the complete methodology](references/methodology.md) before performing this skill. It retains the full procedure, examples, constraints, and failure handling.

Procedure topics: Django Verification Loop; When to Activate; Phase 1: Environment Check; Verify Python version; Check virtual environment; Verify environment variables; Phase 2: Code Quality & Formatting; Type checking; Linting with ruff; Formatting with black; Import sorting; Django-specific checks; Phase 3: Migrations; Check for unapplied migrations.

## Related skills and principles

- [core/goal-driven-execution](../../../core/goal-driven-execution/SKILL.md)
- [core/simplicity-first](../../../core/simplicity-first/SKILL.md)
- [core/surgical-changes](../../../core/surgical-changes/SKILL.md)
- [core/think-before-coding](../../../core/think-before-coding/SKILL.md)

## Source provenance

- `ecc/skills/django-verification/SKILL.md`
