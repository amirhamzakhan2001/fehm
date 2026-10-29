---
name: perl-security-standard
description: Perl Security. Use this standard for perl security standard.
category: languages/perl
sources:
- repository: ecc
  original_path: rules/perl/security.md
  sha256: c3d0311c2bd9b0fbe94d079e410561fa6a918180925f86c29dfadd06d32a00b5
principles:
- core/think-before-coding
- core/simplicity-first
- core/surgical-changes
- core/goal-driven-execution
---

> **Library use:** Apply the [compatibility and execution contract](../../../COMPATIBILITY.md). Source roles, memory claims, command names, hooks, and integrations are instructions or prerequisites—not installed capabilities.

# Perl Security

> This file extends [common/security.md](../../../core/common-security-standard/SKILL.md) with Perl-specific content.

## Taint Mode

- Use `-T` flag on all CGI/web-facing scripts
- Sanitize `%ENV` (`$ENV{PATH}`, `$ENV{CDPATH}`, etc.) before any external command

## Input Validation

- Use allowlist regex for untainting — never `/(.*)/s`
- Validate all user input with explicit patterns:

```perl
if ($input =~ /\A([a-zA-Z0-9_-]+)\z/) {
    my $clean = $1;
}
```

## File I/O

- **Three-arg open only** — never two-arg open
- Prevent path traversal with `Cwd::realpath`:

```perl
use Cwd 'realpath';
my $safe_path = realpath($user_path);
die "Path traversal" unless $safe_path =~ m{\A/allowed/directory/};
```

## Process Execution

- Use **list-form `system()`** — never single-string form
- Use **IPC::Run3** for capturing output
- Never use backticks with variable interpolation

```perl
system('grep', '-r', $pattern, $directory);  # safe
```

## SQL Injection Prevention

Always use DBI placeholders — never interpolate into SQL:

```perl
my $sth = $dbh->prepare('SELECT * FROM users WHERE email = ?');
$sth->execute($email);
```

## Security Scanning

Run **perlcritic** with the security theme at severity 4+:

```bash
perlcritic --severity 4 --theme security lib/
```

## Reference

See skill: `perl-security` for comprehensive Perl security patterns, taint mode, and safe I/O.

## Related skills and principles

- [core/goal-driven-execution](../../../core/goal-driven-execution/SKILL.md)
- [core/simplicity-first](../../../core/simplicity-first/SKILL.md)
- [core/surgical-changes](../../../core/surgical-changes/SKILL.md)
- [core/think-before-coding](../../../core/think-before-coding/SKILL.md)
- [languages/perl/perl-security](../perl-security/SKILL.md)

## Source provenance

- `ecc/rules/perl/security.md`
