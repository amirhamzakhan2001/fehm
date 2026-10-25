---
name: cpp-coding-style-standard
description: C++ Coding Style. Use this standard for cpp coding style standard.
category: languages/cpp
sources:
- repository: ecc
  original_path: rules/cpp/coding-style.md
  sha256: 3d25db0df6aa37cd58117d927020102b4e991fb820b9a6ff193058f0652be611
principles:
- core/think-before-coding
- core/simplicity-first
- core/surgical-changes
- core/goal-driven-execution
---

> **Library use:** Apply the [compatibility and execution contract](../../../COMPATIBILITY.md). Source roles, memory claims, command names, hooks, and integrations are instructions or prerequisites—not installed capabilities.

# C++ Coding Style

> This file extends [common/coding-style.md](../../../core/common-coding-style-standard/SKILL.md) with C++ specific content.

## Modern C++ (C++17/20/23)

- Prefer **modern C++ features** over C-style constructs
- Use `auto` when the type is obvious from context
- Use `constexpr` for compile-time constants
- Use structured bindings: `auto [key, value] = map_entry;`

## Resource Management

- **RAII everywhere** — no manual `new`/`delete`
- Use `std::unique_ptr` for exclusive ownership
- Use `std::shared_ptr` only when shared ownership is truly needed
- Use `std::make_unique` / `std::make_shared` over raw `new`

## Naming Conventions

- Types/Classes: `PascalCase`
- Functions/Methods: `snake_case` or `camelCase` (follow project convention)
- Constants: `kPascalCase` or `UPPER_SNAKE_CASE`
- Namespaces: `lowercase`
- Member variables: `snake_case_` (trailing underscore) or `m_` prefix

## Formatting

- Use **clang-format** — no style debates
- Run `clang-format -i <file>` before committing

## Reference

See skill: `cpp-coding-standards` for comprehensive C++ coding standards and guidelines.

## Related skills and principles

- [core/goal-driven-execution](../../../core/goal-driven-execution/SKILL.md)
- [core/simplicity-first](../../../core/simplicity-first/SKILL.md)
- [core/surgical-changes](../../../core/surgical-changes/SKILL.md)
- [core/think-before-coding](../../../core/think-before-coding/SKILL.md)
- [languages/cpp/cpp-coding-standards](../cpp-coding-standards/SKILL.md)

## Source provenance

- `ecc/rules/cpp/coding-style.md`
