# Integration boundaries

This page preserves an older documentation URL so existing links do not lead to obsolete setup commands.

## No native MCP server in this checkout

The current CLI has no fehm mcp command. The older stdio configuration and Python-wheel instructions belong to a different implementation and should not be copied into an assistant configuration.

## Supported interfaces

Use the CLI, the TypeScript library exports, the local dashboard or selected assistant skills. Skill installation writes files; it is not MCP registration. See [skills and assistant setup](skills.md) and [CLI reference](cli.md).

An external adapter could wrap supported APIs, but no such adapter is included or validated here.
