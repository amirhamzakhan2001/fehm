# graft — selected upstream source

- Repository: https://github.com/trailhq/Graft
- Commit: `8c05769618d413041ea2c8891f82d566f0461b3c`
- License: MIT (see `LICENSE`, retained unchanged)

`vendor/` holds the original upstream file(s) byte-for-byte (hashes in `manifest.json`, verified by `test/upstream-adaptations.test.ts`). They are reference copies: Fehm never imports them, and `vendor/` is excluded from Fehm's own scan.

## Adapted into Fehm

### src/ask/file-selection.ts#fileFirstRoundRobin (+ FileFirstCandidate) → `src/context-selection.ts#fileFirstRoundRobin`

File-first diversification: after the strongest anchors, take one item per file before a second item from any file.

Modifications:
- `queue[depth]` → `queue[depth]!` (noUncheckedIndexedAccess)
- roundRobinQueues not copied (unused)

Fehm adapter: src/context-selection.ts#diversifyHits maps Fehm RetrievalHit[] to candidates (group = file path, singleton group for path-less nodes), keeps a prefix of strong anchors (Fehm addition) and dedupes node ids.

## Not used

Graft CLI, hooks, agent integrations, daemon, graph engine, ranking (fuse.ts/graphrank.ts), viewer.
