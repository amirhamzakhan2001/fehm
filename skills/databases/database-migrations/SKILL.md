---
name: database-migrations
description: Database migration best practices for schema changes, data migrations, rollbacks, and zero-downtime
  deployments across PostgreSQL, MySQL, and common ORMs (Prisma, Drizzle, Kysely, Django, TypeORM, golang-migrate).
  Use when writing a schema or data migration, planning a rollback, or aiming for zero-downtime deployment.
category: databases
sources:
- repository: ecc
  original_path: skills/database-migrations/SKILL.md
  sha256: ad7f2f04ca03e592a16e2a539d8c6e90bf4e08892408820ce99a53e9d07775de
principles:
- core/think-before-coding
- core/simplicity-first
- core/surgical-changes
- core/goal-driven-execution
---

> **Library use:** Apply the [compatibility and execution contract](../../COMPATIBILITY.md). Source roles, memory claims, command names, hooks, and integrations are instructions or prerequisites—not installed capabilities.

# Database Migrations

Database migration best practices for schema changes, data migrations, rollbacks, and zero-downtime deployments across PostgreSQL, MySQL, and common ORMs (Prisma, Drizzle, Kysely, Django, TypeORM, golang-migrate). Use when writing a schema or data migration, planning a rollback, or aiming for zero-downtime deployment.

## Required procedure

Read [the complete methodology](references/methodology.md) before performing this skill. It retains the full procedure, examples, constraints, and failure handling.

Procedure topics: Database Migration Patterns; When to Activate; Core Principles; Migration Safety Checklist; PostgreSQL Patterns; Adding a Column Safely; Adding an Index Without Downtime; Renaming a Column (Zero-Downtime); Removing a Column Safely; Large Data Migrations; Prisma (TypeScript/Node.js); Workflow; Create migration from schema changes; Apply pending migrations in production.

## Related skills and principles

- [core/goal-driven-execution](../../core/goal-driven-execution/SKILL.md)
- [core/simplicity-first](../../core/simplicity-first/SKILL.md)
- [core/surgical-changes](../../core/surgical-changes/SKILL.md)
- [core/think-before-coding](../../core/think-before-coding/SKILL.md)

## Source provenance

- `ecc/skills/database-migrations/SKILL.md`
