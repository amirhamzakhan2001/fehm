# Failure investigation

Supply a stack trace, error output or a source location. FEHM maps available evidence to relevant code, relationships, changes and tests. It produces tentative hypotheses, not automatic proof of root cause.

## Start an investigation

```sh
fehm debug --input failure.txt --location src/auth.ts --line 42 --save
```

Use real paths and redact sensitive logs before saving them. Omit a source location if unknown. The result includes an investigation ID.

## Read or reuse the evidence

```sh
fehm debug report --id INVESTIGATION
fehm debug context --id INVESTIGATION --tokens 2500
```

The /debug dashboard presents hypotheses, evidence and diagnostic actions. Graph relationships do not establish causality; reproduce the failure and use a discriminating check.

## Execution and retention

Inspect an action before executing fehm debug run --id INVESTIGATION --action-id ACTION --approve. Approval applies to real supported checks through existing execution safeguards. The dashboard does not execute project commands. Analysis is ephemeral unless saved; saved investigations can be deleted with fehm debug delete --id INVESTIGATION.
