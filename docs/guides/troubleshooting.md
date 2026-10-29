# Troubleshooting

Start with fehm help and confirm that you are running the built CLI from this checkout.

## Command not found

Run npm run build in FEHM, then npm link if you want a shell command. Alternatively run node /absolute/path/to/fehm/dist/cli.js help. Old query, install, practices and mcp commands are not supported; use the current CLI guide.

## Concepts require a newer Node runtime

Use Node 22.13 or newer for built-in SQLite. Core commands declare Node 20+ support. A Python or SQLite daemon installation is not a substitute.

## Missing or stale source

Check --root, the current working directory, ignored paths and language support. Run fehm scan --force after correcting configuration. Dynamic relationships and unsupported syntax can remain unresolved even in a fresh index.

## Skill does not appear

Inspect fehm skills status ID --platform PLATFORM in the same scope used for installation. Check the reported destination and your assistant's skill-discovery settings. Reload the host when necessary. Customized files are protected; do not force overwrites without reviewing them.

## Verification did not pass

Read the recorded status and output. A setup error can be blocked; missing results are not passes. Stale evidence requires rerunning applicable checks against the current content. Strict TDD support depends on recognizable Node TAP output.

## Port or test environment problems

Choose an unused --port for serve. Website preview defaults to 4321, while the dashboard examples use 4317. Some tests bind localhost and need an environment that permits it. A permission error is not a test assertion failure.
