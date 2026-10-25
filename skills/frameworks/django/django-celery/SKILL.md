---
name: django-celery
description: Django + Celery async task patterns — configuration, task design, beat scheduling, retries, canvas
  workflows, monitoring, and testing. Use when adding background jobs, scheduled tasks, or async processing to a
  Django app.
category: frameworks/django
sources:
- repository: ecc
  original_path: skills/django-celery/SKILL.md
  sha256: 1f9189ece910eb90a5d2cd520a9a6238ccb89a3e48629ac1ad9b55ec3eb21f88
principles:
- core/think-before-coding
- core/simplicity-first
- core/surgical-changes
- core/goal-driven-execution
---

> **Library use:** Apply the [compatibility and execution contract](../../../COMPATIBILITY.md). Source roles, memory claims, command names, hooks, and integrations are instructions or prerequisites—not installed capabilities.

# Django Celery

Django + Celery async task patterns — configuration, task design, beat scheduling, retries, canvas workflows, monitoring, and testing. Use when adding background jobs, scheduled tasks, or async processing to a Django app.

## Required procedure

Read [the complete methodology](references/methodology.md) before performing this skill. It retains the full procedure, examples, constraints, and failure handling.

Procedure topics: Django + Celery Async Task Patterns; When to Activate; Project Setup; Installation; `celery.py` — App Entrypoint; config/celery.py; config/__init__.py; Django Settings; config/settings/base.py; Broker (Redis recommended for production); Serialization; Task behavior; Result persistence; Beat scheduler (for periodic tasks).

## Related skills and principles

- [core/goal-driven-execution](../../../core/goal-driven-execution/SKILL.md)
- [core/simplicity-first](../../../core/simplicity-first/SKILL.md)
- [core/surgical-changes](../../../core/surgical-changes/SKILL.md)
- [core/think-before-coding](../../../core/think-before-coding/SKILL.md)
- [frameworks/django/django-patterns](../django-patterns/SKILL.md)
- [frameworks/django/django-tdd](../django-tdd/SKILL.md)
- [languages/python/python-testing](../../../languages/python/python-testing/SKILL.md)

## Source provenance

- `ecc/skills/django-celery/SKILL.md`
