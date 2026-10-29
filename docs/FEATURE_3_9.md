# Feature 3.9 — Codebase Concept & Ontology Intelligence

Feature 3.9 provides an offline engineering catalog and a separate repository
evidence layer. The initial release adds local SQLite retrieval, conservative
concept rules, existing-feature adapters, two dashboard pages, graph highlighting,
CLI/API access and bounded model-context projections. No LLM or network calls run.

## Start

```sh
npm run build
node dist/cli.js ontology LSP --json
node dist/cli.js ontology --concept-id s22.circuit-breaker --json
node dist/cli.js concepts --root /path/to/project --json
node dist/cli.js concepts --concept-id s39.authentication --json
node dist/cli.js concepts "rate limiting" --context --bytes 4000 --json
node dist/cli.js serve --root /path/to/project
```

The dashboard includes **Concept intelligence** (`/#/concepts`, `/concepts`) and
**Ontology explorer** (`/#/ontology`, `/ontology`). The former displays repository
findings, the latter catalog entries. Their counts never imply that all catalog
concepts occur in a repository. Select a concept for its definition, guidance,
source excerpts, findings, qualitative statuses, scopes, unknowns, tests,
architecture components and Git associations. Source excerpts redact detected
secret patterns through Feature 3.6. Related terms are navigable and explicitly
labelled as topical links, not implementation implications.

SQLite uses Node's built-in `node:sqlite` through a lazy import. **These ontology
commands require Node.js 22.13 or newer**; other existing FEHM commands retain
their previous Node support. No SQLite daemon, Python runtime, hosted database,
embedding service or additional npm dependency is introduced.

## Permanent files and removable inputs

The supplied files now live at:

```text
assets/ontology/fehm_engineering_ontology.json
```

The original catalog is preserved byte-for-byte, including all 2,627 concepts,
74 sections, immutable IDs, reviewed aliases, profiles, facets and provenance.
SHA-256: `c845161771f6656ec99b1faf5bbe3a96f4da4c8e057e4becb343dcaa9211de71`.
Earlier supplied audit/specification documents described catalog work before this
repository detector. They are not shipped in assets/ontology in this checkout;
this feature document is the maintained implementation reference.

`exta_file` is no longer needed. Upstream licenses, manifests and pinned source
attribution is recorded in `THIRD_PARTY_NOTICES.md`; attribution references,
provenance tests and npm packaging use that location. FEHM's adapted algorithms
already live in `src`. The original `third_party` directory can also be deleted.
Both the canonical catalog and retained attribution records ship in the package.
The canonical catalog, attribution snapshots and temporary input directory are
excluded from FEHM's own implementation graph through `.fehmignore`.

## Catalog validation and SQLite

The catalog validator rejects duplicate IDs or normalized canonical names,
missing/empty required definitions, unknown concept types and detection profiles,
malformed guidance/facets, dangling/self edges, parent cycles and inconsistent
counts. Alias collisions remain candidate sets; LSP and DFA each resolve to two
concepts. Normalization uses NFKC, lowercase and whitespace/hyphen/underscore
equivalence, preserving technical symbols such as `+`, `#` and `/`. It does not
stem names, equate acronyms or merge related concepts.

`OntologyIndex` builds `concepts`, `terms`, `sections`, `profiles`, `facets`,
`edges` and metadata tables. Each concept is independently addressable.
Catalog version/hash and index version govern reuse. Builds occur in a transaction
in a temporary database, are probed, and are activated by atomic rename. The
previous index is retained as `ontology.sqlite.previous`. Invalid source catalogs
are rejected before activation. The JSON remains authoritative; the database is
rebuildable. A catalog edit requires refresh/restart; the refresh endpoint opens
and validates a replacement before retiring the prior service handle.

Exact canonical/alias lookup takes precedence. Deterministic text fallback ranks
names, aliases, definitions and domains. Ranking scores are retrieval utilities,
never evidence confidence. Domain/type filters can narrow candidates. Parent and
related expansion is capped at depth 2 and 50 nodes. Shared and record-specific
guidance are combined, including anti-signals, requirements and limitations.
There is no automatic vocabulary insertion, vector index or full-catalog prompt.

## Evidence semantics

Findings record stable concept IDs, qualitative status, separate scope, evidence
paths/lines/graph-node and edge IDs, rationale, limitations, revision, analyzer
version and ontology version. Catalog records contain no repository findings.

Statuses: `explicitly_observed`, `structurally_supported`,
`contextually_inferred`, `weakly_indicated`, `not_verifiable`.
Scopes: `documented_claim`, `declaration`, `implementation`, `deployment`,
`measurement`, `operation`.

Initial executable rules/adapters:

| Evidence | Interpretation |
| --- | --- |
| Reviewed vocabulary in Markdown/comments | Explicit documented reference; not verified implementation or endorsement of its meaning |
| Matching symbol names | Weak declaration clue; never proves the named pattern |
| Selected declared library dependencies | Weak clue, including development-only dependencies |
| Actual JS/TS `await` expressions | Explicit syntax-level implementation observation; no runtime or performance guarantee |
| Existing route facts/AST route entities | Scoped route registration/declaration, with mapped handlers where available |
| Conditioned incrementing loop + catch + calls in one JS/TS function | Contextually inferred retry candidate; failure-dependent control flow, bounds and safety need review |
| get/has + set + return in one JS/TS function | Contextually inferred cache candidate; receiver identity, hit/miss flow and retained reuse need review |
| Feature 3.6 control inventory | Weak control clue; inventory/import evidence is not promoted to universal enforcement |
| Feature 3.7 reconstructed prompt | Declaration evidence with reconstruction completeness; no inferred RAG or behavioral quality |
| Feature 3.5 unused-code candidates | Weak dead-code indication, preserving static-analysis limitations |

