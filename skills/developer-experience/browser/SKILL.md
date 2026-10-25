---
name: browser
description: Browser — Aside first, gstack's own browser as the fallback. Use this methodology for browser.
category: developer-experience
sources:
- repository: gstack
  original_path: BROWSER.md
  sha256: d171f69701f0c03c237d68e784e6955448e6fff6347f8edf722bf5efe4a376ed
principles:
- core/think-before-coding
- core/simplicity-first
- core/surgical-changes
- core/goal-driven-execution
---

> **Library use:** Apply the [compatibility and execution contract](../../COMPATIBILITY.md). Source roles, memory claims, command names, hooks, and integrations are instructions or prerequisites—not installed capabilities.

# Browser

Browser — Aside first, gstack's own browser as the fallback. Use this methodology for browser.

## Required procedure

Read [the complete methodology](references/methodology.md) before performing this skill. It retains the full procedure, examples, constraints, and failure handling.

Procedure topics: Browser — Aside first, gstack's own browser as the fallback; Aside is the browser gstack drives first; The driver contract; What each skill does in Aside; Local-HTML rendering; Cookbook; Web research runs in Aside first; When the fallback kicks in; The fallback engine — complete reference; Quick start; One-time: build the binary (browse/dist/browse, ~58MB); Set $B once and forget about it; Drive a page; Codify a repeated flow.

## Supporting material

See the [selective resource index](references/INDEX.md) for checklists, templates, examples, and reference implementations.

## Runtime prerequisites

See [the dependency ledger](../../DEPENDENCIES.md) and this skill’s records in [dependencies.json](../../dependencies.json). Native gstack/ECC CLIs, browsers, hooks, model tools, credentials, and memory stores must be available before invoking their steps. No runtime installation or execution has been performed. CSO requires its trusted helper; do not emulate that helper on the host.

## Related skills and principles

- [core/goal-driven-execution](../../core/goal-driven-execution/SKILL.md)
- [core/simplicity-first](../../core/simplicity-first/SKILL.md)
- [core/surgical-changes](../../core/surgical-changes/SKILL.md)
- [core/think-before-coding](../../core/think-before-coding/SKILL.md)
- [debugging/investigate](../../debugging/investigate/SKILL.md)
- [design/design-consultation](../../design/design-consultation/SKILL.md)
- [design/design-html](../../design/design-html/SKILL.md)
- [design/live-design-review](../../design/live-design-review/SKILL.md)
- [developer-experience/browse](../browse/SKILL.md)
- [developer-experience/devex-review](../devex-review/SKILL.md)
- [developer-experience/open-gstack-browser](../open-gstack-browser/SKILL.md)
- [developer-experience/plan-devex-review](../plan-devex-review/SKILL.md)
- [developer-experience/scrape](../scrape/SKILL.md)
- [developer-experience/setup-browser-cookies](../setup-browser-cookies/SKILL.md)
- [developer-experience/skillify](../skillify/SKILL.md)
- [documentation/diagram](../../documentation/diagram/SKILL.md)
- [documentation/make-pdf](../../documentation/make-pdf/SKILL.md)
- [engineering/plan-eng-review](../../engineering/plan-eng-review/SKILL.md)
- [engineering/review](../../engineering/review/SKILL.md)
- [orchestration/pair-agent](../../orchestration/pair-agent/SKILL.md)
- [performance/benchmark-gstack](../../performance/benchmark-gstack/SKILL.md)
- [product/office-hours](../../product/office-hours/SKILL.md)
- [product/plan-ceo-review](../../product/plan-ceo-review/SKILL.md)
- [product/spec](../../product/spec/SKILL.md)
- [release/canary](../../release/canary/SKILL.md)
- [release/land-and-deploy](../../release/land-and-deploy/SKILL.md)
- [release/setup-deploy](../../release/setup-deploy/SKILL.md)
- [release/ship](../../release/ship/SKILL.md)
- [security/cso](../../security/cso/SKILL.md)
- [testing/health](../../testing/health/SKILL.md)
- [testing/qa-only](../../testing/qa-only/SKILL.md)
- [workflows/gstack-workflow-router](../../workflows/gstack-workflow-router/SKILL.md)

## Source provenance

- `gstack/BROWSER.md`
