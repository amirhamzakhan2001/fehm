# Library audit

## Counts and counting rules

- Total source repositories: **4**.
- Total source files inventoried, fully read/hash-checked: **6859**.
- Total source skill/agent/workflow/standard/methodology units discovered: **964**.
- Total final skills: **968**.
- Merged source instruction units: **9**.
- Renamed only: **0** (renaming is included in adaptation).
- Split source units: **1** (Karpathy's four principles).
- Preserved unchanged final skill files: **0** (all receive normalization/provenance/compatibility metadata).
- Adapted source instruction units: **950**.
- Excluded source instruction units: **4**.
- Preserved supporting source files: **395**.
- All-file exclusions, including packaging/tests/locales/generated distribution noise: **5402**.
- Shared gstack protocol sections retained after section-level deduplication: **62**.

An instruction unit is a canonical agent, skill, command, standard, context, or selected reusable methodology document. Supporting files are counted separately. Source units include considered product-only launchers that were explicitly excluded. Final skills also include composed workflows and the shared protocol router; therefore final skill counts do not equal a simple input-minus-duplicates total. “Preserved unchanged” above means entire exported SKILL.md bytes, not retained methodology coverage. Complete source procedures are kept inline or in required references; only documented normalization, link relocation, and shared-protocol extraction are applied.

Counts by source: `{"agency-agents": 300, "andrej-karpathy-skills": 1, "ecc": 592, "gstack": 71}`.

## Validation results

- Manifest entries/frontmatter/provenance/workflow relations checked: **968**.
- Source snapshot files checked against original SHA-256: **6859**; modified: **0**.
- Local Markdown file/anchor references checked: **11836**.
- Broken library file links: **0**.
- Broken heading anchors: **0**.
- Empty directories: **0**.
- Validation errors: **0**.
- Entry-point size warnings: **0**.
- Retention units checked: **1165**; unchanged instruction lines checked: **187393**; missing instruction lines: **0**.
- Exact supporting code/data/figure files checked: **193**; altered copies: **0**.

[content-retention.json](content-retention.json) records the independent line-retention comparison. It excludes deliberately relocated Markdown/path lines, generated comments, factored startup blocks, and expanded template macros; those transformations are covered by source mapping and link validation. It checks original procedure bodies, command variants, principle sections, and supporting Markdown, plus byte equality of copied code/data/figures.

Detailed results: [validation.json](validation.json). Reproduce from the workspace with `python3 library-tools/validate_library.py`. Build tooling is outside the library and never executes source workflows.

## Coverage and exclusions

All canonical Agency specialist definitions (including healthcare, finance, GIS, academic, game-development, spatial-computing, sales, marketing, security, and specialized roles) were considered. ECC canonical skills, agents, commands, rules, contexts, hook contracts, learning and workflow documents were considered. Gstack skill outputs, the template-only Claude Code variant, companion sections, checklists, browser/evidence/memory documentation, and selected reference implementations were considered. Karpathy principles and worked examples are preserved.

Useful methodology from Agency examples/strategy and ECC/gstack documentation supplements the canonical folders. Command wrappers are mapped, not presumed redundant. Distinct command procedures are separate on-demand references. Exact template/output pairs map to one rendered artifact. Locale/harness distributions map to their English counterpart when present, without pretending translations are byte-identical. All file-level decisions are in [source-map.json](source-map.json).

Product-only units excluded:

- `gstack/gstack-upgrade/SKILL.md`: Updates the gstack product; no independent task methodology.
- `ecc/commands/auto-update.md`: Launches ECC product updates; not a reusable development procedure.
- `ecc/commands/setup-pm.md`: Package-manager setup launcher; reusable package-manager guidance remains in language and tooling skills.
- `ecc/skills/configure-ecc/SKILL.md`: ECC product installer/configuration router; installation is outside this knowledge library.

Other exclusions: .git/build/cache/binary data, images used only for repository promotion or screenshots (three inspected security teaching diagrams are retained), tests/fixtures, package-manager artifacts, product implementation trees, CI configurations, and distribution-specific installation machinery. Knowledge-bearing code is retained only where directly supporting a procedure and is labeled a reference implementation.

## Duplicates, conflicts, and composition

[DUPLICATES.md](DUPLICATES.md) records exact/layered consolidations and complementary/specialized variants. Cross-repository workflow composition covers planning, code review, security, QA, research, documentation, minimal-change debugging, refactoring, and release. No source is ranked as universally superior.

Potential conflicts: **11 documented families**, with named variants and composition rules in [COMPATIBILITY.md](COMPATIBILITY.md). Scope, style thresholds, TDD coverage, report-versus-repair, publishing gates, runtime choice, and memory integration remain project-specific choices. No unresolved conflict is silently converted into a universal rule.

## Missing and intentionally external dependencies

- Documents with static runtime/path prerequisite records: **254**.
- Source-only or unresolved original Markdown-link observations: **52** (may include repeated observations; dependencies.json carries exact records).
- Original unresolved-link observations: **7**.
- Existing source-only resource observations: **45**.
- Inline project/runtime/source file-path observations: **1027** (classified in dependencies.json).

Two concrete absent external/source assets remain: the security-guide exploit video and the separate ECC-Tools project. Five QA report links are future generated-output placeholders. The Remotion chart-link typo was repaired to the supplied TSX asset. These do not represent missing normalized skills.

These are separate from broken exported links. Missing source references are displayed as explicit original-path notes and cataloged in [DEPENDENCIES.md](DEPENDENCIES.md), rather than fabricated local targets. Gstack helpers/browser/CSO, ECC hook/native Workflow runtimes, external integrations, project outputs, and credential stores are not bundled or claimed available. Runtime functions and network links were not executed or tested.

## Audit limits

The inventory reads and fingerprints every source file. Structural classification, body retention checks, link checks, overlap grouping, and targeted content review support the export; this is not a claim of formal semantic verification of thousands of instructions or exhaustive code dependency resolution. Embedded project-output paths and command examples may require adaptation in the consuming project. External links are preserved but not network-validated. Agency persona claims are explicitly constrained by the compatibility contract. The Karpathy snapshot declares MIT in skill frontmatter but contains no standalone license text; no license document was invented.
