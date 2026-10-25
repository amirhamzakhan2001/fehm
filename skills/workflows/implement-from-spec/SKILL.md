---
name: implement-from-spec
description: Implement a piece of work based on a spec or set of tickets.
category: workflows
intents:
  - implement
sources:
  - repository: matt-pocock-skills
    original_path: skills/engineering/implement/SKILL.md
    sha256: 6d3fd9e83b8f36e5213854779db49b256a457a7ebb4a503e53fa7dcff696adc3
principles:
  - core/think-before-coding
  - core/simplicity-first
  - core/surgical-changes
  - core/goal-driven-execution
---

> **Library use:** Apply the [compatibility and execution contract](../../COMPATIBILITY.md). Source roles, memory claims, command names, hooks, and integrations are instructions or prerequisites—not installed capabilities.

Implement the work described by the user in the spec or tickets.

Use /tdd where possible, at pre-agreed seams.

Run typechecking regularly, single test files regularly, and the full test suite once at the end.

Once done, use /code-review to review the work.

Commit your work to the current branch.
