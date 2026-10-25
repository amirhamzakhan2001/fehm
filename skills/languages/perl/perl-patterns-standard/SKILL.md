---
name: perl-patterns-standard
description: Perl Patterns. Use this standard for perl patterns standard.
category: languages/perl
sources:
- repository: ecc
  original_path: rules/perl/patterns.md
  sha256: 55a86b5bca376dc511bd9b4fa2d0b29985f4d7576aae715d68b760afe0628169
principles:
- core/think-before-coding
- core/simplicity-first
- core/surgical-changes
- core/goal-driven-execution
---

> **Library use:** Apply the [compatibility and execution contract](../../../COMPATIBILITY.md). Source roles, memory claims, command names, hooks, and integrations are instructions or prerequisites—not installed capabilities.

# Perl Patterns

> This file extends [common/patterns.md](../../../core/common-patterns-standard/SKILL.md) with Perl-specific content.

## Repository Pattern

Use **DBI** or **DBIx::Class** behind an interface:

```perl
package MyApp::Repo::User;
use Moo;

has dbh => (is => 'ro', required => 1);

sub find_by_id ($self, $id) {
    my $sth = $self->dbh->prepare('SELECT * FROM users WHERE id = ?');
    $sth->execute($id);
    return $sth->fetchrow_hashref;
}
```

## DTOs / Value Objects

Use **Moo** classes with **Types::Standard** (equivalent to Python dataclasses):

```perl
package MyApp::DTO::User;
use Moo;
use Types::Standard qw(Str Int);

has name  => (is => 'ro', isa => Str, required => 1);
has email => (is => 'ro', isa => Str, required => 1);
has age   => (is => 'ro', isa => Int);
```

## Resource Management

- Always use **three-arg open** with `autodie`
- Use **Path::Tiny** for file operations

```perl
use autodie;
use Path::Tiny;

my $content = path('config.json')->slurp_utf8;
```

## Module Interface

Use `Exporter 'import'` with `@EXPORT_OK` — never `@EXPORT`:

```perl
use Exporter 'import';
our @EXPORT_OK = qw(parse_config validate_input);
```

## Dependency Management

Use **cpanfile** + **carton** for reproducible installs:

```bash
carton install
carton exec prove -lr t/
```

## Reference

See skill: `perl-patterns` for comprehensive modern Perl patterns and idioms.

## Related skills and principles

- [core/goal-driven-execution](../../../core/goal-driven-execution/SKILL.md)
- [core/simplicity-first](../../../core/simplicity-first/SKILL.md)
- [core/surgical-changes](../../../core/surgical-changes/SKILL.md)
- [core/think-before-coding](../../../core/think-before-coding/SKILL.md)
- [languages/perl/perl-patterns](../perl-patterns/SKILL.md)

## Source provenance

- `ecc/rules/perl/patterns.md`
