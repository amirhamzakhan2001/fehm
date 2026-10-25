# Compatibility and execution contract

This library is portable instruction content. It does not install agents, CLIs, browsers, hooks, external integrations, scanners, memory stores, or model access. Source-specific personas describe the perspective to adopt, not actual professional credentials, lived experience, or persistent memory.

## Precedence and selective use

1. System/tool constraints and explicit user requirements control the task and authorization.
2. Project rules and repository constraints control implementation choices within that scope.
3. Applicable security boundaries take precedence over convenience. Never bypass a selected workflow's containment, evidence, or authentication requirements.
4. Load task-specific methodologies and relevant language/framework standards; do not activate the whole library.
5. Report verification exceptions, skipped checks, incomplete coverage, and unavailable dependencies. Avoid unrelated scope expansion.

References preserve the source authors' complete procedures, including strong preferences and named variants. Their use of “always,” “must,” “autonomous,” or “run first” is local to that selected source workflow and its prerequisites; it is not a global instruction to install its product or change the host environment. Preserve explicit gates when choosing that variant unless superseded by the user's authorization or higher-priority constraints. Record any substantive adaptation.

Source slash commands and agent names are discoverability aliases, not registered commands. Resolve them through the repository-scoped `aliases` object in manifest.json. A reference to `ecc:code-reviewer` selects the ECC procedure; it does not prove that a callable agent exists. Delegation requires available tools and authorization. Run sequentially only where that preserves the selected workflow's evidence independence; otherwise report the missing capability.

## Recorded conflicts and decisions

| Conflict | Preserved variants | Composition rule |
| --- | --- | --- |
| Scope expansion versus surgical changes | gstack CEO review/completeness, Agency rapid prototyping, Karpathy surgical changes and simplicity | Present proposed expansion separately. Implement the agreed scope. Completeness means satisfying that scope, not adding speculative features. |
| Mandatory TDD / 80% coverage versus proportionate verification | ECC TDD, common testing rules, verification loop; Karpathy trivial-task judgment | Use project targets. When selecting ECC TDD retain RED/GREEN/refactor and its stated target; record a project-specific exception rather than silently dropping it. Coverage is not proof of correctness. |
| Code-first context versus thinking/planning first | ECC development context; ECC planner; Karpathy think-before-coding | The dev context applies after intent and success criteria are clear. For ambiguous work use clarification/planning first. |
| Fixed style thresholds versus contextual review | ECC 50-line functions/800-line files/immutability and code-review command; Agency constructive correctness-focused review | Preserve ECC thresholds as named conventions; project rules decide enforcement. Do not turn a style nit into a security defect or impose copying on languages where ownership/mutation is idiomatic. |
| Fix-first versus report-only review | gstack review/QA/design-review; gstack qa-only; ECC PR review | Select report or repair mode from the task. Review does not itself authorize modifying, committing, or publishing. |
| Automatic ship/checkpoints versus approval gates | gstack ship and checkpoint protocol; ECC orch-pipeline Gate 1/Gate 2 | Existing user authorization controls actions. Retain the selected source's explicit gates where applicable. Nothing in the library independently grants push, merge, deployment, or messaging permission. |
| Shared telemetry/sync versus private security investigation | gstack startup/learning/gbrain; CSO private-startup policy | CSO findings, code, credentials, and evidence never flow into telemetry or shared learning. The shared protocol is not active for CSO. |
| General tool execution versus trusted security launcher | ECC scanner/review examples; gstack CSO | CSO requires its trusted launcher and qualified profiles. Without them report not assessed. Do not run target code on the host as a substitute. Preserve static / self_reported / runtime_tested labels; do not upgrade evidence to “tested.” |
| Historical v1 learning versus current v2 | ECC continuous-learning contains both a deprecation banner and older “still supported” text | Treat v1 as archival reference. Route new learning work to continuous-learning-v2; preserve the historical text for migration comparisons. |
| Always-delegate persona versus unavailable native engine | ECC agents/Workflow pilot, Agency NEXUS, gstack reviewer army | Instructions do not create agent or Workflow tools. Independent verification cannot be claimed when only self-review ran. |
| Strong success metrics versus observed evidence | Agency persona metrics; ECC quality thresholds; gstack dashboards | Treat targets as targets. Report only observed results and actual credentials/capabilities. |

## Portable execution boundaries

Read the selected procedure completely. Resolve knowledge references through local links, the manifest, and source-map.json. Before running an embedded command, verify the actual target, working directory, available executable, runtime version, credentials, and user authorization. Source paths such as `~/.claude/skills/gstack/bin/...` remain source-runtime examples; do not treat this library's references as installed executables.

Source examples may use pipelines, placeholder paths, or heuristic secret checks. Preserve exit status when validating; a command that pipes into `head` or `tail` does not prove the upstream check passed. A heuristic grep scan is not a comprehensive security assessment. Distinguish test failures from missing tooling and infrastructure failures.

Read-only reference implementations are included where they explain a reusable algorithm or hook contract. They are not a bundled, tested runtime. Do not execute copied helpers whose imports, host APIs, or data stores are unresolved. For integrations, obtain actual tool access before claiming execution. Runtime prerequisites are listed in DEPENDENCIES.md and dependencies.json; that ledger is a static inventory, not a proof that every third-party tool works.

## Relationship and conflict status

Named alternatives remain intentionally available. The decisions above define composition behavior; they do not claim the source prescriptions have become equivalent. Future project-specific choices (coverage target, browser, host, release authority, memory provider) remain unresolved until selected for a real task.
