# Review boundaries

This page preserves an older documentation URL while correcting its product claims.

## What is available

Use guardrails analyze for current working-tree scope and recommended checks, security for static evidence, and context to prepare source material for your coding assistant.

```sh
fehm guardrails analyze
fehm security
fehm context "review authentication changes" --budget 4000
```

## What is not included

The current CLI does not expose fehm review or bundle a separate Open Code Review runtime. Model-based review performed by your assistant remains a separate activity. Its suggestions do not become verified findings merely because FEHM supplied context.

Follow [change verification](verification.md) to record actual checks.
