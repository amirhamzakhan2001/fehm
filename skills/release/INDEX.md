# release

Load only skills relevant to the task. [Library compatibility contract](../COMPATIBILITY.md).

| Skill | Purpose |
| --- | --- |
| [Canary](canary/SKILL.md) | Post-deploy canary monitoring. (gstack) |
| [Canary Watch](canary-watch/SKILL.md) | Use this skill to monitor and verify a deployed URL after releases — checks HTTP endpoints, SSE streams, static assets, console errors, and performance regressions after deploys, merges, or dependency upgrades. Smoke / canary / post-deploy verification. |
| [Deployment Patterns](deployment-patterns/SKILL.md) | Deployment workflows, CI/CD pipeline patterns, Docker containerization, health checks, rollback strategies, and production readiness checklists for web applications. Use when setting up CI/CD, containerizing an app, or checking production readiness before a release. |
| [Document Release](document-release/SKILL.md) | Post-ship documentation update. (gstack) |
| [Land And Deploy](land-and-deploy/SKILL.md) | Land and deploy workflow. (gstack) |
| [Landing Report](landing-report/SKILL.md) | Read-only queue dashboard for workspace-aware ship. (gstack) |
| [Opensource Forker](opensource-forker/SKILL.md) | Fork any project for open-sourcing. Copies files, strips secrets and credentials (20+ patterns), replaces internal references with placeholders, generates .env.example, and cleans git history. First stage of the opensource-pipeline skill. |
| [Opensource Packager](opensource-packager/SKILL.md) | Generate complete open-source packaging for a sanitized project. Produces CLAUDE.md, setup.sh, README.md, LICENSE, CONTRIBUTING.md, and GitHub issue templates. Makes any repo immediately usable with Claude Code. Third stage of the opensource-pipeline skill. |
| [Opensource Pipeline](opensource-pipeline/SKILL.md) | Open-source pipeline: fork, sanitize, and package private projects for safe public release. Chains 3 agents (forker, sanitizer, packager). Triggers: '/opensource', 'open source this', 'make this public', 'prepare for open source'. Use when a private project must be forked, stripped of secrets, and packaged for public release. |
| [Opensource Sanitizer](opensource-sanitizer/SKILL.md) | Verify an open-source fork is fully sanitized before release. Scans for leaked secrets, PII, internal references, and dangerous files using 20+ regex patterns. Generates a PASS/FAIL/PASS-WITH-WARNINGS report. Second stage of the opensource-pipeline skill. Use PROACTIVELY before any public release. |
| [Setup Deploy](setup-deploy/SKILL.md) | Configure deployment settings for /land-and-deploy. |
| [Ship](ship/SKILL.md) | Ship workflow: detect + merge base branch, run tests, review diff, bump VERSION, update CHANGELOG, commit, push, create PR. (gstack) |
