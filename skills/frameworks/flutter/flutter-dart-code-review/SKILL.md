---
name: flutter-dart-code-review
description: Library-agnostic Flutter/Dart code review checklist covering widget best practices, state management
  patterns (BLoC, Riverpod, Provider, GetX, MobX, Signals), Dart idioms, performance, accessibility, security, and
  clean architecture. Use when reviewing Flutter or Dart code, whatever state management library the project uses.
category: frameworks/flutter
sources:
- repository: ecc
  original_path: skills/flutter-dart-code-review/SKILL.md
  sha256: 5ceac13c9b99c97340f9a47c081737aceee1f803ed9045b7fbc980243b01db03
principles:
- core/think-before-coding
- core/simplicity-first
- core/surgical-changes
- core/goal-driven-execution
---

> **Library use:** Apply the [compatibility and execution contract](../../../COMPATIBILITY.md). Source roles, memory claims, command names, hooks, and integrations are instructions or prerequisites—not installed capabilities.

# Flutter Dart Code Review

Library-agnostic Flutter/Dart code review checklist covering widget best practices, state management patterns (BLoC, Riverpod, Provider, GetX, MobX, Signals), Dart idioms, performance, accessibility, security, and clean architecture. Use when reviewing Flutter or Dart code, whatever state management library the project uses.

## Required procedure

Read [the complete methodology](references/methodology.md) before performing this skill. It retains the full procedure, examples, constraints, and failure handling.

Procedure topics: Flutter/Dart Code Review Best Practices; 1. General Project Health; 2. Dart Language Pitfalls; 3. Widget Best Practices; Widget decomposition:; Const usage:; Key usage:; Theming & design system:; Build method complexity:; 4. State Management (Library-Agnostic); Architecture:; Immutability & value equality (for immutable-state solutions: BLoC, Riverpod, Redux):; Reactivity discipline (for reactive-mutation solutions: MobX, GetX, Signals):; State shape design:.

## Related skills and principles

- [core/goal-driven-execution](../../../core/goal-driven-execution/SKILL.md)
- [core/simplicity-first](../../../core/simplicity-first/SKILL.md)
- [core/surgical-changes](../../../core/surgical-changes/SKILL.md)
- [core/think-before-coding](../../../core/think-before-coding/SKILL.md)

## Source provenance

- `ecc/skills/flutter-dart-code-review/SKILL.md`
