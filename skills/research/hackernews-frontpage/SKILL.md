---
name: hackernews-frontpage
description: Scrape the Hacker News front page (titles, points, comment counts).
category: research
sources:
- repository: gstack
  original_path: browser-skills/hackernews-frontpage/SKILL.md
  sha256: 1a4e91d00ffdbdd38d2dc2986cf764b6d7d4d9348fdce19f2c60e92fa4a564da
principles: []
---

> **Library use:** Apply the [compatibility and execution contract](../../COMPATIBILITY.md). Source roles, memory claims, command names, hooks, and integrations are instructions or prerequisites—not installed capabilities.

# Hacker News front-page scraper

Scrapes the Hacker News (`news.ycombinator.com`) front page and returns the
top 30 stories as JSON. Each story has its rank, title, link URL, point count,
and comment count.

## Usage

```
$ $B skill run hackernews-frontpage
{
  "stories": [
    { "rank": 1, "title": "...", "url": "...", "points": 412, "comments": 87 },
    ...
  ],
  "count": 30
}
```

## How it works

1. Navigates to `https://news.ycombinator.com` via the daemon.
2. Reads the page HTML.
3. Parses each story row (HN's stable `tr.athing` structure) into a typed
   `Story` record.
4. Emits a single JSON document on stdout.

## Why this is the reference skill

`hackernews-frontpage` is the smallest interesting browser-skill: no auth,
stable HTML, deterministic output, file-fixture-friendly. Every Phase 1
component (SDK, scoped tokens, three-tier lookup, spawn lifecycle) is
exercised by `$B skill run hackernews-frontpage` and the bundled
`script.test.ts`.

When the HN HTML rotates and our selectors break, the test fails against the
captured fixture before users notice. That's the point.

## Supporting material

See the [selective resource index](references/INDEX.md) for checklists, templates, examples, and reference implementations.

## Runtime prerequisites

See [the dependency ledger](../../DEPENDENCIES.md) and this skill’s records in [dependencies.json](../../dependencies.json). Native gstack/ECC CLIs, browsers, hooks, model tools, credentials, and memory stores must be available before invoking their steps. No runtime installation or execution has been performed. CSO requires its trusted helper; do not emulate that helper on the host.

## Source provenance

- `gstack/browser-skills/hackernews-frontpage/SKILL.md`
