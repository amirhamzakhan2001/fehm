# FEHM 1.0.0 release status

FEHM 1.0.0 is the first release and is available on PyPI. The public website is deployed. npm publication and the GitHub release remain pending. Install FEHM with `uv tool install fehm`; see the [installation guide](guides/installation.md).

## Recorded validation

The 1.0.0 qualification run on macOS ARM64 with Python 3.11 passed:

- TypeScript checks and 376 core tests.
- Seven website checks, with 33 generated pages.
- Mobile and desktop browser checks on 13 installation/integration routes.
- Wheel and sdist construction, runtime integrity and packaged dependency notices checks.
- Isolated wheel installation: CLI, optional MCP, localhost dashboard, missing-asset handling, reinstall and uninstall preservation.
- Isolated npm package installation: CLI and MCP.

The wheel runs with private Node 24.19.0 and does not require system Node/npm. The archive contains portable Python/JavaScript; that alone does not certify every operating system. Exact artifact hashes are generated in python-dist/SHA256SUMS. Validation applies to the artifacts tested; rebuild after changing packaged files.

## Compatibility boundaries

Only macOS ARM64 with Python 3.11 has installed-artifact acceptance evidence. Additional platforms and interpreter versions need qualification. Claude Code connected and Codex accepted configuration during development testing; full authenticated assistant sessions were not tested. See the [complete matrix](REAL_TESTING.md).

Same-version reinstall preserved project state and skills. Public-registry upgrades and migration from private development builds remain untested.

## Before public publication

- Confirm npm package-name ownership and configure npm authentication or trusted publishing if an npm release is desired.
- Review source, artifact contents, licenses and checksums for the release commit.
- Run platform and client acceptance tests for every additional support claim.
- Review the Karpathy skill snapshot's missing standalone license text; its MIT declaration is retained, but no missing upstream license was invented.
- Verify the live website routes, version, canonical URLs and hosting behavior after each deployment.

See [maintainer release instructions](DEPLOYMENT.md). Source publication, package publication and website deployment are separate operations.
