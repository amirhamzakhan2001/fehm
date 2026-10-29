# Local dashboard

The localhost dashboard is part of the FEHM application. It is separate from the static public website in website/.

## Start the dashboard

```sh
fehm serve --root /absolute/path/to/project --port 4317
```

Visit http://127.0.0.1:4317. Select a project you trust. Stop the process with Ctrl+C; choose another port if occupied.

## Workspace pages

- /graph: codebase graph and source relationships.
- /explain: codebase briefing.
- /architecture and /drift: architecture views and drift evidence.
- /health and /security: quality, readiness and security reports.
- /prompts: prompt inventory and evaluation.
- /git-memory and /concepts: history and concept evidence.
- /guardrails and /debug: verification and investigation reports.
- /engine: context reading guide, source references and expandable diagnostics.

## Operating boundary

The local workspace is not a production multi-tenant service. Keep it local and use the CLI's supported execution approvals. The old graph-file positional argument and --watch examples are not supported by this CLI.
