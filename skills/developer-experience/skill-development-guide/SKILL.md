---
name: skill-development-guide
description: Skill Development Guide. Use this methodology for skill development guide.
category: developer-experience
sources:
- repository: ecc
  original_path: docs/SKILL-DEVELOPMENT-GUIDE.md
  sha256: 25579773067b6373355a870faa0d6b9ff146db797abd4c3c56c219d1dcebe046
principles:
- core/think-before-coding
- core/simplicity-first
- core/surgical-changes
- core/goal-driven-execution
---

> **Library use:** Apply the [compatibility and execution contract](../../COMPATIBILITY.md). Source roles, memory claims, command names, hooks, and integrations are instructions or prerequisites—not installed capabilities.

# Skill Development Guide

Skill Development Guide. Use this methodology for skill development guide.

## Required procedure

Read [the complete methodology](references/methodology.md) before performing this skill. It retains the full procedure, examples, constraints, and failure handling.

Procedure topics: Skill Development Guide; Table of Contents; What Are Skills?; When Skills Activate; Skill vs Agent vs Command; Skill Architecture; File Structure; SKILL.md Format; Skill Title; When to Activate; Core Concepts; Code Examples; Anti-Patterns; Best Practices.

## Supporting material

See the [selective resource index](references/INDEX.md) for checklists, templates, examples, and reference implementations.

## Runtime prerequisites

See [the dependency ledger](../../DEPENDENCIES.md) and this skill’s records in [dependencies.json](../../dependencies.json). Native gstack/ECC CLIs, browsers, hooks, model tools, credentials, and memory stores must be available before invoking their steps. No runtime installation or execution has been performed. CSO requires its trusted helper; do not emulate that helper on the host.

## Related skills and principles

- [backend/api-design](../../backend/api-design/SKILL.md)
- [core/common-agents-standard](../../core/common-agents-standard/SKILL.md)
- [core/goal-driven-execution](../../core/goal-driven-execution/SKILL.md)
- [core/simplicity-first](../../core/simplicity-first/SKILL.md)
- [core/surgical-changes](../../core/surgical-changes/SKILL.md)
- [core/think-before-coding](../../core/think-before-coding/SKILL.md)
- [developer-experience/mcp-server-patterns](../mcp-server-patterns/SKILL.md)
- [devops/docker-patterns](../../devops/docker-patterns/SKILL.md)
- [frameworks/django/django-patterns](../../frameworks/django/django-patterns/SKILL.md)
- [frameworks/react/react-patterns](../../frameworks/react/react-patterns/SKILL.md)
- [frameworks/react/react-performance](../../frameworks/react/react-performance/SKILL.md)
- [frameworks/springboot/springboot-patterns](../../frameworks/springboot/springboot-patterns/SKILL.md)
- [languages/go/golang-patterns](../../languages/go/golang-patterns/SKILL.md)
- [languages/python/python-patterns](../../languages/python/python-patterns/SKILL.md)
- [languages/python/python-testing](../../languages/python/python-testing/SKILL.md)
- [languages/rust/rust-testing](../../languages/rust/rust-testing/SKILL.md)
- [security/application-security-review](../../security/application-security-review/SKILL.md)
- [testing/tdd-workflow](../../testing/tdd-workflow/SKILL.md)

## Source provenance

- `ecc/docs/SKILL-DEVELOPMENT-GUIDE.md`
