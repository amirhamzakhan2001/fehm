# Feature 3.6 — Security Review

`fehm serve` → `http://127.0.0.1:4317/security` (dashboard: `/#/security`), and `fehm security` on the command line.

3.6 answers: **what security risks exist in this codebase, how do data and trust boundaries flow through it, which controls exist, which are missing, and what evidence supports each finding?**

There is no security score. The posture is derived from the most severe open finding. No finding says code *is* vulnerable, and no mapping says a project *is* compliant: each finding says what was detected, where, the evidence, what could not be established, and how to verify a fix. No model is called.

```
FehmEngine + 3.2 facts ─┬─ data flow        taint.ts     source → transform → sanitizer → sink (TS AST, Python heuristic)
                        ├─ patterns         sast.ts      crypto, TLS, JWT, CORS, cookies, deserializers, debug, XXE …
                        ├─ secrets          secrets.ts   provider keys, keyed values, committed .env (values never shown)
                        ├─ attack surface   surface.ts   routes × authentication, authorization, validation, rate limits
                        ├─ dependencies     3.5 inventory + OSV advisories, reachability from routes
                        ├─ CI/CD            cicd.ts      GitHub Actions, GitLab CI
                        ├─ infrastructure   infra.ts     Dockerfile, Compose, Kubernetes, Terraform, CloudFormation
                        └─ AI               ai.ts        LLM calls, agent tools, MCP servers and configs
                                              │
          findings (src/findings, shared with 3.5) + controls + OWASP/CWE mapping + posture
                                              │
                         /security · fehm security · SARIF 2.1.0
```

## Posture

| Posture | When |
|---|---|
| Critical attention | Any open critical finding |
| Attention required | Any open high finding |
| Review | Any open medium finding |
| No high-severity findings | Otherwise. The page says explicitly that this is not a statement that the code is secure |
| Unknown | No source files were analysed |

Findings marked false positive, accepted risk or suppressed leave the counts; "reviewed" keeps them open. The review store is shared with 3.5.

**Domain coverage.** The overview shows, per domain, how much Fehm could analyse and the worst open finding. For example:

- data flow: source files in supported languages;
- dependencies: 0 until the advisory lookup has run.

A full bar with no findings means "nothing detected", not "secure".

## Data flow

Every data-flow finding carries a **trace**: its steps (source, transform, call, sanitizer, sink), each with file:line, the sanitizers seen on the path, and whether it crosses a call.

**Sources**

- HTTP request data: `req`/`request`/`ctx`/`event` with `query`, `params`, `body`, `headers`, `cookies`, `url` …; `searchParams.get()`; `request.json()`/`formData()`; Hono's `c.req.*`. In Python: `request.args`/`form`/`json`… and the parameters of route-decorated functions.
- LLM responses: the result of `chat.completions.create`, `messages.create`, `generateText` … and fields such as `.choices[0].message.content`.
- MCP and agent tool arguments: the parameters of `server.tool(…)` / `registerTool(…)` callbacks and AI SDK `tool({ execute })`. The model chooses them.

CLI arguments and environment variables are not sources: the operator owns them.

**Propagation** (TypeScript/JavaScript, on the syntax tree):

- declarations, assignments and `+=`; destructuring;
- template literals, concatenation, `||`/`??`, conditionals, array and object literals, spread, `await`;
- method calls on tainted values;
- calls with tainted arguments. The spec's `buildQuery()` step appears as a *call* step;
- closures: nested functions inherit the enclosing taint.

**One call level, across files.** Every named function is summarised: which parameter reaches which sink (two rounds, so a wrapper of a wrapper is followed). A tainted argument passed to it produces a flow into the callee. The callee is found in the same file, or through the Feature 1 graph's `calls` edges from the enclosing function, so the flow `POST /x → handler → db.ts` crosses files.

**Sinks**

