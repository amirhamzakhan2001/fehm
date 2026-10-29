---
name: autonomous-loops
description: 'Patterns and architectures for autonomous Claude Code loops — from simple sequential pipelines to
  RFC-driven multi-agent DAG systems. Retained for compatibility only: when new autonomous loop guidance is needed,
  use continuous-agent-loop instead.'
category: orchestration
sources:
- repository: ecc
  original_path: skills/autonomous-loops/SKILL.md
  sha256: c2db797295500b9c2b31d9dd2451ef28727346c739b5d1d3366f0f9ea2e823dc
principles:
- core/think-before-coding
- core/simplicity-first
- core/surgical-changes
- core/goal-driven-execution
---

> **Library use:** Apply the [compatibility and execution contract](../../COMPATIBILITY.md). Source roles, memory claims, command names, hooks, and integrations are instructions or prerequisites—not installed capabilities.

# Autonomous Loops

Patterns and architectures for autonomous Claude Code loops — from simple sequential pipelines to RFC-driven multi-agent DAG systems. Retained for compatibility only: when new autonomous loop guidance is needed, use continuous-agent-loop instead.

## Required procedure

Read [the complete methodology](references/methodology.md) before performing this skill. It retains the full procedure, examples, constraints, and failure handling.

Procedure topics: Autonomous Loops Skill; When to Use; Loop Pattern Spectrum; 1. Sequential Pipeline (`claude -p`); Core Insight; daily-dev.sh — Sequential pipeline for a feature branch; Step 1: Implement the feature; Step 2: De-sloppify (cleanup pass); Step 3: Verify; Step 4: Commit; Key Design Principles; Variations; Research with Opus (deep reasoning); Implement with Sonnet (fast, capable).

## Runtime prerequisites

See [the dependency ledger](../../DEPENDENCIES.md) and this skill’s records in [dependencies.json](../../dependencies.json). Native gstack/ECC CLIs, browsers, hooks, model tools, credentials, and memory stores must be available before invoking their steps. No runtime installation or execution has been performed. CSO requires its trusted helper; do not emulate that helper on the host.

## Related skills and principles

- [core/goal-driven-execution](../../core/goal-driven-execution/SKILL.md)
- [core/simplicity-first](../../core/simplicity-first/SKILL.md)
- [core/surgical-changes](../../core/surgical-changes/SKILL.md)
- [core/think-before-coding](../../core/think-before-coding/SKILL.md)
- [orchestration/continuous-agent-loop](../continuous-agent-loop/SKILL.md)
- [verification/verification-loop](../../verification/verification-loop/SKILL.md)

## Source provenance

- `ecc/skills/autonomous-loops/SKILL.md`
