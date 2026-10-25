---
name: ios-design-review
description: Visual design audit for iOS apps on real hardware. (gstack)
category: mobile
sources:
- repository: gstack
  original_path: ios-design-review/SKILL.md
  sha256: 59a25910bfbcb067c0c53df142e0dbb20e81719b255441fda095c9bb28276d62
principles:
- core/think-before-coding
- core/simplicity-first
- core/surgical-changes
- core/goal-driven-execution
---

> **Library use:** Apply the [compatibility and execution contract](../../COMPATIBILITY.md). Source roles, memory claims, command names, hooks, and integrations are instructions or prerequisites—not installed capabilities.

## When to invoke this skill

Connects to a real
iPhone via the same StateServer as /ios-qa, screenshots every screen,
evaluates against Apple HIG, DESIGN.md, and design best practices. Scores
each dimension 0-10 with "what would make it a 10" framing — mirrors
/plan-design-review for browser. For plan-stage design review (before
implementation), use /plan-design-review. For live web visual audits, use
/design-review.
Use when asked to "review the iOS design", "audit the iPhone app's
visuals", or "design QA the iOS app".

Voice triggers (speech-to-text aliases): "review the iOS design", "audit the iPhone app's visuals", "design QA the iPhone app".

# iOS Design Review

Designer's-eye QA on a real iOS device. Finds visual inconsistency, spacing
issues, hierarchy problems, AI-slop patterns, and accessibility gaps. Rates
each dimension 0-10. Mirrors `/plan-design-review`'s scoring rubric ported
to iOS idioms.

## Connection

Uses the running `gstack-ios-qa-daemon`. If no daemon is running, spawn one
via the same flow as `/ios-qa` (Phase 0-2). Read-only by default — no
mutating calls.

## Dimensions + scoring

For each screen in the app, score 0-10 and explain what would push it to 10:

1. **Typography hierarchy.** Display vs body vs caption sizes consistent
   with Apple HIG. SF Pro at correct dynamic-type scale. Line-height matches
   font size. No 12pt body anywhere.
2. **Spacing rhythm.** 4pt or 8pt grid used consistently. No magic
   17/23/31pt paddings. Safe-area insets respected.
3. **Color hierarchy.** Primary action highest contrast; secondary muted;
   destructive distinct. Dark mode renders correctly. Contrast ratios meet
   WCAG AA for body text (4.5:1) and large text (3:1).
4. **Touch targets.** Every interactive element >= 44x44pt. No "tappable
   text" smaller than 24pt.
5. **Loading + empty + error states.** Each present and intentional. No
   blank screens during async work. Empty states explain what to do next.
6. **Accessibility.** VoiceOver labels on every interactive element.
   Dynamic Type cap at XXL doesn't break layouts. Reduce Motion respected.
   Color-blindness palette tested (deuteranopia is most common).
7. **Animation discipline.** No more than 2 simultaneous animations.
   Duration 200-300ms for UI feedback. Spring damping correct (not bouncy
   for serious flows).
8. **iOS idiom alignment.** Uses native components (`NavigationStack`,
   `List`, `Form`, system sheets) where appropriate. No re-invented
   navigation. No web-style hamburger menus on phone.
9. **Information density.** Per-screen content fits without horizontal
   scroll. Long screens have section anchors. Lists use real iOS list
   patterns (swipe-to-delete, contextual menus).
10. **AI-slop check.** Generic stock layouts, "lorem ipsum" data left in,
    cargo-cult Material Design imported from Android, gradients that smell
    AI-generated.

## Loop

1. `POST /session/acquire` with capability `observe` (read-only).
2. For each major screen (driven from a screen list the user provides, or
   auto-discovered via the accessibility tree):
   - `GET /screenshot`
   - `GET /elements`
   - Apply the 10-dimension rubric.
   - Record findings.
3. Produce a markdown report with screenshots, scores per screen, and a
   "biggest leverage fix" suggestion per dimension.
4. Use AskUserQuestion for any score < 7 — present the issue with
   recommended fix + tradeoff so the user can decide whether to address.

## Output

Write a markdown report to
`~/.gstack/projects/<slug>/ios-design-review-<date>.md`. Include the
screenshots inline. The CEO/eng review skills can reference this report
when planning UI changes.

## Failure modes

| Symptom | Action |
|---|---|
| `403 capability_insufficient` from /screenshot | Daemon is in tailnet mode and token is below `observe` tier — owner must mint with `--capability observe` |
| Screenshot is black/blank | App may be in foreground but not rendering; AskUserQuestion to confirm the app is in the expected state |
| 10 screens, but ground-truth screen list said 12 | AskUserQuestion: were 2 hidden behind state we haven't triggered? |

## Runtime prerequisites

See [the dependency ledger](../../DEPENDENCIES.md) and this skill’s records in [dependencies.json](../../dependencies.json). Native gstack/ECC CLIs, browsers, hooks, model tools, credentials, and memory stores must be available before invoking their steps. No runtime installation or execution has been performed. CSO requires its trusted helper; do not emulate that helper on the host.

## Related skills and principles

- [core/goal-driven-execution](../../core/goal-driven-execution/SKILL.md)
- [core/gstack-operating-protocol](../../core/gstack-operating-protocol/SKILL.md)
- [core/simplicity-first](../../core/simplicity-first/SKILL.md)
- [core/surgical-changes](../../core/surgical-changes/SKILL.md)
- [core/think-before-coding](../../core/think-before-coding/SKILL.md)
- [design/live-design-review](../../design/live-design-review/SKILL.md)
- [design/plan-design-review](../../design/plan-design-review/SKILL.md)
- [developer-experience/plan-tune](../../developer-experience/plan-tune/SKILL.md)
- [documentation/document-generate](../../documentation/document-generate/SKILL.md)
- [engineering/codex](../../engineering/codex/SKILL.md)
- [engineering/review](../../engineering/review/SKILL.md)
- [memory/context-restore](../../memory/context-restore/SKILL.md)
- [memory/context-save](../../memory/context-save/SKILL.md)
- [memory/learn](../../memory/learn/SKILL.md)
- [mobile/ios-qa](../ios-qa/SKILL.md)
- [project-management/retro](../../project-management/retro/SKILL.md)
- [release/ship](../../release/ship/SKILL.md)
- [testing/qa-only](../../testing/qa-only/SKILL.md)

## Source provenance

- `gstack/ios-design-review/SKILL.md`
