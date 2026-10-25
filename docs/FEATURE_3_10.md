# Feature 3.10 — Engineering Guardrails

FEHM now supports an explicit, local change-verification workflow through `fehm guardrails`, the exported `Guardrails` API, and the `/guardrails` dashboard. It records evidence from approved commands rather than accepting a coding agent's assertion that tests passed.

This is the initial implementation of the specification, with the supported boundaries below. It does not transparently intercept IDE agents, provide an independent LLM reviewer, or sandbox arbitrary generated code.

## Quick start

```sh
fehm guardrails plan --root . > task.json
# Review task.json: replace the task and acceptance criteria, confirm criteria,
# map each criterion to check IDs, and configure exact commands/categories.
fehm guardrails start --file task.json --root .
# Copy the returned run ID.
fehm guardrails run --run-id RUN --check-id unit --phase baseline --approve
# Add a failing behavioral test before changing implementation.
fehm guardrails run --run-id RUN --check-id unit --phase red --expected-test 'returns the expected value' --approve
# Implement the change without altering the red test.
fehm guardrails run --run-id RUN --check-id unit --phase green --approve
# Run each required integration/regression/build/lint check in the same way.
fehm guardrails security --run-id RUN
fehm guardrails report --run-id RUN --gate
fehm guardrails context --run-id RUN --bytes 12000
fehm serve
```

`plan` reuses Project Health's command discovery. It is a template, not approval. Discovery labels generic test commands as regression; the user must identify unit and integration checks. Default policy requires all three categories, TDD, and security review. A full suite can be an additional required regression check. Impact-based suggestions never remove mandatory checks.

Example task configuration (adjust paths to the repository):

```json
{
  "task": "Return the expected value",
  "mode": "agent-integration",
  "requirements": [
    {"id":"value", "text":"Returns the expected value", "origin":"user", "confirmed":true, "checks":["unit","integration"]}
  ],
  "policy": {
    "checks": [
      {"id":"unit", "category":"unit", "argv":["node","--test","--test-reporter=tap","test/unit.test.mjs"], "cwd":".", "required":true},
      {"id":"integration", "category":"integration", "argv":["node","--test","--test-reporter=tap","test/integration.test.mjs"], "cwd":".", "required":true},
      {"id":"regression", "category":"regression", "argv":["npm","test","--","--test-reporter=tap"], "cwd":".", "required":true}
    ],
    "requiredCategories":["unit","integration","regression"],
    "tdd":true,
    "security":true,
    "maxAttempts":2,
    "timeoutMs":120000,
    "execution":"host-approved"
  }
}
```

Node options must appear before positional test files. For npm scripts, verify that argument forwarding reaches the test runner correctly; an argument after a glob may be treated as a filename. Configure a dedicated TAP script when necessary. No shell glob expansion is performed by FEHM.

## Workflow and evidence

- Intake freezes policy and requirement-to-check mappings. Inferred requirements remain unverified until explicitly confirmed in the task configuration. To change the requirements or policy, start another run.
- Baseline checks must run against the intake fingerprint. Later failures are annotated if that check also failed at baseline; pre-existing failures remain visible and do not automatically pass the gate. Baseline capture is optional in this initial version, particularly for verification-only tasks.
- Red requires a real failing TAP subtest with the exact expected name and `ERR_ASSERTION`, a changed test snapshot, and unchanged implementation since intake. Setup, syntax and dependency failures do not count. Green must retain the red test snapshot. Refactor checks can be recorded as another phase and must pass on the current revision.
- `exception --run-id RUN --reason '...'` records a deliberate TDD exception. It produces warnings rather than silently satisfying strict TDD.
- Changed existing tests or test configuration require human review. `review --run-id RUN --reason '...'` records review for the current fingerprint. This conservative heuristic flags changes; it does not prove malicious intent or semantically detect every weakened assertion.
- Unit/integration/regression commands currently require Node TAP summary output with positive test counts, every test passing, and no skips/todos/cancellations. Other runner output is inconclusive. Build/lint commands use exit status. Missing environment/dependencies, timeout, empty/truncated output and process failures are distinguished from passes.
- Every invocation needs `--approve`. This approves the frozen argv/cwd at the current fingerprint. The ledger records argv, phase, approval, timestamps, duration, exit code, bounded redacted output, policy hash and fingerprint. Commands that mutate included source files produce stale evidence.
- Readiness is `verified_required`, `verified_warnings`, `not_verified`, `failed`, or `requires_human_review`. `report --gate` returns nonzero unless readiness begins with `verified_`. This verifies configured mappings, not complete correctness.

## Existing feature integration

