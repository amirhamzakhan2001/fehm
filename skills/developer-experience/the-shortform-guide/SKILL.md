---
name: the-shortform-guide
description: The Shorthand Guide to Everything Claude Code. Use this methodology for the shortform guide.
category: developer-experience
sources:
- repository: ecc
  original_path: the-shortform-guide.md
  sha256: 0a0729d48fb25b4625b9dc0bcaf1e74a57002cd460369e7a8e38750f0efbb55a
principles:
- core/think-before-coding
- core/simplicity-first
- core/surgical-changes
- core/goal-driven-execution
---

> **Library use:** Apply the [compatibility and execution contract](../../COMPATIBILITY.md). Source roles, memory claims, command names, hooks, and integrations are instructions or prerequisites—not installed capabilities.

# The Shortform Guide

The Shorthand Guide to Everything Claude Code. Use this methodology for the shortform guide.

## Required procedure

Read [the complete methodology](references/methodology.md) before performing this skill. It retains the full procedure, examples, constraints, and failure handling.

Procedure topics: The Shorthand Guide to Everything Claude Code; Skills and Commands; Example skill structure; Hooks; Subagents; Example subagent structure; Rules and Memory; MCPs (Model Context Protocol); Check enabled MCPs; Disable unused ones in ~/.claude/settings.json or in the current repo's .mcp.json; Plugins; Add a marketplace; mgrep plugin by @mixedbread-ai; Open Claude, run /plugins, find new marketplace, install from there.

## Runtime prerequisites

See [the dependency ledger](../../DEPENDENCIES.md) and this skill’s records in [dependencies.json](../../dependencies.json). Native gstack/ECC CLIs, browsers, hooks, model tools, credentials, and memory stores must be available before invoking their steps. No runtime installation or execution has been performed. CSO requires its trusted helper; do not emulate that helper on the host.

## Related skills and principles

- [core/goal-driven-execution](../../core/goal-driven-execution/SKILL.md)
- [core/simplicity-first](../../core/simplicity-first/SKILL.md)
- [core/surgical-changes](../../core/surgical-changes/SKILL.md)
- [core/think-before-coding](../../core/think-before-coding/SKILL.md)
- [developer-experience/hookify](../hookify/SKILL.md)
- [developer-experience/the-longform-guide](../the-longform-guide/SKILL.md)
- [engineering/refactor-clean](../../engineering/refactor-clean/SKILL.md)
- [testing/test-coverage](../../testing/test-coverage/SKILL.md)

## Source provenance

- `ecc/the-shortform-guide.md`
