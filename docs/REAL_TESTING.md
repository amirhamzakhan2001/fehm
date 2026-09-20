# Real-repository beta testing

Fehm is ready for controlled local testing. Passing automated release gates does not establish correctness for every feature, language, client, or workload. Record the Fehm version, OS, repository revision, commands, expected outcomes, and actual outcomes. Use a trusted sample repository first; preserve existing `.fehm` policy/history before experiments.

## Automated baseline

From the Fehm checkout:

```bash
npm ci
npm run release:check
npm run build:python
python3 scripts/python-smoke.py
```

The engine gate tests representative features and localhost behavior. The wheel gate tests installation without global Node/npm, scan/query, practice audit, registration, MCP, and cockpit serving. CI defines other OS/runtime jobs; a configured job is not a passing result.

## Acceptance matrix

| Area | Real test | Required evidence |
| --- | --- | --- |
| Installation | Install the reviewed wheel on each advertised OS | Correct version; no separate npm/Node installation needed for Fehm |
| Graph and context | Scan a known repository; query a known authentication/API flow | Expected files, symbols, and cited sources; uncertainty for inferred or missing links |
| Incremental indexing | Scan unchanged code, edit one function, then rescan | Unchanged work reused; changed source reflected in the graph |
| Architecture | In a disposable project, approve a reviewed contract and introduce a forbidden import | Expected violation/location reported; drift identifies the new violation |
| Practices | Save a baseline, then remove a detected control in a disposable project | Audit identifies regression; approved required gaps participate in preflight |
| Change review | Use a known diff with impact/preflight | Correct affected files/tests; no claim of exhaustive runtime prediction |
| Verification | Run verify on trusted code with its toolchain installed | Commands actually execute; failures/timeouts are reported |
| Quality reports | Supply known coverage, API, and runtime artifacts | Outputs agree with those inputs; heuristic findings remain reviewable |
| Assistant skills | Register one platform/scope and reload that assistant | Skill discovered; Fehm runs in the intended repository and the assistant cites actual output |
| MCP | Configure the installed executable and graph in a real client | Client initializes, lists tools, and completes context/practices calls |
| Cockpit | Test navigation, graph interaction, forms, errors, project switching, watch, and keyboard access | Correct project/results, working layout, no console errors, updated source reflected |
| AI providers | Configure a test provider and run a small evaluation | Success, denied credentials, timeout, malformed response, latency, and cost recorded |
| Native services | Install/status/restart/remove on each OS, including paths with spaces | Correct lifecycle without leftover jobs; currently unqualified for general use |
| Scale | Measure cold/warm scan time, peak memory, query latency, and watch responsiveness | Publish workload sizes and measured results before performance claims |

Tests that remove controls, change architecture, execute mutations, or replay historical code belong in disposable copies. Provider tests use an explicitly configured account/budget. Automated tests do not establish real-client/provider/platform outcomes.

Known native-service limitation: the Linux unit writer does not quote paths in `ExecStart`, so spaces can break service startup. Use foreground `watch`/`serve` for the beta workflow; do not consider native services production-qualified.

## GitHub readiness

The README describes a local beta, grouped capabilities, uv installation, and known limits. Review the files selected for the initial commit: temporary images, `.env` files, generated indexes, build output, and package artifacts are excluded. `.fehm/architecture.proposed.json` is intentionally allowed by the ignore rules but is an unapproved local proposal; exclude it from the initial commit unless you deliberately want to share it. An approved project contract may be versioned after review.

A GitHub source push does not publish PyPI packages. Until the owner publishes and verifies the release, use the developer build/local-wheel instructions and keep the public install command marked as pending.

## Production qualification remains open

Browser/client discovery, real providers, OS services, other OS wheel runs, and measured scale results remain outstanding. TypeScript project aliases/references, deeper polyglot resolution, and custom practice extensions remain roadmap work. The initial website, SEO metadata, and optional analytics code are implemented separately in `website/`; public launch and live measurement remain pending. Update [FEATURE_AUDIT.md](FEATURE_AUDIT.md) with concrete results as they arrive.
