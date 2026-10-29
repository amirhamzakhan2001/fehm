---
name: project-init
description: Detect a project's stack and produce a dry-run ECC onboarding plan using the repository's install manifests
  and stack mappings.
category: workflows
sources:
- repository: ecc
  original_path: commands/project-init.md
  sha256: efd4a7859eab26f9017b9e7be0c13fb85419817720384719e6380735043e1164
principles:
- core/think-before-coding
- core/simplicity-first
- core/surgical-changes
- core/goal-driven-execution
---

> **Library use:** Apply the [compatibility and execution contract](../../COMPATIBILITY.md). Source roles, memory claims, command names, hooks, and integrations are instructions or prerequisites—not installed capabilities.

# /project-init

Create a safe, reviewable ECC onboarding plan for the current project. This command should start in dry-run mode and only write files after explicit user approval.

## Usage

```text
/project-init
/project-init --dry-run
/project-init --target claude
/project-init --target cursor
/project-init --skills continuous-learning-v2,security-review
/project-init --config ecc-install.json
```

## Safety Rules

1. Default to dry-run. Do not modify `CLAUDE.md`, settings files, rules, skills, or install state until the user approves the concrete plan.
2. Preserve existing project guidance. If `CLAUDE.md`, `.claude/settings.local.json`, `.cursor/`, `.codex/`, `.gemini/`, `.opencode/`, `.codebuddy/`, `.joycode/`, or `.qwen/` already exists, inspect it and propose a merge/append plan instead of overwriting.
3. Use ECC's installer and manifest tooling. Do not hand-copy files or clone arbitrary remotes as an install shortcut.
4. Keep permissions narrow. Any generated settings should match detected build/test/lint tools and avoid broad shell access.
5. Report exactly what would change before applying anything.

## Detection Inputs

Read the current project root and detect stack signals from:

- package manager files: `package.json`, `package-lock.json`, `pnpm-lock.yaml`, `yarn.lock`, `bun.lockb`
- language manifests: `pyproject.toml`, `requirements.txt`, `go.mod`, `Cargo.toml`, `pom.xml`, `build.gradle`, `build.gradle.kts`
- framework files: `next.config.*`, `vite.config.*`, `tailwind.config.*`, `Dockerfile`, `docker-compose.yml`
- ECC config: `ecc-install.json`
- optional stack map: `config/project-stack-mappings.json` in the ECC repo

When the ECC checkout is available, use `config/project-stack-mappings.json` as the stack-to-rules/skills reference. If the file is unavailable, fall back to the installed ECC manifests and explicit user choices.

## Planning Flow

1. Identify the target harness. Default to `claude` unless the user asks for `cursor`, `codex`, `gemini`, `opencode`, `codebuddy`, `joycode`, or `qwen`.
2. Detect stacks from project files and show the evidence for each match.
3. Resolve the smallest useful ECC plan:
   - project has an `ecc-install.json`: `node scripts/install-plan.js --config ecc-install.json --json`
   - user named a profile: `node scripts/install-plan.js --profile <profile> --target <target> --json`
   - user named skills: `node scripts/install-plan.js --skills <skill-ids> --target <target> --json`
   - only language stacks are detected: use the legacy language install dry-run with those language names
4. Run a dry-run apply command before writing:

```bash
node scripts/install-apply.js --target <target> --dry-run --json <language-or-profile-args>
```

5. Summarize detected stacks, selected modules/components/skills, target paths, skipped unsupported modules, and files that would be changed.
6. Ask for approval before applying the non-dry-run command.

## Output Contract

Return:

1. detected stack evidence
2. proposed target harness
3. exact dry-run command used
4. exact apply command to run after approval
5. files/directories that would be created or changed
6. warnings about existing files, broad permissions, missing scripts, or unsupported targets

## CLAUDE.md Guidance

If the user wants a `CLAUDE.md` starter, generate it separately from the installer plan and keep it minimal:

- build command, if detected
- test command, if detected
- lint/typecheck command, if detected
- dev server command, if detected
- repo-specific notes from existing package scripts or manifests

Never replace an existing `CLAUDE.md` without showing a diff and receiving approval.

## Related

- `config/project-stack-mappings.json` for stack-to-surface hints
- `scripts/install-plan.js` for deterministic plan resolution
- `scripts/install-apply.js` for dry-run and apply operations
- `/ecc-guide` for interactive feature discovery before installing

## Runtime prerequisites

See [the dependency ledger](../../DEPENDENCIES.md) and this skill’s records in [dependencies.json](../../dependencies.json). Native gstack/ECC CLIs, browsers, hooks, model tools, credentials, and memory stores must be available before invoking their steps. No runtime installation or execution has been performed. CSO requires its trusted helper; do not emulate that helper on the host.

## Related skills and principles

- [core/goal-driven-execution](../../core/goal-driven-execution/SKILL.md)
- [core/simplicity-first](../../core/simplicity-first/SKILL.md)
- [core/surgical-changes](../../core/surgical-changes/SKILL.md)
- [core/think-before-coding](../../core/think-before-coding/SKILL.md)
- [developer-experience/ecc-guide](../../developer-experience/ecc-guide/SKILL.md)

## Source provenance

- `ecc/commands/project-init.md`
