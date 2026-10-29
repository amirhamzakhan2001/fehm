# FEHM documentation

This is the central entry point for maintained project documentation. The root [README](../README.md) introduces the product; these pages explain setup, workflows, architecture, implementation limits and maintenance.

The public website renders the user guides directly from `docs/guides/`. Update those Markdown files once to update both repository and website documentation.

## User guides

- [Introduction](guides/overview.md), [installation](guides/installation.md), [quickstart](guides/quickstart.md), [CLI reference](guides/cli.md).
- [Skills and assistant setup](guides/skills.md), [Superpowers workflows](guides/superpowers.md), [integration boundaries](guides/mcp.md).
- [Architecture and drift](guides/architecture.md), [health, readiness and security](guides/health.md).
- [Change verification](guides/verification.md), [failure investigation](guides/debugging.md), [review boundaries](guides/open-code-review.md).
- [Git memory and concepts](guides/git-memory.md), [local dashboard](guides/cockpit.md), [prompts and model use](guides/ai.md).
- [Security and privacy](guides/security.md), [troubleshooting](guides/troubleshooting.md), [open-source foundations](guides/open-source.md).

## Implementation references

Internal feature numbers remain in specification filenames for stable engineering references; they are not product navigation labels. These documents contain detailed schemas, APIs, evidence semantics, implementation records and deferred work. A proposed capability in a research section is not automatically shipped.

| Reference | Current status |
| --- | --- |
| [Context engine](FEATURE_1.md) | Implemented; language-specific resolution limits apply. |
| [Skill intelligence](FEATURE_2.md) | Implemented; see the newer Superpowers integration record below. |
| [Codebase graph](FEATURE_3_1.md) | Implemented. |
| [Codebase briefing](FEATURE_3_2.md) | Implemented. |
| [Architecture](FEATURE_3_3.md) | Implemented with inference and view-specific limits. |
| [Architecture drift](FEATURE_3_4.md) | Implemented with explicit and inferred evidence distinctions. |
| [Health and coverage](FEATURE_3_5.md) | Implemented, including Engineering Readiness and static Web Delivery/SEO checks. |
| [Security review](FEATURE_3_6.md) | Implemented static analysis; not a complete security assessment. |
| [Prompt intelligence](FEATURE_3_7.md) | Implemented inventory, supplied-output evaluation and approved apply workflow. |
| [Git memory](FEATURE_3_8.md) | Implemented history, comparisons and historical analyzer snapshots. |
| [Concept intelligence](FEATURE_3_9.md) | Implemented; Node 22.13+ required for SQLite. |
| [Change verification](FEATURE_3_10.md) | Implemented working-tree analysis and approved execution ledger. |
| [Failure investigation](FEATURE_3_11.md) | Implemented bounded investigation; distinguish the implementation record from earlier proposals. |
| [Revision-aware change impact](FEATURE_3_12.md) | **Plan only.** No standalone Change Impact Engine or fehm impact CLI. |
| [Dashboard architecture](DASHBOARD.md) | Engineering reference for the localhost application. |

## Integration, development and assets

- [Native Superpowers audit, usage, maintenance and validation](integrations/superpowers.md).
- [Documentation and contributor maintenance](maintenance.md).
- [Public website development and deployment](website.md).
- [Brand assets](brand.md).
- [Third-party notices](../THIRD_PARTY_NOTICES.md), [FEHM license](../LICENSE), [skill licenses](../skills/licenses/).

## Research and audit records

These records preserve the evidence and decisions from their implementation sessions. Dated validation counts are historical observations, not a continuously updated status badge.

- [Documentation consolidation audit](audits/documentation-refresh.md).
- [Architecture library research](research/architecture-libraries.md).
- [Architecture/drift redesign](audits/architecture-drift-redesign.md).
- [Concept workspace](audits/concepts-workspace.md).
- [Engineering audit](audits/engineering-audit.md).
- [Human-centered workspace](audits/human-centered-workspace.md).

## Why some Markdown stays outside docs

`README.md` stays at the repository root for repository/package discovery. `THIRD_PARTY_NOTICES.md` stays at its established package path to preserve attribution links and packaging. Skill entrypoints, skill references and their licenses remain in `skills/`: the registry, installer and package depend on those paths. Dependency/vendor licenses and generated website output are not project documentation to relocate. General website and brand documentation have moved here.
