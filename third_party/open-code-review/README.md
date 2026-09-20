# Open Code Review vendored source and engine

Unmodified upstream source archive: v1.12.7, commit 85cecfe5f935da2b2aae8f91ce4fee8ed343a681. SHA-256 and platform binary digests are pinned in manifest.json. The source archive retains upstream license headers and notices. No upstream source modifications. Fehm integration code lives in src/.

Run `npm run vendor:review` to fetch and verify only the host platform engine. Binary downloads occur during developer packaging, never during user review. Generated bin/ is ignored by Git. LICENSE and VIEWER_NOTICE accompany distributions.

The licenses/ directory retains legal notices from all 85 modules in the pinned go.mod dependency download, plus Go and the embedded Ant Design icon license. index.json records module versions and Go module sums. Regenerate and audit this inventory from the same pinned source when updating the engine.
