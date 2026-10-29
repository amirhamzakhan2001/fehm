# Feature 3.7 — Prompt Intelligence

Feature 3.7 adds a local-first prompt inventory, code-aware analysis, evaluation,
conservative improvement engine, revision records and an explicitly approved apply
workflow. It consumes the existing `FehmEngine`, `BriefingFacts`, call/dependency
relationships, test references and Feature 3.6 security findings.

## Use

```sh
npm run build
node dist/cli.js prompts --root /path/to/project
node dist/cli.js prompts --root /path/to/project --json
node dist/cli.js serve --root /path/to/project
```

Open the dashboard's **Prompt intelligence** page (`/#/prompts`, standalone
`/prompts`). It includes inventory filters, instruction coverage, twelve score
dimensions, source fragments, variable origins, findings, dependency links,
workflow diagrams, candidate/diff review, recorded-output evaluation, pairwise
comparison, export and saved revision history.

```sh
fehm prompts --prompt-id P-... --prompt-mode balanced --json
fehm prompts --prompt-id P-... --cases
fehm prompts --prompt-id P-... --prompt-mode balanced --save-revision
fehm prompts --prompt-id P-... --history
fehm prompts --fail-on medium
```

Modes: `balanced`, `quality`, `tokens`, `reliability`, `structured-output`,
`security`. Some modes legitimately produce no automatic change. A missing
fallback, role, category list or tool permission cannot safely be invented from
weak static evidence. These remain actionable findings for developer review.

## Discovery and evidence

* TypeScript/JavaScript: compiler AST, lexical scope, local constants, named imports,
  literals/templates, concatenation, message arrays, shorthand fields, provider
  calls, common wrappers and receiver constructor instructions. Mutated values,
  spreads and dynamic expressions remain partial/unknown.
* Python: bounded lexical reconstruction of constants, concatenation, f-strings,
  messages, common calls and agent configuration. This is explicitly heuristic,
  **not** a Python AST/type checker.
* Artifacts: prompt text/Markdown/Jinja files and prompt keys in JSON/YAML.
  These use the shared scanner, with its ignore, binary and size policies.
* Calls include major SDK API shapes and common `llm`, `model`, `chain`, `agent`,
  `assistant`, `ai_service` and `llm_service` methods. Arbitrarily named wrappers
  are visible through graph dependencies but are not universally reconstructed.
* Records contain graph node/edge IDs, linked test paths and existing security
  finding IDs. They do not clone the graph. The current graph has no dedicated
  prompt ontology nodes; `ontologyNodeIds` is empty rather than fabricated.

Behavioral instruction coverage distinguishes **present**, **not detected** and
**unknown**. A simple translation utility receives an informational missing-role
finding; tool-bearing calls receive higher severity. Unresolved system/developer
configuration is unknown, not an assertion that instructions are absent.

Rule evidence includes task structure, output/parser mismatch, failure behavior,
grounding, variable boundaries, tool policy, sensitive content, static token
size, exact duplication and obvious contradictory output language. Detected
secrets are redacted, and affected source spans cannot produce a patch.

The twelve dimensions are intent, role, context, boundaries, constraints, output,
failure handling, grounding, security, tools, efficiency and maintainability.
Unknown dimensions are excluded from the static mean. Semantic and behavioral
scores are `null` until actually supplied/run. Composite scores average available
layers equally; the individual components and reasons remain exposed.

## Evaluation

Draft cases cover normal, empty, adversarial and missing/conflicting input.
They are **unreviewed generated templates**, not production tests. Replace the
placeholder inputs/assertions and set `reviewed: true` before execution.

A recorded-output file has this shape:

```json
{
  "model": "the-model-used-to-produce-these-outputs",
  "cases": [{
    "id": "normal",
    "name": "Known category",
    "origin": "authored",
    "reviewed": true,
    "variables": {"email": "Please cancel my order"},
    "assertions": [
      {"type": "json", "required": {"category": "string"}},
      {"type": "contains", "value": "cancellation"}
    ]
  }],
  "outputs": {"normal": "{\"category\":\"cancellation\"}"}
}
```

```sh
fehm prompts --prompt-id P-... --prompt-eval evaluation.json --json
fehm prompts --prompt-id P-... --prompt-mode balanced --prompt-eval candidate-evaluation.json --json
```

Supported deterministic assertions: exact equality, contains, not-contains, JSON
parsing and required top-level JSON field types. This is not a complete JSON Schema
validator. Unsupported assertions are rejected. Empty suites are not a pass;
missing outputs, invalid cases and timeouts cannot pass. Cases and prompt text are
hashed so comparisons reject mismatched versions, models and suites.

For live evaluations, supply callbacks explicitly through the library:

```ts
import { evaluateCandidate } from "fehm";

const result = await evaluateCandidate({
  prompt,                    // a record from buildPromptReport()
  mode: "balanced",
  cases,                     // reviewed, representative cases
  model: "your-pinned-model",
  provider: async ({ prompt, test, signal }) => {
    // Call your model adapter here. Known placeholders have been substituted.
    // Preserve your application's actual message roles, schemas and settings.
    // Do not dispatch production tools while evaluating adversarial inputs.
    return runYourModel({ prompt, test, signal });
  },
  judge: async ({ original, candidate, requirements }) => {
    // Return {score: 0..100, intentPreserved, rationale, model}.
    return reviewIntent({ original, candidate, requirements });
  },
});
```

