# Quickstart

Build FEHM using the [installation guide](installation.md), then run these commands from a repository you know.

## Find the relevant source

```sh
fehm scan .
fehm stats
fehm search "authentication"
fehm context "change authentication" --budget 4000
```

Inspect returned file locations. Replace the example query with a task that exists in your codebase.

## Follow a symbol

```sh
fehm focus authenticate
fehm relationships authenticate
fehm flow authenticate --depth 2
```

Replace authenticate with a symbol returned by search. Ambiguous symbols and unresolved calls need inspection; a static path is not a recorded execution trace.

## Open the workspace

```sh
fehm serve --port 4317
```

Visit http://127.0.0.1:4317. The Context Engine workspace provides a reading guide with source references and expandable raw diagnostics. Other pages expose the graph, briefing, architecture and evidence reports.

## Review before running checks

```sh
fehm guardrails analyze --json
```

This recommends checks without executing them. Read [verification](verification.md) before approving repository commands.
