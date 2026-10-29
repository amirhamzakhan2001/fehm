---
name: feature-development
description: Develop a feature from clarified intent through evidence-based release and reflection.
category: workflows
sources:
- repository: andrej-karpathy-skills
  original_path: skills/karpathy-guidelines/SKILL.md
  sha256: 6e22cc54cb02a5e98ae42d06d9d7292db0c1b43894831b32879beb0166b2aea7
- repository: gstack
  original_path: office-hours/SKILL.md
  sha256: dd9c366fa946a5b580e22343d05ff394fef646fb7ae5a02ff768ecdf9a2f579b
- repository: gstack
  original_path: plan-ceo-review/SKILL.md
  sha256: f5368fa96be83f6086e7fc45301d2771fece295d9eb8a147284d5163c338701e
- repository: gstack
  original_path: plan-eng-review/SKILL.md
  sha256: c03907fc011811cad44228050939b99aa253cacee45e3fffefda4c55cdf0367d
- repository: ecc
  original_path: skills/tdd-workflow/SKILL.md
  sha256: f5d8543733c557f0c53b688d40f14e9b870a6b2c7e405bab07433954e363828a
- repository: gstack
  original_path: review/SKILL.md
  sha256: cebbf9f8cbf1e230416559ad21ca3bf3de4cf0143917393303a0dfb0fa42e078
- repository: gstack
  original_path: qa/SKILL.md
  sha256: fe583b1beca3f62629e69def5c632cc65005978aa0482a69042381e163743c18
- repository: ecc
  original_path: skills/verification-loop/SKILL.md
  sha256: f0d56107f79e607d4de6c5543b8edfb1b58ab9ae4019b39831689cd91116543e
- repository: gstack
  original_path: document-release/SKILL.md
  sha256: 7f01fd8dc6e963d38f224e09301bf320fa5ae45b9b2f92f08687f674331dd3d8
- repository: gstack
  original_path: ship/SKILL.md
  sha256: 895538116120c7ca60f4eabafd47b3267fc0396ee3344028d0d2f6302fc5538d
- repository: gstack
  original_path: land-and-deploy/SKILL.md
  sha256: f623d7b9285a907245cd5bfbea0429fabcba05bbfc57e23bc72e87c91cf169a4
- repository: gstack
  original_path: retro/SKILL.md
  sha256: 97ad8009950cedcba51df00d123fc36a880f3a8702f2800a86db8a42d6cbe6e4
principles:
- core/think-before-coding
- core/simplicity-first
- core/surgical-changes
- core/goal-driven-execution
---

> **Library use:** Apply the [compatibility and execution contract](../../COMPATIBILITY.md). Source roles, memory claims, command names, hooks, and integrations are instructions or prerequisites—not installed capabilities.

# Feature Development

## When to use

Develop a feature from clarified intent through evidence-based release and reflection.

## Inputs

User objective, project constraints, relevant source or evidence, and explicit success criteria.

## Procedure and handoffs

1. Load [the think-before-coding procedure](../../core/think-before-coding/SKILL.md). Clarify assumptions and measurable acceptance criteria; apply all four core principles.
2. Load [the office-hours procedure](../../product/office-hours/SKILL.md). Produce the problem framing and user evidence.
3. Load [the plan-ceo-review procedure](../../product/plan-ceo-review/SKILL.md). Decide product scope; record expansion proposals separately.
4. Load [the plan-eng-review procedure](../../engineering/plan-eng-review/SKILL.md). Hand implementation a reviewed architecture, failure cases, and test plan.
5. Load [the tdd-workflow procedure](../../testing/tdd-workflow/SKILL.md). Use the red → green → refactor cycle for implementation.
6. Load [the review procedure](../../engineering/review/SKILL.md). Hand QA a diff review with severity, evidence, and unresolved risks.
7. Load [the qa procedure](../../testing/qa/SKILL.md). Reproduce relevant user flows, then fix and re-verify within scope.
8. Load [the verification-loop procedure](../../verification/verification-loop/SKILL.md). Freeze the candidate and record the actual build/type/lint/test/security/diff results.
9. Load [the document-release procedure](../../release/document-release/SKILL.md). Update affected docs before publication; if the selected source requires post-ship docs, schedule a second pass after landing.
10. Load [the ship procedure](../../release/ship/SKILL.md). Create the release/PR artifacts when authorized; this stage does not imply merge authorization.
11. Load [the land-and-deploy procedure](../../release/land-and-deploy/SKILL.md). When deployment is authorized, verify CI, rollout, and production health.
12. Load [the retro procedure](../../project-management/retro/SKILL.md). Record evidence-backed lessons and follow-up work.

## Verification and output

Produce the artifacts required by the selected procedures and an evidence-backed status: completed, failed, skipped with reason, or blocked on a named prerequisite. Carry unresolved findings forward. Do not treat an unavailable tool, an unrun check, or a reviewer failure as a pass.

## Scope and compatibility

Select stages proportionate to the task. Preserve required gates of the chosen variant; record exceptions. Read the [compatibility policy](../../COMPATIBILITY.md) before combining conflicting variants. These instructions do not grant tool access or authorize publishing, commits, deployment, or communications.

## Related skills and principles

- [core/goal-driven-execution](../../core/goal-driven-execution/SKILL.md)
- [core/simplicity-first](../../core/simplicity-first/SKILL.md)
- [core/surgical-changes](../../core/surgical-changes/SKILL.md)
- [core/think-before-coding](../../core/think-before-coding/SKILL.md)
- [engineering/plan-eng-review](../../engineering/plan-eng-review/SKILL.md)
- [engineering/review](../../engineering/review/SKILL.md)
- [product/office-hours](../../product/office-hours/SKILL.md)
- [product/plan-ceo-review](../../product/plan-ceo-review/SKILL.md)
- [project-management/retro](../../project-management/retro/SKILL.md)
- [release/document-release](../../release/document-release/SKILL.md)
- [release/land-and-deploy](../../release/land-and-deploy/SKILL.md)
- [release/ship](../../release/ship/SKILL.md)
- [testing/qa](../../testing/qa/SKILL.md)
- [testing/tdd-workflow](../../testing/tdd-workflow/SKILL.md)
- [verification/verification-loop](../../verification/verification-loop/SKILL.md)

## Source provenance

- `andrej-karpathy-skills/skills/karpathy-guidelines/SKILL.md`
- `gstack/office-hours/SKILL.md`
- `gstack/plan-ceo-review/SKILL.md`
- `gstack/plan-eng-review/SKILL.md`
- `ecc/skills/tdd-workflow/SKILL.md`
- `gstack/review/SKILL.md`
- `gstack/qa/SKILL.md`
- `ecc/skills/verification-loop/SKILL.md`
- `gstack/document-release/SKILL.md`
- `gstack/ship/SKILL.md`
- `gstack/land-and-deploy/SKILL.md`
- `gstack/retro/SKILL.md`
