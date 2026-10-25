---
name: hookify-help
description: Get help with the hookify system
category: developer-experience
sources:
- repository: ecc
  original_path: commands/hookify-help.md
  sha256: 11c4beec77187548978f4022cf76b3e077c0a04365f0b0d2464d06ca053c91a2
principles:
- core/think-before-coding
- core/simplicity-first
- core/surgical-changes
- core/goal-driven-execution
---

> **Library use:** Apply the [compatibility and execution contract](../../COMPATIBILITY.md). Source roles, memory claims, command names, hooks, and integrations are instructions or prerequisites—not installed capabilities.

Display comprehensive hookify documentation.

## Hook System Overview

Hookify creates rule files that integrate with Claude Code's hook system to prevent unwanted behaviors.

### Event Types

- `bash`: triggers on Bash tool use and matches command patterns
- `file`: triggers on Write/Edit tool use and matches file paths
- `stop`: triggers when a session ends
- `prompt`: triggers on user message submission and matches input patterns
- `all`: triggers on all events

### Rule File Format

Files are stored as `.claude/hookify.{name}.local.md`:

```yaml
---
name: descriptive-name
enabled: true
event: bash|file|stop|prompt|all
action: block|warn
pattern: "regex pattern to match"
---
Message to display when rule triggers.
Supports multiple lines.
```

### Commands

- `/hookify [description]` creates new rules and auto-analyzes the conversation when no description is given
- `/hookify-list` lists configured rules
- `/hookify-configure` toggles rules on or off

### Pattern Tips

- use regex syntax
- for `bash`, match against the full command string
- for `file`, match against the file path
- test patterns before deploying

## Related skills and principles

- [core/goal-driven-execution](../../core/goal-driven-execution/SKILL.md)
- [core/simplicity-first](../../core/simplicity-first/SKILL.md)
- [core/surgical-changes](../../core/surgical-changes/SKILL.md)
- [core/think-before-coding](../../core/think-before-coding/SKILL.md)
- [developer-experience/hookify](../hookify/SKILL.md)
- [developer-experience/hookify-configure](../hookify-configure/SKILL.md)
- [developer-experience/hookify-list](../hookify-list/SKILL.md)

## Source provenance

- `ecc/commands/hookify-help.md`
