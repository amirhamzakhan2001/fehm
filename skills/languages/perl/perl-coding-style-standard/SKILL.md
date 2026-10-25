---
name: perl-coding-style-standard
description: Perl Coding Style. Use this standard for perl coding style standard.
category: languages/perl
sources:
- repository: ecc
  original_path: rules/perl/coding-style.md
  sha256: 4f134e0da0e332280e6c6803c5dec6edb38088c42f4bb6270c27e81f579a853a
principles:
- core/think-before-coding
- core/simplicity-first
- core/surgical-changes
- core/goal-driven-execution
---

> **Library use:** Apply the [compatibility and execution contract](../../../COMPATIBILITY.md). Source roles, memory claims, command names, hooks, and integrations are instructions or prerequisites—not installed capabilities.

# Perl Coding Style

> This file extends [common/coding-style.md](../../../core/common-coding-style-standard/SKILL.md) with Perl-specific content.

## Standards

- Always `use v5.36` (enables `strict`, `warnings`, `say`, subroutine signatures)
- Use subroutine signatures — never unpack `@_` manually
- Prefer `say` over `print` with explicit newlines

## Immutability

- Use **Moo** with `is => 'ro'` and `Types::Standard` for all attributes
- Never use blessed hashrefs directly — always use Moo/Moose accessors
- **OO override note**: Moo `has` attributes with `builder` or `default` are acceptable for computed read-only values

## Formatting

Use **perltidy** with these settings:

```
-i=4    # 4-space indent
-l=100  # 100 char line length
-ce     # cuddled else
-bar    # opening brace always right
```

## Linting

Use **perlcritic** at severity 3 with themes: `core`, `pbp`, `security`.

```bash
perlcritic --severity 3 --theme 'core || pbp || security' lib/
```

## Reference

See skill: `perl-patterns` for comprehensive modern Perl idioms and best practices.

## Related skills and principles

- [core/goal-driven-execution](../../../core/goal-driven-execution/SKILL.md)
- [core/simplicity-first](../../../core/simplicity-first/SKILL.md)
- [core/surgical-changes](../../../core/surgical-changes/SKILL.md)
- [core/think-before-coding](../../../core/think-before-coding/SKILL.md)
- [frontend/web-security-standard](../../../frontend/web-security-standard/SKILL.md)
- [languages/perl/perl-patterns](../perl-patterns/SKILL.md)

## Source provenance

- `ecc/rules/perl/coding-style.md`
