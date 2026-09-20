# Security policy

## Reporting

Report suspected vulnerabilities privately to the project maintainers using the repository's private reporting channel when available. Include the affected revision/version, minimal reproduction, expected/actual behavior, and impact. Do not post live credentials, private source, or sensitive graph/evaluation artifacts in public issues.

Security fixes target the current maintained version. This repository's build and audit records do not imply that a public package has already been published.

The uv distribution bundles the TypeScript runtime dependency and depends on a pinned, unofficial `nodejs-wheel-binaries` distribution. Review both dependency supply chains before releasing; update runtime pins with corresponding wheel smoke tests. User installation does not run npm or fetch engine code on first launch. Agent skill registration changes only the reported skill path, refuses symlinked destinations, and protects customized files; `--force` backs them up before replacement/removal.

## Trust model

fehm is a local-first analysis tool for trusted repositories and controlled private teams. The CLI binds the cockpit to loopback by default. Non-loopback binding requires a bearer token of at least 32 characters unless explicitly bypassed. Private remote access should use TLS and network restrictions.

Unauthenticated loopback requests reject unrelated hostnames. API authentication is shared across projects in one process; this is not tenant isolation. Static cockpit assets and liveness/readiness probes are public. Library callers are responsible for their own listen address and access controls.

## Execution and data

Verification commands, mutation runs, and historical replay execute project code. Temporary copies and Git checkouts protect the working tree but are not a sandbox against malicious repositories. Do not execute untrusted project commands in a sensitive environment.

Normal graph/practice analysis does not call a model provider. Explicit provider features can transmit prompts and selected context to the configured endpoint; review provider retention and sensitive-data policies first. Treat retrieved/model content as untrusted data, preserve the prompt-injection boundary, and constrain tool authorization.

Keep source excerpts, graphs, prompts, evaluation output, traces, policies, and agent history private as appropriate. Externalize secrets, restrict state permissions, avoid credentials in URLs or logs, back up durable records, and use one writer per state directory.

## Policy and assurance limits

Architecture and practices approval records express local project intent. The practice approval hash detects content changes; it is not a cryptographic identity or role-based authorization system. Anyone with sufficient repository write access can alter local policy state.

Static security, readiness, and practices findings are evidence for review. They do not certify compliance, prove the absence of vulnerabilities, or replace runtime testing and a project threat model.

For deployment, probes, recovery, and incident procedures, read [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md). For implementation boundaries, read [docs/SYSTEM_DESIGN.md](docs/SYSTEM_DESIGN.md).
