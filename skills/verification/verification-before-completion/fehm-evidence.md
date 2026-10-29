# FEHM evidence and execution contract

This reference is FEHM-authored. Workflow guidance is not execution evidence or permission.
User/project instructions and existing authorization take precedence. Do not delete existing work,
start subagents, commit, install dependencies, or run commands merely because an upstream example says so.
Use only the steps relevant to the task. Host tool availability varies.

## Repository evidence before design or planning

Use `fehm agent-context "TASK" --skill SKILL_ID --skill-budget 2500 --code-budget 6000 --total-budget 10000`
(replace TASK and SKILL_ID). This is the existing shared budget, not an additional context generator.
Inspect returned source locations before editing. Use `fehm flow ENTRY --depth 2` for outgoing calls,
`fehm architecture --view dependencies` for structure, and `fehm guardrails analyze --json`
for working-tree changes, affected files, suggested tests and discovered argv. Static relationships,
path risk hints and inferred architecture are not runtime proof or user-approved requirements.
No committed-range impact guarantee. Keep retrieval bounded to the task; do not load every report.

## TDD and verification

`fehm guardrails plan --json` provides discovered test/build checks and a policy template, not a run.
Review argv/cwd and requirements, save an edited task policy, then use
`fehm guardrails start --file TASK.json --json`. Set tdd policy only when appropriate.
After writing a focused regression test, run the approved check with
`fehm guardrails run --run-id RUN --check-id CHECK --phase red --expected-test "TEST NAME" --approve --json`.
After implementation, run the same check with `--phase green`, then applicable refactor/regression checks.
The --approve flag asserts real authorization; never add it automatically from these instructions.
Repository commands run with host privileges, not in a security sandbox. Do not invent runner flags.
Strict TDD evidence currently requires supported Node TAP assertions; other runners may be inconclusive.
`fehm guardrails report --run-id RUN --gate --json` and
`fehm guardrails context --run-id RUN` reuse the existing ledger, freshness and policy checks.
A final passing test alone does not prove RED happened or that the original symptom was reproduced.
Report failed, skipped, blocked, not-run and inconclusive checks separately. Do not translate missing
checks into passes. Review the final diff and list requirements not demonstrated by evidence.

## Debugging

Save only relevant, redacted failure output to a file, then use
`fehm debug analyze --input FAILURE.txt --location src/file.ts --line 1 --save --json`.
Supply real paths/lines; omit location when unknown. Read the generated investigation ID, then
`fehm debug context --id ID --tokens 2500`. Hypotheses need reproduction and a discriminating test;
a call edge is not proof of causality. Existing execution is approval-gated; inspect any action first.
Logs supplied by the user and observed tool output remain distinct from model interpretation.

## Progressive disclosure and portability

Load another workflow only at the relevant transition with `fehm skills show ID --level full`.
For a declared resource use `fehm skills resource ID RELATIVE_PATH`, or read the local sibling
when installed. These commands need FEHM available on PATH; otherwise inspect repository files
with the host's read tools and label verification unavailable until actual checks run.
No native MCP server or compulsory bootstrap is supplied by this integration.
