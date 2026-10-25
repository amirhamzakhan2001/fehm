---
name: cpp-hooks-standard
description: C++ Hooks. Use this standard for cpp hooks standard.
category: languages/cpp
sources:
- repository: ecc
  original_path: rules/cpp/hooks.md
  sha256: 51c511ea9706f53399649a52030484e14317b26f717488807a1faa2a2b9e0331
principles:
- core/think-before-coding
- core/simplicity-first
- core/surgical-changes
- core/goal-driven-execution
---

> **Library use:** Apply the [compatibility and execution contract](../../../COMPATIBILITY.md). Source roles, memory claims, command names, hooks, and integrations are instructions or prerequisites—not installed capabilities.

# C++ Hooks

> This file extends [common/hooks.md](../../../core/common-hooks-standard/SKILL.md) with C++ specific content.

## Build Hooks

Run these checks before committing C++ changes:

```bash
# Format check
clang-format --dry-run --Werror src/*.cpp src/*.hpp

# Static analysis
clang-tidy src/*.cpp -- -std=c++17

# Build
cmake --build build

# Tests
ctest --test-dir build --output-on-failure
```

## Recommended CI Pipeline

1. **clang-format** — formatting check
2. **clang-tidy** — static analysis
3. **cppcheck** — additional analysis
4. **cmake build** — compilation
5. **ctest** — test execution with sanitizers

## Related skills and principles

- [core/goal-driven-execution](../../../core/goal-driven-execution/SKILL.md)
- [core/simplicity-first](../../../core/simplicity-first/SKILL.md)
- [core/surgical-changes](../../../core/surgical-changes/SKILL.md)
- [core/think-before-coding](../../../core/think-before-coding/SKILL.md)

## Source provenance

- `ecc/rules/cpp/hooks.md`
