---
name: security-review
description: Select a security assessment variant and preserve its evidence and execution boundaries.
category: workflows
sources:
- repository: ecc
  original_path: skills/security-review/SKILL.md
  sha256: b9eb6416eebc8dda046674f0a2dbb3be88aff526d182b60a0f55998d3d6d0d8d
- repository: agency-agents
  original_path: security/security-appsec-engineer.md
  sha256: f3ee22350c9e0e7289d2d4747e7c1a8fe196d70340feec7b176b13bacc3deb77
- repository: gstack
  original_path: cso/SKILL.md
  sha256: 14a16ce06c46b2cc539b5e689cbe59d16b1e9bd49a9bfe8da9dc7d3a6a378ab2
principles:
- core/think-before-coding
- core/simplicity-first
- core/surgical-changes
- core/goal-driven-execution
---

> **Library use:** Apply the [compatibility and execution contract](../../COMPATIBILITY.md). Source roles, memory claims, command names, hooks, and integrations are instructions or prerequisites—not installed capabilities.

# Security Review

## When to use

Select a security assessment variant and preserve its evidence and execution boundaries.

## Inputs

User objective, project constraints, relevant source or evidence, and explicit success criteria.

## Procedure and handoffs

1. Load [the application-security-review procedure](../../security/application-security-review/SKILL.md). Apply relevant authentication, input, secrets, dependency, and application checks.
2. Load [the appsec-engineer procedure](../../security/appsec-engineer/SKILL.md). Use the application-security specialist to examine relevant design and trust boundaries.
3. Load [the cso procedure](../../security/cso/SKILL.md). Use CSO only with its trusted launcher; without it report that variant not assessed. Never substitute host execution for containment or label static findings runtime-tested.

## Verification and output

Produce the artifacts required by the selected procedures and an evidence-backed status: completed, failed, skipped with reason, or blocked on a named prerequisite. Carry unresolved findings forward. Do not treat an unavailable tool, an unrun check, or a reviewer failure as a pass.

## Scope and compatibility

Select stages proportionate to the task. Preserve required gates of the chosen variant; record exceptions. Read the [compatibility policy](../../COMPATIBILITY.md) before combining conflicting variants. These instructions do not grant tool access or authorize publishing, commits, deployment, or communications.

## Related skills and principles

- [core/goal-driven-execution](../../core/goal-driven-execution/SKILL.md)
- [core/simplicity-first](../../core/simplicity-first/SKILL.md)
- [core/surgical-changes](../../core/surgical-changes/SKILL.md)
- [core/think-before-coding](../../core/think-before-coding/SKILL.md)
- [security/application-security-review](../../security/application-security-review/SKILL.md)
- [security/appsec-engineer](../../security/appsec-engineer/SKILL.md)
- [security/cso](../../security/cso/SKILL.md)
- [security/security-reviewer](../../security/security-reviewer/SKILL.md)

## Source provenance

- `ecc/skills/security-review/SKILL.md`
- `agency-agents/security/security-appsec-engineer.md`
- `gstack/cso/SKILL.md`
