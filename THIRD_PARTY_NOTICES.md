# Third-party notices

FEHM 1.0.0 is distributed under its own MIT license. Third-party code, rules, instructions, assets and dependencies retain their respective licenses. Attribution does not imply endorsement or installation of an upstream product.

## Adapted engine code and rules

| Upstream project | Recorded source | Use in FEHM | License / retained text |
| --- | --- | --- | --- |
| [AgentMemory](https://github.com/rohitg00/agentmemory) | `bcf4f0d00d1c71e9221287a4778e4122ce2d7574` | Lexical retrieval, stemming, synonyms and feedback/recency signals | Apache-2.0; `third_party/licenses/agentmemory-LICENSE.txt` |
| [Codebase Memory MCP](https://github.com/DeusData/codebase-memory-mcp) | `92abefa3f57a94591a92bcecd6a6f102da373575` | Identifier-word splitting | MIT; `third_party/licenses/codebase-memory-mcp-LICENSE.txt` |
| [ECC](https://github.com/affaan-m/ECC) | `9ac593b55cba44c8b20152a5c7f28d300a67ec7e` | Memory relevance scoring | MIT; `skills/licenses/ecc-LICENSE.txt` |
| [Graft](https://github.com/trailhq/Graft) | `8c05769618d413041ea2c8891f82d566f0461b3c` | File-first context diversification | MIT; `third_party/licenses/Graft-LICENSE.txt` |
| [Skylos](https://github.com/duriantaco/skylos) | Snapshot reporting 4.41.0 | Selected quality/security rule definitions and thresholds | Apache-2.0; `third_party/licenses/skylos-LICENSE.txt` |

Source headers identify adapted routines and changes. Adaptations integrate with FEHM's TypeScript graph and reporting; upstream servers, databases and runtimes are not included by these adaptations. License files were copied verbatim from the supplied source snapshots; their hashes are recorded in `third_party/licenses/provenance.json`. Snapshot license identity is recorded separately from code revision identity.

## Bundled workflow catalog

The catalog contains adapted instructions, not complete upstream plugins, hooks or agent runtimes. `skills/manifest.json` records source metadata; `skills/source-map.json` records file hashes and import decisions. Downloaded catalog snapshots generally lack Git commit metadata; do not treat them as pinned upstream releases.

| Source | Imported material | Retained notices |
| --- | --- | --- |
| [Superpowers](https://github.com/obra/superpowers) | Planning, TDD, debugging and verification workflows | MIT, `skills/licenses/superpowers-LICENSE.txt` |
| [Caveman](https://github.com/JuliusBrussee/caveman) | Selected MIT-licensed skill instructions | `skills/licenses/caveman-LICENSE.txt`; restricted-license runtime components are excluded |
| [Ponytail](https://github.com/DietrichGebert/ponytail) | Engineering simplicity workflows | MIT, `skills/licenses/ponytail-LICENSE.txt` |
| [Matt Pocock's skills](https://github.com/mattpocock/skills) | Engineering skills from the supplied `skills-main` snapshot | MIT, `skills/licenses/matt-pocock-skills-LICENSE.txt` |
| [ECC](https://github.com/affaan-m/ECC) | Skills, agent instructions and commands adapted into catalog entries | MIT, `skills/licenses/ecc-LICENSE.txt` |
| [Agency Agents](https://github.com/msitarzewski/agency-agents) | Specialist agent instructions | MIT, `skills/licenses/agency-agents-LICENSE.txt` |
| [gstack](https://github.com/garrytan/gstack) | Planning, review, QA and release instructions | MIT plus upstream third-party notices: `skills/licenses/gstack-LICENSE.txt`, `skills/licenses/gstack-NOTICE.md.txt` |
| [Karpathy skills](https://github.com/multica-ai/andrej-karpathy-skills) | Engineering principles and instructions | MIT declaration retained in original frontmatter; downloaded snapshot contained no standalone license file |

Five Superpowers workflows were refreshed from a snapshot reporting version 7.0.1. `skills/superpowers-provenance.json` records their paths, hashes and adaptations. Complete MIT notices, Copyright (c) 2025 Jesse Vincent, accompany refreshed resources and installed copies. See `docs/integrations/superpowers.md` for scope and dependency decisions.

## Research and earlier development references

[Archify](https://github.com/tt-a1i/archify) informed architecture-document research. [Open Code Review](https://github.com/alibaba/open-code-review) was explored in earlier development. Neither project's runtime is shipped in FEHM 1.0.0. Their presence among downloaded source folders is not evidence that all their features or code are bundled. Any future import requires its own provenance and notices review.

## Devicon technology icons

Selected unmodified SVGs from https://github.com/devicons/devicon/tree/v2.17.0/icons are embedded in technology-icons.ts. Used only to identify detected technologies. Logos remain trademarks of their respective owners; no endorsement is implied.

The MIT License (MIT)

Copyright (c) 2015 konpa

Permission is hereby granted, free of charge, to any person obtaining a copy of
this software and associated documentation files (the "Software"), to deal in
the Software without restriction, including without limitation the rights to
use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of
the Software, and to permit persons to whom the Software is furnished to do so,
subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS
FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER
IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN
CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.


## Runtime dependencies

Python artifacts include production npm dependencies with their original license files. The lockfile records exact versions; `npm run vendor:review` checks the packaged inventory. Direct dependencies include the MCP TypeScript SDK, Three.js, TypeScript and Zod. The pinned `nodejs-wheel-binaries` Python dependency supplies private Node.js separately and carries its own notices. FEHM's license does not replace dependency licenses.

## Website assets

The website distributes Manrope and Newsreader fonts with their original license files in `website/public/fonts/`. Website files are not included in the FEHM npm package or Python runtime payload.

## Redistribution

Preserve this notice, applicable license texts, source attributions and bundled catalog notices when redistributing FEHM. The Karpathy snapshot's missing standalone license text remains a provenance limitation; its frontmatter declaration is not a newly supplied upstream license file.
