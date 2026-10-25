# skylos — selected upstream source

- Repository: https://github.com/duriantaco/skylos
- Version: 4.41.0 (the snapshot had no git metadata, so it is pinned by version and by file hashes)
- License: Apache-2.0 (see `LICENSE`, retained unchanged)

`vendor/` holds the original upstream files byte-for-byte (hashes in `manifest.json`, verified by `test/upstream-adaptations.test.ts`). They are reference copies: Fehm never imports or runs them, and no Python is needed.

## How Skylos is used in Fehm

Feature 3.5 (project health) re-implements a selection of Skylos' rules in TypeScript, over Fehm's own code graph. This is the "hybrid" approach: Skylos' rule definitions and thresholds, Fehm's graph, tests, git history and dashboard. Each Fehm finding records the Skylos rule id it corresponds to (`upstream`), and the page shows it.

| Skylos | Fehm |
|---|---|
| SKY-Q301 cyclomatic complexity (`rules/quality/complexity.py`) | `src/health/metrics.ts#cyclomatic` |
| SKY-Q306 cognitive complexity | `src/health/metrics.ts#cognitive` |
| SKY-Q302 nesting (`rules/quality/nesting.py`) | `src/health/metrics.ts#nestingDepth` |
| SKY-C303 / C304 arguments and length (`structure.py`) | `src/health/quality.ts#complexityFindings` |
| SKY-Q501 / Q502 class size (`class_size.py`) | `src/health/quality.ts#classFindings` |
| `skylos debt` scoring (`debt/scoring.py`) | `src/health/debt.ts` |
| Dead-code evidence model (`deadcode/evidence.py`) | `src/health/dead-code.ts` |
| Other rule ids (`rules/catalog.py`): L002, L007, L008, L009, L011, L012, L026, L030, L031, L032, L035, Q305, Q402, Q405–Q407, T104, U001, U002, U005, UC002, A101, A102, D223, SCA-LIC001 | `src/health/rules.ts` and the modules it lists |

Modifications are listed per adaptation in `manifest.json`. The main ones: TypeScript and JavaScript are analysed with the TypeScript compiler; Python, Go, Java and Rust with line-level heuristics labelled as such; severities mapped onto Fehm's five levels; debt priority extended with git churn and test protection.

Feature 3.6 (security review) adapts the security side the same way:

| Skylos | Fehm |
|---|---|
| Taint rules and untrusted sources (`rules/danger/taint.py`, `untrusted_sources.py`; D211, D212, D215, D216, D228, D230, D233, D234) | `src/security/taint.ts` |
| Secret detection (`rules/secrets.py`; S101, S102) | `src/security/secrets.ts` |
| Danger patterns (D201–D210, D232, D246–D253, D271, D346, D348) | `src/security/sast.ts` |
| GitHub Actions and GitLab CI rules (D290–D323) | `src/security/cicd.ts` |
| Container rules (D330, D342, D343) | `src/security/infra.ts` |
| MCP, agent and LLM rules (D240–D244, D260–D267) and `defend` plugins, OWASP LLM / Agentic mappings (`defend/owasp.py`) | `src/security/ai.ts`, `src/security/rules.ts` |

Not used: the Python analyzer itself, LLM review and investigator, agent hooks and command guard, runtime agent verification, remediation engine, attestation, the SBOM writer, cloud upload, benchmarks and editor extensions.
