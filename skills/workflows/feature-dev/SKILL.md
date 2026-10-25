---
name: feature-dev
description: Guided feature development with codebase understanding and architecture focus
category: workflows
sources:
- repository: ecc
  original_path: commands/feature-dev.md
  sha256: b446c316f680a1ab709f2eabff15d5e88b57396f4581ea8b0f9260d04bd4be34
principles:
- core/think-before-coding
- core/simplicity-first
- core/surgical-changes
- core/goal-driven-execution
---

> **Library use:** Apply the [compatibility and execution contract](../../COMPATIBILITY.md). Source roles, memory claims, command names, hooks, and integrations are instructions or prerequisites—not installed capabilities.

A structured feature-development workflow that emphasizes understanding existing code before writing new code.

## Phases

### 1. Discovery

- read the feature request carefully
- identify requirements, constraints, and acceptance criteria
- ask clarifying questions if the request is ambiguous

### 2. Codebase Exploration

- use `code-explorer` to analyze the relevant existing code
- trace execution paths and architecture layers
- understand integration points and conventions

### 3. Clarifying Questions

- present findings from exploration
- ask targeted design and edge-case questions
- wait for user response before proceeding

### 4. Architecture Design

- use `code-architect` to design the feature
- provide the implementation blueprint
- wait for approval before implementing

### 5. Implementation

- implement the feature following the approved design
- prefer TDD where appropriate
- keep commits small and focused

### 6. Quality Review

- use `code-reviewer` to review the implementation
- address critical and important issues
- verify test coverage

### 7. Summary

- summarize what was built
- list follow-up items or limitations
- provide testing instructions

## Related skills and principles

- [architecture/code-architect](../../architecture/code-architect/SKILL.md)
- [code-intelligence/code-explorer](../../code-intelligence/code-explorer/SKILL.md)
- [core/goal-driven-execution](../../core/goal-driven-execution/SKILL.md)
- [core/simplicity-first](../../core/simplicity-first/SKILL.md)
- [core/surgical-changes](../../core/surgical-changes/SKILL.md)
- [core/think-before-coding](../../core/think-before-coding/SKILL.md)
- [engineering/code-reviewer-ecc](../../engineering/code-reviewer-ecc/SKILL.md)

## Source provenance

- `ecc/commands/feature-dev.md`
