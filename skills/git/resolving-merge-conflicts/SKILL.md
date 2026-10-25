---
name: resolving-merge-conflicts
description: Use when you need to resolve an in-progress git merge/rebase conflict.
category: git
intents:
  - ship
sources:
  - repository: matt-pocock-skills
    original_path: skills/engineering/resolving-merge-conflicts/SKILL.md
    sha256: 9d8114f8ef0b31f535a265fc05c364bd8cf2e2895a830040e06c22acb11f54b0
principles:
  - core/think-before-coding
  - core/simplicity-first
  - core/surgical-changes
  - core/goal-driven-execution
---

> **Library use:** Apply the [compatibility and execution contract](../../COMPATIBILITY.md). Source roles, memory claims, command names, hooks, and integrations are instructions or prerequisites—not installed capabilities.

1. **See the current state** of the merge/rebase. Check git history, and the conflicting files.

2. **Find the primary sources** for each conflict. Understand deeply why each change was made, and what the original intent was. Read the commit messages, check the PRs, check original issues/tickets.

3. **Resolve each hunk.** Preserve both intents where possible. Where incompatible, pick the one matching the merge's stated goal and note the trade-off. Do **not** invent new behaviour. Always resolve; never `--abort`.

4. Discover the project's **automated checks** and run them, typically typecheck, then tests, then format. Fix anything the merge broke.

5. **Finish the merge/rebase.** Stage everything and commit. If rebasing, continue the rebase process until all commits are rebased.
