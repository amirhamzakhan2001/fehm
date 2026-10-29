<p align="center">
  <img src="assets/brand/readme-banner.svg" alt="FEHM — Know the code. Understand the change." width="100%">
</p>

# FEHM

**Understand a codebase, give your coding assistant focused context, and verify changes with evidence.**

FEHM is a local-first TypeScript tool with a CLI, a library API, and a localhost dashboard. It indexes files, symbols, imports and call relationships, then retrieves relevant source under an estimated token budget. Ordinary indexing, retrieval and skill routing do not call an LLM.

[Documentation](docs/README.md) · [Installation](docs/guides/installation.md) · [CLI guide](docs/guides/cli.md) · [Assistant skills](docs/guides/skills.md) · [Website development](docs/website.md)

## Get started

Use **Node.js 22.13 or newer** for the complete feature set, including the SQLite-backed concept catalog. The package declares Node 20+ for other commands. Git is needed for Git-history workflows.

Build from this repository:

```sh
git clone https://github.com/amirhamzakhan2001/fehm.git
cd fehm
npm ci
npm run build
node dist/cli.js help

# Optional: make the fehm command available locally
npm link
```

Then run from the repository you want to understand:

```sh
cd /path/to/your/project
fehm scan .
fehm search "authentication"
fehm context "change authentication" --budget 4000
fehm serve --port 4317
```

Open **http://127.0.0.1:4317**. Stop the server with Ctrl+C. Alternatively, run `/path/to/fehm/dist/cli.js` with Node and `--root /path/to/project`. Local state is stored under `.fehm/` by default.

This checkout uses Node/npm. The former Python-wheel setup and MCP server instructions do not apply to this implementation. These instructions do not assume that an npm or Python package has been published.

## What you can do

| Workflow | Current capability |
| --- | --- |
| Understand source | Search files and symbols, inspect relationships, trace outgoing calls, and explore the codebase graph. |
| Explain and map architecture | Read source-linked briefings and architecture views, with inferred relationships distinguished from observed evidence. |
| Build context for an assistant | Select relevant source and optional workflow skills within shared estimated token budgets. |
| Route and install skills | Discover the bundled catalog, choose relevant skills, and install selected skills with customization protection. |
| Inspect drift | Compare repository structure with explicit project constraints and detected conventions. |
| Review health and security | Inspect tests, supplied coverage, dependencies, static security signals, implementation integrity, engineering readiness and HTML delivery checks. |
| Analyze prompts | Inventory prompts and tool contracts; evaluate supplied cases and outputs through the supported prompt workflow. |
| Explore Git history | Search changes, compare revisions and inspect historical analyzer snapshots. |
| Understand engineering concepts | Look up concepts and inspect the evidence supporting their use in the codebase. |
| Verify changes | Analyze working-tree impact, discover checks, and record explicitly approved execution through the existing guardrail ledger. |
| Investigate failures | Turn error output and source locations into traceable evidence, tentative hypotheses and diagnostic actions. |

See the [documentation index](docs/README.md) for implementation references and limits. The broader revision-aware Change Impact Engine remains a **plan**, not a shipped standalone feature.

## Use FEHM with your coding assistant

Select a skill; installation is never implicit:

```sh
fehm skills list --source superpowers
fehm skills route "Debug a failing authentication test" --budget 2500
fehm agent-context "Debug authentication" --skill debugging/systematic-debugging
fehm skills install debugging/systematic-debugging --platform codex --project --dry-run
fehm skills install debugging/systematic-debugging --platform codex --project
```

Installer platform keys: `claude`, `cursor`, `codex`, `gemini`, `copilot`, `vscode`, and `generic`. These write skill files using the supported directory conventions; the host controls discovery and invocation. They do not install an MCP server or guarantee that an agent follows the instructions.

The optional [Superpowers integration](docs/integrations/superpowers.md) preserves detailed planning, TDD, debugging and verification workflows, packages their supporting resources, and connects them to FEHM's existing evidence tools. Use `--exclude-source superpowers` to exclude that source from a routing/context request, or `--no-skills` with `agent-context` for code-only context.

## Evidence, privacy and limits

- Graph coverage varies by language. TypeScript/JavaScript use the TypeScript compiler; Python, Go, Rust and Java use shallower heuristics. Unresolved and dynamic relationships remain incomplete.
- Context tokens are estimates. FEHM does not incur model tokens for ordinary retrieval; an assistant/model consumes tokens when it reads the output.
- Optional command-based summaries and reranking can use external models. Advisory lookup and other explicitly invoked external tools can contact services. Inspect the configured commands and data boundaries.
- Static security/readiness findings support investigation. They do not certify production readiness or identify whether code was written by AI, a beginner or an engineer.
- Tests exist independently of test results. Guardrails record execution, freshness and policy evidence; they require approval to run project commands. Host execution is not sandbox isolation. Strict TDD evidence currently supports Node TAP assertions.

Read [security and privacy](docs/guides/security.md) and [verification](docs/guides/verification.md) before running repository checks.

## Develop and validate

```sh
npm run check
npm run build
npm test
npm --prefix website run check
```

Some tests bind localhost. No root lint script is configured. The public website is a separate static build in `website/`; the application dashboard is implemented in `src/visualization/`.

[Architecture and feature references](docs/README.md#implementation-references) · [Documentation maintenance](docs/maintenance.md) · [Brand assets](docs/brand.md)

## License

FEHM is MIT licensed. See [LICENSE](LICENSE), [third-party notices](THIRD_PARTY_NOTICES.md), and the licenses/provenance shipped with the skill catalog. Vendored projects retain their own notices; adaptations are not full installations of those projects.
