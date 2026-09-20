# Fehm with coding assistants

Install Fehm using uv, then register its **Agent Skill** with the assistant you use. The skill teaches the assistant how to scan, query evidence, inspect impact, and review architecture/practice drift. Each integration runs the same local Fehm engine.

Before an official PyPI release, install the developer-built wheel using [DEPLOYMENT.md](DEPLOYMENT.md). After publication:

```bash
uv tool install fehm
uv tool update-shell
```

Registration defaults to your personal user directory. Add `--project` while in a repository root to share a repository-local skill. Run `fehm install --platform <name> --dry-run` to preview. The installer reports every destination and preserves customized skills unless `--force` explicitly requests a backup and replacement. It does not modify shared instructions, MCP settings, permission lists, or hooks.

## Claude Code

```bash
fehm install --platform claude
# Or, from your repository:
fehm install --project --platform claude
```

Reload Claude Code and select `/fehm`, asking it to map the current repository. Personal skills live at `~/.claude/skills/fehm/SKILL.md`; project skills at `.claude/skills/fehm/SKILL.md`. See [Claude Code skills](https://code.claude.com/docs/en/skills).

## Cursor

```bash
fehm install --platform cursor
# Repository-only alternative:
fehm install --project --platform cursor
```

Reload Cursor, select `/fehm`, and ask it to map the repository. Destinations are `~/.cursor/skills/fehm/SKILL.md` or `.cursor/skills/fehm/SKILL.md`. This uses Cursor's native skill support; a redundant always-on rule is not required. See [Cursor skills](https://cursor.com/docs/skills).

## Codex

```bash
fehm install --platform codex
# Repository-only alternative:
fehm install --project --platform codex
```

Use `$fehm` in Codex CLI/IDE and ask it to map the repository. Destinations are `~/.agents/skills/fehm/SKILL.md` or `.agents/skills/fehm/SKILL.md`. Restart Codex if discovery does not refresh. Existing `AGENTS.md` files remain intact. See [OpenAI's skill documentation](https://learn.chatgpt.com/docs/build-skills).

## Gemini CLI

```bash
fehm install --platform gemini
# Repository-only alternative:
fehm install --project --platform gemini
```

Restart/reload Gemini CLI and ask it to use the Fehm skill to map the repository. Its skill activation mechanism can select Fehm from the request; a `/fehm` command is not assumed on every Gemini version. Destinations are `~/.gemini/skills/fehm/SKILL.md` or `.gemini/skills/fehm/SKILL.md`. See [Gemini Agent Skills](https://geminicli.com/docs/cli/using-agent-skills/).

## GitHub Copilot CLI

```bash
fehm install --platform copilot
# Repository-only alternative:
fehm install --project --platform copilot
```

In Copilot CLI, use `/skills reload`, then `/skills info fehm`. Ask it to use Fehm to map the repository. Destinations are `~/.copilot/skills/fehm/SKILL.md` or `.github/skills/fehm/SKILL.md`. See [Copilot CLI skills](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-skills).

## GitHub Copilot in VS Code

```bash
fehm install --platform vscode
# Repository-only alternative:
fehm install --project --platform vscode
```

Reload VS Code, select the Fehm skill in agent chat (or `/fehm`), and ask it to map the repository. This shares the `.copilot` user / `.github` project skill paths used by Copilot CLI, so installing both aliases is unnecessary. See [VS Code skills](https://code.visualstudio.com/docs/agent-customization/agent-skills).

## Other assistants

```bash
fehm install --platform generic --project
```

This writes `.agents/skills/fehm/SKILL.md` for clients that discover that convention. Without `--project` it writes `~/.agents/skills/fehm/SKILL.md`. Generic and Codex share the same destination. Compatibility is conditional on the client's Agent Skills support; clients without it can use the CLI or stdio MCP. Install only the scope/platform you need to avoid duplicate discovery in clients that read several compatible directories.

## Build once, query, and refresh

These commands work in every supported assistant terminal, from the analyzed repository:

```bash
fehm scan .
fehm query "authentication flow"
fehm practices audit
fehm serve .fehm/graph.json --watch
```

The graph lives in `.fehm/graph.json`. Ask: **Use Fehm to explain the authentication flow. Cite the source files and distinguish explicit relationships from inferred ones.** Query produces a source-backed context packet; the assistant explains it using its own model. Fehm does not silently call a provider. Rescan after changes or keep the watcher running.

After a registry upgrade, refresh the installed skill using the same platform/scope:

```bash
uv tool upgrade fehm
fehm install --platform claude
fehm integrations --platform claude
```

To remove only the registration, run `fehm uninstall --platform claude` (add `--project` for a repository skill). This leaves graph state and other assistant files intact. A user-edited skill requires review before updating; `--force` saves a timestamped `.bak` beside it. Restore/customize that backup manually if needed. Symlinked installation paths are refused to prevent unintended writes elsewhere.

## Optional MCP connection

Skills work through the CLI; automatic MCP registration is not performed. For any client supporting local stdio MCP, register an absolute executable path and the intended graph. `uv tool dir --bin` reports the tool executable directory. Use its `fehm` (`fehm.exe` on Windows):

```json
{
  "mcpServers": {
    "fehm": {
      "command": "/absolute/path/to/uv/bin/fehm",
      "args": ["mcp", "/absolute/path/to/project/.fehm/graph.json"]
    }
  }
}
```

The outer configuration schema/location depends on the client (Codex uses TOML; VS Code uses a `servers` map). Translate the same command and args into the client's schema. See the [official Codex MCP reference](https://learn.chatgpt.com/docs/extend/mcp?surface=cli). For example, a Codex MCP entry is:

```toml
[mcp_servers.fehm]
command = "/absolute/path/to/uv/bin/fehm"
args = ["mcp", "/absolute/path/to/project/.fehm/graph.json"]
```

Build the graph first and reload the client. Confirm it lists `fehm_context` and `fehm_practices`. MCP does not require the cockpit server. Refresh graphs separately. Tools that run project commands or call model providers remain explicit actions.

## Verification boundaries

Automated tests check each registration destination, both scopes, repeat installation, custom-file protection/backups, removal, symlink refusal, and packaged CLI execution. The wheel smoke also exercises stdio MCP and localhost assets without global Node/npm. These tests do not authenticate to proprietary clients or prove every client version has discovered the skill. Verify discovery in your installed assistant before adopting it in a team. Remote/cloud assistants need their own Fehm installation and project skill; a personal local registration does not provision the remote environment.