| Sink | Examples | Rule |
|---|---|---|
| SQL | `db/pool/client/knex/sequelize/prisma….query/execute/raw/$queryRawUnsafe(text)` | sec/sql-injection (CWE-89) |
| Command | `exec`, `execSync`; `spawn`/`execFile` with `shell: true` | sec/command-injection (CWE-78) |
| Code | `eval`, `new Function`, `vm.run*`, string `setTimeout` | sec/code-injection (CWE-94) |
| Path | `fs.*` read/write/stream/unlink, `res.sendFile`/`download` | sec/path-traversal (CWE-22) |
| SSRF | `fetch`, `axios`, `got`, `http(s).get/request`, `requests`, `urlopen` | sec/ssrf (CWE-918) |
| Redirect | `res.redirect`, `NextResponse.redirect`, `Location` header, `location.href =` | sec/open-redirect (CWE-601) |
| XSS | `res.send` of a string, `innerHTML`, `dangerouslySetInnerHTML`, `document.write`, Python `Markup`/`mark_safe` | sec/xss (CWE-79) |
| Other | header values, `unserialize`/`pickle`/unsafe `yaml.load`, `Model.create(req.body)` (mass assignment), template compilation, `_.set`/merge of the body (prototype pollution), `new RegExp` | see rules.ts |
| LLM prompt | request data in LLM call arguments | sec/llm-prompt-injection (LLM01) |

**Sanitizers are per sink:**

- numeric conversion (`parseInt`, `Number`, `int()`) neutralises everything;
- HTML escaping and encoding neutralise XSS, header and template sinks only;
- `path.basename` / `secure_filename` neutralise paths;
- SQL escaping functions neutralise SQL; `shlex.quote` neutralises shell.

**Guards:** `if (!ALLOWED.includes(x)) return` (also `.has`, `.startsWith`, `.test`) neutralises x for URL, path and redirect sinks after the guard.

**Schema validation** (`.parse`, `.safeParse`, `validate…`) is recorded, lowers severity one level and the confidence, but does not suppress injection: a validated string is still a string.

**Not flagged:**

- parameterized SQL (a literal query plus a parameter array, or a tagged `sql\`\`` template);
- a fixed scheme and host with a variable path (`fetch(\`https://api.x.com/u/${id}\`)`);
- a fixed relative redirect (`"/users/" + id`);
- `res.json(obj)`.

**Model output reaching `eval`, a shell, SQL, HTML or a file path** is its own rule: sec/llm-output-sink (LLM05, ASI05).

## Secrets

- **What is scanned:** every indexed file except lockfiles and source maps, plus `.env` files tracked by git (the scanner never indexes them, so git is asked), plus MCP client configs.
- **Detectors:**
  - provider patterns (GitHub, GitLab, Slack, Stripe, AWS, Google, SendGrid, Twilio, Anthropic, OpenAI, private keys, JWTs, credentials in connection URLs);
  - a keyed-value rule: a secret-like key with a 16+ character quoted value above an entropy floor, not a placeholder, not an environment lookup.
- **What a finding shows:** the kind, the length and a SHA-256 fingerprint. **The value is never in a finding**, and `/api/security/source` and `/api/health/source` redact detected secrets in excerpts.
- **Test files:** secrets there are low severity.
- **Public client variables:** `NEXT_PUBLIC_`/`VITE_`/`REACT_APP_` variables whose names say secret, token or password are reported as exposed to the browser.

## Attack surface, authentication, authorization

- **Routes:** every route 3.2 found.
- **Controls per route:** authentication, authorization, input validation and rate limiting are each detected, not detected, unknown or not applicable. Evidence is looked for:
  - in the registration call itself (middleware arguments);
  - in a decorator above it;
  - in `app.use(…)` earlier in the file;
  - in the handler body. For a named handler this is the graph location; for an inline arrow, the registration call; for `@app.route`, the function under it.

  Comments, regex literals and prose strings are removed first, so a rule that *describes* `app.use(auth)` is not middleware.
- **Findings:**
  - "No authentication control detected on POST /api/orders" appears only for state-changing or sensitive routes, and only when the application authenticates somewhere else. With no authentication anywhere there is one aggregated finding, low if every server binds to localhost.
  - Authorization is judged separately, for administrative routes that authenticate.
  - Webhooks are judged by signature verification, not user authentication.
  - Login routes without any rate limiter are reported; state-changing routes without validation are reported as one aggregated low finding.
