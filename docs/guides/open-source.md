# Open-source foundations

FEHM 1.0.0 builds on selected open-source code, rules and workflows. Each source retains its license. An acknowledgment does not mean the full upstream product is included or endorses FEHM.

## Code and analysis

AgentMemory contributes retrieval, stemming, synonyms and feedback ideas through attributed adaptations. Codebase Memory MCP contributes identifier splitting; Graft contributes file-first context selection; Skylos contributes selected static rule definitions; ECC contributes relevance scoring. FEHM integrates these adaptations into its own TypeScript engine.

Exact revisions, scope and retained license locations are maintained in [third-party notices](../../THIRD_PARTY_NOTICES.md). Full engine license texts are packaged in third_party/licenses/.

## Workflow instructions

The catalog includes Superpowers, Caveman's MIT-licensed skills, Ponytail, Matt Pocock's skills, ECC, Agency Agents, gstack and Karpathy skills. Source metadata, file hashes and import decisions live in skills/manifest.json and skills/source-map.json; retained texts are in skills/licenses/. The Karpathy snapshot lacks a standalone license file; its MIT frontmatter declaration is preserved, and this provenance limitation remains documented.

Five Superpowers workflows include supporting resources and FEHM evidence guidance. Their snapshot reports version 7.0.1; this is an upstream version, independent of FEHM 1.0.0. See [Superpowers workflows](superpowers.md).

Imported instructions remain subordinate to user and project instructions. They grant no execution permissions. The catalog does not automatically install upstream hooks, servers or plugins.

## Research references

Archify informed architecture-document research, and Open Code Review was explored during earlier development. Their runtimes are not shipped in FEHM 1.0.0. Downloaded source folders are not a package inventory.

## Assets and dependencies

Devicon technology icons retain MIT attribution. Website fonts retain their original license files. Packaged JavaScript dependencies include their own licenses; private Node is supplied through a separate pinned Python dependency. The website stays in this repository and is excluded from CLI distributions.

## Redistribution

FEHM's MIT license covers FEHM's own work. Preserve third-party notices, applicable license texts and source attribution alongside redistributed material.
