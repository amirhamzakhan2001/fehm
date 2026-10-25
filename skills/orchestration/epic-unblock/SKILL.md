---
name: epic-unblock
description: Sweep blocked epic issues and reopen anything whose dependencies are closed.
category: orchestration
sources:
- repository: ecc
  original_path: commands/epic-unblock.md
  sha256: 48c1868f03b6ceda7a923d98c76206a35eefa91774a61a0d9d4c18ea5713a4e7
principles:
- core/think-before-coding
- core/simplicity-first
- core/surgical-changes
- core/goal-driven-execution
---

> **Library use:** Apply the [compatibility and execution contract](../../COMPATIBILITY.md). Source roles, memory claims, command names, hooks, and integrations are instructions or prerequisites—not installed capabilities.

# /epic-unblock

Sweep blocked epics whose declared dependencies are complete.

```bash
node scripts/github-coordination.js unblock --repo <owner/repo>
```

What this does:

1. Scans epic issues in the repository.
2. Checks each blocked epic's dependency list.
3. Moves fully unblocked epics to ready.
4. Updates labels, comments, and local snapshots.

Compatibility aliases:

- `/loop-status`

## Runtime prerequisites

See [the dependency ledger](../../DEPENDENCIES.md) and this skill’s records in [dependencies.json](../../dependencies.json). Native gstack/ECC CLIs, browsers, hooks, model tools, credentials, and memory stores must be available before invoking their steps. No runtime installation or execution has been performed. CSO requires its trusted helper; do not emulate that helper on the host.

## Related skills and principles

- [core/goal-driven-execution](../../core/goal-driven-execution/SKILL.md)
- [core/simplicity-first](../../core/simplicity-first/SKILL.md)
- [core/surgical-changes](../../core/surgical-changes/SKILL.md)
- [core/think-before-coding](../../core/think-before-coding/SKILL.md)
- [orchestration/loop-status](../loop-status/SKILL.md)

## Source provenance

- `ecc/commands/epic-unblock.md`
