# verification

Load only skills relevant to the task. [Library compatibility contract](../COMPATIBILITY.md).

| Skill | Purpose |
| --- | --- |
| [Delivery Gate](delivery-gate/SKILL.md) | Stop hook that blocks Claude from finishing until quality checks pass. Detects rationalization patterns (surface text heuristics), stale learning logs (filesystem mtime), and low disk space. Complements self-audit by mechanically enforcing learning capture habits. Use when Claude should be mechanically blocked from declaring work finished before quality checks and learning capture actually pass. |
| [Gstack Validation Discipline](gstack-validation-discipline/SKILL.md) | gstack — AI Engineering Workflow. Use this methodology for gstack validation discipline. |
| [Production Audit](production-audit/SKILL.md) | Local-evidence production readiness audit for shipped apps, pre-launch reviews, post-merge checks, and "what breaks in prod?" questions without sending repo data to an external audit service. Use when auditing production readiness before launch, after a merge, or when asked what breaks in prod. |
| [Quality Gate](quality-gate/SKILL.md) | Run the ECC formatter quality gate for a single file and report remediation steps. |
| [Verification Loop](verification-loop/SKILL.md) | A comprehensive verification system for Claude Code sessions. Use when verifying a Claude Code session's work before claiming it is complete. |

<!-- imported:start -->
| Skill | Purpose |
| --- | --- |
| [verification-before-completion](verification-before-completion/SKILL.md) | Use when about to claim work is complete, fixed, or passing, before committing or creating PRs - requires running verification commands and confirming output before making any success claims; evidence before assertions always (superpowers) |
| [verify-and-stop](verify-and-stop/SKILL.md) | Prove existing work meets acceptance conditions without expanding scope. Use for validation-only tasks, completion checks, focused gate runs, and last-mile proof. (caveman) |
<!-- imported:end -->
