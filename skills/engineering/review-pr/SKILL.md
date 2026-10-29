---
name: review-pr
description: Comprehensive PR review using specialized agents
category: engineering
sources:
- repository: ecc
  original_path: commands/review-pr.md
  sha256: dd6a610a4fa1ba61bb12ecaab9e2fddd1cbb57faff58d3601da019031e880a4c
principles:
- core/think-before-coding
- core/simplicity-first
- core/surgical-changes
- core/goal-driven-execution
---

> **Library use:** Apply the [compatibility and execution contract](../../COMPATIBILITY.md). Source roles, memory claims, command names, hooks, and integrations are instructions or prerequisites—not installed capabilities.

Run a comprehensive multi-perspective review of a pull request.

## Usage

`/review-pr [PR-number-or-URL] [--focus=comments|tests|errors|types|code|simplify]`

If no PR is specified, review the current branch's PR. If no focus is specified, run the full review stack.

## Steps

1. Identify the PR:
   - use `gh pr view` to get PR details, changed files, and diff
2. Find project guidance:
   - look for `CLAUDE.md`, lint config, TypeScript config, repo conventions
3. Run specialized review agents:
   - `code-reviewer`
   - `comment-analyzer`
   - `pr-test-analyzer`
   - `silent-failure-hunter`
   - `type-design-analyzer`
   - `code-simplifier`
4. Aggregate results:
   - dedupe overlapping findings
   - rank by severity
5. Report findings grouped by severity

## Confidence Rule

Only report issues with confidence >= 80:

- Critical: bugs, security, data loss
- Important: missing tests, quality problems, style violations
- Advisory: suggestions only when explicitly requested

## Related skills and principles

- [core/goal-driven-execution](../../core/goal-driven-execution/SKILL.md)
- [core/simplicity-first](../../core/simplicity-first/SKILL.md)
- [core/surgical-changes](../../core/surgical-changes/SKILL.md)
- [core/think-before-coding](../../core/think-before-coding/SKILL.md)
- [engineering/code-reviewer-ecc](../code-reviewer-ecc/SKILL.md)
- [engineering/code-simplifier](../code-simplifier/SKILL.md)
- [engineering/comment-analyzer](../comment-analyzer/SKILL.md)
- [engineering/silent-failure-hunter](../silent-failure-hunter/SKILL.md)
- [engineering/type-design-analyzer](../type-design-analyzer/SKILL.md)
- [testing/pr-test-analyzer](../../testing/pr-test-analyzer/SKILL.md)

## Source provenance

- `ecc/commands/review-pr.md`
