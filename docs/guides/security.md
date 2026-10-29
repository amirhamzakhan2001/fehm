# Security and privacy

Ordinary source indexing, retrieval, skill routing and static analysis run locally. The public website does not receive local repository activity or connect to your dashboard.

## Stored evidence

Local .fehm state can contain source-derived indexes, saved investigations and execution records. Treat it according to the repository's sensitivity. Redact secrets from supplied failures and logs. Do not publish local state inadvertently.

## Command execution

Guardrails and supported diagnostic execution require approval. The runner bounds operations and records evidence, but project commands execute with host permissions. Inspect argv, working directory, scripts and dependencies before approval. Skills never grant execution permissions by themselves.

## Network and models

Installing dependencies uses package registries. Optional advisory lookup and explicitly configured external summary/reranker commands may contact services. An assistant reading exported context may send it to its provider. Review that provider's policy and the context before sharing.

## Static-analysis limits

Security signals are evidence for review, not proof that all vulnerabilities are found. An empty report does not establish safety. Readiness cannot identify the author or whether AI was used. Keep the dashboard local; it is not designed as an isolated multi-tenant service.
