---
name: update-codemaps
description: Scan project structure and generate token-lean architecture codemaps.
category: code-intelligence
sources:
- repository: ecc
  original_path: commands/update-codemaps.md
  sha256: dee7709ae4044862fd947e17048f8af170145b70ac53dfe01caa672a903853ea
principles:
- core/think-before-coding
- core/simplicity-first
- core/surgical-changes
- core/goal-driven-execution
---

> **Library use:** Apply the [compatibility and execution contract](../../COMPATIBILITY.md). Source roles, memory claims, command names, hooks, and integrations are instructions or prerequisites—not installed capabilities.

# Update Codemaps

Analyze the codebase structure and generate token-lean architecture documentation.

## Step 1: Scan Project Structure

1. Identify the project type (monorepo, single app, library, microservice)
2. Find all source directories (src/, lib/, app/, packages/)
3. Map entry points (main.ts, index.ts, app.py, main.go, etc.)

## Step 2: Generate Codemaps

Create or update codemaps in `docs/CODEMAPS/` (or `.reports/codemaps/`):

| File | Contents |
|------|----------|
| `architecture.md` | High-level system diagram, service boundaries, data flow |
| `backend.md` | API routes, middleware chain, service → repository mapping |
| `frontend.md` | Page tree, component hierarchy, state management flow |
| `data.md` | Database tables, relationships, migration history |
| `dependencies.md` | External services, third-party integrations, shared libraries |

### Codemap Format

Each codemap should be token-lean — optimized for AI context consumption:

```markdown
# Backend Architecture

## Routes
POST /api/users → UserController.create → UserService.create → UserRepo.insert
GET  /api/users/:id → UserController.get → UserService.findById → UserRepo.findById

## Key Files
src/services/user.ts (business logic, 120 lines)
src/repos/user.ts (database access, 80 lines)

## Dependencies
- PostgreSQL (primary data store)
- Redis (session cache, rate limiting)
- Stripe (payment processing)
```

## Step 3: Diff Detection

1. If previous codemaps exist, calculate the diff percentage
2. If changes > 30%, show the diff and request user approval before overwriting
3. If changes <= 30%, update in place

## Step 4: Add Metadata

Add a freshness header to each codemap:

```markdown
<!-- Generated: 2026-02-11 | Files scanned: 142 | Token estimate: ~800 -->
```

## Step 5: Save Analysis Report

Write a summary to `.reports/codemap-diff.txt`:
- Files added/removed/modified since last scan
- New dependencies detected
- Architecture changes (new routes, new services, etc.)
- Staleness warnings for docs not updated in 90+ days

## Tips

- Focus on **high-level structure**, not implementation details
- Prefer **file paths and function signatures** over full code blocks
- Keep each codemap under **1000 tokens** for efficient context loading
- Use ASCII diagrams for data flow instead of verbose descriptions
- Run after major feature additions or refactoring sessions

## Supporting material

See the [selective resource index](references/INDEX.md) for checklists, templates, examples, and reference implementations.

## Related skills and principles

- [core/goal-driven-execution](../../core/goal-driven-execution/SKILL.md)
- [core/simplicity-first](../../core/simplicity-first/SKILL.md)
- [core/surgical-changes](../../core/surgical-changes/SKILL.md)
- [core/think-before-coding](../../core/think-before-coding/SKILL.md)

## Source provenance

- `ecc/commands/update-codemaps.md`
