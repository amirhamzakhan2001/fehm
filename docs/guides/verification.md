# Change verification

Start with a read-only assessment of current changes. Reverse file dependencies, connected tests and package checks help identify useful verification steps.

## Inspect before execution

```sh
fehm guardrails analyze --json
fehm guardrails verify
```

Without --approve, verify analyzes without running checks. Inspect the proposed commands, working directories and project scripts. When you authorize host execution:

```sh
fehm guardrails verify --approve
```

This approval runs the discovered batch. It is not isolation from repository code. Health --run is another explicit execution path; ordinary health analysis does not run project checks.

## Use a strict task policy when needed

```sh
fehm guardrails plan --json
fehm guardrails start --file TASK.json
fehm guardrails report --run-id RUN --gate
```

TASK.json must be a reviewed policy with real requirements, check IDs and argv. The template alone does not approve execution. Supported strict workflows can record baseline, red, green and refactor phases. TDD evidence currently validates Node TAP assertions; unsupported output can be inconclusive.

## Report only demonstrated results

Distinguish passed, failed, skipped, blocked, not-run, stale and inconclusive evidence. A passing check is valid only for its observed scope and freshness. A passing suite does not prove complete correctness or that the original failure was reproduced.

## Scope boundary

Current impact analysis covers working-tree files and reverse dependencies. The richer revision-aware Change Impact Engine remains a plan; there is no standalone fehm impact command. Renames are currently represented as deletion/addition pairs in this workflow.
