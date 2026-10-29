# CLI reference

Run fehm help for the full argument reference. Commands accept --root DIR; --json requests structured output where supported. Run from the project root when omitting --root.

## Source and context

```sh
fehm scan .
fehm stats
fehm search "authentication"
fehm context "change authentication" --budget 4000
fehm explain src/auth.ts
fehm system-map
fehm connectivity
fehm agent-context "Debug authentication" --skill-budget 2500
```

Use focus, relationships and flow with a real symbol returned by search. Context budgets use FEHM's estimator, not an exact provider tokenizer.

## Engineering analysis

```sh
fehm brief
fehm architecture --view dependencies
fehm drift
fehm health
fehm security
fehm prompts
fehm git-memory "authentication"
fehm concepts "idempotency"
fehm ontology "idempotency"
fehm guardrails analyze
fehm debug --location src/auth.ts --line 1
```

Use actual source paths. Health and security findings are static evidence, not proof of behavior. The concept commands require Node 22.13+.

## Skills and optional workflows

```sh
fehm skills list --source superpowers
fehm skills route "Debug a failing test" --budget 2500
fehm skills show debugging/systematic-debugging --level full
fehm skills resource debugging/systematic-debugging root-cause-tracing.md
fehm agent-context "Explain authentication" --no-skills
```

## Execution is a separate decision

Guardrails verification and diagnostic execution require explicit approval. Health --run executes discovered project commands. Prompt --apply --approve can modify files and run a supplied check. Read the relevant guide and inspect commands before enabling execution; the host is not a sandbox.

Unsupported older command examples include fehm query, fehm impact, fehm practices, fehm mcp and fehm install. Use search, guardrails analyze, drift/health and skills install for the implemented workflows.


## Installation and assistant connections

```sh
fehm --version
fehm doctor --json
fehm install --platform claude --project --dry-run
fehm install --platform claude --project
fehm integrations --platform claude --project
fehm uninstall --platform claude --project
fehm mcp-config --platform claude --root /absolute/project
fehm mcp --root /absolute/project
```

Omit --project for personal skills. mcp-config prints settings without writing them; --executable accepts an existing absolute launcher path. The mcp command uses stdout exclusively for stdio protocol messages and requires an explicit root. A missing or stale graph needs a scan in a separate terminal. The former fehm query command is now fehm context (or fehm search for ranked hits); graph-file positional MCP arguments are no longer accepted.
