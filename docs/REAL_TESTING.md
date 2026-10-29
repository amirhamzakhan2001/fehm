# Integration compatibility evidence

Recorded 2026-10-29 on macOS 27.0.1 ARM64. Installer/config tests are not authenticated assistant behavior tests. No real personal assistant settings were modified. Installed wheel/npm smoke checks were repeated successfully for first-release version 1.0.0; the live Claude/Codex observations below were obtained with the earlier development wheel, not repeated model-session tests. See [first-release validation](RELEASE_STATUS.md).

| Client | Version | Personal/project skill files | Skill discovery / assistant CLI invocation | MCP configuration | Actual MCP connection | Model context query |
| --- | --- | --- | --- | --- | --- | --- |
| Claude Code | 2.1.283 | Automated, both scopes | Unverified; project entrypoint installed in fixture | Official `claude mcp add`, isolated user config passed | `claude mcp list`: Connected to installed wheel | Not run; client not signed in |
| Codex CLI | 0.154.0-alpha.6.2 | Automated, both scopes | Unverified | Actual `codex mcp get` accepted override configuration | Not tested in a model session | Not tested |
| Cursor | Unverified | Automated, both scopes | Unverified | Canonical JSON fixture tested | Not tested | Not tested |
| Gemini CLI | Not installed | Automated, both scopes | Unverified | Canonical JSON fixture tested | Not tested | Not tested |
| Copilot CLI | Not installed | Automated, both scopes | Unverified | Canonical JSON fixture tested | Not tested | Not tested |
| VS Code Copilot | CLI unavailable | Automated, both scopes | Unverified | Canonical JSON fixture tested | Not tested | Not tested |
| Generic | Client-dependent | Automated, both scopes | Host-dependent | Example shape only, no universal client schema | Not claimed | Not claimed |

The official MCP TypeScript SDK client and an independent Python JSON-RPC smoke client connected to isolated installs and queried fehm_context and fehm_practices. This establishes protocol behavior, not model compliance. Tests cover malformed arguments, missing/stale/corrupt/wrong-root state, repeated sessions and shutdown. Responses contain the selected root and source-backed results. MCP never automatically scans or writes state.

| Platform | Artifact/runtime evidence | Support status |
| --- | --- | --- |
| macOS ARM64, Python 3.11, private Node 24.19.0 | Wheel installed through uv; CLI, graph, skill, MCP, reinstall and uninstall passed | Verified for recorded tests |
| Linux x64/ARM64 | Node dependency publishes binaries; CI qualification prepared | Unverified |
| Windows x64/ARM64 | Node dependency publishes binaries; wrapper branch present | Unverified; signal behavior needs Windows acceptance |
| macOS x64 | Node dependency publishes binary | Unverified |
| Python 3.10, 3.12+ | Metadata allows 3.10+ | Unverified interpreter versions |

The universal Fehm wheel contains no native engine binary. Its Node dependency is platform-specific. Do not equate availability of a dependency wheel with verified Fehm behavior.

## Complete the remaining client tests

Use an isolated repository with a known authentication flow. Install the released artifact in that environment, scan, install the chosen skill, inspect the client's discovered skills and connect MCP with the generated configuration. Ask:

> Use FEHM to explain the authentication flow. Identify the relevant entry points, trace the supported caller/callee relationships, cite source files and line locations, and distinguish directly observed evidence from inferred relationships.

Record client version, OS, scope, tool calls, returned root/source references, limitations and exact results. Then edit a file, confirm stale MCP results are refused, rescan and repeat. Verify skill update/removal preserves custom files and unrelated settings. Run in remote containers separately; local paths do not transfer.