- **Reach:** each route also shows what its handler reaches (database, filesystem, network, processes, LLMs) through its call tree, and the findings inside its own lines.

## Dependencies

- **Inventory and advisories:** the components come from 3.5's inventory, and advisories from 3.5's opt-in OSV.dev lookup (the only network access, run from Project health or `fehm health --advisories`). Until it has run, the domain says *not checked*.
- **Reachability:** a vulnerable package is **reachable** when a route handler or entry point reaches, through the file dependency graph, a file that imports it. The path is shown (`POST /upload → upload.ts → lib`).
- **Unreached packages:** imported but unreached packages drop one severity level.
- **Not established:** whether the vulnerable *function* is called.

## CI/CD, containers, Kubernetes, infrastructure

- **GitHub Actions:**
  - `pull_request_target` / `workflow_run` checking out the contributor's ref (critical);
  - untrusted `${{ github.event.* }}` interpolated into `run:` or `github-script`;
  - `write-all` or write scopes on untrusted events, and missing top-level permissions;
  - actions not pinned to a commit (third-party low, first-party info);
  - echoed secrets, `secrets: inherit`;
  - self-hosted runners on untrusted events;
  - `curl | sh`;
  - persisted checkout credentials and cache use in `pull_request_target`.
- **GitLab CI:** evaluated MR/commit variables, mutable images, unpinned includes, Docker-in-Docker without TLS.
- **Dockerfile:** root user, mutable base image, remote `ADD`, `curl | sh`, secret `ENV`/`ARG` values (redacted), `EXPOSE` without `HEALTHCHECK`.
- **Compose:** privileged, host namespaces, the Docker socket, host-root mounts, dangerous capabilities, root user.
- **Kubernetes:**
  - privileged, host network/PID/IPC, hostPath, privilege escalation, dangerous capabilities;
  - no runAsNonRoot, no resource limits;
  - wildcard RBAC and cluster-admin bindings;
  - literal Secret data;
  - Ingress without TLS;
  - mutable images.
- **Terraform and CloudFormation:** public buckets, ingress from 0.0.0.0/0 on SSH, RDP, database or all ports, publicly accessible databases, disabled encryption, `Action "*"` on `Resource "*"`.