The implementation uses the actual repository numbering: Health 3.5 supplies command discovery; Security 3.6 supplies deterministic static findings; the existing graph supplies reverse dependency impact and suggested tests; Git Memory's Git wrapper supplies HEAD and a bounded working-tree diff. Graph links are included in reports. Git diff excludes untracked content; the content snapshot still detects untracked changes.

Security assessment records severity, confidence, location and recommended action, retains previous assessments, and includes analyzer unknowns. High/critical findings block readiness. After a fix, checks and security analysis must be rerun. A finding no longer detected is not proof that every exploit is prevented. No dependency advisory network lookup, dynamic scan or penetration test runs automatically.

## Agent integration and bounded remediation

The documented CLI protocol and exported TypeScript API are the supported integration surfaces. `agent-integration`, `fehm-directed`, and `verification-only` label the workflow's owner; they do not enable proprietary IDE hooks or automatic interception.

```ts
import { Guardrails } from 'fehm';
const guard = new Guardrails(repositoryRoot);
await guard.remediate(runId, 'Fix the failing implementation', true, async report => {
  // Invoke your explicitly authorized local coding-agent adapter here.
  // Use report.run.requirements, report.reasons and report.impact.
  // Preserve tests; do not change requirements or suppress failing checks.
});
```

Remediation is opt-in through the API; no bundled LLM provider or automatic code-writing command is enabled. Each invocation records an attempt and consumes the run's bounded retry budget, including unsuccessful attempts. The adapter receives the report; after completion FEHM reruns required checks and security analysis. Test modifications stop automatic verification and require human review. The adapter executes in the host process and must be trusted; cancellation and time limits inside the adapter are the integrator's responsibility. FEHM does not forcibly roll back edits.

Execution, remediation, and review mutations share a repository lock. If the process crashes, inspect `.fehm/guardrails/execution.lock` and confirm no runner is active before removing that stale lock. An interrupted check remains running/unverified rather than being promoted to passed.

## Dashboard and persistence

The dashboard provides history, readiness reasons, requirement mappings, check results/output, TDD evidence, security findings, changed paths, graph links, remediation attempts, timeline, frozen policy, and JSON report download. Commands, exceptions, and human review are explicit CLI/API actions; the HTTP dashboard is read-only. Policy edits happen in the task file followed by a new run.

Runs live under `.fehm/guardrails/<run-id>.json` in the repository. The guardrails ledger intentionally does not follow the server's alternate index `--state-dir`; it remains tied to the repository. `history` lists runs; `context` emits a bounded text packet with a truncation marker. Its size parameter is a character bound, not a tokenizer measurement.

## Execution and assurance limits

- The runner uses exact allowlisted argv, `shell:false`, a realpath-checked repository cwd, closed stdin, a minimal environment, a timeout (maximum ten minutes), bounded output, and process-group termination on POSIX. PATH and temporary-directory variables are retained; arbitrary inherited credentials and `NODE_OPTIONS` are not forwarded. Tool-specific environment configuration is not yet supported.
- `host-approved` runs with host filesystem/network permissions. It does not enforce memory, filesystem or network isolation. `isolated` requests are blocked rather than silently downgraded. Windows descendant-process isolation and `.cmd` shell wrappers are not supported by this runner.
- Snapshots hash regular file contents, including untracked/unsupported source types and lockfiles. They exclude dependency/output directories named `.git`, `node_modules`, `dist`, `build`, `coverage`, `.cache`, and `__pycache__`. Under `.fehm`, only `health.json` and `findings-review.json` are included. The run policy is independently hashed. Symlinks, unreadable files and size/count limits block verification rather than being silently accepted.
- Snapshot limits: 30,000 files, 5 MB per file, 250 MB aggregate. Executable versions, installed dependencies, external services, file modes, and excluded generated artifacts are not attested. Their changes require deliberate rerunning; content freshness alone cannot detect them.
- Logs are bounded and common credential patterns are redacted; redaction cannot recognize every secret. Do not put credentials in task text, argv, or test output. The local ledger is not tamper-proof or a security boundary against a malicious runner. Approved test output and human-reviewed requirement mappings remain trusted inputs.
- Static graph test suggestions are advisory. Framework-specific test-result adapters, automatic requirement extraction, detailed assertion-diff analysis, native IDE integrations, container execution, dynamic security validation, deployment approval, and autonomous LLM supervision remain future extensions.

## Validation

The new classifier was exercised with a failing assertion before implementation. Controlled repositories cover positive/negative execution, setup failures, stale revisions, exact red checkpoints, TDD exceptions, inferred criteria, all three test categories, approval/isolation blocking, timeouts, environment filtering, test changes, bounded remediation, security fix/reassessment history, and HTTP dashboard routes. Existing feature regression tests are also run. Browser rendering remains a separate visual check; API tests do not substitute for it.
