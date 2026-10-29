---
name: continuous-agent-loop
description: Patterns for continuous autonomous agent loops with quality gates, evals, and recovery controls. Use
  when running an agent loop that must self-check, gate on evals, and recover from failures.
category: orchestration
sources:
- repository: ecc
  original_path: skills/continuous-agent-loop/SKILL.md
  sha256: f228cd383a9063b3a0116c5aea02565e859992f63fae5e799adf9c9e44e2454d
principles:
- core/think-before-coding
- core/simplicity-first
- core/surgical-changes
- core/goal-driven-execution
---

> **Library use:** Apply the [compatibility and execution contract](../../COMPATIBILITY.md). Source roles, memory claims, command names, hooks, and integrations are instructions or prerequisites—not installed capabilities.

# Continuous Agent Loop

This is the v1.8+ canonical loop skill name. It supersedes `autonomous-loops` while keeping compatibility for one release.

## Loop Selection Flow

```text
Start
  |
  +-- Need strict CI/PR control? -- yes --> continuous-pr
  |
  +-- Need RFC decomposition? -- yes --> rfc-dag
  |
  +-- Need exploratory parallel generation? -- yes --> infinite
  |
  +-- default --> sequential
```

## Combined Pattern

Recommended production stack:
1. RFC decomposition (`ralphinho-rfc-pipeline`)
2. quality gates (`plankton-code-quality` + `/quality-gate`)
3. eval loop (`eval-harness`)
4. session persistence (`nanoclaw-repl`)

## Failure Modes

- loop churn without measurable progress
- repeated retries with same root cause
- merge queue stalls
- cost drift from unbounded escalation

## Recovery

- freeze loop
- run `/harness-audit`
- reduce scope to failing unit
- replay with explicit acceptance criteria

## Related skills and principles

- [core/goal-driven-execution](../../core/goal-driven-execution/SKILL.md)
- [core/simplicity-first](../../core/simplicity-first/SKILL.md)
- [core/surgical-changes](../../core/surgical-changes/SKILL.md)
- [core/think-before-coding](../../core/think-before-coding/SKILL.md)
- [engineering/plankton-code-quality](../../engineering/plankton-code-quality/SKILL.md)
- [orchestration/autonomous-loops](../autonomous-loops/SKILL.md)
- [orchestration/eval-harness](../eval-harness/SKILL.md)
- [orchestration/harness-audit](../harness-audit/SKILL.md)
- [orchestration/nanoclaw-repl](../nanoclaw-repl/SKILL.md)
- [orchestration/ralphinho-rfc-pipeline](../ralphinho-rfc-pipeline/SKILL.md)
- [verification/quality-gate](../../verification/quality-gate/SKILL.md)

## Source provenance

- `ecc/skills/continuous-agent-loop/SKILL.md`
