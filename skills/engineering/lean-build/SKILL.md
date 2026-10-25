---
name: lean-build
description: Build feature work with high overbuilding risk. Use for new behavior, product slices, or integrations where repository reuse, strict scope, and an explicit stop condition matter.
category: engineering
intents:
  - implement
sources:
  - repository: caveman
    original_path: skills/lean-build/SKILL.md
    sha256: 4d498073c6312858b220e9a04b7456c2485c734edb077f6bb17d88a7ed96ad7a
principles:
  - core/think-before-coding
  - core/simplicity-first
  - core/surgical-changes
  - core/goal-driven-execution
---

> **Library use:** Apply the [compatibility and execution contract](../../COMPATIBILITY.md). Source roles, memory claims, command names, hooks, and integrations are instructions or prerequisites—not installed capabilities.

# Lean build

Native Core's architecture-first simplicity remains mandatory. Turn feature into complete narrow outcome fitting system.

- Derive observable acceptance and explicit non-goals from request and repository.
- Trace entry point through layers owning invariants.
- Deliver coherent end-to-end path across responsible layers; never force work into one file, direct expression, or local patch.
- Reuse fitting seam. Refactor when patching duplicates behavior, weakens ownership, or hides root cause.
- Omit modes, providers, config, extensibility, and polish unless acceptance needs them.
- Add surface, dependency, service, config, or migration only for lifecycle design or acceptance; state material tradeoff.
- Keep work runnable; preserve Core safety.

Exercise path. Run focused proof. Stop when acceptance passes. Report only material omissions and trigger.
