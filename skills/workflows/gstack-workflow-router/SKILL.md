---
name: gstack-workflow-router
description: Router for the gstack skill suite. (gstack)
category: workflows
sources:
- repository: gstack
  original_path: SKILL.md
  sha256: 22d771b948576e11604f8c23d758fd0745218b58dcfe85e1934b13deb445873e
principles:
- core/think-before-coding
- core/simplicity-first
- core/surgical-changes
- core/goal-driven-execution
---

> **Library use:** Apply the [compatibility and execution contract](../../COMPATIBILITY.md). Source roles, memory claims, command names, hooks, and integrations are instructions or prerequisites—not installed capabilities.

## When to invoke this skill

Sends any gstack request to the right skill
(planning, review, QA, shipping, debugging, docs, security, design). For browser/QA
and dogfooding it points you at /browse. Use when you invoke gstack without a specific
skill, or ask "which gstack skill fits this?".

## Route first

This is the gstack router. Its one job is to send the request to the right skill.

1. If the request is about a browser, QA, dogfooding, screenshots, or inspecting a page
   (open a site, test a deploy, take a screenshot, check a flow visually) → invoke `/browse`.
   Every gstack browser skill (`/browse`, `/qa`, `/qa-only`, `/design-review`, `/canary`,
   `/benchmark`, `/scrape`) drives the Aside browser first — the user's real browser with
   their real logged-in sessions — and falls back to gstack's own browser when Aside is not
   installed or not running. Route "open the browser" / "import cookies" requests to the
   fallback-browser skills below only when the user is clearly on that path (Linux,
   Windows, or Aside closed); on Aside there is nothing to open or import.
2. Otherwise, route by the rules below. If nothing matches, answer directly.

Best-effort, record which way you routed (never block on it). Set `ROUTE_OUTCOME` to
`browse` (sent to /browse), `routed` (sent to another skill), or `direct` (answered
directly, no skill matched):
```bash
~/.claude/skills/gstack/bin/gstack-telemetry-log --event-type route --skill gstack --outcome ROUTE_OUTCOME --session-id "$_SESSION_ID" 2>/dev/null || true
```

If `PROACTIVE` is `false`: do NOT proactively invoke or suggest other gstack skills during
this session. Only run skills the user explicitly invokes. This preference persists across
sessions via `gstack-config`.

If `PROACTIVE` is `true` (default): **invoke the Skill tool** when the user's request
matches a skill's purpose. Do NOT answer directly when a skill exists for the task.
Use the Skill tool to invoke it. The skill has specialized workflows, checklists, and
quality gates that produce better results than answering inline.

**Routing rules — when you see these patterns, INVOKE the skill via the Skill tool:**
- User describes a new idea, asks "is this worth building", brainstorms, pitches a concept → invoke `/office-hours`
- User asks to spec something out, file an issue, write up a ticket, "turn this into a GitHub issue", "backlog item" → invoke `/spec`
- User asks about strategy, scope, ambition, "think bigger", "what should we build" → invoke `/plan-ceo-review`
- User asks to review architecture, lock in the plan, "does this design make sense" → invoke `/plan-eng-review`
- User asks about design system, brand, visual identity, "how should this look" → invoke `/design-consultation`
- User asks to review design of a plan → invoke `/plan-design-review`
- User asks about developer experience of a plan, API/CLI/SDK design → invoke `/plan-devex-review`
- User wants all reviews done automatically, "review everything" → invoke `/autoplan`
- User reports a bug, error, broken behavior, "why is this broken", "this doesn't work", "wtf", "something's wrong" → invoke `/investigate`
- User asks to test the site, find bugs, QA, "does this work", "check the deploy" → invoke `/qa`
- User asks to just report bugs without fixing → invoke `/qa-only`
- User asks to review code, check the diff, pre-landing review, "look at my changes" → invoke `/review`
- User asks to find code worth sharing, shared-code extractions, or duplication worth consolidating → invoke `/deslop-shared-libs`
- User asks about visual polish, design audit of a live site, "this looks off" → invoke `/design-review`
- User asks to audit the live developer experience, time-to-hello-world → invoke `/devex-review`
- User asks to ship, deploy, push, create a PR, "let's land this", "send it" → invoke `/ship`
- User asks to merge + deploy + verify as one flow → invoke `/land-and-deploy`
- User asks to configure deployment for the project → invoke `/setup-deploy`
- User asks to monitor prod after shipping, post-deploy checks → invoke `/canary`
- User asks to update docs after shipping → invoke `/document-release`
- User asks to write docs from scratch, generate documentation, "document this feature/module" → invoke `/document-generate`
- User asks for a weekly retro, what did we ship, "how'd we do" → invoke `/retro`
Generic “second opinion”, “outside review”, or “cross-model review” requests use `/codex` (namespaced: `/gstack-codex`). This selection follows the **claude harness**, independently of model configuration. Explicit provider requests take precedence: Codex means `/codex`; Claude Code means `/claude-code`. Never silently substitute another provider. If that provider is the current harness, report that no outside invocation ran and suggest the other wrapper only as a separate user choice. Wrapper availability: Claude Code installs only /codex; Codex installs only /claude-code; other harnesses install both. Repair stale installations with `setup --host claude`. There is no /claude compatibility alias.
- User asks for safety mode, careful mode → invoke `/careful` or `/guard`
- User asks to restrict edits to a directory → invoke `/freeze` or `/unfreeze`
- User asks to upgrade gstack → invoke `/gstack-upgrade`
- User asks to save progress, checkpoint, "save my work" → invoke `/context-save`
- User asks to resume, restore, "where was I" → invoke `/context-restore`
- User asks about security, OWASP, vulnerabilities, "is this secure" → invoke `/cso`
- User asks to make a PDF, document, publication → invoke `/make-pdf`
- User asks to pull data off a web page, "grab the table from", "extract the prices" → invoke `/scrape`
- User asks to launch a real browser for QA, "open the browser" → invoke `/open-gstack-browser` (fallback browser; on Aside the tabs are already visible)
- User asks to import cookies for authenticated testing → invoke `/setup-browser-cookies` (fallback browser; Aside already has the sessions)
- User asks to share the browser with another agent, "pair OpenClaw/Codex with my browser" → invoke `/pair-agent` (fallback browser)
- User asks to codify or save the last `/scrape` as a reusable skill → invoke `/skillify` (fallback browser)
- User asks about page speed, performance regression, benchmarks → invoke `/benchmark`
- User asks what gstack has learned, "show learnings" → invoke `/learn`
- User asks to tune question sensitivity, "stop asking me that" → invoke `/plan-tune`
- User asks for code quality dashboard, "health check" → invoke `/health`

