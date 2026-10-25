# ecc — selected upstream source

- Repository: https://github.com/affaan-m/ECC
- Commit: `9ac593b55cba44c8b20152a5c7f28d300a67ec7e`
- License: MIT (see `LICENSE`, retained unchanged)

`vendor/` holds the original upstream file(s) byte-for-byte (hashes in `manifest.json`, verified by `test/upstream-adaptations.test.ts`). They are reference copies: Fehm never imports them, and `vendor/` is excluded from Fehm's own scan.

## Adapted into Fehm

### scripts/lib/instinct-relevance.js#computeRelevanceBoost, instinctMatchesStack, tokenize, DEFAULT_* boosts → `src/memory.ts#computeRelevanceBoost, memoryMatchesStack, wholeTokens, rankMemory`

Additive relevance boost when ranking project memory for a context packet.

Modifications:
- 'project scope' boost (0.25) becomes location relevance: the memory links a path/symbol in the current selection
- stack keywords derived from the Fehm graph (languages + external packages) instead of detectProjectType/filesystem
- base score is query-term relevance instead of instinct confidence; a boost never admits an otherwise unrelated entry
- ECC_INSTINCT_RELEVANCE_RANKING env toggle and fs helpers removed

## Not used

ECC hooks, agents, installers, session infrastructure, global memory, plugin system. Snapshot restored from Fehm's own git history (previously vendored at the same commit).
