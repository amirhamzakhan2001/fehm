# Fehm distribution and assistant integration plan

Research date: 2026-10-29. This is a proposed release plan, not a claim that its new commands or integrations already exist.

## Recommendation

Keep `website/` in this repository. Publish the Node CLI and static website separately. First ship an installable CLI with a small Fehm-specific skill and explicit assistant setup; add a local MCP interface for direct graph tools next; distribute native plugins/extensions after those interfaces are tested.

There is no need to move the website to make code graphs or review changes. Fehm scans the selected repository root, not its own installation directory. When Fehm scans itself, website source is part of that repository. Its scanner honors root `.gitignore` and `.fehmignore`; add `/website/` to this repository's `.fehmignore` only if a core-only self-analysis is desired. Do not make that a universal exclusion for other users' projects. Build directories such as `dist` are already excluded.

The npm `files` allowlist includes `dist`, `skills`, `assets/ontology`, and notices; it does not include `website`. The website reads root `package.json` and `docs/guides/*.md`. Moving it would require a new source-sharing/versioning arrangement. Keep the repository root as the hosting build root, build with `npm --prefix website run build`, and publish `website/dist`.

## Current evidence

- `package.json`: Node/npm package named `fehm`, version `0.1.0`; executable `dist/cli.js`; build/typecheck/test scripts. No `prepack` or publication workflow is configured.
- `src/integrations.ts`: selected catalog skills can be installed, inspected and removed for seven platform keys. Managed hashes, declared resources, dry runs and customized-file protection already exist.
- `src/cli.ts`: `skills install` needs skill IDs or a task. No top-level assistant onboarding command, installation doctor, or MCP server command is exposed.
- `README.md` and `docs/guides/installation.md`: source-checkout instructions; native MCP is explicitly absent. The old Python/MCP setup is not applicable to this implementation.
- Registry lookup `npm view fehm name version repository.url dist-tags --json` returned E404. This establishes no publicly readable package at lookup time; it does not guarantee ownership or name availability for publication.
- `npm pack --dry-run --ignore-scripts --json` succeeded: 2,826 files, 9,288,790 packed bytes, 30,829,098 unpacked bytes, and zero `website/` files. The CLI is present. This dry run verifies package selection, not a fresh build or clean install; it is not publication.
- No `.github` directory was present during this review. README, website, guides and other changes are currently untracked or modified and must be included deliberately in a release commit.
- The README tab path under Downloads was unavailable; this review used the current repository README and integration implementation.
- This research is not a fresh full release qualification or a live assistant compatibility test.

## What the comparison projects demonstrate

