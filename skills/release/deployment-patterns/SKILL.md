---
name: deployment-patterns
description: Deployment workflows, CI/CD pipeline patterns, Docker containerization, health checks, rollback strategies,
  and production readiness checklists for web applications. Use when setting up CI/CD, containerizing an app, or
  checking production readiness before a release.
category: release
sources:
- repository: ecc
  original_path: skills/deployment-patterns/SKILL.md
  sha256: b864abd1954570c4a469b7e1deb897e57858d25db2fd98d035ff7bca4a15b9b6
principles:
- core/think-before-coding
- core/simplicity-first
- core/surgical-changes
- core/goal-driven-execution
---

> **Library use:** Apply the [compatibility and execution contract](../../COMPATIBILITY.md). Source roles, memory claims, command names, hooks, and integrations are instructions or prerequisites—not installed capabilities.

# Deployment Patterns

Deployment workflows, CI/CD pipeline patterns, Docker containerization, health checks, rollback strategies, and production readiness checklists for web applications. Use when setting up CI/CD, containerizing an app, or checking production readiness before a release.

## Required procedure

Read [the complete methodology](references/methodology.md) before performing this skill. It retains the full procedure, examples, constraints, and failure handling.

Procedure topics: Deployment Patterns; When to Activate; Deployment Strategies; Rolling Deployment (Default); Blue-Green Deployment; After verification:; Canary Deployment; If metrics look good:; Final:; Docker; Multi-Stage Dockerfile (Node.js); Stage 1: Install dependencies; Stage 2: Build; Stage 3: Production image.

## Related skills and principles

- [core/goal-driven-execution](../../core/goal-driven-execution/SKILL.md)
- [core/simplicity-first](../../core/simplicity-first/SKILL.md)
- [core/surgical-changes](../../core/surgical-changes/SKILL.md)
- [core/think-before-coding](../../core/think-before-coding/SKILL.md)

## Source provenance

- `ecc/skills/deployment-patterns/SKILL.md`
