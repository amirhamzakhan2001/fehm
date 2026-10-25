---
name: documentation
description: Create task-appropriate documentation and reconcile it with implementation.
category: workflows
sources:
- repository: agency-agents
  original_path: engineering/engineering-technical-writer.md
  sha256: 70c8a29cddf7de486b41185693b4961af3fcccbc632b8df13ec43572859edc43
- repository: gstack
  original_path: document-generate/SKILL.md
  sha256: a5de4f4e9d3e49f51e739b851027af1ac7443878e2f940a15358ebf4148132e2
- repository: ecc
  original_path: agents/doc-updater.md
  sha256: 5018d3a0bf740d2263fd4b7a92412d53a62d4be151a71221d6549cacba62d72c
principles:
- core/think-before-coding
- core/simplicity-first
- core/surgical-changes
- core/goal-driven-execution
---

> **Library use:** Apply the [compatibility and execution contract](../../COMPATIBILITY.md). Source roles, memory claims, command names, hooks, and integrations are instructions or prerequisites—not installed capabilities.

# Documentation

## When to use

Create task-appropriate documentation and reconcile it with implementation.

## Inputs

User objective, project constraints, relevant source or evidence, and explicit success criteria.

## Procedure and handoffs

1. Load [the technical-writer procedure](../../documentation/technical-writer/SKILL.md). Identify audience, source of truth, and task.
2. Load [the document-generate procedure](../../documentation/document-generate/SKILL.md). Select Diataxis tutorial, how-to, reference, or explanation and ground it in the code.
3. Load [the doc-updater procedure](../../documentation/doc-updater/SKILL.md). Check examples, links, codemaps, and stale claims; deliver updated docs.

## Verification and output

Produce the artifacts required by the selected procedures and an evidence-backed status: completed, failed, skipped with reason, or blocked on a named prerequisite. Carry unresolved findings forward. Do not treat an unavailable tool, an unrun check, or a reviewer failure as a pass.

## Scope and compatibility

Select stages proportionate to the task. Preserve required gates of the chosen variant; record exceptions. Read the [compatibility policy](../../COMPATIBILITY.md) before combining conflicting variants. These instructions do not grant tool access or authorize publishing, commits, deployment, or communications.

## Related skills and principles

- [core/goal-driven-execution](../../core/goal-driven-execution/SKILL.md)
- [core/simplicity-first](../../core/simplicity-first/SKILL.md)
- [core/surgical-changes](../../core/surgical-changes/SKILL.md)
- [core/think-before-coding](../../core/think-before-coding/SKILL.md)
- [documentation/doc-updater](../../documentation/doc-updater/SKILL.md)
- [documentation/document-generate](../../documentation/document-generate/SKILL.md)
- [documentation/technical-writer](../../documentation/technical-writer/SKILL.md)

## Source provenance

- `agency-agents/engineering/engineering-technical-writer.md`
- `gstack/document-generate/SKILL.md`
- `ecc/agents/doc-updater.md`