[Graphify](https://github.com/Graphify-Labs/graphify) distributes graph workflows to coding assistants. [code-review-graph's installation guide](https://github.com/tirth8205/code-review-graph/blob/staging/docs/USAGE.md) describes an installer that configures MCP, skills and platform instructions. Their useful lesson is the installation experience: runtime, assistant instructions and tool access are distinct parts. Their approach does not imply that Fehm needs a separate website repository, a Python rewrite, or identical hooks.

## Supported assistants and proposed distribution

The paths below match Fehm's current installer and the official documentation reviewed. These refer to coding-agent environments, not universal support for consumer chat interfaces.

| Platform key | Project skill directory | Personal skill directory | Proposed native distribution |
| --- | --- | --- | --- |
| `claude` | `.claude/skills` | `~/.claude/skills` | Claude Code plugin with selected skills, optionally MCP |
| `codex` | `.agents/skills` | `~/.agents/skills` | Codex-compatible plugin with selected skills, optionally MCP |
| `gemini` | `.gemini/skills` | `~/.gemini/skills` | Gemini CLI extension; direct skill install is also available |
| `cursor` | `.cursor/skills` | `~/.cursor/skills` | Skills first; separately configured local MCP |
| `copilot` | `.github/skills` | `~/.copilot/skills` | Copilot CLI skills and client-specific MCP setup |
| `vscode` | `.github/skills` | `~/.copilot/skills` | VS Code Copilot skills and client-specific MCP setup |
| `generic` | `.agents/skills` | `~/.agents/skills` | Portable skill export; verify each host's discovery support |

Sources: [Claude skills](https://code.claude.com/docs/en/skills), [Claude plugins](https://code.claude.com/docs/en/plugins), [Codex skills](https://learn.chatgpt.com/docs/build-skills), [OpenAI plugin packaging](https://developers.openai.com/plugins/build/plugins), [Gemini skills](https://geminicli.com/docs/cli/skills/), [Gemini extensions](https://geminicli.com/docs/extensions/), [Cursor skills](https://cursor.com/docs/skills), [Copilot skills](https://docs.github.com/en/copilot/concepts/customizations/agent-skills), [VS Code skills](https://code.visualstudio.com/docs/agent-customization/agent-skills).

## Phase 1: installable CLI and Fehm skill

1. Choose the public npm name and confirm publisher ownership. Use a scoped name if necessary while retaining the `fehm` executable. Align the documented and declared Node minimum: 22.13+ for the full feature set, unless the older-runtime limitation is intentionally retained and tested.
2. Make packed artifacts reproducible. Build before packing, preferably with `prepack`; ensure CLI executability and all dashboard, ontology, skill and license resources survive packaging. Test the generated tarball installed into an empty directory with real dependency resolution, without borrowed checkout dependencies.
3. Author one compact Fehm-owned entry skill, with on-demand references for exploration, review and investigation. It should guide the host to existing `search`, `context`, `relationships`, `architecture`, `guardrails` and `debug` commands. Preserve unresolved evidence, token limits and execution approvals. Keep the broad bundled catalog optional rather than installing all of it.
4. Add an onboarding command using the existing installer rather than a second lifecycle implementation. Proposed interface: `fehm setup --platform codex --project`, with explicit user/project scopes, `--dry-run`, status, update and removal. Explain destinations before writes; preserve customized files and unrelated configuration. Ensure frontmatter names and invocation instructions match what each host actually loads.
5. Add an installation doctor that checks runtime, executable resolution, skill/resource presence and selected root. Do not claim that a file existing proves the assistant activated it. Resolve project roots at invocation time for personal skills; never embed this developer's checkout path.
6. Validate resource links and frontmatter in the installed bundle. Existing catalog content is not automatically a portable install bundle: undeclared relative references must be removed, rewritten or explicitly packaged for the release entry skill.

Target experience, **only after implementation and npm publication**:

```sh
npm install -g fehm
cd /path/to/project
fehm setup --platform claude --project
# Or: codex, gemini, cursor, copilot, vscode, generic
fehm doctor
```

`setup` and `doctor` above are proposals, not current commands. Users can already build from source and run `fehm skills install <existing-skill-id> --platform <key> --project`.

Acceptance: clean-install startup outside Fehm's checkout; graph and dashboard work on a fixture repository; installation/status/update/removal works in isolated homes; custom files survive; paths with spaces work; a real session in each claimed assistant discovers and uses the skill against the intended project.

## Phase 2: direct graph access over MCP

Add a local stdio MCP server around existing TypeScript APIs, not a replacement engine. Keep dashboard `serve` separate; proposed command: `fehm mcp --root /absolute/project`.

Start with a small query surface: status/index freshness, search, bounded context, symbol relationships, architecture, and existing change-analysis/investigation results. Tool names, schemas and budgets should be stable and versioned. Be explicit about index/cache writes even when queries do not modify source. Keep protocol output on stdout and diagnostics on stderr.

Bind a server to an explicit repository root. Validate paths and output limits; honor ignore rules; surface stale/partial results. Exclude arbitrary shell execution and mutation from the initial tool set. If approved check execution is later exposed, preserve the existing guardrail approval model.

Implement MCP registration through per-client adapters or their supported setup commands. Do not assume Claude, Codex, Gemini, Cursor, Copilot CLI and VS Code share a configuration format. Merge only Fehm-owned entries and preserve unrelated servers, comments where supported, and custom changes. Test an actual initialize/list-tools/call-tool round trip and a real host session.

MCP is optional for a CLI-plus-skill launch. It is required before advertising Fehm as a native MCP graph-tool integration comparable to the MCP workflow of code-review-graph.

## Phase 3: native plugin and extension distribution

Generate thin platform bundles from the same maintained Fehm skill sources:

- Claude Code: `.claude-plugin/plugin.json`, skills, and optional MCP configuration; distribute through a marketplace or documented local plugin path.
- Codex: use its supported plugin scaffolding and compatibility manifest, with skill folders and optional MCP configuration. Validate actual install/discovery through the supported plugin workflow.
- Gemini CLI: an extension manifest and skill bundle, optionally MCP; provide a valid extension repository/release artifact accepted by Gemini's installer.
- Keep the existing directory installer for Cursor, Copilot and generic clients until native bundles are separately tested.

Test plugin-root/subdirectory rules for each host. A monorepo containing manifests somewhere inside it is not automatically a valid one-command plugin URL. Produce dedicated release artifacts or a distribution repository where required. This concern is separate from the location of `website/`.

Avoid enabling hooks by default for the first release. Add automatic refresh or workflow hooks only as a later explicit option, with measured cost, freshness behavior and host-specific tests. Plugin marketplace listing is separate from publishing source code or an npm package.

## Release gates and publication order

1. Review the working tree, include all intended untracked docs/site/resources, and create a reproducible release commit. Do not silently include unrelated changes.
2. Run root typecheck/build/full tests and website checks on that commit. Add CI for these checks plus a tarball-install smoke test. Qualify supported Node versions and OSes; otherwise label the narrower tested support accurately.
3. Inspect the tarball for required runtime data and notices, and for excluded website/build caches/local state. Audit bundled resource licensing and any packed executable resources. Test with no source-checkout fallback.
4. Test the entry skill in real assistant sessions. Record assistant versions, discovery, correct project selection, tool invocation, evidence output and upgrade/removal. Filesystem tests alone are not behavioral validation.
5. Push the source repository and publish a tagged GitHub release. A source release may precede registry/plugin distribution if instructions remain source-based.
6. Publish npm under the confirmed account/name, then test the registry-installed package from a clean environment. Set up [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/) for supported CI publication and provenance, following npm's account/package setup requirements.
7. Update README and website installation examples only after the public commands work. Distinguish CLI installed, skill installed, MCP connected and native plugin installed.
8. Deploy the website from the same repository with the production canonical origin and output directory. Verify production links, 404 responses, assets and mobile rendering. The recent background animation has automated build coverage but still needs current visual browser QA.

Recommended first public milestone: published CLI + one Fehm-specific skill + explicit setup + honest compatibility evidence. Follow with MCP and platform-native bundles. Uploading the current source is possible without pretending all three distribution layers are complete.
