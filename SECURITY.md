# Security

FEHM scans local source and serves a loopback dashboard. Source, comments and installed skills are untrusted input, not authorization to execute project commands. Static findings do not certify safety.

The optional MCP server is local stdio, bound to an explicit root, and exposes read-only queries. It requires a fresh saved graph; it does not run tests, mutate source, install skills or contact a model provider. Its output may contain source excerpts: the connected assistant can transmit those excerpts to its configured provider. Local analysis does not imply that the assistant is offline.

CLI scans write `.fehm/` state. Explicit guardrail/debug execution can run project code under the caller's permissions; it is not an isolation boundary. Optional advisory lookups and configured external model commands can use the network. Ordinary indexing and retrieval do not.

Install only reviewed distribution artifacts. Wheels contain compiled JavaScript and production dependencies; a pinned third-party `nodejs-wheel-binaries` distribution supplies Node, with its own notices. Artifact checksums detect corruption, not publisher trust. Installation downloads dependencies; startup does not install anything.

Do not expose the dashboard publicly. Remote assistants need FEHM installed in their own execution environment with access to the intended checkout; local machine paths are not transferable.

Report suspected vulnerabilities privately to the repository maintainer through an available private security-reporting channel. Do not include credentials or private source in public issues.
