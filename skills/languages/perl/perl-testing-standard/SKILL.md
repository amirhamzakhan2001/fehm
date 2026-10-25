---
name: perl-testing-standard
description: Perl Testing. Use this standard for perl testing standard.
category: languages/perl
sources:
- repository: ecc
  original_path: rules/perl/testing.md
  sha256: 4e8377928b5da585aebeaa278e3f293365d84df7819cb44d8efb1b5dc4631e68
principles:
- core/think-before-coding
- core/simplicity-first
- core/surgical-changes
- core/goal-driven-execution
---

> **Library use:** Apply the [compatibility and execution contract](../../../COMPATIBILITY.md). Source roles, memory claims, command names, hooks, and integrations are instructions or prerequisites—not installed capabilities.

# Perl Testing

> This file extends [common/testing.md](../../../core/common-testing-standard/SKILL.md) with Perl-specific content.

## Framework

Use **Test2::V0** for new projects (not Test::More):

```perl
use Test2::V0;

is($result, 42, 'answer is correct');

done_testing;
```

## Runner

```bash
prove -l t/              # adds lib/ to @INC
prove -lr -j8 t/         # recursive, 8 parallel jobs
```

Always use `-l` to ensure `lib/` is on `@INC`.

## Coverage

Use **Devel::Cover** — target 80%+:

```bash
cover -test
```

## Mocking

- **Test::MockModule** — mock methods on existing modules
- **Test::MockObject** — create test doubles from scratch

## Pitfalls

- Always end test files with `done_testing`
- Never forget the `-l` flag with `prove`

## Reference

See skill: `perl-testing` for detailed Perl TDD patterns with Test2::V0, prove, and Devel::Cover.

## Related skills and principles

- [core/goal-driven-execution](../../../core/goal-driven-execution/SKILL.md)
- [core/simplicity-first](../../../core/simplicity-first/SKILL.md)
- [core/surgical-changes](../../../core/surgical-changes/SKILL.md)
- [core/think-before-coding](../../../core/think-before-coding/SKILL.md)
- [languages/perl/perl-testing](../perl-testing/SKILL.md)

## Source provenance

- `ecc/rules/perl/testing.md`
