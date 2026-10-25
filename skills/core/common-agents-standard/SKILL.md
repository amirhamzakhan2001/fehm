---
name: common-agents-standard
description: Agent Orchestration. Use this standard for common agents standard.
category: core
sources:
- repository: ecc
  original_path: rules/common/agents.md
  sha256: 4946437db9ad562af9a2d6f3eaffdc7c1b23f8534bec403a9e066d9219157cc3
principles:
- core/think-before-coding
- core/simplicity-first
- core/surgical-changes
- core/goal-driven-execution
---

> **Library use:** Apply the [compatibility and execution contract](../../COMPATIBILITY.md). Source roles, memory claims, command names, hooks, and integrations are instructions or prerequisites—not installed capabilities.

# Agent Orchestration

## Available Agents

ECC agents ship with the `ecc@ecc` plugin, not in `~/.claude/agents/`.
They are invoked through the Agent tool with a plugin-scoped `subagent_type`:

```text
Agent(subagent_type: "ecc:planner", prompt: "...")
```

| Agent | Purpose | When to Use |
|-------|---------|-------------|
| ecc:planner | Implementation planning | Complex features, refactoring |
| ecc:architect | System design | Architectural decisions |
| ecc:tdd-guide | Test-driven development | New features, bug fixes |
| ecc:code-reviewer | Code review | After writing code |
| ecc:security-reviewer | Security analysis | Before commits |
| ecc:build-error-resolver | Fix build errors | When build fails |
| ecc:e2e-runner | E2E testing | Critical user flows |
| ecc:refactor-cleaner | Dead code cleanup | Code maintenance |
| ecc:doc-updater | Documentation | Updating docs |
| ecc:rust-reviewer | Rust code review | Rust projects |
| ecc:harmonyos-app-resolver | HarmonyOS app development | HarmonyOS/ArkTS projects |

For the full roster of 68 agents, see `/ecc:ecc-guide`.

## Immediate Agent Usage

No user prompt needed:
1. Complex feature requests - Use **ecc:planner** agent
2. Code just written/modified - Use **ecc:code-reviewer** agent
3. Bug fix or new feature - Use **ecc:tdd-guide** agent
4. Architectural decision - Use **ecc:architect** agent

## Parallel Task Execution

ALWAYS use parallel Task execution for independent operations:

```markdown
# GOOD: Parallel execution
Launch 3 agents in parallel:
1. Agent 1: Security analysis of auth module
2. Agent 2: Performance review of cache system
3. Agent 3: Type checking of utilities

# BAD: Sequential when unnecessary
First agent 1, then agent 2, then agent 3
```

## Delegation Completion Contract

Applies to every agent at every depth (parent, child, grandchild):

1. **Your final message IS the deliverable.** Never end your turn with "waiting for background agents" — a spawned task is not a completed task. Ending your turn while children are running orphans their results (completed children cannot notify a parent whose turn has ended).
2. **If you delegate, you own collection.** Wait for results, integrate them, then return. Fire-and-forget delegation is forbidden.
3. **Decompose only when the work cannot fit in one context.** Do not re-delegate a task already sized for a single agent — depth is an outcome, not a plan.

> Rationale: observed failure mode — research agents followed "Parallel Task Execution" above, spawned children, and returned "waiting" as their final answer. All children completed successfully but their results were orphaned. The parallel rule without a completion contract produces zombie tasks.

## Multi-Perspective Analysis

For complex problems, use split role sub-agents:
- Factual reviewer
- Senior engineer
- Security expert
- Consistency reviewer
- Redundancy checker

## Runtime prerequisites

See [the dependency ledger](../../DEPENDENCIES.md) and this skill’s records in [dependencies.json](../../dependencies.json). Native gstack/ECC CLIs, browsers, hooks, model tools, credentials, and memory stores must be available before invoking their steps. No runtime installation or execution has been performed. CSO requires its trusted helper; do not emulate that helper on the host.

## Related skills and principles

- [architecture/architect](../../architecture/architect/SKILL.md)
- [core/goal-driven-execution](../goal-driven-execution/SKILL.md)
- [core/simplicity-first](../simplicity-first/SKILL.md)
- [core/surgical-changes](../surgical-changes/SKILL.md)
- [core/think-before-coding](../think-before-coding/SKILL.md)
- [debugging/build-error-resolver](../../debugging/build-error-resolver/SKILL.md)
- [developer-experience/ecc-guide](../../developer-experience/ecc-guide/SKILL.md)
- [documentation/doc-updater](../../documentation/doc-updater/SKILL.md)
- [engineering/code-reviewer-ecc](../../engineering/code-reviewer-ecc/SKILL.md)
- [engineering/refactor-cleaner](../../engineering/refactor-cleaner/SKILL.md)
- [languages/rust/rust-reviewer](../../languages/rust/rust-reviewer/SKILL.md)
- [mobile/harmonyos-app-resolver](../../mobile/harmonyos-app-resolver/SKILL.md)
- [security/security-reviewer](../../security/security-reviewer/SKILL.md)
- [testing/e2e-runner](../../testing/e2e-runner/SKILL.md)
- [testing/tdd-guide](../../testing/tdd-guide/SKILL.md)
- [workflows/planner](../../workflows/planner/SKILL.md)

## Source provenance

- `ecc/rules/common/agents.md`
