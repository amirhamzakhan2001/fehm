# agentmemory — selected upstream source

- Repository: https://github.com/rohitg00/agentmemory
- Commit: `bcf4f0d00d1c71e9221287a4778e4122ce2d7574`
- License: Apache-2.0 (see `LICENSE`, retained unchanged)

Local snapshot had no git metadata; the commit was identified by matching all three file hashes against upstream main (2026-09-26). The files differ from tag v0.9.29.

`vendor/` holds the original upstream file(s) byte-for-byte (hashes in `manifest.json`, verified by `test/upstream-adaptations.test.ts`). They are reference copies: Fehm never imports them, and `vendor/` is excluded from Fehm's own scan.

## Adapted into Fehm

### src/state/search-index.ts#SearchIndex (add, remove, search, lowerBound) → `src/lexical-index.ts#LexicalIndex`

BM25 lexical retrieval with prefix (half idf) and synonym (weight 0.7) expansion.

Modifications:
- documents are Fehm {id, weighted fields} instead of CompressedObservation
- Fehm identifier-aware tokenize replaces upstream tokenizer; CJK segmentation removed
- exact+prefix scores reported as `lexical`, synonym scores separately as `semantic`
- results tie-broken by id (upstream sorted by score only)
- no prefix expansion for query terms shorter than 3 characters
- sessionId, serialize/deserialize, restoreFrom, observationCountsBySession, clear removed

### src/state/stemmer.ts#stem → `src/stemmer.ts#stem`

Porter-style stemming for query/document terms.

Modifications:
- three `!` non-null assertions for noUncheckedIndexedAccess; algorithm unchanged

### src/state/synonyms.ts#getSynonyms (+ SYNONYM_GROUPS) → `src/synonyms.ts#getSynonyms`

Deterministic concept expansion — Fehm's LLM-free semantic signal.

Modifications:
- added FEHM_SYNONYM_GROUPS (login/auth, payment/billing, user/account, connection/pool, handler/controller/route, util/helper, session/token/jwt)

### src/functions/lessons.ts#reinforceLesson (+ lesson-search recency boost) → `src/skill-feedback.ts#historicalSignals`

Feature 2 skill memory: bounded confidence per (similar task → skill) from user feedback. Kept: `c + 0.1·(1 − c)` and `1 / (1 + days·0.01)`.

Modifications:
- a lesson is a (similar task → skill) association built from feedback entries, not a stored record
- negative feedback weakens symmetrically: `c − 0.1·c` (upstream weakens only through time decay)
- starting confidence 0.5 = no opinion; signal = (c − 0.5)·2 × similarity × recency
- relevance is task similarity (term + intent Jaccard ≥ 0.3), not BM25
- no persisted confidence, decay sweep, soft delete, KV store or iii SDK

The snapshot is the same download as the files above (search-index.ts in it matches the pinned hash), so lessons.ts is from the same commit.

## Not used

AgentMemory server, iii engine, REST/MCP servers, hooks, viewer, vector index, hybrid-search, reranker, persistence, any external database.
