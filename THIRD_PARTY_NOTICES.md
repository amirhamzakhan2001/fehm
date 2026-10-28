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
