# Third-party notices

FEHM includes independent TypeScript adaptations of selected algorithms and rule
definitions from the projects below. The original projects are not bundled or
executed by FEHM.

| Project | Source revision | License | FEHM use |
| --- | --- | --- | --- |
| AgentMemory | `bcf4f0d00d1c71e9221287a4778e4122ce2d7574` | Apache-2.0 | lexical retrieval, stemming, synonyms, feedback signals |
| codebase-memory-mcp | `92abefa3f57a94591a92bcecd6a6f102da373575` | MIT | identifier-word splitting |
| ECC | `9ac593b55cba44c8b20152a5c7f28d300a67ec7e` | MIT | memory relevance scoring |
| Graft | `8c05769618d413041ea2c8891f82d566f0461b3c` | MIT | file-first context diversification |
| Skylos | 4.41.0 | Apache-2.0 | quality and security rule definitions and thresholds |

Sources: <https://github.com/rohitg00/agentmemory>,
<https://github.com/DeusData/codebase-memory-mcp>,
<https://github.com/affaan-m/ECC>, <https://github.com/trailhq/Graft>, and
<https://github.com/duriantaco/skylos>.

FEHM's adapted code is identified in source-file headers. Changes include
ports to TypeScript, integration with FEHM's code graph, and FEHM-specific
behavior; it is not a distribution of the original projects.
