# Troubleshooting

## Command or package not found

FEHM is not publicly released on PyPI/npm yet. Obtain the reviewed wheel and follow [installation](installation.md). Run uv tool update-shell and open a new terminal. Use uv tool dir --bin to locate the launcher. A registry 404 is not a reason to install an unrelated similarly named package.

## Runtime assets or wrong version

Run fehm --version and fehm doctor. The doctor reports the runtime directory, private Node version and required assets. Reinstall the reviewed wheel with dependencies if assets are missing. Stop older server processes before upgrading. Do not copy the generated executable without its uv environment.

## Skill not discovered

Run fehm integrations --platform codex --project, replacing the platform and matching your original scope. A current file proves installation, not activation. Reload the host and inspect its skill list. Check organization settings and client version. Personal Codex and generic skills share .agents/skills; Copilot CLI and VS Code share .github/skills in project scope. Do not install duplicate scopes unnecessarily.

## MCP fails to initialize

Use fehm mcp-config for the specific client. Codex uses TOML, VS Code uses a servers map, and other documented JSON clients use mcpServers. Merge the FEHM entry instead of replacing existing settings. Check the absolute executable and project paths. A GUI may not inherit your terminal PATH. Test the launcher with --version. MCP stdout is protocol traffic; diagnostics belong on stderr.

## Missing, corrupt, stale or wrong graph

Run fehm doctor --root /absolute/project. Then run fehm scan --root /absolute/project. Keep both graph.json and index.json together in .fehm. Do not copy another project's state into this directory. MCP refuses missing, incompatible or stale saved state and does not repair it implicitly. If source changes during a query, rescan and retry. CLI scans can rebuild malformed cache state without deleting user policies/history.

## Port or permission errors

Choose an unused port with fehm serve --port 7444, or stop your existing process with Ctrl+C. Check read access to source and write access to .fehm for scanning. MCP queries do not require writes. Avoid sudo installations. Symlinked assistant destinations are refused; choose a normal directory or manage that destination manually.

## Remote agents and upgrades

Install FEHM in the execution environment where the assistant runs. Your laptop paths cannot be used by a remote container or cloud agent. Refresh selected skills after upgrading; customized files are preserved and force replacement makes a backup. Regenerate MCP configuration if the executable location changed. Removing the CLI does not delete project graphs or client settings.
