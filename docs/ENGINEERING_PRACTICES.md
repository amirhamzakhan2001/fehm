# Engineering practices and drift

fehm helps a project retain its approved architecture and review engineering controls throughout development and operation. The built-in catalog contains 31 static checks. It covers common concerns across the lifecycle; it cannot encode every practice, prove production readiness, or prescribe a single architecture for every industry.

## Two kinds of drift

| Kind | Baseline | Evidence | Result |
| --- | --- | --- | --- |
| Architecture drift | Graph before a change and the chosen architecture contract | File import relationships and layer rules | Added, resolved, and unchanged violations |
| Engineering-practice drift | Saved report under the same practice policy | Current source, tests, configuration, CI, and documentation artifacts | Lost and improved practice signals |

A new violation always makes architecture drift `degraded`, even when another violation was fixed. Similarly, an improved practice does not cancel out a lost control. Neither report measures whitespace, preferred naming, or fashionable architecture patterns. Use formatters and language-specific linters for coding style.

## Workflow

```bash
fehm scan .
fehm practices audit .fehm/graph.json
fehm practices propose .fehm/graph.json --profile auto
```

Review `.fehm/practices.proposed.json`. The proposal requires architecture-intent documentation, automated tests, and CI verification; other catalog rules start as warnings. This draft has no enforcement effect.

Choose the rules your project needs. For example:

```json
{
  "version": 1,
  "profile": "library",
  "rules": {
    "architecture-intent": { "mode": "require" },
    "automated-tests": { "mode": "require" },
    "ci-verification": { "mode": "require" },
    "dependency-review": { "mode": "warn" },
    "container-hardening": {
      "mode": "off",
      "reason": "Published as a library; no container runtime is deployed."
    }
  }
}
```

Approve only after reviewing the actual file:

```bash
fehm practices approve .fehm/graph.json
fehm practices audit .fehm/graph.json
fehm practices baseline .fehm/graph.json
```

Approval writes `.fehm/practices.json` with the developer approval time and a hash of the policy content. A changed or unapproved active policy fails closed. To revise policy, edit a proposal and approve it again. Re-running `propose` replaces the proposal with catalog defaults; it does not modify an approved policy.

The baseline records observed evidence, including existing gaps. Saving it is not a declaration that all practices are satisfied. Do not routinely reset it to hide regressions. Baselines from a different repository, catalog, or policy are reported as incompatible and require review before replacement.

## Applicability and results

| Setting | Behavior |
| --- | --- |
| `auto` profile | Infer service and AI applicability from implementation signals; also detect data and web artifacts. |
| `library` profile | Do not automatically require service or AI controls; data/web signals still apply. |
| `service` profile | Enable service controls; data/web signals still apply. |
| `ai-service` profile | Enable service and AI controls; data/web signals still apply. |
| `warn` | Report findings without blocking preflight. This is the default for unspecified rules. |
| `require` | Force applicability and require a detected signal after explicit policy approval. |
| `off` | Exempt the rule; a non-empty reason is mandatory. |

`detected` means every configured signal for that rule was found. `review` means at least one signal is missing. `not-applicable` means automatic applicability did not select the rule. `exempt` records a deliberate exception.

Evidence contains paths, line numbers, and check labels. Source snippets and secret values are not included. Runtime capability detection excludes documentation and test fixtures; source-based control checks cannot be satisfied by a README. The checks remain pattern-based and can have false positives or negatives. Repository exclusions and a 2 MiB per-artifact read cap mean missing evidence may need manual review.

The evidence fingerprint includes scanned practice artifacts, so a CI or documentation change can affect practices even when the source graph fingerprint is unchanged. Rescan the source graph before graph-based architecture and impact checks.

## Preflight and CI

```bash
fehm preflight .fehm/graph.json --base HEAD~1 --understand "describe the intended change"
fehm practices audit .fehm/graph.json --json
```

Preflight combines understanding, affected architecture violations, protected zones, risk, and approved required practice gaps. An explicit `--approve` can override approval-requiring gaps for that invocation; the report retains the practice findings and records the override. Invalid policy data is an error and is not bypassed by that flag.

Practice enforcement is project-wide, not restricted to changed source files. This catches missing CI or test artifacts that a source-only diff may not contain. A saved practice regression is advisory in preflight unless its rule is required; the standalone audit exits with code 2 for any drift regression or required gap. Advisory gaps alone exit successfully. Invalid files/configuration exit with code 1.

