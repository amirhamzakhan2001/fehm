# Quickstart

Install FEHM from PyPI using [installation](installation.md). These steps need no AI assistant, provider key or FEHM source checkout.

## Scan your project

```sh
cd /path/to/your/project
fehm --version
fehm doctor
fehm scan .
fehm doctor --json
```

Confirm the doctor reports a fresh graph at your project's .fehm/graph.json. Scan also saves .fehm/index.json. It does not install the project's dependencies or execute its code.

## Retrieve evidence

```sh
fehm search "authentication"
fehm context "authentication flow" --budget 4000
fehm relationships "authenticateUser"
fehm flow "authenticateUser" --depth 2
```

Replace authenticateUser with a symbol returned by search. Follow source paths and line references. Inferred edges and unresolved calls are not runtime proof. Refresh with fehm scan . after edits before using MCP.

## Open the local cockpit

```sh
fehm serve --port 4317
```

Open http://127.0.0.1:4317 and stop with Ctrl+C. Use a different free port for a second project.

## Optional assistant skill

```sh
fehm install --platform codex --project --dry-run
fehm install --platform codex --project
fehm integrations --platform codex --project
```

Select your platform: claude, cursor, codex, gemini, copilot, vscode or generic. Reload the assistant and inspect its skill list. Ask: “Use FEHM to explain the authentication flow. Identify the relevant entry points, trace the supported caller/callee relationships, cite source files and line locations, and distinguish directly observed evidence from inferred relationships.”

## Optional MCP

```sh
fehm mcp-config --platform codex --root /absolute/path/to/project
```

This prints configuration only. Review and merge the FEHM entry into your client's settings. See [MCP connection](mcp.md). CLI installation, skill installation and MCP registration are independent steps.
