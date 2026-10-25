---
name: common-code-review-standard
description: Code Review Standards. Use this standard for common code review standard.
category: core
sources:
- repository: ecc
  original_path: rules/common/code-review.md
  sha256: 275fcc2c05f51389cd0d050e704d45b1920210882eaab89d47f449bd3b2b6e98
principles:
- core/think-before-coding
- core/simplicity-first
- core/surgical-changes
- core/goal-driven-execution
---

> **Library use:** Apply the [compatibility and execution contract](../../COMPATIBILITY.md). Source roles, memory claims, command names, hooks, and integrations are instructions or prerequisites—not installed capabilities.

# Code Review Standards

## Purpose

Code review ensures quality, security, and maintainability before code is merged. This rule defines when and how to conduct code reviews.

## When to Review

**MANDATORY review triggers:**

- After writing or modifying code
- Before any commit to shared branches
- When security-sensitive code is changed (auth, payments, user data)
- When architectural changes are made
- Before merging pull requests

**Pre-Review Requirements:**

Before requesting review, ensure:

- All automated checks (CI/CD) are passing
- Merge conflicts are resolved
- Branch is up to date with target branch

## Review Checklist

Before marking code complete:

- [ ] Code is readable and well-named
- [ ] Functions are focused (<50 lines)
- [ ] Source files are cohesive (under the 800-line soft maintainability ceiling, or include a reason for a deliberate exception)
- [ ] No deep nesting (>4 levels)
- [ ] Errors are handled explicitly
- [ ] No hardcoded secrets or credentials
- [ ] No console.log or debug statements
- [ ] Tests exist for new functionality
- [ ] Test coverage meets 80% minimum

## Security Review Triggers

**STOP and use security-reviewer agent when:**

- Authentication or authorization code
- User input handling
- Database queries
- File system operations
- External API calls
- Cryptographic operations
- Payment or financial code

## Review Severity Levels

| Level | Meaning | Action |
|-------|---------|--------|
| CRITICAL | Security vulnerability or data loss risk | **BLOCK** - Must fix before merge |
| HIGH | Bug or significant quality issue | **WARN** - Should fix before merge |
| MEDIUM | Maintainability concern, including an unexplained source file over the soft 800-line ceiling | **INFO** - Consider fixing |
| LOW | Style or minor suggestion | **NOTE** - Optional |

## Agent Usage

Use these agents for code review:

| Agent | Purpose |
|-------|---------|
| **code-reviewer** | General code quality, patterns, best practices |
| **security-reviewer** | Security vulnerabilities, OWASP Top 10 |
| **typescript-reviewer** | TypeScript/JavaScript specific issues |
| **python-reviewer** | Python specific issues |
| **go-reviewer** | Go specific issues |
| **rust-reviewer** | Rust specific issues |

## Review Workflow

```
1. Run git diff to understand changes
2. Check security checklist first
3. Review code quality checklist
4. Run relevant tests
5. Verify coverage >= 80%
6. Use appropriate agent for detailed review
```

## Common Issues to Catch

### Security

- Hardcoded credentials (API keys, passwords, tokens)
- SQL injection (string concatenation in queries)
- XSS vulnerabilities (unescaped user input)
- Path traversal (unsanitized file paths)
- CSRF protection missing
- Authentication bypasses

### Code Quality

- Large functions (>50 lines) - split into smaller
- Large files (>800 lines) - extract modules
- Deep nesting (>4 levels) - use early returns
- Missing error handling - handle explicitly
- Mutation patterns - prefer immutable operations
- Missing tests - add test coverage

### Performance

- N+1 queries - use JOINs or batching
- Missing pagination - add LIMIT to queries
- Unbounded queries - add constraints
- Missing caching - cache expensive operations

## Approval Criteria

- **Approve**: No CRITICAL or HIGH issues
- **Warning**: Only HIGH issues (merge with caution)
- **Block**: CRITICAL issues found

## Integration with Other Rules

This rule works with:

- [testing.md](../common-testing-standard/SKILL.md) - Test coverage requirements
- [security.md](../common-security-standard/SKILL.md) - Security checklist
- [git-workflow.md](../common-git-workflow-standard/SKILL.md) - Commit standards
- [agents.md](../common-agents-standard/SKILL.md) - Agent delegation

## Related skills and principles

- [core/goal-driven-execution](../goal-driven-execution/SKILL.md)
- [core/simplicity-first](../simplicity-first/SKILL.md)
- [core/surgical-changes](../surgical-changes/SKILL.md)
- [core/think-before-coding](../think-before-coding/SKILL.md)
- [engineering/code-reviewer](../../engineering/code-reviewer/SKILL.md)
- [engineering/code-reviewer-ecc](../../engineering/code-reviewer-ecc/SKILL.md)
- [languages/go/go-reviewer](../../languages/go/go-reviewer/SKILL.md)
- [languages/python/python-reviewer](../../languages/python/python-reviewer/SKILL.md)
- [languages/rust/rust-reviewer](../../languages/rust/rust-reviewer/SKILL.md)
- [languages/typescript/typescript-reviewer](../../languages/typescript/typescript-reviewer/SKILL.md)
- [security/security-reviewer](../../security/security-reviewer/SKILL.md)
- [workflows/code-review](../../workflows/code-review/SKILL.md)

## Source provenance

- `ecc/rules/common/code-review.md`