Scanning, candidate generation and recorded-output checks never make model calls.
There are no built-in provider credentials or paid network calls. Callbacks own
provider integration, costs and cancellation support. Flattened logical prompt
text alone does not reproduce a multi-message application: the provider adapter
must preserve runtime roles, configuration and tool mocks. A static score is not
an estimate of task success.

The dashboard accepts the recorded-output format. To compare, select a candidate
mode and add `baselineOutputs` plus a semantic review object
`{score, intentPreserved, rationale, model}`. Export the resulting comparison.
Recorded outputs and semantic reviews are explicitly user-supplied evidence;
FEHM does not attest that the stated model produced them.

## Improvement, regression gates and applying

Default revisions retain original instructions and variables. They can add an
observed JSON output requirement or grounding/data-handling constraints, or
collapse surplus blank lines. They never invent application schema fields,
category names, failure return values or permissions. Tokens may increase to
address a reliability issue. Every change cites a finding or a concrete edit.
There is no claim of semantic deduplication or arbitrary LLM rewriting.

A candidate starts as `needs-validation`, or `rejected` for incomplete
reconstruction, sensitive content or no applicable change. Recommendation requires:

1. Matching original/candidate text hashes and the same nonempty suite/model.
2. Preserved original instructions and variables, plus a positive semantic review.
3. No previously passing case regresses.
4. All security/critical cases pass; no execution errors remain.
5. Behavioral score does not decline; no detected output conflict remains.

An improved aggregate score never overrides these gates. For a source edit,
a single unambiguous literal/file span is required; composed and dynamic prompts
remain manual edits. The dashboard provides an actual unified source patch for
review. Multi-file rewriting is not automatic.

A comparison JSON file contains `baseline`, `proposed` and `semantic` records from
the library or dashboard. Run:

```sh
fehm prompts --prompt-id P-... --prompt-mode balanced \
  --prompt-comparison comparison.json --json

fehm prompts --prompt-id P-... --prompt-mode balanced \
  --prompt-comparison comparison.json --apply --approve \
  --prompt-check '["npm","test"]'
```

`--approve` is the explicit developer decision. `--prompt-check` is a required
argument array, executed without a shell with a two-minute timeout. Apply refuses
stale source or symlink escapes, preserves CRLF, runs the specified code checks,
and restores the original file if checks fail. If another writer changes the file
during validation, FEHM refuses to overwrite that writer. `--dry-run` validates
the apply prerequisites without editing or running the code check. No commit is
created. The library exposes the same flow as `applyPromptCandidate`, accepting a
validation callback. The HTTP server intentionally does not execute test commands
or apply production code; use the explicit CLI/library workflow.

Saved revisions live in `.fehm/prompt-revisions.json` (or the configured state
directory). Records include version, optimization ID, scores, tokens, timestamp,
source commit and hashes; they do not copy prompt text or duplicate Git history.
Storage retains the latest 1,000 records. Read-only services reject saving.

## Token and cost accounting

Counts are `ceil(UTF-8 bytes / 4)`, clearly labelled estimates rather than exact
model tokenization. Dynamic/total tokens remain unknown. The static prefix is
reported separately for cache awareness. `estimateImpact` takes an explicit
invocation count and uncached input price; it does not invent current provider
pricing or assume that removed tokens equal cache-adjusted cost savings.

## HTTP and library surfaces

* `GET /api/prompts`, `/report`, `/detail?id=...`, `/history?id=...`
* `GET /api/prompts/candidate?id=...&mode=...`, `/patch?id=...&mode=...`
* `POST /api/prompts/refresh`, `/save?id=...&mode=...`
* `POST /api/prompts/evaluate`, `/compare` — recorded outputs only, maximum 1 MB

POST requests require `x-fehm: 1`. The page uses the existing same-origin CSP and
renders repository text as DOM text, not HTML. All public domain functions and
types are exported from `fehm`.

## Known boundaries

Static reconstruction cannot find every runtime-generated prompt. Python and
configuration parsing are heuristic; imported Python prompt builders, arbitrary
wrapper aliases, runtime `.format()` expansion, complex schema propagation,
inter-service flow, embeddings, vision payloads and arbitrary templates may remain
unresolved. Parser detection is function-scoped and is labelled as a possible
association, not proven response data flow. Delimiters are not a security control
by themselves. Exact duplicates are detected; semantic similarity, automatic
business-rule extraction, hallucination/factuality judgments and universal tool
behavior evaluation require application-specific evaluators.

Coverage is limited to indexed files and reported in every scan. Absence of a
finding is not proof of prompt quality or security.

## Design references and validation

The separation between code evaluators, semantic judging, pairwise comparison and
regression tests follows the evaluation taxonomy in
[LangSmith's evaluation documentation](https://docs.langchain.com/langsmith/evaluation-types).
The supplied feature design also references Promptfoo's assertion and iterative
optimization concepts; FEHM adds no runtime dependency on either framework.

Tests in `test/prompts.test.ts` exercise imported/scoped instructions, Python
reconstruction, templates, mutation uncertainty, secret redaction, graph references,
output contracts, candidate preservation, valid patches, evaluation failures,
regression gates, CLI/API behavior, revisions, approval, stale source and rollback.
