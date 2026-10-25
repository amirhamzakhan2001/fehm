---
name: docker-patterns
description: Docker and Docker Compose patterns for local development, hardened CLI installer harnesses, container
  security, networking, volumes, and multi-service orchestration. Use when creating or reviewing Dockerfiles and
  Compose services, testing installers across Linux distributions, or planning accurate native macOS and Windows
  validation.
category: devops
sources:
- repository: ecc
  original_path: skills/docker-patterns/SKILL.md
  sha256: 2a880cf2f6401874151daa9bcc0eacd10cf79f5f48b97f98e93a877a8f3fd12b
principles:
- core/think-before-coding
- core/simplicity-first
- core/surgical-changes
- core/goal-driven-execution
---

> **Library use:** Apply the [compatibility and execution contract](../../COMPATIBILITY.md). Source roles, memory claims, command names, hooks, and integrations are instructions or prerequisites—not installed capabilities.

# Docker Patterns

Docker and Docker Compose patterns for local development, hardened CLI installer harnesses, container security, networking, volumes, and multi-service orchestration. Use when creating or reviewing Dockerfiles and Compose services, testing installers across Linux distributions, or planning accurate native macOS and Windows validation.

## Required procedure

Read [the complete methodology](references/methodology.md) before performing this skill. It retains the full procedure, examples, constraints, and failure handling.

Procedure topics: Docker Patterns; Docker Compose for Local Development; Standard Web App Stack; docker-compose.yml; Development vs Production Dockerfile; Stage: dependencies; Stage: dev (hot reload, debug tools); Stage: build; Stage: production (minimal image); Override Files; docker-compose.override.yml (auto-loaded, dev-only settings); docker-compose.prod.yml (explicit for production); Development (auto-loads override); Production.

## Related skills and principles

- [core/goal-driven-execution](../../core/goal-driven-execution/SKILL.md)
- [core/simplicity-first](../../core/simplicity-first/SKILL.md)
- [core/surgical-changes](../../core/surgical-changes/SKILL.md)
- [core/think-before-coding](../../core/think-before-coding/SKILL.md)

## Source provenance

- `ecc/skills/docker-patterns/SKILL.md`