Syntax rules use the same indexed source and map back to existing graph entities.
They do not build another call graph, security scanner, coverage engine or Git
parser. Vocabulary scanning is bounded to 2,000 lines and 80 concept/scope pairs
per file; JS/TS syntax rules to 20,000 lines. Other languages receive vocabulary
and existing-analyzer evidence, not an invented JS-equivalent structural analysis.
Generic short words are restricted in document matching; reviewed technical
acronyms such as DFA/LSP/RAG remain candidates. Exact catalog lookup supports all
canonical names and aliases regardless of these detector bounds.

A queried concept without findings returns `not_verifiable`, not “absent.”
Each detail also states that broad behavior, deployment and achieved properties
remain unverified. No runtime/operational adapter is connected in this release.
No automatic negative authorization/vulnerability or production reliability
claims are made. Counterevidence arrays are reserved for observations; catalog
anti-signals are guidance, not falsely reported as observed counterevidence.

## Existing-feature integration

The server shares its architecture facts/model, security, health and prompt
services with the concept view. Prompt and concept views share security results.
Evidence reuses existing node and edge IDs. Graph inspectors link back to concept
findings for their file; `/graph#concept=<id>` highlights the evidence-linked nodes
using the existing renderer. The concept overlay exposes typed edges, including
`implemented_by` only for directly/structurally supported implementation scope,
`referenced_by` for weaker references, and configuration declarations where
appropriate. The overlay does not mutate the canonical code graph.

Callers/callees are inspected in Feature 3.1. Test links represent static file
dependencies, not measured coverage. Architecture components are mapped through
existing file membership. Git history reuses Feature 3.8 on demand and reports
file changes as temporal associations, not exact concept introduction dates.
Drift analysis is available through existing architecture navigation; this release
does not manufacture new drift findings from ontology relationships.

## Incremental analysis and context

`.fehm/concept-evidence.json` caches local observations by file content hash,
ontology hash and rule version, scoped to the repository root. Changed files are
re-extracted; deleted files disappear. Current graph links and cross-feature
interpretations are refreshed separately, so cached local text/syntax does not
freeze relationships. Server reports also invalidate when the engine or supplied
analyzer result objects change. Full scans remain available with `--force`.
`--state-dir` is supported; `--dry-run` uses in-memory SQLite and suppresses writes.

`conceptContext` selects at most 12 candidate concepts, compact evidence pointers
and scoped findings before serialization. `maxBytes` is a **byte budget**, not a
token estimate. Token counts default to `null`. Library callers can supply their
actual target-model tokenizer and a token budget; the exact serialized JSON is
then counted and bounded. Model identity, tokenizer revision, prompt wrappers,
tool schemas and output reserves remain the caller's responsibility. No token
saving percentage or production latency claim is made.

## HTTP and library

GET `/api/concepts` (or `/report`) returns findings. Filters include `q`, `section`,
`type`, `status`, `scope`, `path`, and `language`.

* `/catalog` — counts, domains, types and ambiguous terms
* `/lookup?q=...&section=...&type=...&limit=30` — ranked vocabulary candidates
* `/knowledge?id=...&depth=1` — catalog-only detail and bounded relationships
* `/detail?id=...` — repository assessment and integrations
* `/graph?id=...` — typed concept-to-code overlay using existing graph IDs
* `/source?path=...&line=...` — bounded redacted excerpt from an indexed file
* `/history?id=...` — up to 20 evidence-file histories in a 100-commit window
* `/context?q=...&bytes=8000` — compact selected context and measured byte count
* POST `/refresh` — refresh engine/catalog/evidence; requires `x-fehm: 1`

Pages use the existing CSP and render repository/catalog text as DOM text.
SQL queries bind parameters; source requests require an indexed file. Public
exports include the catalog/types, `OntologyIndex`, `validateOntology`,
`normalizeConceptTerm`, `analyzeConcepts`, `conceptAssessment`, `conceptExcerpt`
and `conceptContext`.

## Validation and boundaries

`test/concepts.test.ts` checks every canonical name and alias, ambiguity, malformed
catalog rejection, transactional replacement/rollback copies, conservative scope,
cache reuse/invalidation/deletion, clean-vs-incremental equivalence, graph IDs,
context budgets, source guards, CLI and HTTP behavior. Existing provenance tests
validate all migrated upstream source hashes and licenses.

Run `node --import tsx bench/concepts.ts` for the labelled rule benchmark.
`eval/concepts-benchmark.json` records its results, elapsed times, cache reuse and
serialized context bytes. Its twelve small fixtures cover JS/TS, Python and Go,
documentation, misleading names, unused dependencies, candidate patterns, dynamic
dispatch and unsupported runtime claims. This is regression evidence for these
rules, not representative production precision/recall. Actual model-token
measurement is unavailable until a target-model tokenizer is supplied.

Later work: richer verified database/auth/cache/retry/RAG data-flow rules,
cross-file behavioral detectors, runtime/deployment evidence adapters, framework
and recent-change filters, ontology term proposal/review, concept graph edge
filter controls, selective LLM interpretation, and a larger independently labelled
benchmark. The initial release intentionally abstains where current evidence does
not establish the requested claim. No detector exists for every catalog concept.
