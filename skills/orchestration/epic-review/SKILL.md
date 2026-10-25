---
name: epic-review
description: Mark epic review requested, approved, or changes requested.
category: orchestration
sources:
- repository: ecc
  original_path: commands/epic-review.md
  sha256: 4c9ce11bb8d7375f6d2128e0883071ccbf4162df8ed445e565706983f6c17b42
principles:
- core/think-before-coding
- core/simplicity-first
- core/surgical-changes
- core/goal-driven-execution
---

> **Library use:** Apply the [compatibility and execution contract](../../COMPATIBILITY.md). Source roles, memory claims, command names, hooks, and integrations are instructions or prerequisites—not installed capabilities.

# /epic-review

Coordinate review state for an epic issue.

```bash
node scripts/github-coordination.js review <issue-number> --repo <owner/repo> --review approved
```

What this does:

1. Updates the review state in the coordination block.
2. Syncs review labels to GitHub.
3. Records the review outcome in an audit comment.
4. Keeps the local cache aligned with the issue body.

Compatibility aliases:

- `/review-pr`
- `/code-review`

## Runtime prerequisites

See [the dependency ledger](../../DEPENDENCIES.md) and this skill’s records in [dependencies.json](../../dependencies.json). Native gstack/ECC CLIs, browsers, hooks, model tools, credentials, and memory stores must be available before invoking their steps. No runtime installation or execution has been performed. CSO requires its trusted helper; do not emulate that helper on the host.

## Related skills and principles

- [core/goal-driven-execution](../../core/goal-driven-execution/SKILL.md)
- [core/simplicity-first](../../core/simplicity-first/SKILL.md)
- [core/surgical-changes](../../core/surgical-changes/SKILL.md)
- [core/think-before-coding](../../core/think-before-coding/SKILL.md)
- [engineering/local-and-pr-code-review](../../engineering/local-and-pr-code-review/SKILL.md)
- [engineering/review-pr](../../engineering/review-pr/SKILL.md)

## Source provenance

- `ecc/commands/epic-review.md`
