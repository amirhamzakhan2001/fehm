---
name: python-security-standard
description: Python Security. Use this standard for python security standard.
category: languages/python
sources:
- repository: ecc
  original_path: rules/python/security.md
  sha256: 6bbbb6c800cdfef23c3f9a5055ce31096a7724b51f0d528935f6c32970639453
principles:
- core/think-before-coding
- core/simplicity-first
- core/surgical-changes
- core/goal-driven-execution
---

> **Library use:** Apply the [compatibility and execution contract](../../../COMPATIBILITY.md). Source roles, memory claims, command names, hooks, and integrations are instructions or prerequisites—not installed capabilities.

# Python Security

> This file extends [common/security.md](../../../core/common-security-standard/SKILL.md) with Python specific content.

## Secret Management

```python
import os
from dotenv import load_dotenv

load_dotenv()

api_key = os.environ["OPENAI_API_KEY"]  # Raises KeyError if missing
```

## Security Scanning

- Use **bandit** for static security analysis:
  ```bash
  bandit -r src/
  ```

## Reference

See skill: `django-security` for Django-specific security guidelines (if applicable).

## Related skills and principles

- [core/goal-driven-execution](../../../core/goal-driven-execution/SKILL.md)
- [core/simplicity-first](../../../core/simplicity-first/SKILL.md)
- [core/surgical-changes](../../../core/surgical-changes/SKILL.md)
- [core/think-before-coding](../../../core/think-before-coding/SKILL.md)
- [frameworks/django/django-security](../../../frameworks/django/django-security/SKILL.md)

## Source provenance

- `ecc/rules/python/security.md`
