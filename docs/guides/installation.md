# Installation

FEHM 1.0.0 is the first release, prepared for publication.

FEHM is not yet published on PyPI or npm. Use the verified wheel supplied by the maintainer; do not run a registry installation command until the release is announced. A wheel contains the compiled engine and production JavaScript dependencies. Its pinned nodejs-wheel-binaries dependency supplies private Node 24.19.0. No separate Node/npm installation or FEHM source checkout is needed by users.

## Install a supplied wheel

Install uv using the [official uv installation guide](https://docs.astral.sh/uv/getting-started/installation/). Python 3.10+ is required; uv can provision Python if needed. This release's installed-artifact tests were run on macOS ARM64 with Python 3.11. Linux, Windows, Intel macOS and other Python versions remain unverified; a portable wheel tag is not a tested-platform claim.

```sh
uv tool install /absolute/path/to/fehm-1.0.0-py3-none-any.whl
uv tool update-shell
fehm --version
fehm doctor
```

Open a new terminal if the command is not found. Installation requires network access for Python/build dependencies and the private Node wheel unless cached. Startup does not download dependencies. Git workflows need Git; executing project checks needs the project's own toolchain.

## First project

```sh
cd /path/to/your/project
fehm scan .
fehm context "authentication flow" --budget 4000
fehm serve --port 4317
```

The scan saves .fehm/graph.json and .fehm/index.json. The dashboard is at http://127.0.0.1:4317. Stop it with Ctrl+C. See [quickstart](quickstart.md).

## Upgrade and uninstall

Stop running FEHM servers, install the reviewed replacement wheel, and refresh only the assistant scopes you selected:

```sh
uv tool install --reinstall /absolute/path/to/fehm-1.0.0-py3-none-any.whl
fehm --version
fehm install --platform claude
fehm integrations --platform claude
```

Use the replacement artifact's actual filename. Customized skills are preserved; --force backs up before replacement. A same-version reinstall has been tested; cross-version migrations require release-specific qualification. After a verified registry publication, the normal upgrade command will be uv tool upgrade fehm.

```sh
fehm uninstall --platform claude
uv tool uninstall fehm
```

Add --project to remove a project skill. Uninstalling the CLI leaves project .fehm state, policies, history and separately installed skills intact. MCP settings remain client-owned; remove only the FEHM entry through that client's settings.

## Contributor source setup

Contributors need Node 22.13+, npm and Git. End users installing a wheel do not need these build steps.

```sh
npm ci
npm run build
node dist/cli.js --version
```

Do not mix a globally linked development command and a wheel command without checking fehm doctor for the actual runtime location.
