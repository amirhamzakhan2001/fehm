# Superpowers workflows

FEHM refreshes five existing Superpowers-derived workflows without adding another registry, orchestrator or verification engine.

## Available workflows

- workflows/brainstorming: clarify requirements and design decisions.
- workflows/writing-plans: create an implementation plan grounded in actual files and interfaces.
- testing/test-driven-development: preserve the detailed red/green/refactor workflow and test-writing reference.
- debugging/systematic-debugging: investigate evidence, compare patterns and test hypotheses before fixing.
- verification/verification-before-completion: support completion claims with actual, fresh checks.

## Retrieve only what is useful

```sh
fehm agent-context "Debug the failing authentication test" --skill debugging/systematic-debugging
fehm skills show testing/test-driven-development --level full
fehm skills resource debugging/systematic-debugging fehm-evidence.md
fehm skills route "Explain authentication" --exclude-source superpowers
```

Skills retain the existing IDs and routing defaults. Detailed resources load on demand. A generic plan request may select another existing FEHM planning skill; --skill selects your preferred workflow within the budget.

## Evidence and permissions

Workflow instructions link to existing test discovery, guardrail execution, debugging investigations and context commands. They do not grant permission to run commands or prove that an agent followed a workflow. Strict TDD evidence requires supported Node TAP assertions. Passing a final test does not establish that a failing test ran first.

## Provenance

The selected refresh uses a downloaded snapshot reporting Superpowers 7.0.1; no commit SHA was present. Original/adapted hashes and modification notes are recorded in skills/superpowers-provenance.json. MIT notices are preserved in every installed selected skill. Other existing catalog entries retain their earlier provenance.

The upstream compulsory bootstrap, visual server and automatic orchestration are not part of this integration. The full audit and maintenance record is in docs/integrations/superpowers.md in the repository.
