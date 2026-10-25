---
name: react-native-hooks-standard
description: React Native / Expo Hooks. Use this standard for react native hooks standard.
category: frameworks/react-native
sources:
- repository: ecc
  original_path: rules/react-native/hooks.md
  sha256: b9b2d1a70bb621b4e6899f76c23b7573ce89d27cc16773b2e5ca03edc8fdc00a
principles:
- core/think-before-coding
- core/simplicity-first
- core/surgical-changes
- core/goal-driven-execution
---

> **Library use:** Apply the [compatibility and execution contract](../../../COMPATIBILITY.md). Source roles, memory claims, command names, hooks, and integrations are instructions or prerequisites—not installed capabilities.

# React Native / Expo Hooks

> This file extends [common/hooks.md](../../../core/common-hooks-standard/SKILL.md) with React Native / Expo-specific automation guidance.

These are recommended PostToolUse automations to keep RN/Expo code healthy. Wire them in your hook runtime (or run manually); adapt commands to your package manager.

## Suggested PostToolUse checks (on edit of *.ts/*.tsx)

- **Type check:** `tsc --noEmit` — catch type errors early.
- **Lint:** `npx expo lint` (uses `eslint-config-expo`; flat config `eslint.config.js` is the default from SDK 53+).
- **Format:** `prettier --write` on changed files.

## Pre-release / periodic

- `npx expo-doctor` — validates Expo/native dependency health and config.
- `npx expo install --check` — keeps native deps aligned with the installed Expo SDK.
- `npm audit` — dependency vulnerability scan.

## Notes

- Do not run heavy native builds inside fast edit hooks; keep edit-time hooks to typecheck/lint/format.
- Reserve `eas build` / E2E for explicit commands or CI, not per-edit automation.
- Keep these consistent with ECC hook runtime controls (`ECC_HOOK_PROFILE`, `ECC_DISABLED_HOOKS`).

## Related skills and principles

- [core/goal-driven-execution](../../../core/goal-driven-execution/SKILL.md)
- [core/simplicity-first](../../../core/simplicity-first/SKILL.md)
- [core/surgical-changes](../../../core/surgical-changes/SKILL.md)
- [core/think-before-coding](../../../core/think-before-coding/SKILL.md)

## Source provenance

- `ecc/rules/react-native/hooks.md`
