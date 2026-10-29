# MCP connection

MCP is optional. It exposes the same engine used by the CLI and cockpit through a local stdio process. The CLI and dashboard work without an assistant. Installing a skill does not register an MCP server.

## Prepare your graph and configuration

```sh
fehm scan --root /absolute/path/to/project
fehm doctor --root /absolute/path/to/project
fehm mcp-config --platform claude --root /absolute/path/to/project
```

Replace the platform with your client. Configuration generation prints exact absolute paths from the installed runtime and never changes settings. Review and merge only the FEHM entry, preserving other servers. The wheel launcher is used when available; npm installations use absolute Node and CLI paths. Use --executable /absolute/path/to/bin/fehm to select a specific existing launcher. Regenerate after moving the installation. The examples below use placeholders; substitute paths for the environment where your assistant runs.

## Claude Code

Prefer Claude's official registration command with your installed executable:

```sh
claude mcp add --transport stdio --scope project fehm -- /absolute/path/to/bin/fehm mcp --root /absolute/path/to/project
```

Approve the project server in Claude's MCP UI. JSON configuration is also supported.

### claude configuration

.mcp.json (project; approve through Claude Code).

```json
{
  "mcpServers": {
    "fehm": {
      "command": "/absolute/path/to/bin/fehm",
      "args": [
        "mcp",
        "--root",
        "/absolute/path/to/project"
      ]
    }
  }
}
```

### cursor configuration

.cursor/mcp.json (project) or ~/.cursor/mcp.json (personal).

```json
{
  "mcpServers": {
    "fehm": {
      "command": "/absolute/path/to/bin/fehm",
      "args": [
        "mcp",
        "--root",
        "/absolute/path/to/project"
      ]
    }
  }
}
```

### codex configuration

~/.codex/config.toml (personal); project .codex/config.toml requires a trusted project.

```toml
[mcp_servers.fehm]
command = "/absolute/path/to/bin/fehm"
args = ["mcp","--root","/absolute/path/to/project"]
```

### gemini configuration

.gemini/settings.json (project) or ~/.gemini/settings.json (personal).

```json
{
  "mcpServers": {
    "fehm": {
      "command": "/absolute/path/to/bin/fehm",
      "args": [
        "mcp",
        "--root",
        "/absolute/path/to/project"
      ]
    }
  }
}
```

### copilot configuration

~/.copilot/mcp-config.json (personal).

```json
{
  "mcpServers": {
    "fehm": {
      "type": "local",
      "command": "/absolute/path/to/bin/fehm",
      "args": [
        "mcp",
        "--root",
        "/absolute/path/to/project"
      ],
      "tools": [
        "*"
      ]
    }
  }
}
```

### vscode configuration

.vscode/mcp.json for the VS Code local MCP configuration; harness-specific configurations may differ.

```json
{
  "servers": {
    "fehm": {
      "type": "stdio",
      "command": "/absolute/path/to/bin/fehm",
      "args": [
        "mcp",
        "--root",
        "/absolute/path/to/project"
      ]
    }
  }
}
```

## Official client registration alternatives

Codex supports codex mcp add fehm -- /absolute/path/to/bin/fehm mcp --root /absolute/path/to/project. Copilot CLI supports copilot mcp add fehm -- /absolute/path/to/bin/fehm mcp --root /absolute/path/to/project. Review the scope reported by the client. Gemini uses its mcpServers settings; Cursor uses its MCP settings. VS Code can open its MCP configuration through the command palette. Client policy and trust approval still apply. The generated files are schema-tested; see the compatibility record for actual live-client evidence.

## Tools and limits

- fehm_context: focused source packet; query required, estimated budget 100–12000 tokens (default 4000).
- fehm_search: ranked lexical/graph hits; query required, limit 1–50 (default 10).
- fehm_focus: symbol/file with direct relationships; query required.
- fehm_relationships: direct edges with provenance and confidence; query required.
- fehm_system_map: structural repository overview.
- fehm_practices: current static project-health findings, at most 50 with total/truncation metadata. This preserves the old name but does not claim identical behavior to the removed legacy practices engine.

All tools require a fresh saved graph and cap responses at 96 KiB. They do not execute repository code, invoke external providers, repair graphs or expose arbitrary filesystem access. Missing, corrupt, incompatible or stale state returns an error with a scan instruction. Ordinary CLI commands may refresh indexes; MCP does not. Source changes during a query require another scan.

## Verify and refresh

Open your client's MCP server list and confirm FEHM connects and exposes the six tools above. Ask for a context packet about a known symbol and check its root and source locations. Then ask: “Use FEHM to explain the authentication flow. Identify entry points, trace supported caller/callee relationships, cite files and lines, and distinguish observed evidence from inference.” A tool appearing is not proof the assistant used it correctly.

After edits, run fehm scan in a separate terminal. The stdio server reads the refreshed state on subsequent calls. It stops on input closure or SIGTERM/SIGINT. Logs use stderr; stdout is reserved for MCP. Stop servers before replacing their installed runtime.

## Security and support

Returned source may be transmitted by your assistant to its provider. Local computation does not make that external interaction offline. Remote clients need access to the installation and checkout in their own environment. See [security](security.md) and [troubleshooting](troubleshooting.md).

Official sources: [Claude MCP](https://code.claude.com/docs/en/mcp), [Codex MCP](https://learn.chatgpt.com/docs/extend/mcp), [Cursor MCP](https://cursor.com/docs/mcp), [Gemini MCP](https://geminicli.com/docs/tools/mcp-server/), [Copilot MCP](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-mcp-servers), [VS Code MCP](https://code.visualstudio.com/docs/agent-customization/mcp-servers).
