---
name: react-native-accessibility-standard
description: React Native / Expo Accessibility. Use this standard for react native accessibility standard.
category: frameworks/react-native
sources:
- repository: ecc
  original_path: rules/react-native/accessibility.md
  sha256: 7cd8adb29406c0f07e6628334bf417e8df3d71a2781c2f830b5b74177b2b8222
principles:
- core/think-before-coding
- core/simplicity-first
- core/surgical-changes
- core/goal-driven-execution
---

> **Library use:** Apply the [compatibility and execution contract](../../../COMPATIBILITY.md). Source roles, memory claims, command names, hooks, and integrations are instructions or prerequisites—not installed capabilities.

# React Native / Expo Accessibility

> Extends the ECC quality bar to accessibility (a11y). Treat a11y as a release requirement, not an afterthought.
> Target: usable with screen readers (VoiceOver on iOS, TalkBack on Android) and at large font sizes.

## Labeling

- Every interactive element has an `accessibilityRole` and an `accessibilityLabel` (or readable child text).
- Icon-only buttons MUST have an `accessibilityLabel` — there is no visible text for the reader to announce.
- Use `accessibilityHint` only when the action is non-obvious; keep it short.
- Group related elements with `accessible` on the container so they're announced as one unit when appropriate.

```tsx
<Pressable
  accessibilityRole="button"
  accessibilityLabel="Delete item"
  onPress={onDelete}
>
  <TrashIcon />
</Pressable>
```

## State & Live Regions

- Communicate state with `accessibilityState` (e.g. `{ disabled, selected, checked, expanded }`).
- Announce async/transient changes (toasts, validation errors) via `accessibilityLiveRegion` (Android) and `AccessibilityInfo.announceForAccessibility` where needed.
- Reflect loading/error/empty states in text the reader can reach — not just spinners or color.

## Touch Targets & Layout

- Minimum touch target ~44x44pt (iOS) / 48x48dp (Android); use `hitSlop` to enlarge small controls.
- Respect Dynamic Type / font scaling — avoid fixed heights that clip scaled text; test at the largest accessibility font size.
- Honor `prefers-reduced-motion` (`AccessibilityInfo.isReduceMotionEnabled`) — gate non-essential animation.

## Color & Contrast

- Do not convey meaning by color alone; pair with text, icon, or shape.
- Meet WCAG AA contrast: 4.5:1 for body text, 3:1 for large text and meaningful UI/graphical elements.
- Verify both light and dark themes.

## Focus & Navigation

- Logical focus order; move focus to new content (modals, screens) on open and restore on close.
- Ensure custom components are reachable and operable by the screen reader, not just by touch.

## Testing

- Manually test with VoiceOver and TalkBack on real devices — automated checks do not catch everything.
- In component tests, query by role/label (see testing.md) so a11y and tests reinforce each other.
- Add a11y to the pre-release gate: key flows pass a screen-reader walkthrough.

## Related skills and principles

- [core/goal-driven-execution](../../../core/goal-driven-execution/SKILL.md)
- [core/simplicity-first](../../../core/simplicity-first/SKILL.md)
- [core/surgical-changes](../../../core/surgical-changes/SKILL.md)
- [core/think-before-coding](../../../core/think-before-coding/SKILL.md)

## Source provenance

- `ecc/rules/react-native/accessibility.md`