**When in doubt, invoke the skill.** A false positive (invoking a skill that wasn't
needed) is cheaper than a false negative (answering ad-hoc when a structured workflow
exists). The skill provides multi-step workflows, checklists, and quality gates that
always produce better results than an ad-hoc answer. If no skill matches, answer
directly as usual.

If the user opts out of suggestions, run `gstack-config set proactive false`.
If they opt back in, run `gstack-config set proactive true`.

## Runtime prerequisites

See [the dependency ledger](../../DEPENDENCIES.md) and this skill’s records in [dependencies.json](../../dependencies.json). Native gstack/ECC CLIs, browsers, hooks, model tools, credentials, and memory stores must be available before invoking their steps. No runtime installation or execution has been performed. CSO requires its trusted helper; do not emulate that helper on the host.

## Related skills and principles

- [core/goal-driven-execution](../../core/goal-driven-execution/SKILL.md)
- [core/gstack-operating-protocol](../../core/gstack-operating-protocol/SKILL.md)
- [core/simplicity-first](../../core/simplicity-first/SKILL.md)
- [core/surgical-changes](../../core/surgical-changes/SKILL.md)
- [core/think-before-coding](../../core/think-before-coding/SKILL.md)
- [debugging/investigate](../../debugging/investigate/SKILL.md)
- [design/design-consultation](../../design/design-consultation/SKILL.md)
- [design/live-design-review](../../design/live-design-review/SKILL.md)
- [design/plan-design-review](../../design/plan-design-review/SKILL.md)
- [developer-experience/browse](../../developer-experience/browse/SKILL.md)
- [developer-experience/devex-review](../../developer-experience/devex-review/SKILL.md)
- [developer-experience/open-gstack-browser](../../developer-experience/open-gstack-browser/SKILL.md)
- [developer-experience/plan-devex-review](../../developer-experience/plan-devex-review/SKILL.md)
- [developer-experience/plan-tune](../../developer-experience/plan-tune/SKILL.md)
- [developer-experience/scrape](../../developer-experience/scrape/SKILL.md)
- [developer-experience/setup-browser-cookies](../../developer-experience/setup-browser-cookies/SKILL.md)
- [developer-experience/skillify](../../developer-experience/skillify/SKILL.md)
- [documentation/document-generate](../../documentation/document-generate/SKILL.md)
- [documentation/make-pdf](../../documentation/make-pdf/SKILL.md)
- [engineering/claude-code](../../engineering/claude-code/SKILL.md)
- [engineering/codex](../../engineering/codex/SKILL.md)
- [engineering/deslop-shared-libs](../../engineering/deslop-shared-libs/SKILL.md)
- [engineering/plan-eng-review](../../engineering/plan-eng-review/SKILL.md)
- [engineering/review](../../engineering/review/SKILL.md)
- [memory/context-restore](../../memory/context-restore/SKILL.md)
- [memory/context-save](../../memory/context-save/SKILL.md)
- [memory/learn](../../memory/learn/SKILL.md)
- [orchestration/pair-agent](../../orchestration/pair-agent/SKILL.md)
- [performance/benchmark-gstack](../../performance/benchmark-gstack/SKILL.md)
- [product/office-hours](../../product/office-hours/SKILL.md)
- [product/plan-ceo-review](../../product/plan-ceo-review/SKILL.md)
- [product/spec](../../product/spec/SKILL.md)
- [project-management/retro](../../project-management/retro/SKILL.md)
- [release/canary](../../release/canary/SKILL.md)
- [release/document-release](../../release/document-release/SKILL.md)
- [release/land-and-deploy](../../release/land-and-deploy/SKILL.md)
- [release/setup-deploy](../../release/setup-deploy/SKILL.md)
- [release/ship](../../release/ship/SKILL.md)
- [security/careful](../../security/careful/SKILL.md)
- [security/cso](../../security/cso/SKILL.md)
- [security/freeze](../../security/freeze/SKILL.md)
- [security/guard](../../security/guard/SKILL.md)
- [security/unfreeze](../../security/unfreeze/SKILL.md)
- [testing/health](../../testing/health/SKILL.md)
- [testing/qa-only](../../testing/qa-only/SKILL.md)
- [workflows/autoplan](../autoplan/SKILL.md)

## Source provenance

- `gstack/SKILL.md`
