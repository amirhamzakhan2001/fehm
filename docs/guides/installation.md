# Installation

Use Node.js 22.13 or newer for all features. The package declares Node 20+ for core commands, but the concept catalog uses built-in SQLite and requires 22.13+. Git workflows need Git. Project tests require their own toolchains.

## Build from source

```sh
git clone https://github.com/amirhamzakhan2001/fehm.git
cd fehm
npm ci
npm run build
node dist/cli.js help
npm link
```

The optional npm link step exposes the fehm command. Without it, run node /absolute/path/to/fehm/dist/cli.js with --root /absolute/path/to/project. Dependency installation may access the npm registry; ordinary repository retrieval does not.

## Open a repository

```sh
cd /absolute/path/to/project
fehm scan .
fehm serve --port 4317
```

Visit http://127.0.0.1:4317. Stop the server with Ctrl+C. State is stored in .fehm/ by default. Use --root when your current directory is not the project root.

## Upgrade deliberately

Review upstream changes, update your checkout, run npm ci and npm run build, and rerun the checks. Reinstall selected assistant skills only when you want to update their copies. Customized installed files are protected.

## Packaging boundary

These instructions rely on this source checkout, not an assumed published registry release. package.json is the source of truth for the source version. Former uv wheel instructions do not apply. No Python runtime is required by this implementation.
