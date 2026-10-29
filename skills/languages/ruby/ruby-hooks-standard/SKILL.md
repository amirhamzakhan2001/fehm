---
name: ruby-hooks-standard
description: Ruby Hooks. Use this standard for ruby hooks standard.
category: languages/ruby
sources:
- repository: ecc
  original_path: rules/ruby/hooks.md
  sha256: 70d673bc40b8b1dc04d1b1a0530486506dce22712684561e3c750347a84f6b24
principles:
- core/think-before-coding
- core/simplicity-first
- core/surgical-changes
- core/goal-driven-execution
---

> **Library use:** Apply the [compatibility and execution contract](../../../COMPATIBILITY.md). Source roles, memory claims, command names, hooks, and integrations are instructions or prerequisites—not installed capabilities.

# Ruby Hooks

> This file extends [common/hooks.md](../../../core/common-hooks-standard/SKILL.md) with Ruby and Rails specific content.

## PostToolUse Hooks

Configure project-local hooks to prefer binstubs and checked-in tooling:

- **RuboCop**: run `bundle exec rubocop -A <file>` or the project's safer formatter command after Ruby edits.
- **Brakeman**: run `bundle exec brakeman --no-progress` after security-sensitive Rails changes.
- **Tests**: run the narrowest matching `bin/rails test ...` or `bundle exec rspec ...` command for touched files.
- **Bundler audit**: run `bundle exec bundle-audit check --update` when `Gemfile` or `Gemfile.lock` changes and the project has bundler-audit installed.

## Warnings

- Warn on committed `debugger`, `binding.irb`, `binding.pry`, `puts`, `pp`, or `p` calls in application code.
- Warn when an edit disables CSRF protection, expands mass-assignment, or adds raw SQL without parameterization.
- Warn when a migration changes data destructively without a reversible path or documented rollout plan.

## CI Gate Suggestions

```bash
bundle exec rubocop
bundle exec brakeman --no-progress
bin/rails test
bundle exec rspec
```

Use only the commands that are present in the project; do not install new hook dependencies without maintainer approval.

## Related skills and principles

- [core/goal-driven-execution](../../../core/goal-driven-execution/SKILL.md)
- [core/simplicity-first](../../../core/simplicity-first/SKILL.md)
- [core/surgical-changes](../../../core/surgical-changes/SKILL.md)
- [core/think-before-coding](../../../core/think-before-coding/SKILL.md)

## Source provenance

- `ecc/rules/ruby/hooks.md`
