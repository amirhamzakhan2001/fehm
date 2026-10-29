# memory

Load only skills relevant to the task. [Library compatibility contract](../COMPATIBILITY.md).

| Skill | Purpose |
| --- | --- |
| [Ck](ck/SKILL.md) | Persistent per-project memory for Claude Code. Auto-loads project context on session start, tracks sessions with git activity, and writes to native memory. Commands run deterministic Node.js scripts — behavior is consistent across model versions. Use when a project needs context to survive across Claude Code sessions instead of being re-explained each time. |
| [Context Budget](context-budget/SKILL.md) | Audits Claude Code context window consumption across agents, skills, MCP servers, and rules. Identifies bloat, redundant components, and produces prioritized token-savings recommendations. Use when the context window is filling up too fast and the agents, skills, MCP servers, or rules consuming it need to be identified. |
| [Context Restore](context-restore/SKILL.md) | Restore working context saved earlier by /context-save. (gstack) |
| [Context Save](context-save/SKILL.md) | Save working context. (gstack) |
| [Continuous Learning](continuous-learning/SKILL.md) | [DEPRECATED - use continuous-learning-v2] Legacy v1 stop-hook skill extractor. v2 is a strict superset with instinct-based, project-scoped, hook-reliable learning. Do not invoke v1: when continuous learning, session learning, or pattern extraction is requested, route to continuous-learning-v2 instead. |
| [Continuous Learning V2](continuous-learning-v2/SKILL.md) | Instinct-based learning system that observes sessions via hooks, creates atomic instincts with confidence scoring, and evolves them into skills/commands/agents. v2.1 adds project-scoped instincts to prevent cross-project contamination. Use when capturing lessons from a session, managing instincts, or promoting them into skills, commands, or agents. |
| [Conversation Analyzer](conversation-analyzer/SKILL.md) | Use this agent when analyzing conversation transcripts to find behaviors worth preventing with hooks. Triggered by /hookify without arguments. |
| [Evolve](evolve/SKILL.md) | Analyze instincts and suggest or generate evolved structures |
| [Gbrain Write Surfaces](gbrain-write-surfaces/SKILL.md) | gbrain write surfaces — what lands where, and how to verify. Use this methodology for gbrain write surfaces. |
| [Growth Log](growth-log/SKILL.md) | Use after a complex task, failure, or when reviewing what was learned. Teaches how to write growth logs that extract reusable patterns — not diary entries. |
| [Instinct Export](instinct-export/SKILL.md) | Export instincts from project/global scope to a file |
| [Instinct Import](instinct-import/SKILL.md) | Import instincts from file or URL into project/global scope |
| [Instinct Status](instinct-status/SKILL.md) | Show learned instincts (project + global) with confidence |
| [Knowledge Ops](knowledge-ops/SKILL.md) | Knowledge base management, ingestion, sync, and retrieval across multiple storage layers (local files, MCP memory, vector stores, Git repos). Use when the user wants to save, organize, sync, deduplicate, or search across their knowledge systems. |
| [Learn](learn/SKILL.md) | Manage project learnings. |
| [Learn Ecc](learn-ecc/SKILL.md) | Extract reusable patterns from the current session and save them as candidate skills or guidance. |
| [Learn Eval](learn-eval/SKILL.md) | Extract reusable patterns from the session, self-evaluate quality before saving, and determine the right save location (Global vs Project). |
| [Memorable Workflow Memory](memorable-workflow-memory/SKILL.md) | Workflow memory with Memorable (optional, third party). Use this methodology for memorable workflow memory. |
| [Memory Persistence Hooks](memory-persistence-hooks/SKILL.md) | Memory Persistence Hooks. Use this methodology for memory persistence hooks. |
| [Projects](projects/SKILL.md) | List known projects and their instinct statistics |
| [Promote](promote/SKILL.md) | Promote project-scoped instincts to global scope |
| [Prune](prune/SKILL.md) | Delete pending instincts older than 30 days that were never promoted |
| [Resume Session](resume-session/SKILL.md) | Load the most recent session file from ~/.claude/session-data/ and resume work with full context from where the last session ended. |
| [Save Session](save-session/SKILL.md) | Save current session state to a dated file in ~/.claude/session-data/ so work can be resumed in a future session with full context. |
| [Sessions](sessions/SKILL.md) | Manage Claude Code session history, aliases, and session metadata. |
| [Setup Gbrain](setup-gbrain/SKILL.md) | Set up gbrain for this coding agent: install the CLI, initialize a local PGLite or Supabase brain, register MCP, capture per-remote trust policy. (gstack) |
| [Strategic Compact](strategic-compact/SKILL.md) | Suggests manual context compaction at logical intervals to preserve context through task phases rather than arbitrary auto-compaction. Use when a session is approaching a context limit and a task phase is a natural place to compact. |
| [Sync Gbrain](sync-gbrain/SKILL.md) | Keep gbrain current with this repo's code and refresh agent search guidance in CLAUDE.md. (gstack) |
| [Unified Memory](unified-memory/SKILL.md) | Share durable, inspectable context and handoffs between Claude, Codex, Hermes, Cursor, OpenCode, and other agents through the local ECC Memory Vault. Use when an agent must save work state, transfer context, resume another agent's task, or search shared project knowledge. |
| [Using Gbrain With Gstack](using-gbrain-with-gstack/SKILL.md) | Using GBrain with GStack. Use this methodology for using gbrain with gstack. |

<!-- imported:start -->
| Skill | Purpose |
| --- | --- |
| [handoff](handoff/SKILL.md) | Compact the current conversation into a handoff document for another agent to pick up. (matt-pocock-skills) |
| [caveman-compress](caveman-compress/SKILL.md) | Compress a memory file such as CLAUDE.md or a todo list into caveman format to save input tokens, keeping a readable backup. Trigger: /caveman-compress. (caveman) |
<!-- imported:end -->
