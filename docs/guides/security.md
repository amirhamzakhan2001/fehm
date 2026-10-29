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


## Local MCP boundary

The optional stdio server requires an explicit project root and a fresh saved graph. Its six tools query the existing engine; they do not run checks, invoke a provider, write source or update the index. Responses are capped at 96 KiB; narrow large queries. Connected assistants may send returned source excerpts to their providers. Source text is untrusted data, not instructions or permission to execute commands.

## Distribution and remote environments

The wheel contains production JavaScript dependencies and uses a pinned unofficial nodejs-wheel-binaries dependency for private Node. Review artifact provenance and checksums. Installation can download dependencies; startup does not. Uninstall leaves .fehm project state and client settings intact. Remote agents need a separate installation with access to their intended checkout. Do not expose the loopback dashboard publicly.
