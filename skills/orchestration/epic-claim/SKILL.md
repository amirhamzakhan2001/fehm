---
name: epic-claim
description: Claim an epic issue, stamp coordination state, and sync local ownership.
category: orchestration
sources:
- repository: ecc
  original_path: commands/epic-claim.md
  sha256: fab151e31f5ed680cff1e171c65870ab18dbdd481fe5b94378dc57f98b0eb6ab
principles:
- core/think-before-coding
- core/simplicity-first
- core/surgical-changes
- core/goal-driven-execution
---

> **Library use:** Apply the [compatibility and execution contract](../../COMPATIBILITY.md). Source roles, memory claims, command names, hooks, and integrations are instructions or prerequisites—not installed capabilities.

# /epic-claim

Claim one epic issue as the source of truth for a unit of work.

Use the coordination script:

```bash
node scripts/github-coordination.js claim <issue-number> --repo <owner/repo> --actor <login>
```

What this does:

1. Loads the issue body and coordination block.
2. Marks the epic as claimed in GitHub issue state.
3. Updates labels and the local SQLite cache.
4. Appends an audit comment for the claim.

Compatibility aliases:

- `/orch-add-feature`
- `/orch-change-feature`
- `/prp-implement`

## Runtime prerequisites

See [the dependency ledger](../../DEPENDENCIES.md) and this skill’s records in [dependencies.json](../../dependencies.json). Native gstack/ECC CLIs, browsers, hooks, model tools, credentials, and memory stores must be available before invoking their steps. No runtime installation or execution has been performed. CSO requires its trusted helper; do not emulate that helper on the host.

## Related skills and principles

- [core/goal-driven-execution](../../core/goal-driven-execution/SKILL.md)
- [core/simplicity-first](../../core/simplicity-first/SKILL.md)
- [core/surgical-changes](../../core/surgical-changes/SKILL.md)
- [core/think-before-coding](../../core/think-before-coding/SKILL.md)
- [orchestration/orch-add-feature](../orch-add-feature/SKILL.md)
- [orchestration/orch-change-feature](../orch-change-feature/SKILL.md)
- [workflows/prp-implement](../../workflows/prp-implement/SKILL.md)

## Source provenance

- `ecc/commands/epic-claim.md`
