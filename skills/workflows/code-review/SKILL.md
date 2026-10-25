---
name: code-review
description: Compose structural review, engineering checks, and constructive specialist feedback.
category: workflows
sources:
- repository: gstack
  original_path: review/SKILL.md
  sha256: cebbf9f8cbf1e230416559ad21ca3bf3de4cf0143917393303a0dfb0fa42e078
- repository: ecc
  original_path: commands/code-review.md
  sha256: 20f4b8fcf132d6563ae0afb3d6d695ac8d4d85f3d36b15da83de30b041cce107
- repository: agency-agents
  original_path: engineering/engineering-code-reviewer.md
  sha256: 7509fcc3ea1dda46511b2801996305bf3d4a125576f9655ff0b63df25602f446
principles:
- core/think-before-coding
- core/simplicity-first
- core/surgical-changes
- core/goal-driven-execution
---

> **Library use:** Apply the [compatibility and execution contract](../../COMPATIBILITY.md). Source roles, memory claims, command names, hooks, and integrations are instructions or prerequisites—not installed capabilities.

# Code Review

## When to use

Compose structural review, engineering checks, and constructive specialist feedback.

## Inputs

User objective, project constraints, relevant source or evidence, and explicit success criteria.

## Procedure and handoffs

1. Load [the review procedure](../../engineering/review/SKILL.md). Check base-branch diff, trust boundaries, plan completion, and production risks.
2. Load [the local-and-pr-code-review procedure](../../engineering/local-and-pr-code-review/SKILL.md). Select local or PR mode; read full files and run applicable validation. Publishing requires authorization.
3. Load [the code-reviewer procedure](../../engineering/code-reviewer/SKILL.md). Deduplicate findings by defect/evidence; communicate blocker, suggestion, or nit with location, impact, and a repair. Preserve the strictest justified severity.

## Verification and output

Produce the artifacts required by the selected procedures and an evidence-backed status: completed, failed, skipped with reason, or blocked on a named prerequisite. Carry unresolved findings forward. Do not treat an unavailable tool, an unrun check, or a reviewer failure as a pass.

## Scope and compatibility

Select stages proportionate to the task. Preserve required gates of the chosen variant; record exceptions. Read the [compatibility policy](../../COMPATIBILITY.md) before combining conflicting variants. These instructions do not grant tool access or authorize publishing, commits, deployment, or communications.

## Runtime prerequisites

See [the dependency ledger](../../DEPENDENCIES.md) and this skill’s records in [dependencies.json](../../dependencies.json). Native gstack/ECC CLIs, browsers, hooks, model tools, credentials, and memory stores must be available before invoking their steps. No runtime installation or execution has been performed. CSO requires its trusted helper; do not emulate that helper on the host.

## Related skills and principles

- [core/common-code-review-standard](../../core/common-code-review-standard/SKILL.md)
- [core/goal-driven-execution](../../core/goal-driven-execution/SKILL.md)
- [core/simplicity-first](../../core/simplicity-first/SKILL.md)
- [core/surgical-changes](../../core/surgical-changes/SKILL.md)
- [core/think-before-coding](../../core/think-before-coding/SKILL.md)
- [developer-experience/plan-tune](../../developer-experience/plan-tune/SKILL.md)
- [documentation/document-generate](../../documentation/document-generate/SKILL.md)
- [engineering/code-reviewer](../../engineering/code-reviewer/SKILL.md)
- [engineering/code-reviewer-ecc](../../engineering/code-reviewer-ecc/SKILL.md)
- [engineering/codex](../../engineering/codex/SKILL.md)
- [engineering/local-and-pr-code-review](../../engineering/local-and-pr-code-review/SKILL.md)
- [engineering/review](../../engineering/review/SKILL.md)
- [memory/context-restore](../../memory/context-restore/SKILL.md)
- [memory/context-save](../../memory/context-save/SKILL.md)
- [memory/learn](../../memory/learn/SKILL.md)
- [product/spec](../../product/spec/SKILL.md)
- [project-management/retro](../../project-management/retro/SKILL.md)
- [release/document-release](../../release/document-release/SKILL.md)
- [release/ship](../../release/ship/SKILL.md)
- [testing/qa-only](../../testing/qa-only/SKILL.md)

## Source provenance

- `gstack/review/SKILL.md`
- `ecc/commands/code-review.md`
- `agency-agents/engineering/engineering-code-reviewer.md`
