# Graft source adaptation

Pinned original source and MIT license are retained here; manifest.json records the commit and source checksum.

Fehm uses `fileFirstRoundRobin` in `src/context-selection.ts`, extracted from Graft’s `src/ask/file-selection.ts`. The unused queue helper is omitted. Context packet recommendations group by source path (pathless nodes use individual groups) before applying the existing node and token limits. Scores and standalone retrieval order are unchanged. Diversity is limited to the retrieved candidate pool; small budgets can still omit files.

This does not install Graft, its hosted services, hooks, telemetry or other graph features.

Fehm preserves the three highest-ranked anchors before rotating the remaining candidates across files, protecting focused context under small budgets. This is a Fehm-specific adaptation; file diversity is not guaranteed when only those anchors fit.
