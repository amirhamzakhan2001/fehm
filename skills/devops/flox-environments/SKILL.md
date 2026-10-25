---
name: flox-environments
description: Create reproducible, cross-platform (macOS/Linux) development environments with Flox, a declarative
  Nix-based environment manager. Use when setting up project toolchains for any language, installing system-level
  dependencies (compilers, databases, native libs like openssl/BLAS), pinning exact package versions for a team,
  running local services (PostgreSQL, Redis, Kafka), onboarding developers with one command, or solving 'works on
  my machine' problems — including agent/vibe-coding setups that need project-scoped tools without sudo. Also use
  when the user mentions .flox/, manifest.toml, flox activate, or FloxHub.
category: devops
sources:
- repository: ecc
  original_path: skills/flox-environments/SKILL.md
  sha256: d15e0af4d6f57ea085482f163d0d1658279301202b161087e9e6f66e7f4b91c9
principles:
- core/think-before-coding
- core/simplicity-first
- core/surgical-changes
- core/goal-driven-execution
---

> **Library use:** Apply the [compatibility and execution contract](../../COMPATIBILITY.md). Source roles, memory claims, command names, hooks, and integrations are instructions or prerequisites—not installed capabilities.

# Flox Environments

Create reproducible, cross-platform (macOS/Linux) development environments with Flox, a declarative Nix-based environment manager. Use when setting up project toolchains for any language, installing system-level dependencies (compilers, databases, native libs like openssl/BLAS), pinning exact package versions for a team, running local services (PostgreSQL, Redis, Kafka), onboarding developers with one command, or solving 'works on my machine' problems — including agent/vibe-coding setups that need project-scoped tools without sudo. Also use when the user mentions .flox/, manifest.toml, flox activate, or FloxHub.

## Required procedure

Read [the complete methodology](references/methodology.md) before performing this skill. It retains the full procedure, examples, constraints, and failure handling.

Procedure topics: Flox Environments; When to Activate; Core Concepts; Essential Commands; Manifest Structure; .flox/env/manifest.toml; Packages to install — the core of the environment; Static environment variables; Non-interactive setup scripts (run every activation); Shell functions and aliases (available in interactive shell); Supported platforms; Package Installation Patterns; Basic Installation; Version Pinning.

## Related skills and principles

- [core/goal-driven-execution](../../core/goal-driven-execution/SKILL.md)
- [core/simplicity-first](../../core/simplicity-first/SKILL.md)
- [core/surgical-changes](../../core/surgical-changes/SKILL.md)
- [core/think-before-coding](../../core/think-before-coding/SKILL.md)

## Source provenance

- `ecc/skills/flox-environments/SKILL.md`
