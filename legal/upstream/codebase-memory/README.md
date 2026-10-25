# codebase-memory — selected upstream source

- Repository: https://github.com/DeusData/codebase-memory-mcp
- Commit: `92abefa3f57a94591a92bcecd6a6f102da373575`
- License: MIT (see `LICENSE`, retained unchanged)

`vendor/` holds the original upstream file(s) byte-for-byte (hashes in `manifest.json`, verified by `test/upstream-adaptations.test.ts`). They are reference copies: Fehm never imports them, and `vendor/` is excluded from Fehm's own scan.

## Adapted into Fehm

### src/store/store.c#camel_should_split (and the splitting loop of sqlite_camel_split) → `src/text.ts#camelShouldSplit, src/text.ts#splitIdentifier`

camelCase/acronym identifier boundaries (updateCloud → update Cloud, XMLParser → XML Parser) so identifiers match natural-language query words.

Modifications:
- C → TypeScript; JS string instead of NUL-terminated buffer
- returns word parts instead of 'original + split' text
- Fehm addition: `_ - . /` and letter/digit transitions are boundaries (upstream relies on FTS5 unicode61 for `_`)
- no 2048-byte buffer limit

Fehm adapter: src/text.ts#tokenize keeps the whole identifier plus its stemmed parts.

## Not used

SQLite store, FTS5, graph, MCP server, daemon, UI, parsers. store.c is kept whole only as the pinned reference.
