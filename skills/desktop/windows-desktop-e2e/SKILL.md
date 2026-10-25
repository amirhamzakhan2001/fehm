---
name: windows-desktop-e2e
description: E2E testing for Windows native desktop apps (WPF, WinForms, Win32/MFC, Qt) using pywinauto and Windows
  UI Automation. Use when writing E2E tests for a Windows native desktop app with pywinauto or UI Automation.
category: desktop
sources:
- repository: ecc
  original_path: skills/windows-desktop-e2e/SKILL.md
  sha256: cbc93a1e2514ecdcee30da744aa13eb6c0ebe4948ca3dfff52b287df4f9f0814
principles:
- core/think-before-coding
- core/simplicity-first
- core/surgical-changes
- core/goal-driven-execution
---

> **Library use:** Apply the [compatibility and execution contract](../../COMPATIBILITY.md). Source roles, memory claims, command names, hooks, and integrations are instructions or prerequisites—not installed capabilities.

# Windows Desktop E2E

E2E testing for Windows native desktop apps (WPF, WinForms, Win32/MFC, Qt) using pywinauto and Windows UI Automation. Use when writing E2E tests for a Windows native desktop app with pywinauto or UI Automation.

## Required procedure

Read [the complete methodology](references/methodology.md) before performing this skill. It retains the full procedure, examples, constraints, and failure handling.

Procedure topics: Windows Desktop E2E Testing; When to Activate; When NOT to Use; Core Concepts; Setup & Prerequisites; Python 3.8+, Windows only; Optional: screen recording; Install ffmpeg and add to PATH: https://ffmpeg.org/download.html; Testability Setup (by Framework); WPF; WinForms; Win32 / MFC; Qt — see dedicated section below; Page Object Model.

## Related skills and principles

- [core/goal-driven-execution](../../core/goal-driven-execution/SKILL.md)
- [core/simplicity-first](../../core/simplicity-first/SKILL.md)
- [core/surgical-changes](../../core/surgical-changes/SKILL.md)
- [core/think-before-coding](../../core/think-before-coding/SKILL.md)
- [languages/cpp/cpp-coding-standards](../../languages/cpp/cpp-coding-standards/SKILL.md)
- [languages/cpp/cpp-testing](../../languages/cpp/cpp-testing/SKILL.md)
- [memory/learn-ecc](../../memory/learn-ecc/SKILL.md)
- [testing/e2e-testing](../../testing/e2e-testing/SKILL.md)

## Source provenance

- `ecc/skills/windows-desktop-e2e/SKILL.md`
