# Documentation and contributor maintenance

## Sources of truth

- package.json: version, supported core Node range, build/test scripts and distribution files.
- src/cli.ts and `node dist/cli.js help`: supported commands and flags.
- src/visualization/features.ts: available dashboard pages.
- src/integrations.ts: assistant skill directory conventions and lifecycle behavior.
- docs/FEATURE_*.md: detailed engineering references and implementation limitations.
- docs/guides/*.md: maintained user-facing instructions shared with the public website.
- skills/superpowers-provenance.json: selected workflow snapshot and adaptation hashes.

A source version does not prove a published package exists. Do not advertise a command, provider integration or feature based solely on an old specification or another branch.

## Validate a change

```sh
npm run check
npm run build
npm test
npm --prefix website run check
```

Some tests bind localhost. There is no root lint script. Website content tests check local navigation, metadata, supported command examples and the shared documentation source. They are not a substitute for a browser layout check when presentation changes.

## Update docs with behavior

Change the relevant guide and technical implementation record together. If a feature is planned, label it planned in the docs index and public content. Preserve explicit distinctions between repository observations, inference, supplied output, execution results and model suggestions.

When adding a user guide, register its title and description in website/src/guide-catalog.json. The website's small Markdown renderer supports headings, paragraphs, unordered lists, fenced examples, inline code and links to sibling guides. It escapes raw HTML. Do not assume full GitHub-flavored Markdown support in public guides; technical references remain normal Markdown.

Homepage/product summaries live in website/src/home.mjs and content.mjs. They should link into the shared guides and avoid copying long installation instructions. Version comes from the root package.json.

## File organization

General project prose belongs under docs/. Preserve internal specification filenames to avoid breaking source references. Keep the repository README, package attribution notices, skill files and machine-consumed references at their established paths. Do not move files simply because they end in .md: runtime contracts and license placement matter.

## Website publishing

See [website development](website.md). Building updates local website/dist only. Publishing, production domain settings, analytics and Search Console remain separate deployment operations; do not report a local build as a live site update.
