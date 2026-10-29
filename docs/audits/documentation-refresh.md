# Documentation consolidation audit

Date: 2026-10-29. Scope: the current FEHM checkout, repository README and static public website.

## Findings

The incoming README and public website described another implementation: source version 1.4.0, Python/uv wheels, a bundled Open Code Review engine, stdio MCP, practices commands, standalone impact commands and graph-file watch mode. The checked-out package version is 0.1.0 and its implementation is Node/TypeScript. Those claims could not be supported by its CLI or source.

The technical feature references already documented most implemented systems, but users lacked a central index and practical guides. The broader revision-aware change-impact document is a plan. The concept commands require Node 22.13+ even though the package's general engine range starts at Node 20.

## Resolution

Rewrote the root README around verified source installation and supported commands. Added shared user guides under docs/guides and a docs index that distinguishes implementations, limitations, plans and historical audit records. Moved website/README.md to docs/website.md and assets/brand/README.md to docs/brand.md. Retained specification filenames so existing source references remain valid.

Public website guides now render those same Markdown sources. Product copy, examples, assistant setup, implementation status and llms.txt describe the current CLI and optional Superpowers integration. Legacy /docs/mcp/ and /docs/open-code-review/ URLs remain as explicit boundary pages, not unsupported installation guides.

Root README, THIRD_PARTY_NOTICES.md, skill entrypoints/resources, bundled licenses and generated artifacts are intentional exceptions to physical consolidation. Moving them would break discovery, installation, package attribution or upstream resource contracts.

## Coverage and limitations

Every implemented dashboard family has a user guide or shared workflow guide and a technical reference. This is an audited documentation baseline, not a claim that every internal API has exhaustive documentation. Historical reports retain dated claims; public guides describe current behavior. No live deployment or live assistant session is implied by local website tests.

## Validation

- Root TypeScript check (`npm run check`): passed.
- Website build and tests (`npm --prefix website run check`): 33 generated pages; seven tests passed. Coverage includes preview/production metadata, local links, HTTP redirects/404s, analytics consent behavior, guide search, shared Markdown, command families, assistant destinations and repository Markdown file links.
- Headless Chrome: 32 content routes at 320, 390 and 1440px (96 route/viewport checks), no page overflow or page errors. Guide search/navigation and FAQ interaction passed. Desktop homepage and mobile guide screenshots were visually reviewed.
- `git diff --check`: passed. No root lint script exists. Core runtime implementation was not changed by this documentation refresh; its full suite was not rerun for these prose and website-only edits.
- Localhost tests initially encountered sandbox EPERM and passed when rerun with permitted localhost access. The in-app browser was unavailable; visual validation used local headless Chrome.

The built website remains a local preview with noindex and analytics disabled by default. No production deployment, account configuration or analytics changes were made.
