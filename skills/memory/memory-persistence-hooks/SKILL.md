---
name: memory-persistence-hooks
description: Memory Persistence Hooks. Use this methodology for memory persistence hooks.
category: memory
sources:
- repository: ecc
  original_path: hooks/memory-persistence/README.md
  sha256: 020dc83bf19a4d0a887ee0683c087ebf14fc77f01d178e271277d6912a31bdf5
principles: []
---

> **Library use:** Apply the [compatibility and execution contract](../../COMPATIBILITY.md). Source roles, memory claims, command names, hooks, and integrations are instructions or prerequisites—not installed capabilities.

# Memory Persistence Hooks

These lifecycle hook definitions document ECC's memory persistence contract for Claude Code plugin and manual installs.

The executable implementations live in `scripts/hooks/`:

- `session-start.js` loads bounded prior context, detects project state, and prepares session metadata.
- `pre-compact.js` captures state before context compaction.
- `session-end.js` persists session-end summaries when transcript metadata is available.
- `observe-runner.js` records tool-use observations for continuous learning.
- `session-activity-tracker.js` records tool usage and file activity for ECC2 status and observability.

The installed hook graph is still `hooks/hooks.json`. This directory is the stable, human-readable lifecycle definition surface referenced by the harness audit and longform docs.

## Lifecycle Contract

| Event | Hook | Purpose | Blocking |
|---|---|---|---|
| `SessionStart` | `session:start` | Load bounded prior context and project metadata | no |
| `PreCompact` | `pre:compact` | Save state before compaction | no |
| `PreToolUse` | `pre:observe:continuous-learning` | Capture tool intent for learning signals | no |
| `PostToolUse` | `post:observe:continuous-learning` | Capture tool result for learning signals | no |
| `PostToolUse` | `post:session-activity-tracker` | Record tool and file activity for ECC2 metrics | no |
| `Stop` | `stop:format-typecheck` | Batch quality gate after edits | yes on hook failure |
| `Stop` | `stop:check-console-log` | Audit modified files for debug logging | warn/error by hook output |

## Operator Expectations

- Keep persistence local by default.
- Avoid sending transcripts or tool traces to hosted services unless a user explicitly enables an integration.
- Bound context loaded at session start with `ECC_SESSION_START_MAX_CHARS`.
- Allow opt-out with `ECC_SESSION_START_CONTEXT=off`.
- Keep lifecycle hooks profile-gated through `ECC_HOOK_PROFILE` and `ECC_DISABLED_HOOKS`.

## Related Files

- `hooks/hooks.json`
- `../../developer-experience/hook-lifecycle/SKILL.md`
- `scripts/hooks/session-start.js`
- `scripts/hooks/pre-compact.js`
- `scripts/hooks/session-end.js`
- `scripts/hooks/observe-runner.js`
- `scripts/hooks/session-activity-tracker.js`
- `docs/architecture/observability-readiness.md`

## Supporting material

See the [selective resource index](references/INDEX.md) for checklists, templates, examples, and reference implementations.

## Runtime prerequisites

See [the dependency ledger](../../DEPENDENCIES.md) and this skill’s records in [dependencies.json](../../dependencies.json). Native gstack/ECC CLIs, browsers, hooks, model tools, credentials, and memory stores must be available before invoking their steps. No runtime installation or execution has been performed. CSO requires its trusted helper; do not emulate that helper on the host.

## Related skills and principles

- [frontend/web-hooks-standard](../../frontend/web-hooks-standard/SKILL.md)

## Source provenance

- `ecc/hooks/memory-persistence/README.md`
