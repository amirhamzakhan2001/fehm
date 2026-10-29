# Assistant integrations

These guides target FEHM **1.0.0**, the first release. Public registry publication is pending; begin with the reviewed wheel.

Install the CLI first using [installation](guides/installation.md). Register the first-party Fehm skill using `fehm install --platform <client>` (personal) or add `--project` at the intended project root. `fehm integrations` reports status; `fehm uninstall` removes the selected scope's managed entrypoint. Add `--dry-run` to preview writes; customized files require explicit force with backup. The same lifecycle implementation serves selected catalog skills.

Platform keys: claude, cursor, codex, gemini, copilot, vscode, generic. Claude uses .claude/skills; Cursor .cursor/skills; Codex/generic .agents/skills; Gemini .gemini/skills. Copilot CLI and VS Code share .github/skills for project scope and ~/.copilot/skills for personal scope. Every entrypoint is in a fehm subdirectory. Those two Copilot labels do not imply independent skill systems.

Skills teach workflow; MCP exposes tools. Neither installs the CLI. Optional `fehm mcp-config --platform <client> --root /absolute/project` prints settings only. Use the generated configuration and the client's trust/registration UI. See [MCP guide](guides/mcp.md), [catalog skills](guides/skills.md), and [actual compatibility results](REAL_TESTING.md).

Installation never modifies shared instructions, hooks, permissions or unrelated MCP servers. Removal keeps unknown sibling files and project state. Multi-file catalog installation is atomic per file, not transactional across a resource bundle; an interrupted operation may need inspection and retry. Do not run concurrent installers against the same destination.
