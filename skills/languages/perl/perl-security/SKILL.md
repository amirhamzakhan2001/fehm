---
name: perl-security
description: Comprehensive Perl security covering taint mode, input validation, safe process execution, DBI parameterized
  queries, web security (XSS/SQLi/CSRF), and perlcritic security policies. Use when reviewing Perl input handling,
  process execution, DBI queries, or web-facing code.
category: languages/perl
sources:
- repository: ecc
  original_path: skills/perl-security/SKILL.md
  sha256: fd6dd778ed3b612dd8ee5f856d557b9328a1f92f87d5b69b91a53d58657531f6
principles:
- core/think-before-coding
- core/simplicity-first
- core/surgical-changes
- core/goal-driven-execution
---

> **Library use:** Apply the [compatibility and execution contract](../../../COMPATIBILITY.md). Source roles, memory claims, command names, hooks, and integrations are instructions or prerequisites—not installed capabilities.

# Perl Security

Comprehensive Perl security covering taint mode, input validation, safe process execution, DBI parameterized queries, web security (XSS/SQLi/CSRF), and perlcritic security policies. Use when reviewing Perl input handling, process execution, DBI queries, or web-facing code.

## Required procedure

Read [the complete methodology](references/methodology.md) before performing this skill. It retains the full procedure, examples, constraints, and failure handling.

Procedure topics: Perl Security Patterns; When to Activate; How It Works; Taint Mode; Enabling Taint Mode; Tainted: anything from outside the program; Sanitize PATH early (required in taint mode); Untainting Pattern; Good: Validate and untaint with a specific regex; Good: Validate and untaint a file path; Bad: Overly permissive untainting (defeats the purpose); Input Validation; Allowlist Over Blocklist; Good: Allowlist — define exactly what's permitted.

## Related skills and principles

- [core/goal-driven-execution](../../../core/goal-driven-execution/SKILL.md)
- [core/simplicity-first](../../../core/simplicity-first/SKILL.md)
- [core/surgical-changes](../../../core/surgical-changes/SKILL.md)
- [core/think-before-coding](../../../core/think-before-coding/SKILL.md)
- [languages/perl/perl-security-standard](../perl-security-standard/SKILL.md)

## Source provenance

- `ecc/skills/perl-security/SKILL.md`
