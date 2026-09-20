# Open Code Review inside Fehm

Fehm's platform-specific uv wheel includes the unmodified [Alibaba Open Code Review](https://github.com/alibaba/open-code-review) 1.12.7 engine. Users do not need a separate Open Code Review or npm installation. Git 2.41 or newer is still required for upstream Git workflows.

## Configure and check the engine

```sh
fehm review engine-version
fehm review configure provider
fehm review configure model
```

Configuration uses Open Code Review's interactive interface and may test provider connectivity. Credentials remain in upstream's configuration. Review its provider, tool and telemetry settings before running it. A source checkout prepares the pinned native engine with `npm run vendor:review`; the existing PATH executable fallback is retained when no bundled binary is present.

## Review with Fehm context

```sh
fehm scan .
fehm impact --base HEAD~1
# Preview only: no engine execution or provider call
fehm review --context "authentication changes" --graph-report
# Explicit execution
fehm review --context "authentication changes" --graph-report --allow-provider
```

`--context` is supported for diff reviews, not full-file scans in this pinned release. It creates Fehm's existing budgeted context packet and passes its rendered text through upstream's `--background-file` option. The private temporary file is removed after success or failure. Open Code Review may retain the supplied context in its own session history. Repository text is untrusted context, not instructions to approve changes.

`--graph-report` validates the upstream JSON comment fields and relative paths, then links each finding to overlapping indexed source locations. It preserves upstream status, coverage/manifest information, warnings and the original report. Model claims remain explicitly unverified; location overlap does not establish accuracy. The graph is not modified and no finding is automatically applied or posted.

Both flags require `.fehm/graph.json` for the selected repository. Rescan after changes: an existing graph can be stale. Without either flag, the previous raw JSON output behavior remains available.

## Other review scopes

```sh
fehm review --allow-provider
fehm review --from main --to my-feature --allow-provider
fehm review --commit abc123 --allow-provider
fehm review --scan --path src --allow-provider
```

Use `--repo /absolute/path/to/project` to select another repository. The default timeout is five minutes; `--timeout` accepts 1,000–1,800,000 milliseconds. Output is limited to 8 MiB per stream. Execution uses no shell. The selected diff/path is not a security boundary: the engine may read additional context or use configured tools. Provider charges can apply. Timeout kills the direct process, not provider-side requests already submitted or necessarily detached tools.

## Packaging and attribution

`third_party/open-code-review/source.tar.gz` retains unmodified upstream source. `manifest.json` pins release 1.12.7, commit `85cecfe5f935da2b2aae8f91ce4fee8ed343a681`, its source hash, and the release binary hashes for six platform/architecture combinations. SHA-256 verification occurs before packaging and before bundled engine execution. Hashes establish correspondence with the pinned upstream release; Fehm does not claim an independent source-to-binary reproducibility audit.

The upstream Apache-2.0 license, viewer notice, Go license, icon license and dependency license inventory accompany the engine. Fehm integration code remains MIT licensed. No upstream source was modified.

Wheels contain only the build host's engine and carry a platform tag. Build on each target platform; do not relabel a wheel or rebuild the bundled source distribution on another platform. Developer packaging downloads the pinned binary; user reviews never download an engine. The source archive is kept in the repository, while the wheel includes provenance, engine and notices.

## Validation boundaries

The macOS ARM64 engine version command and adapter tests have been exercised locally. Linux, Windows and other architecture artifacts are pinned, with CI builds configured, but execution on those platforms still needs confirmation. Live model quality, provider costs and token savings have not been benchmarked in Fehm. Existing deterministic features remain local and unchanged.

## Evidence-focused review profile and freshness

Add `--profile code-review` to a diff review for the adapted Agency Agents checklist. It can be combined with `--context` and requires `--allow-provider` to execute. It does not install assistant instructions or run separate agents.

`--graph-report` now includes `sourceFreshness`, adapted from gstack’s review-binding approach. States are `unchanged`, `changed`, `index-stale`, or `uncaptured`. Hashes cover only files already in Fehm’s index. They do not verify model conclusions, new files or Git reference changes. See [integration provenance](OPEN_SOURCE_INTEGRATIONS.md#selected-source-integrations-september-21-2026).
