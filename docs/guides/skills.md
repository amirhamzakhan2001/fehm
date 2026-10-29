# Skills and assistant setup

Skill discovery, context selection and installation are separate operations. FEHM does not automatically install the catalog or load every workflow.

## Select relevant guidance

```sh
fehm skills list
fehm skills search "debugging"
fehm skills route "Debug authentication" --budget 2500
fehm agent-context "Debug authentication" --skill debugging/systematic-debugging
```

The existing router handles ranking, overlap, exclusions and budgets. Use --exclude-source superpowers or repeat --exclude-skill ID to omit guidance for a request. agent-context --no-skills retrieves code only.

## Install one skill

```sh
fehm skills install debugging/systematic-debugging --platform codex --project --dry-run
fehm skills install debugging/systematic-debugging --platform codex --project
fehm skills status debugging/systematic-debugging --platform codex --project
fehm skills uninstall debugging/systematic-debugging --platform codex --project
```

Platform keys are claude, cursor, codex, gemini, copilot, vscode and generic. Omit --project for personal scope. The installer reports its destination. For Codex project scope, this example writes .agents/skills/fehm-debugging-systematic-debugging/SKILL.md and its declared resources.

## Preserve user changes

Customized entrypoints and resources are protected. An explicitly requested --force backs up customized files before replacing/removing them. Unrelated sibling files remain. Symlink destinations and unsafe resource paths are refused.

## Host boundary

Your assistant controls discovery and invocation. Reload it if needed and check its skill support. Directory-format tests do not prove live host behavior. The installed guidance can use FEHM commands when the CLI is available in that environment; no native MCP connection is installed.

Read about the [Superpowers workflows](superpowers.md).
