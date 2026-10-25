# developer-experience

Load only skills relevant to the task. [Library compatibility contract](../COMPATIBILITY.md).

| Skill | Purpose |
| --- | --- |
| [Aside](aside/SKILL.md) | Answer a quick side question without interrupting or losing context from the current task. Resume work automatically after answering. |
| [Browse](browse/SKILL.md) | Drive a real browser through Aside: open a page, read it, click through a flow, take screenshots, check console errors. (gstack) |
| [Browser](browser/SKILL.md) | Browser — Aside first, gstack's own browser as the fallback. Use this methodology for browser. |
| [Bun Runtime](bun-runtime/SKILL.md) | Bun as runtime, package manager, bundler, and test runner. When to choose Bun vs Node, migration notes, and Vercel support. |
| [Capability Surface Selection](capability-surface-selection/SKILL.md) | Capability Surface Selection. Use this methodology for capability surface selection. |
| [Config Gc](config-gc/SKILL.md) | Garbage collection for your Claude Code configuration. Periodically scans ~/.claude (skills, memory, hooks, permissions, MCP servers, caches) for redundant, stale, orphaned, or low-value items, then walks the user through a confirm-each-deletion cleanup. Use when the user says "clean up my config", "config GC", "too many skills", "audit my setup", "my .claude is bloated", or asks for a periodic config review. |
| [Developer Advocate](developer-advocate/SKILL.md) | Expert developer advocate specializing in building developer communities, creating compelling technical content, optimizing developer experience (DX), and driving platform adoption through authentic engineering engagement. Bridges product and engineering teams with external developers. |
| [Developer Tooling Engineer](developer-tooling-engineer/SKILL.md) | Expert developer-tooling and CLI engineer — building command-line tools and internal developer platforms with great DX: intuitive command design, helpful errors, shell completions, fast startup, cross-platform distribution, and scriptable, composable interfaces. |
| [Devex Review](devex-review/SKILL.md) | Live developer experience audit. (gstack) |
| [Domain Skills](domain-skills/SKILL.md) | Domain Skills. Use this methodology for domain skills. |
| [Ecc Guide](ecc-guide/SKILL.md) | Guide users through ECC's current agents, skills, commands, hooks, rules, install profiles, and project onboarding by reading the live repository surface before answering. |
| [Ecc Recipes](ecc-recipes/SKILL.md) | Map a described workflow to the right ECC command-GROUP with run-order and stop condition, and browse all command-group recipe families. Adds a family-grouping + run-order + when-to-stop layer on top of the flat command catalog. Advisory only. TRIGGER when the user says which commands for X, what command group runs X, show ECC recipes, list ECC pipelines, or how do I run a workflow with ECC. DO NOT TRIGGER when the user wants the task executed directly, wants a single-command deep doc (use ecc-guide), or wants a draft prompt rewritten (use prompt-optimizer). |
| [Ecc Tools Cost Audit](ecc-tools-cost-audit/SKILL.md) | Evidence-first ECC Tools burn and billing audit workflow. Use when investigating runaway PR creation, quota bypass, premium-model leakage, duplicate jobs, or GitHub App cost spikes in the ECC Tools repo. |
| [Hermes Imports](hermes-imports/SKILL.md) | Convert local Hermes operator workflows into sanitized ECC skills and release-pack artifacts. Use when preparing a Hermes workflow for public ECC reuse without leaking private workspace state, credentials, or local-only paths. |
| [Hook Bug Workarounds](hook-bug-workarounds/SKILL.md) | Hook Bug Workarounds. Use this methodology for hook bug workarounds. |
| [Hook Lifecycle](hook-lifecycle/SKILL.md) | Hooks. Use this methodology for hook lifecycle. |
| [Hookify](hookify/SKILL.md) | Create hooks to prevent unwanted behaviors from conversation analysis or explicit instructions |
| [Hookify Configure](hookify-configure/SKILL.md) | Enable or disable hookify rules interactively |
| [Hookify Help](hookify-help/SKILL.md) | Get help with the hookify system |
| [Hookify List](hookify-list/SKILL.md) | List all configured hookify rules |
| [Hookify Rules](hookify-rules/SKILL.md) | This skill should be used when the user asks to create a hookify rule, write a hook rule, configure hookify, add a hookify rule, or needs guidance on hookify rule syntax and patterns. |
| [Mcp Builder](mcp-builder/SKILL.md) | Expert Model Context Protocol developer who designs, builds, and tests MCP servers that extend AI agent capabilities with custom tools, resources, and prompts. |
| [Mcp Connector Policy](mcp-connector-policy/SKILL.md) | MCP Connector Policy. Use this methodology for mcp connector policy. |
| [Mcp Server Patterns](mcp-server-patterns/SKILL.md) | Build MCP servers with Node/TypeScript SDK — tools, resources, prompts, Zod validation, stdio vs Streamable HTTP. Use Context7 or official MCP docs for latest API. Use when building or debugging an MCP server — tools, resources, prompts, validation, or transport choice. |
| [Model Route](model-route/SKILL.md) | Recommend the best model tier for the current task based on complexity, risk, and budget. |
| [Open Gstack Browser](open-gstack-browser/SKILL.md) | Launch GStack Browser — AI-controlled Chromium with the sidebar extension baked in. |
| [Plan Devex Review](plan-devex-review/SKILL.md) | Interactive developer experience plan review. (gstack) |
| [Plan Tune](plan-tune/SKILL.md) | Self-tuning question sensitivity + developer psychographic for gstack (v1: observational). (gstack) |
| [Rules Distill](rules-distill/SKILL.md) | Scan skills to extract cross-cutting principles and distill them into rules — append, revise, or create new rule files. Use when the same principle keeps recurring across skills and belongs in a rule file instead. |
| [Scrape](scrape/SKILL.md) | Pull data from a web page through the Aside browser — your real, already signed-in sessions. (gstack) |
| [Setup Browser Cookies](setup-browser-cookies/SKILL.md) | Import cookies from your real Chromium browser into the headless browse session. (gstack) |
| [Skill Adaptation Policy](skill-adaptation-policy/SKILL.md) | Skill Adaptation Policy. Use this methodology for skill adaptation policy. |
| [Skill Comply](skill-comply/SKILL.md) | Visualize whether skills, rules, and agent definitions are actually followed — auto-generates scenarios at 3 prompt strictness levels, runs agents, classifies behavioral sequences, and reports compliance rates with full tool call timelines. Use when checking whether agents actually follow the skills, rules, and definitions they were given, rather than assuming they do. |
| [Skill Create](skill-create/SKILL.md) | Analyze local git history to extract coding patterns and generate SKILL.md files. Local version of the Skill Creator GitHub App. |
| [Skill Development Guide](skill-development-guide/SKILL.md) | Skill Development Guide. Use this methodology for skill development guide. |
| [Skill Scout](skill-scout/SKILL.md) | Search existing local, marketplace, GitHub, and web skill sources before creating a new skill. Use when the user wants to create, build, fork, or find a skill for a workflow. |
| [Skill Stocktake](skill-stocktake/SKILL.md) | Use when auditing Claude skills and commands for quality. Supports Quick Scan (changed skills only) and Full Stocktake modes with sequential subagent batch evaluation. |
| [Skillify](skillify/SKILL.md) | Codify the most recent successful /scrape flow into a permanent browser-skill on disk. (gstack) |
| [Terminal Opener](terminal-opener/SKILL.md) | Open an executable and its argument array in a visible terminal window through a reusable, shell-free launch plan with dry-run, JSON, capability detection, detached fallback, and standalone recovery modes. Use when Codex needs to open an interactive CLI, SSH session, local development process, sandbox, or other argv-based command in a new host terminal; diagnose whether a supported terminal is available; or provide an actionable plan when the requested terminal is unsupported. |
| [Terminal Ops](terminal-ops/SKILL.md) | Evidence-first repo execution workflow for ECC. Use when the user wants a command run, a repo checked, a CI failure debugged, or a narrow fix pushed with exact proof of what was executed and verified. |
| [The Longform Guide](the-longform-guide/SKILL.md) | The Longform Guide to Everything Claude Code. Use this methodology for the longform guide. |
| [The Shortform Guide](the-shortform-guide/SKILL.md) | The Shorthand Guide to Everything Claude Code. Use this methodology for the shortform guide. |
| [Workspace Surface Audit](workspace-surface-audit/SKILL.md) | Audit the active repo, MCP servers, plugins, connectors, env surfaces, and harness setup, then recommend the highest-value ECC-native skills, hooks, agents, and operator workflows. Use when the user wants help setting up Claude Code or understanding what capabilities are actually available in their environment. |

<!-- imported:start -->
| Skill | Purpose |
| --- | --- |
| [writing-skills](writing-skills/SKILL.md) | Use when creating new skills, editing existing skills, or verifying skills work before deployment (superpowers) |
| [setup-wizard](setup-wizard/SKILL.md) | Generate an interactive bash wizard that walks a human through steps only they can perform. Use when provisioning infrastructure, setting up credentials or CI secrets, walking an unfamiliar third-party dashboard, or running a one-off migration or cutover. Don't invoke this for steps the agent can perform itself. (matt-pocock-skills) |
| [writing-for-agents](writing-for-agents/SKILL.md) | Writing documents for agents. Use when creating or editing skills, or modifying AGENTS.md or CLAUDE.md. (matt-pocock-skills) |
| [caveman-terse-output](caveman-terse-output/SKILL.md) | Ultra-compressed communication mode that cuts output tokens while keeping technical accuracy. Levels: lite, full, ultra and the wenyan variants. Use for /caveman, "caveman mode", "talk like caveman", "be brief" or "less tokens". (caveman) |
<!-- imported:end -->
