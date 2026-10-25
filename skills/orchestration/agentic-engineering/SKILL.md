---
name: agentic-engineering
description: Operate as an agentic engineer using eval-first execution, decomposition, and cost-aware model routing.
  Use when planning or executing engineering work that agents will carry out end to end.
category: orchestration
sources:
- repository: ecc
  original_path: skills/agentic-engineering/SKILL.md
  sha256: 41c32c20ec97469341f5d83d8beb15f03d1b6f1c40fb1bdf534c50cd9a38cb6f
principles:
- core/think-before-coding
- core/simplicity-first
- core/surgical-changes
- core/goal-driven-execution
---

> **Library use:** Apply the [compatibility and execution contract](../../COMPATIBILITY.md). Source roles, memory claims, command names, hooks, and integrations are instructions or prerequisites—not installed capabilities.

# Agentic Engineering

Use this skill for engineering workflows where AI agents perform most implementation work and humans enforce quality and risk controls.

## Operating Principles

1. Define completion criteria before execution.
2. Decompose work into agent-sized units.
3. Route model tiers by task complexity.
4. Measure with evals and regression checks.

## Eval-First Loop

1. Define capability eval and regression eval.
2. Run baseline and capture failure signatures.
3. Execute implementation.
4. Re-run evals and compare deltas.

## Task Decomposition

Apply the 15-minute unit rule:
- each unit should be independently verifiable
- each unit should have a single dominant risk
- each unit should expose a clear done condition

## Model Routing

- Haiku: classification, boilerplate transforms, narrow edits
- Sonnet: implementation and refactors
- Opus: architecture, root-cause analysis, multi-file invariants

## Session Strategy

- Continue session for closely-coupled units.
- Start fresh session after major phase transitions.
- Compact after milestone completion, not during active debugging.

## Review Focus for AI-Generated Code

Prioritize:
- invariants and edge cases
- error boundaries
- security and auth assumptions
- hidden coupling and rollout risk

Do not waste review cycles on style-only disagreements when automated format/lint already enforce style.

## Cost Discipline

Track per task:
- model
- token estimate
- retries
- wall-clock time
- success/failure

Escalate model tier only when lower tier fails with a clear reasoning gap.

## Related skills and principles

- [core/goal-driven-execution](../../core/goal-driven-execution/SKILL.md)
- [core/simplicity-first](../../core/simplicity-first/SKILL.md)
- [core/surgical-changes](../../core/surgical-changes/SKILL.md)
- [core/think-before-coding](../../core/think-before-coding/SKILL.md)

## Source provenance

- `ecc/skills/agentic-engineering/SKILL.md`
