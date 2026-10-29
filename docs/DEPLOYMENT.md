# Release maintenance

This guide is for FEHM maintainers. End users should follow [installation](guides/installation.md). The first release is **1.0.0**; see [release status](RELEASE_STATUS.md) and [compatibility evidence](REAL_TESTING.md).

## Build and qualify

CI targets Node 24 and Python 3.11. Install uv, then run:

```sh
npm ci
npm run release:check
```

The command runs typechecking, core and website tests, a clean runtime build, Python packaging, dependency-notice checks, isolated wheel/npm installation checks and artifact integrity checks. Dependency downloads and localhost listeners are required. Outputs are written to python-dist/.

The wheel bundles precompiled JavaScript and production npm dependencies from the lockfile. Lifecycle scripts are disabled during bundling. A pinned Python dependency provides private Node 24.19.0. The sdist contains the prepared runtime, so installation requires no npm build. The build hook checks runtime hashes and version agreement.

The universal wheel tag describes portable package contents; supported-platform claims require successful installed-artifact tests. The qualification workflow in .github/workflows/release.yml prepares Linux, macOS and Windows artifacts but does not publish them.

## Version and artifact review

Keep root package.json/package-lock.json, pyproject.toml, website/package.json and wheel examples synchronized. Upstream dependency versions and source revisions are independent of FEHM's version.

Before publishing, select an immutable release commit and review:

- Qualification results for each advertised platform.
- Wheel, sdist, npm package contents and generated checksums.
- Third-party notices, retained licenses and provenance limitations.
- Release notes, current installation commands and client compatibility claims.

Do not mix older development artifacts into the release. Changes to packaged files require rebuilt artifacts and relevant installed-package checks.

## Registry publication

Confirm ownership of the intended package names. Configure trusted publishing or protected maintainer credentials; never commit credentials. A package-name lookup or successful local build does not establish ownership or public availability.

After maintainer approval of the exact artifacts, publish only the reviewed files:

```sh
uv publish python-dist/fehm-1.0.0-py3-none-any.whl python-dist/fehm-1.0.0.tar.gz
# If distributing through npm, publish the reviewed tarball:
npm publish /absolute/path/to/fehm-1.0.0.tgz
```

Verify registry metadata and installation in a fresh environment. The primary user instructions now use `uv tool install fehm`; keep them aligned with future verified upgrades. Attach the reviewed artifacts, checksums and support matrix to the corresponding GitHub release.

## Website deployment

The website reads shared guides and integration fixtures from the repository. Keep the hosting build root at the repository root:

```sh
npm --prefix website run build
```

Publish website/dist/. Configure SITE_URL for the actual production origin and SITE_INDEXABLE=true for production; previews should remain non-indexable. See [website hosting](website.md) for Cloudflare configuration, optional analytics and security headers.

After deployment, verify version 1.0.0, integration and guide routes, copied commands, mobile layout, canonical URLs and HTTP 404 behavior. A local website build does not update the deployed site.
