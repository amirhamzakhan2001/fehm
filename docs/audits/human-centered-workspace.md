# Human-centered workspace audit

This pass covers Architecture Drift, Project Health, Prompt Intelligence and Git Memory. It preserves FEHM's application sidebar, existing analysis engines, source evidence, and earlier uncommitted work.

## Root problems and corrections

| Feature | Root cause | Implemented correction |
|---|---|---|
| Drift | Generic opening, baseline detail before priorities, AI-group findings omitted from the overview shortlist | Evidence-derived assessment; open findings ranked by impact, configured-rule basis and confidence; no category excluded from prioritization. |
| Drift | Users must reconstruct the meaning from expected/observed chains; drawer obscures the map action | Explain meaning, impact, evidence basis and next step first; Show on map closes the drawer while keeping the finding selected and highlighted. |
| Health | Measurements dominate the opening; evidence and technical identifiers have equal prominence with explanation | Explicit coverage/check availability and top open findings first; category metrics and calculation definitions remain expandable; source and technical rule details use disclosure. |
| Health | List capped at 300, open details lost after review, overlapping loads can replace newer results | Incremental show-more access, expanded finding identity restored after review, latest-request guard. |
| Health | Baseline absence described as a fix; lack of static test reach described as no protection | “No longer detected” baseline language; finding heading says “no detected test relationship.” Actual runtime coverage remains separate. |
| Prompts | Counts and scores precede purpose; record IDs dominate; findings do not expose the instruction context | Inventory assessment and priority links, concise previews, uncertainty-aware purpose/input/output explanations, expandable matching source fragments and practical next steps. |
| Prompts | Selected identity lost on reload; poor return path; refresh failure replaces usable inventory | Prompt ID in URL, restored selection, Back to inventory, re-run static analysis, and previous inventory preserved with a stale/error notice. |
| Git | Commit list lacks investigation context; current graph links/comparisons appear as JSON | Window assessment, readable change summaries, explicitly labeled author intent, current graph links, readable file comparisons, technical evidence on demand, Back to commit. |
| Git | Async detail responses mutate whichever selection is currently visible | Selection tokens prevent late diffs, snapshots, file histories, blame and comparisons from replacing another selection; buttons show pending state. |
| Git | File lineage depends on semantic events; root commits lack diff action | File-only history uses Git changed-file records; root diff uses bounded Git show with external diff/textconv disabled. Symbol-specific history still requires symbol evidence. |

Drift and Health now retain old results if refresh fails, with an explicit warning. Prompt refresh failures retain inventory and the selected workspace. No result is marked fixed merely by review. No source is automatically overwritten. No dependencies were added.

## Main files

- `src/visualization/shared/ui/assessment.ts`: pure, evidence-derived presentation helpers.
- `src/visualization/{drift,health,prompts,git-memory}/ui/main.ts`: assessments, disclosure, identity, navigation and failure handling.
- `src/visualization/features.ts`: shared restrained assessment styling and visible focus states.
- `src/git-memory/history.ts`, `git.ts`, and `src/visualization/git-memory/routes.ts`: file-history inclusion and root-commit diff.
- `test/workspace-assessment.test.ts`, `test/git-memory.test.ts`: ranking/uncertainty/history regression coverage.
- `scripts/human-workspace-smoke.mjs`: repeatable browser regression; uses an optional existing Playwright installation and Chrome via documented environment variables, not a new runtime dependency.

## Executed verification

- TypeScript check and production builds passed.
- Full suite: 310 tests passed after the main changes.
- Subsequent root-diff and assessment tests: 10 passed.
- Browser harness passed against a temporary, real Git repository and analyzed sources:
  - 56-prompt inventory pagination/search, exact selected identity across reload, candidate generation/edit/save, and retained inventory on simulated refresh failure.
  - Drift explanation, inline source, selected map navigation, decision persisted to the fixture repository.
  - Health inline source, persisted review and restored expanded finding, actual harmless fixture test-command execution and displayed stdout.
  - Git actual diff, root-commit diff, file lineage/back navigation, current graph inspection and revision comparison.
  - Deliberately delayed diff response did not overwrite the newly selected commit.
  - All four pages rendered at 390px and produced no JavaScript page errors; this is a responsive smoke check, not a full accessibility audit.
- Screenshots inspected: `/tmp/fehm-human-health.png`, `/tmp/fehm-human-git.png`.
- Initial browser attempt failed on an incorrect test selector (textbox versus searchbox); corrected and rerun successfully.
- Changed source/test/script files pass `git diff --check`. The pre-existing `.gitignore` blank-line change was not edited.

## Limits that remain

This is a targeted correction of observed problems, not a claim that every requested capability is complete.

- Prompt discovery is bounded static analysis: runtime-only prompts and unsupported languages/formats can remain unknown. Purpose explanations are explicitly inferred, not verified model behavior.
- The browser evaluates recorded outputs; live model evaluation remains a library integration. It does not yet offer durable evaluation-run history, optimization-status filtering across the complete inventory, or an approved automatic source-apply workflow. Saved proposals and manual patch review remain available.
- A missing-instruction finding has no exact source span; the UI exposes relevant instruction fragments rather than fabricating a precise highlight.
- Git has no invented milestone/reason summaries or editable team-decision memory. Categories are detection hints; commit messages are attributed statements. Current graph references are not historical impact.
- Merge-commit diff uses Git's default show semantics; it is not a per-parent merge conflict explorer. History is bounded to the selected window and unavailable objects remain unavailable.
- Long histories and inventories use existing bounded analysis and partial disclosure, not a new virtualized renderer. No large-repository performance benchmark or comprehensive screen-reader audit was performed.
- Prompt and health static heuristics still need broader independently labeled fixtures before stronger completeness or quality claims are justified.
