---
name: kubernetes-patterns
description: Kubernetes workload patterns, resource management, RBAC, probes, autoscaling, ConfigMap/Secret handling,
  and kubectl debugging for production-grade deployments. Use when writing or reviewing Kubernetes manifests, or
  debugging probes, RBAC, autoscaling, or resource limits.
category: devops
sources:
- repository: ecc
  original_path: skills/kubernetes-patterns/SKILL.md
  sha256: 808b2ec032224e251f1bef9f6e9879e88e2e7abd0feb393632fb6042d8ac5ecc
principles:
- core/think-before-coding
- core/simplicity-first
- core/surgical-changes
- core/goal-driven-execution
---

> **Library use:** Apply the [compatibility and execution contract](../../COMPATIBILITY.md). Source roles, memory claims, command names, hooks, and integrations are instructions or prerequisites—not installed capabilities.

# Kubernetes Patterns

Kubernetes workload patterns, resource management, RBAC, probes, autoscaling, ConfigMap/Secret handling, and kubectl debugging for production-grade deployments. Use when writing or reviewing Kubernetes manifests, or debugging probes, RBAC, autoscaling, or resource limits.

## Required procedure

Read [the complete methodology](references/methodology.md) before performing this skill. It retains the full procedure, examples, constraints, and failure handling.

Procedure topics: Kubernetes Patterns; When to Activate; When to Use; How It Works; Examples; Core Workload Patterns; Deployment — Production Template; Probes — Liveness, Readiness, Startup; Correct pattern: startupProbe covers slow startup,; then liveness/readiness take over; WRONG: initialDelaySeconds without startupProbe; If the app takes 60s to start, set a startupProbe instead; Services and Ingress; Service Types.

## Related skills and principles

- [core/goal-driven-execution](../../core/goal-driven-execution/SKILL.md)
- [core/simplicity-first](../../core/simplicity-first/SKILL.md)
- [core/surgical-changes](../../core/surgical-changes/SKILL.md)
- [core/think-before-coding](../../core/think-before-coding/SKILL.md)
- [devops/docker-patterns](../docker-patterns/SKILL.md)
- [git/git-workflow](../../git/git-workflow/SKILL.md)
- [release/deployment-patterns](../../release/deployment-patterns/SKILL.md)
- [security/application-security-review](../../security/application-security-review/SKILL.md)

## Source provenance

- `ecc/skills/kubernetes-patterns/SKILL.md`
