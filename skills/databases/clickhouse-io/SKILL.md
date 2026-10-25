---
name: clickhouse-io
description: ClickHouse database patterns, query optimization, analytics, and data engineering best practices for
  high-performance analytical workloads. Use when writing ClickHouse schemas or queries, or when an analytical query
  is too slow.
category: databases
sources:
- repository: ecc
  original_path: skills/clickhouse-io/SKILL.md
  sha256: 9f0f2b632f3feb1bd4ca7bae119fe05454668ab763b7d3c3d304f8740b8fd415
principles:
- core/think-before-coding
- core/simplicity-first
- core/surgical-changes
- core/goal-driven-execution
---

> **Library use:** Apply the [compatibility and execution contract](../../COMPATIBILITY.md). Source roles, memory claims, command names, hooks, and integrations are instructions or prerequisites—not installed capabilities.

# Clickhouse Io

ClickHouse database patterns, query optimization, analytics, and data engineering best practices for high-performance analytical workloads. Use when writing ClickHouse schemas or queries, or when an analytical query is too slow.

## Required procedure

Read [the complete methodology](references/methodology.md) before performing this skill. It retains the full procedure, examples, constraints, and failure handling.

Procedure topics: ClickHouse Analytics Patterns; When to Activate; Overview; Table Design Patterns; MergeTree Engine (Most Common); ReplacingMergeTree (Deduplication); AggregatingMergeTree (Pre-aggregation); Query Optimization Patterns; Efficient Filtering; Aggregations; Window Functions; Data Insertion Patterns; Bulk Insert (Recommended); Streaming Insert.

## Related skills and principles

- [core/goal-driven-execution](../../core/goal-driven-execution/SKILL.md)
- [core/simplicity-first](../../core/simplicity-first/SKILL.md)
- [core/surgical-changes](../../core/surgical-changes/SKILL.md)
- [core/think-before-coding](../../core/think-before-coding/SKILL.md)

## Source provenance

- `ecc/skills/clickhouse-io/SKILL.md`
