---
name: ruby-security-standard
description: Ruby Security. Use this standard for ruby security standard.
category: languages/ruby
sources:
- repository: ecc
  original_path: rules/ruby/security.md
  sha256: 15802886a80d1ab0d7da6c4c0233eca08ee0f3828d388e82a77a882fcbef6af5
principles:
- core/think-before-coding
- core/simplicity-first
- core/surgical-changes
- core/goal-driven-execution
---

> **Library use:** Apply the [compatibility and execution contract](../../../COMPATIBILITY.md). Source roles, memory claims, command names, hooks, and integrations are instructions or prerequisites—not installed capabilities.

# Ruby Security

> This file extends [common/security.md](../../../core/common-security-standard/SKILL.md) with Ruby and Rails specific content.

## Rails Defaults

- Keep CSRF protection enabled for state-changing browser requests.
- Use strong parameters or typed boundary objects before mass assignment.
- Store secrets in Rails credentials, environment variables, or a secret manager. Never commit plaintext keys, tokens, private credentials, or copied `.env` values.

## SQL And Active Record

- Prefer Active Record query APIs and parameterized SQL.
- Never interpolate request, cookie, header, job, or webhook values into SQL strings.
- Scope model callbacks carefully; security-sensitive side effects should be explicit and covered by tests.

## Authentication And Sessions

- Use the Rails 8 authentication generator for simple session auth, or Devise when OAuth, MFA, confirmable, lockable, multi-model auth, or existing Devise conventions are required.
- Rotate sessions after sign-in and privilege changes.
- Protect account recovery flows with expiry, single-use tokens, rate limiting, and audit logging.

## Dependencies

- Run dependency checks when the lockfile changes:

```bash
bundle exec bundle-audit check --update
bundle exec brakeman --no-progress
```

- Review new gems for maintainer activity, native extension risk, transitive dependencies, and whether the same behavior can be implemented with Rails core.

## Web Safety

- Escape template output by default. Treat `html_safe`, `raw`, and custom sanitizers as security-sensitive code.
- Validate file uploads by content type, extension, size, and storage destination.
- Treat background jobs, webhooks, Action Cable messages, and Turbo Stream inputs as untrusted boundaries.

## Reference

See skill: `security-review` for secure-by-default review patterns.

## Related skills and principles

- [core/goal-driven-execution](../../../core/goal-driven-execution/SKILL.md)
- [core/simplicity-first](../../../core/simplicity-first/SKILL.md)
- [core/surgical-changes](../../../core/surgical-changes/SKILL.md)
- [core/think-before-coding](../../../core/think-before-coding/SKILL.md)
- [security/application-security-review](../../../security/application-security-review/SKILL.md)

## Source provenance

- `ecc/rules/ruby/security.md`
