# Setup and deployment: developer first, user second

Fehm is a local CLI with an optional browser cockpit. The primary end-user distribution is a Python wheel installed with **uv**. The wheel contains the compiled TypeScript engine, compiler dependency, cockpit, and assistant skill. A pinned `nodejs-wheel-binaries` dependency supplies its private Node runtime. Users do not need a separate Node or npm installation to run Fehm.

Developers still use npm to build and test the TypeScript engine. There is no Python rewrite and no npm install on first launch. Git and the target project's own toolchain remain necessary for Git operations and commands that build/test that project.

**Publication status:** these instructions do not imply a public release exists. PyPI returned 404 for `fehm` on 20 September 2026; this does not reserve the name. Until the owner publishes it, use the locally built wheel or a reviewed wheel supplied by the developer. The initial website is implemented in `website/` with a separate static build; the website uses Cloudflare Pages at `https://fehm.pages.dev`. See [website setup](../website/README.md).

## Part 1 — Developer: build, test, and publish

### Step 1 — Install developer prerequisites

Install Node.js 24, npm, Git, Python 3.10+, and [uv](https://docs.astral.sh/uv/getting-started/installation/). Docker is optional.

```bash
node --version
npm --version
python3 --version
uv --version
git --version
```

The Python launcher supports Python 3.10+. Binary availability follows the pinned runtime dependency: macOS 13.5+ Intel/Apple Silicon, Linux x64/ARM64 with supported glibc or musl, and Windows x64/ARM64. A release should pass the CI wheel smoke test on its advertised platforms. There is no fallback that compiles Node from source during a normal user install.

### Step 2 — Get the source and dependencies

```bash
git clone https://github.com/amirhamzakhan2001/fehm.git
cd fehm
npm ci
```

All following developer commands run from this checkout. `npm ci` uses the committed lockfile.

### Step 3 — Set the release identity

Review `package.json`, `package-lock.json`, and `pyproject.toml`. Keep their version synchronized (currently `1.4.0`). Confirm ownership/availability of the intended **PyPI** project before release. Python package names are separate from npm names; change the Python distribution name and install instructions if needed. The terminal command can remain `fehm`.

The Node runtime version is pinned in `pyproject.toml`. Review upstream releases/security updates deliberately and rerun the wheel tests before changing it. `nodejs-wheel-binaries` is an unofficial Node distribution, not maintained by Fehm or the Node.js team. See its [package documentation](https://pypi.org/project/nodejs-wheel-binaries/).

### Step 4 — Verify the engine

```bash
npm run release:check
npm audit --omit=dev
```

Expected: type checks, tests, production build, authenticated API smoke, localhost/watch smoke, and npm package inspection pass. Review dependency findings. An `EPERM` on a localhost listener means the test environment disallows listening; run the smoke tests where loopback ports are permitted.

### Step 5 — Build the uv release artifacts

```bash
npm run build:python
```

This compiles the engine, stages its production files under `build/fehm-runtime`, and runs `uv build --out-dir python-dist`. Expected artifacts for the current version:

- `python-dist/fehm-1.4.0-py3-none-PLATFORM.whl`
- `python-dist/fehm-1.4.0.tar.gz`

The source archive contains the prepared engine, so rebuilding its wheel needs no npm. Running `uv build` on an unprepared checkout fails with an explanation. Rerun `npm run build:python` after source, skill, public asset, documentation, or version changes. The npm lockfile supplies the bundled TypeScript version. Its license/notices are included; Node's dependency wheel supplies its own notices.

### Step 6 — Test the actual installed wheel

```bash
python3 scripts/python-smoke.py python-dist/fehm-1.4.0-py3-none-PLATFORM.whl
```

This uses temporary uv tool directories and a disposable repository. It installs the wheel, removes system Node/npm from Fehm's PATH, and checks scan, query, practice audit, each assistant registration, MCP, cockpit assets, shutdown, and nonzero failure exit codes. It does not modify your personal assistant configuration.

For manual testing, install the reviewed wheel and inspect registration before applying it:

```bash
uv tool install ./python-dist/fehm-1.4.0-py3-none-PLATFORM.whl
uv tool update-shell
fehm --version
fehm install --platform claude --project --dry-run
```

Open a new terminal if needed. Run the user's workflow below in a sample repository. CI includes wheel installation checks on Linux, macOS, and Windows; local execution on one OS does not prove the others have passed.

### Step 7 — Publish the tested artifacts when ready

Create/confirm your PyPI project and publishing credentials. Use a PyPI token or configure [trusted publishing](https://docs.pypi.org/trusted-publishers/). Keep credentials out of source files and shell history.

```bash
uv publish python-dist/fehm-1.4.0-py3-none-PLATFORM.whl python-dist/fehm-1.4.0.tar.gz
```

Run this only for the exact reviewed name/version and after release checks pass. Supply credentials through your secure environment or trusted publishing setup. See [uv's publishing guide](https://docs.astral.sh/uv/guides/package/). Do not publish every stale artifact in the directory. This repository's CI tests packages; it does not automatically publish them. No publication is performed by writing this guide.

### Step 8 — Verify the public user journey

On a clean environment after publication:

```bash
uv tool install fehm==1.4.0
fehm --version
fehm --help
```

Repeat the scan, registration, and cockpit steps from Part 2. Announce the exact release name/version, supported platforms, and known limitations. Before publication, distribute the reviewed wheel and installation command from Step 6 instead.

npm remains available for TypeScript contributors/library consumers. It is not an additional user installation requirement for the uv release. Avoid installing both distributions into the same command PATH; an older `fehm` command can shadow the newer one.

### Optional Step 9 — Run a private container deployment

Use this when you want Fehm to stay running on your own machine or a controlled server. It is not required for normal user installation. Start Docker and return to the Fehm checkout.

**9.1 Build the image:**

```bash
docker build -t fehm:local .
```

**9.2 Select the repository and prepare writable state:**

```bash
FEHM_PROJECT=/absolute/path/to/project
mkdir -p "$FEHM_PROJECT/.fehm"
export FEHM_AUTH_TOKEN="$(openssl rand -hex 32)"
```

Run these commands as the non-root account owning the project. The examples map its numeric user/group into the container so the `.fehm` mount is writable. Check the platform's bind-mount permissions if your host uses a different ownership arrangement. Keep the token in a secure runtime configuration for repeat deployments; do not commit it.

**9.3 Build the graph inside the container:**

```bash
docker run --rm --read-only --tmpfs /tmp \
  --user "$(id -u):$(id -g)" \
  -v "$FEHM_PROJECT:/workspace:ro" \
  -v "$FEHM_PROJECT/.fehm:/workspace/.fehm:rw" \
  fehm:local node dist/cli.js scan /workspace
```

This step is required because the graph stores an absolute repository path. A host graph pointing to `/Users/...` will not work when the container sees `/workspace`. This replaces the source graph/cache in the mounted state directory; stop any host watcher first. To switch back to host operation later, rescan from the host path.

**9.4 Start the container:**

```bash
docker run -d --name fehm-cockpit --restart unless-stopped \
  --read-only --tmpfs /tmp \
  --user "$(id -u):$(id -g)" \
  -p 127.0.0.1:7331:7331 \
  -e FEHM_AUTH_TOKEN \
  -v "$FEHM_PROJECT:/workspace:ro" \
  -v "$FEHM_PROJECT/.fehm:/workspace/.fehm:rw" \
  fehm:local node dist/cli.js serve /workspace/.fehm/graph.json --watch
```

The image listens on `0.0.0.0` inside the container, so it requires the token. The host port mapping keeps access on the host's loopback interface. See [Docker's runtime and user options](https://docs.docker.com/engine/containers/run/) for platform details.

**9.5 Verify operation:**

```bash
docker logs fehm-cockpit
curl --fail http://127.0.0.1:7331/api/live
curl --fail http://127.0.0.1:7331/api/ready
```

Open `http://127.0.0.1:7331` and enter the configured token when prompted. Liveness should report `ok`; readiness should report `ready`. Use `docker stop fehm-cockpit` to stop it and `docker start fehm-cockpit` to start the same container again.

For a server deployment, keep the loopback binding and connect from your laptop through SSH:

```bash
ssh -N -L 7441:127.0.0.1:7331 your-user@your-server
```

Then open `http://127.0.0.1:7441` on your laptop. If you need a shared HTTPS URL instead, configure a trusted TLS reverse proxy, network restrictions, and the bearer token. All projects in one server share that token; they are not isolated tenants. Publishing a container image to a registry is a separate optional distribution action, not necessary to run this locally built image.

## Part 2 — User: install and use Fehm

### Step 1 — Install uv

Follow the [official uv installation instructions](https://docs.astral.sh/uv/getting-started/installation/) for your OS, then check:

```bash
uv --version
```

uv can manage the Python interpreter it needs. You do not need to install npm or Node separately for Fehm. Internet access is needed to download Fehm, its runtime dependency, and Python if missing. The runtime download is substantial; uv provides isolated installation, not a smaller engine.

### Step 2 — Install Fehm

After an official PyPI release exists:

```bash
uv tool install fehm
uv tool update-shell
fehm --version
```

Open a new terminal after updating PATH. Before publication, or for a developer-supplied release, use its wheel instead:

```bash
uv tool install /absolute/path/to/fehm-1.4.0-py3-none-PLATFORM.whl
```

Download wheels only from the project's verified release channel. A local Fehm wheel can still require network access for its runtime dependency. Installation does not start a server or upload source code.

### Step 3 — Register your coding assistant

Choose the assistant you use:

```bash
fehm install --platform claude
# Alternatives: cursor, codex, gemini, copilot, vscode, generic
```

The default is a personal skill. For one repository only, change to its root and add `--project`:

```bash
cd /absolute/path/to/your/project
fehm install --project --platform codex
fehm integrations --project --platform codex
```

The command prints the exact file and scope. Reload your assistant. See [INTEGRATIONS.md](INTEGRATIONS.md) for every client, invocation, paths, MCP setup, and removal. Registration installs a skill; it does not install the assistant or silently change its hooks/permissions. In SSH, containers, or cloud workers, install Fehm in the environment where the assistant executes commands.

### Step 4 — Build the repository graph

From your project root:

```bash
fehm scan .
fehm stats
```

Expected: `.fehm/graph.json` and supporting local state. Alternatively ask your assistant to use the Fehm skill to map the current repository (`$fehm` in Codex; `/fehm` where the client supports skill slash commands). Fehm extracts code locally. Rescan after source changes, or use watch mode below.

### Step 5 — Ask with evidence

```bash
fehm query "authentication flow"
fehm practices audit
```

The terminal query returns a context packet. Ask the assistant: **Use Fehm to explain the authentication flow. Cite source files and distinguish explicit relationships from inferred ones.** The assistant supplies the explanation; the CLI does not call a model for this query.

Practice findings begin as advisory. An audit exit code 2 means an approved required gap or a saved-baseline regression needs review. Follow [ENGINEERING_PRACTICES.md](ENGINEERING_PRACTICES.md) before approving policy/baselines.

### Step 6 — Open the localhost cockpit

```bash
fehm serve .fehm/graph.json --watch
```

Open **http://127.0.0.1:7331**. Stop with Ctrl+C. If the port is in use, add `--port 7441` and open that port. Readiness is available at `/api/ready`. Multiple repositories can be served by passing their graph paths to one command. Keep one writer per repository state directory.

### Step 7 — Upgrade and refresh registration

For a registry installation:

```bash
uv tool upgrade fehm
fehm install --platform claude
```

Use the original platform and add `--project` if that was the installation scope. For a local wheel install, install the new reviewed wheel with `uv tool install --force /path/to/new.whl`. Stop watchers/services before upgrading; preserve `.fehm` policies and durable history, then rescan the project and restart. Rescan after moving a repository because graphs contain absolute source paths.

### Step 8 — Remove registration or uninstall

```bash
fehm uninstall --platform claude
uv tool uninstall fehm
```

Remove each desired integration before uninstalling the CLI. Use `--project` for project registrations. This preserves graph data and other assistant configuration. Customized skills are protected; `--force` makes a backup before replacing/removing one. To inspect without writing, add `--dry-run`.

## Troubleshooting

| Symptom | Action |
| --- | --- |
| `fehm: command not found` | Run `uv tool update-shell`, open a new terminal, and check `uv tool list`. GUI assistants may need a restart to inherit PATH. |
| Package not found | Public publishing may not have happened; use a developer-built wheel and confirm the actual distribution name. |
| No compatible runtime wheel | Check your OS/architecture against the pinned runtime's supported platforms. Use a supported environment; do not assume a 32-bit machine works. |
| Skill missing | Check `fehm integrations --platform <name>` with the right scope, reload the assistant, and confirm skills are enabled. |
| Customized skill conflict | Preserve your edits or review the backup-producing `--force` operation. Symlinked destinations are refused. |
| Missing graph or moved source root | Run `fehm scan .` from the intended repository. |
| Localhost does not start | Check port conflicts, listener restrictions, and the supplied graph/source path. |
| API 401 | Supply the configured bearer token. |
| Remote bind refused | Set a token of at least 32 characters; prefer loopback with SSH/TLS. |
| Stale command/version | Check `command -v fehm` (PowerShell: `Get-Command fehm`) for an older npm or uv installation. |
| Verification cannot run npm/pytest/etc. | Install the analyzed project's toolchain. Fehm's private runtime does not provision project dependencies. |

### Configuration

| Setting | Default | Purpose |
| --- | --- | --- |
| `--host` / `FEHM_HOST` | `127.0.0.1` | Listening interface |
| `--port` / `PORT` | `7331` | TCP port; 0 selects an available port |
| `FEHM_AUTH_TOKEN` / `--token-env NAME` | Unset | Bearer authentication |
| `--watch` | Off | Serialized polling refresh |
| `--interval` | 1500 ms | Requested refresh interval; minimum 250 ms |
| `--allow-unauthenticated` | Off | Explicit remote-authentication bypass; not part of the normal deployment path |

`REPOMIND_HOST` and `REPOMIND_AUTH_TOKEN` remain deprecated compatibility fallbacks. New installations should use `FEHM_*` settings. A custom graph destination can be supplied with `fehm scan <repository> --out <directory>`; serve its `graph.json`. Practice policy and durable intelligence still live under the repository's `.fehm` directory.

### Probes and API access

| Endpoint | Purpose |
| --- | --- |
| `GET /api/live` | Public process liveness |
| `GET /api/ready` | Public graph/source-root readiness; 503 when unavailable |
| `GET /api/projects` | Project inventory |
| `GET /api/overview` | Selected project summary |
| `GET /api/graph` | Progressive graph slice |
| `POST /api/context` | Non-empty query plus optional estimated-token budget |
| `GET /api/practices` | Practices, approved gaps, and drift |
| `GET /api/architecture` | Architecture approval state |
| `GET /api/production-audit` | Readiness evidence |
| `GET /api/onboarding` | Newcomer briefing |

API routes other than probes require bearer authentication when configured. Readiness does not certify engineering policy or model-provider availability. Static assets remain public. Library callers using `createCockpitServer()` must configure their own listen address and access controls; CLI bind safeguards do not govern arbitrary embedding.

### Operational boundaries

The localhost smoke scripts verify authentication, validation, project routing, readiness, watch refresh, bind safeguards, and shutdown. They do not prove visual/browser correctness, native service installation, or safety for untrusted code execution. Verification/mutation/replay commands execute repository code and should run only in an appropriate trusted or isolated environment.

During an incident, restrict access, preserve sanitized request IDs/logs and state, stop execution jobs as needed, rotate exposed credentials, and follow [SECURITY.md](../SECURITY.md). A public multi-tenant service would require separate identity, isolation, worker, quota, retention, and abuse-control systems.

## Bundled review engine wheels

`PLATFORM` in wheel examples is a placeholder: use the actual filename emitted by `uv build`. Wheels are now platform-specific because they include Open Code Review 1.12.7. Build separately on each target platform. `npm run package:python` fetches and verifies the pinned engine. Source distributions contain that same platform engine and reject rebuilding on another platform. The source archive and license inventory live under `third_party/open-code-review`; audit and update pins together before changing upstream versions.
