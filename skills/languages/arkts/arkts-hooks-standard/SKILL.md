---
name: arkts-hooks-standard
description: HarmonyOS / ArkTS Hooks. Use this standard for arkts hooks standard.
category: languages/arkts
sources:
- repository: ecc
  original_path: rules/arkts/hooks.md
  sha256: 58bc4133ecdf5bd81fd32fb228206a552445cddb0e868228d829fd390a807b2c
principles:
- core/think-before-coding
- core/simplicity-first
- core/surgical-changes
- core/goal-driven-execution
---

> **Library use:** Apply the [compatibility and execution contract](../../../COMPATIBILITY.md). Source roles, memory claims, command names, hooks, and integrations are instructions or prerequisites—not installed capabilities.

# HarmonyOS / ArkTS Hooks

> This file extends [common/hooks.md](../../../core/common-hooks-standard/SKILL.md) with HarmonyOS-specific build and validation hooks.

## Build Commands

### HAP Package Build

```bash
# Build HAP package (global hvigor environment)
hvigorw assembleHap -p product=default

# Build with specific module
hvigorw assembleHap -p module=entry -p product=default

# Clean build
hvigorw clean
```

### DevEco Studio CLI

```bash
# Check project structure
hvigorw --version

# Install dependencies
ohpm install

# Update dependencies
ohpm update
```

## Recommended PostToolUse Hooks

### After Editing .ets/.ts Files

Run hvigor build to check for ArkTS compilation errors:

```json
{
  "type": "PostToolUse",
  "matcher": {
    "tool": ["Edit", "Write"],
    "filePath": ["**/*.ets", "**/*.ts"]
  },
  "hooks": [
    {
      "command": "hvigorw assembleHap -p product=default 2>&1 | tail -20",
      "async": true,
      "timeout": 60000
    }
  ]
}
```

### After Editing module.json5

Validate permission and ability declarations:

```json
{
  "type": "PostToolUse",
  "matcher": {
    "tool": "Edit",
    "filePath": "**/module.json5"
  },
  "hooks": [
    {
      "command": "echo '[HarmonyOS] module.json5 modified - verify permissions and abilities'",
      "async": false
    }
  ]
}
```

### After Editing oh-package.json5

Reinstall dependencies:

```json
{
  "type": "PostToolUse",
  "matcher": {
    "tool": "Edit",
    "filePath": "**/oh-package.json5"
  },
  "hooks": [
    {
      "command": "ohpm install 2>&1 | tail -10",
      "async": true,
      "timeout": 30000
    }
  ]
}
```

## PreToolUse Hooks

### V1 Decorator Guard

Warn when code contains V1 state management decorators:

```json
{
  "type": "PreToolUse",
  "matcher": {
    "tool": ["Write", "Edit"],
    "filePath": "**/*.ets"
  },
  "hooks": [
    {
      "command": "echo '[HarmonyOS] Reminder: Use @ComponentV2 / @Local / @Param - V1 decorators (@State, @Prop, @Link) are prohibited'"
    }
  ]
}
```

## Validation Checklist

After each implementation cycle, verify:

- [ ] `hvigorw assembleHap` completes without errors
- [ ] No V1 decorators in new or modified `.ets` files
- [ ] No `@ohos.router` imports in new or modified files
- [ ] All API permissions declared in `module.json5`
- [ ] All dependencies listed in `oh-package.json5`
- [ ] Resource strings added to all i18n directories
- [ ] Dark theme colors provided for new color resources

## Related skills and principles

- [core/goal-driven-execution](../../../core/goal-driven-execution/SKILL.md)
- [core/simplicity-first](../../../core/simplicity-first/SKILL.md)
- [core/surgical-changes](../../../core/surgical-changes/SKILL.md)
- [core/think-before-coding](../../../core/think-before-coding/SKILL.md)

## Source provenance

- `ecc/rules/arkts/hooks.md`