`verify` retains its existing static/security/architecture/test checks. Run `practices audit` as an additional CI gate. fehm does not intercept editor keystrokes or prevent writes by tools that skip preflight.

## Catalog

The source of truth is `PRACTICE_RULES` in `src/engineering-practices.ts`. The catalog table below lists its current identifiers. Recommendations are broader than the static signal: a matching timeout, for example, does not prove comprehensive retries, cost controls, or cancellation.

| Rule | Area | Review concern | Applicability |
| --- | --- | --- | --- |
| `architecture-intent` | Architecture | Document boundaries and rationale | all |
| `ownership` | Architecture | Assign review ownership | all |
| `development-workflow` | Development | Make development reproducible | all |
| `static-analysis` | Development | Configure static analysis | all |
| `automated-tests` | Testing | Keep executable regression tests | all |
| `failure-tests` | Testing | Exercise failure and denied paths | all |
| `ci-verification` | Delivery | Run verification in CI | all |
| `dependency-lock` | Supply chain | Pin resolved dependency versions | all |
| `dependency-review` | Supply chain | Review dependency risk | all |
| `security-policy` | Security | Document security response | all |
| `threat-model` | Security | Record trust boundaries | service |
| `input-validation` | Security | Validate untrusted inputs | service |
| `authorization` | Security | Enforce server-side authorization | service |
| `secret-handling` | Security | Externalize secrets | all |
| `api-contracts` | API and data | Version interface contracts | service |
| `data-migrations` | API and data | Version data migrations | data |
| `data-recovery` | API and data | Plan data recovery and privacy | data |
| `timeouts` | Reliability | Bound external operations | service |
| `idempotency` | Reliability | Handle repeated side effects | service |
| `health-checks` | Operations | Expose health and readiness | service |
| `observability` | Operations | Correlate runtime diagnostics | service |
| `incident-runbook` | Operations | Document incident response | service |
| `deployment-rollback` | Deployment | Plan rollout and rollback | service |
| `container-hardening` | Deployment | Use a non-root container user | service |
| `infrastructure-review` | Deployment | Review infrastructure changes | service |
| `accessibility` | User experience | Provide accessible controls | web |
| `ai-prompt-versioning` | AI engineering | Version prompts and model configuration | ai |
| `ai-evaluations` | AI engineering | Gate AI changes on evaluations | ai |
| `ai-tool-boundaries` | AI engineering | Constrain agent tools and authorization | ai |
| `ai-data-safety` | AI engineering | Specify model-data and injection safeguards | ai |
| `ai-runtime-budgets` | AI engineering | Bound model execution cost and latency | ai |

## Interfaces and extension

- CLI: `practices audit`, `propose`, `approve`, and `baseline`.
- Library: `auditEngineeringPractices`, `proposePracticesPolicy`, `approvePracticesPolicy`, and `savePracticesBaseline`.
- HTTP: `GET /api/practices`, optionally scoped with `?project=id`.
- MCP: `fehm_practices`.
- Cockpit: **Practices & drift**.

Policy approval and baseline writes use explicit CLI/library operations; the cockpit explains these operations and displays results. It does not silently approve rules. To add a detector, add a catalog rule with scoped artifact checks, applicability, remediation, and a reference; add positive/negative fixtures and update the catalog version when comparison semantics change. Arbitrary policy IDs and unreasoned exemptions are rejected.

## Reference frameworks

These frameworks informed the review areas, not a claim that fehm implements every requirement:

- [NIST SSDF 1.1](https://www.nist.gov/publications/secure-software-development-framework-ssdf-version-11-recommendations-mitigating-risk): secure-development practices across the software lifecycle.
- [OWASP ASVS](https://owasp.org/projects/asvs): verifiable application-security requirements.
- [NIST AI RMF](https://www.nist.gov/itl/ai-risk-management-framework): managing AI risks; the framework page also links its generative-AI profile.
- [Google SRE production-readiness guidance](https://sre.google/workbook/engagement-model/): production review and ongoing operational improvement.
- [W3C WCAG overview](https://www.w3.org/WAI/standards-guidelines/wcag/): accessibility requirements whose conformance needs actual evaluation.

No score, regex match, catalog reference, or approval record constitutes certification against these frameworks. Formal assurance requires the relevant controls, runtime evidence, people, processes, and independent review appropriate to the project.
