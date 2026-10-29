---
name: slop-scan
description: 'Slop-scan: what to fix, what to leave. Use this methodology for slop scan.'
category: engineering
sources:
- repository: gstack
  original_path: docs/SLOP_SCAN.md
  sha256: df6fab494861fc903e09ebdbb267a5c5afe36bdfb82e9c751ee3aeda2e19f238
principles:
- core/think-before-coding
- core/simplicity-first
- core/surgical-changes
- core/goal-driven-execution
---

> **Library use:** Apply the [compatibility and execution contract](../../COMPATIBILITY.md). Source roles, memory claims, command names, hooks, and integrations are instructions or prerequisites—not installed capabilities.

# Slop-scan: what to fix, what to leave

Moved verbatim from CLAUDE.md (token-load reduction). Read before acting
on any slop-scan finding.

### What to fix (genuine quality improvements)

- **Empty catches around file ops** — use `safeUnlink()` (ignores ENOENT, rethrows
  EPERM/EIO). A swallowed EPERM in cleanup means silent data loss.
- **Empty catches around process kills** — use `safeKill()` (ignores ESRCH, rethrows
  EPERM). A swallowed EPERM means you think you killed something you didn't.
- **Redundant `return await`** — remove when there's no enclosing try block. Saves a
  microtask, signals intent.
- **Typed exception catches** — `catch (err) { if (!(err instanceof TypeError)) throw err }`
  is genuinely better than `catch {}` when the try block does URL parsing or DOM work.
  You know what error you expect, so say so.

### What NOT to fix (linter gaming, not quality)

- **String-matching on error messages** — `err.message.includes('closed')` is brittle.
  Playwright/Chrome can change wording anytime. If a fire-and-forget operation can fail
  for ANY reason and you don't care, `catch {}` is the correct pattern.
- **Adding comments to exempt pass-through wrappers** — "alias for active session" above
  a method just to trip slop-scan's exemption rule is noise, not documentation.
- **Converting extension catch-and-log to selective rethrow** — Chrome extensions crash
  entirely on uncaught errors. If the catch logs and continues, that IS the right pattern
  for extension code. Don't make it throw.
- **Tightening best-effort cleanup paths** — shutdown, emergency cleanup, and disconnect
  code should use `safeUnlinkQuiet()` (swallows ALL errors). A cleanup path that throws
  on EPERM means the rest of cleanup doesn't run. That's worse.

### Utilities in `lib/error-handling.ts` (re-exported from `browse/src/error-handling.ts`)

| Function | Use when | Behavior |
|----------|----------|----------|
| `safeUnlink(path)` | Normal file deletion | Ignores ENOENT, rethrows others |
| `safeUnlinkQuiet(path)` | Shutdown/emergency cleanup | Swallows all errors |
| `safeKill(pid, signal)` | Sending signals | Ignores ESRCH, rethrows others |
| `isProcessAlive(pid)` | Boolean process checks | Returns true/false, never throws |

### Score tracking

Baseline (2026-04-09, before cleanup): 100 findings, 432.8 score, 2.38 score/file.
After cleanup: 90 findings, 358.1 score, 1.96 score/file.

Don't chase the number. Fix patterns that represent actual code quality problems.
Accept findings where the "sloppy" pattern is the correct engineering choice.

## Runtime prerequisites

See [the dependency ledger](../../DEPENDENCIES.md) and this skill’s records in [dependencies.json](../../dependencies.json). Native gstack/ECC CLIs, browsers, hooks, model tools, credentials, and memory stores must be available before invoking their steps. No runtime installation or execution has been performed. CSO requires its trusted helper; do not emulate that helper on the host.

## Related skills and principles

- [core/goal-driven-execution](../../core/goal-driven-execution/SKILL.md)
- [core/simplicity-first](../../core/simplicity-first/SKILL.md)
- [core/surgical-changes](../../core/surgical-changes/SKILL.md)
- [core/think-before-coding](../../core/think-before-coding/SKILL.md)
- [developer-experience/browse](../../developer-experience/browse/SKILL.md)

## Source provenance

- `gstack/docs/SLOP_SCAN.md`