The Feature 1 scanner now indexes `.tf`, `.tfvars`, `.hcl`, `Dockerfile.*`, `*.dockerfile`, `Containerfile` and `Jenkinsfile` as configuration, so these reach 3.6 (and 3.3's deployment view).

## LLM, agents and MCP

- **Inventory:**
  - providers (OpenAI, Anthropic, Google, Mistral, Cohere, Ollama, Bedrock …) and frameworks (AI SDK, LangChain, LlamaIndex, MCP …) with the files that import them;
  - direct API endpoints;
  - **call sites** (model, pinned or alias, output limit, untrusted input, where the output goes);
  - **tools** (MCP `server.tool`, `registerTool`, FastMCP/LangChain `@tool`, AI SDK `tool()`, OpenAI function definitions);
  - MCP servers (transport, authentication detected);
  - MCP client configs (`.mcp.json`, `.cursor/mcp.json`, `.vscode/mcp.json`, `claude_desktop_config.json`).
- **Tool analysis:** each tool's capabilities (shell, code evaluation, file read/write, network, database), whether it has a schema, and whether it shows an approval or allowlist step.
- **Findings:**
  - dangerous tool with no guard;
  - tool without a schema;
  - **tool-description poisoning** (instruction-like text, HTML comments or zero-width characters in a description);
  - network MCP transport without authentication;
  - MCP server launched from an unpinned `npx`/`uvx` package;
  - request data in prompts (low when a delimiter or length limit is nearby);
  - model output to dangerous sinks;
  - no output-token limit;
  - model alias instead of a pinned version;
  - secrets inside prompts.
- **AI controls table:** the share of call sites or tools where evidence of each control was found (the spec's AI security dimensions, following Skylos' `defend` plugins). The page states that these percentages are not a security measure.

## Security controls inventory

Authentication, authorization, input validation, secrets management, rate limiting, audit logging, password hashing, transport security, security headers, CSRF, CORS, dependency and security scanning in CI (from 3.5's CI analysis), and security tests.

- **Statuses:** present, partial, missing, unknown or not applicable, each with up to five evidence lines.
- **How evidence counts:**
  - a package counts only through an import or `require`;
  - a function only through a call;
  - comments, regex literals and prose strings are removed first.

  This is why Fehm's own rule files do not count as controls.

## Frameworks

Every rule maps to a CWE and to categories of the OWASP Top 10 (2021), OWASP API Security (2023), OWASP LLM Top 10 (2025) and OWASP Agentic (2026, the Skylos/`defend` naming). The page shows, per category, the findings from mapped rules, "no findings", or **not covered** when no Fehm rule addresses the category. The disclaimer is on the page: evidence toward a category, never compliance.

## Findings, lifecycle, CI

- **What each finding carries:**
  - the shared model (id, rule, the Skylos rule it came from, severity, confidence, evidence, what was not established, why, action, verification);
  - a domain, CWE, OWASP ids, the trace, controls detected and missing;
  - the test files that exercise the affected file, to re-run after the fix.
- **Lifecycle:** review states, baseline (`security-baseline.json`: new, existing, fixed) and trend points (`security-history.json`, one per distinct digest) reuse 3.5's helpers.
- **Changed-files scope:** `--changed`, or the page toggle.
- **SARIF 2.1.0:** `fehm security --sarif`, or the page's SARIF link. It includes codeFlows for traces, for GitHub code scanning.

## Page

1. Posture, with critical attention and domain coverage.
2. Attack surface: route table and filters.
3. Data flow.
4. Application, secrets, dependencies, CI/CD, containers & Kubernetes, infrastructure.
5. LLM, agents & MCP.
6. Security controls, then OWASP & CWE.
7. Findings: search, severity, domain, review state, new. Each opens with its trace (source → sink with file:line), "Show in graph", the sink's source (redacted), controls, verification including related tests, the rule, and review buttons.
8. Trends, then Analysis (analyzers, language coverage, provenance digest, what was not determined).

## API

| Route | |
|---|---|
| `GET /security` | Page |
| `GET /api/security[?scope=changed]` | Page payload |
| `GET /api/security/report` | Full report (Export) |
| `GET /api/security/sarif` | SARIF 2.1.0 |
| `POST /api/security/review?id=&status=…[&note=]` | Review a finding (shared store with 3.5) |
| `POST /api/security/baseline[?clear=1]` | Set or clear the security baseline |
| `GET /api/security/source?path=&line=` | Redacted excerpt of an indexed file |
| `POST /api/security/refresh` | Incremental re-index (the page's "Run scan") |

Writes need POST and `x-fehm: 1`. Dry-run servers refuse them.

## CLI

```
fehm security [--all] [--json] [--changed]
fehm security --sarif > fehm.sarif
fehm security --baseline
fehm security --fail-on critical|high|medium|new
```

## Deviations from the spec, and deferred items

- **`security-graph.ts` no longer exists** (removed in the rebuild). Traces render as step chains with "Show in graph" into 3.1, and 3.3 has a security architecture view. A dedicated security-graph canvas is deferred.
- **No score.** The spec's "coverage %" per domain is shown as *analysed / relevant inputs*, and the AI dimensions as *share with detected controls*, each labelled as such.
- **Confidence** uses Fehm's vocabulary (verified, strong, inferred, unknown), as elsewhere.
- **Analysis depth:**
  - data flow goes one call level deep (with summaries of summaries) and stays inside the repository;
  - Python data flow is line-level within a function;
  - Go, Java and Rust get pattern rules only;
  - dependency reachability is file-level.
- **Deferred:**
  - taint through class fields and async callbacks registered elsewhere;
  - GraphQL resolvers and OpenAPI-driven route inventories;
  - Pulumi and CDK;
  - cloud-provider live configuration;
  - git-history secret scanning;
  - automatic patches ("apply fix → re-scan → verify"; the verification steps are listed per finding);
  - LLM-assisted explanations (never needed for a finding).

Bump `SECURITY_VERSION` when findings change for the same code: it marks trend points.
