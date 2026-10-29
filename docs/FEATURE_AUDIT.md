# Integration release feature audit

See the [release audit](RELEASE_STATUS.md) for measured results and [compatibility matrix](REAL_TESTING.md) for unverified client/platform behavior.

Implemented in this release: an installable Python wrapper with private Node dependency, portable runtime wheel/sdist, top-level Fehm skill lifecycle using the existing installer, installation doctor, read-only SDK stdio MCP, client-specific configuration generation, installed-artifact checks, and updated shared website documentation.

The MCP inventory is fehm_context, fehm_search, fehm_focus, fehm_relationships, fehm_system_map and fehm_practices. The last maps to current static project health, not the removed legacy practice-policy engine. Historical tools that executed mutation tests, model optimization or agent-memory writes were not restored. There is no arbitrary execution tool in MCP.

Public registry publication, Cloudflare deployment, migration from private development builds, full authenticated assistant acceptance, and other OS qualification are not completed. CI prepares qualification artifacts but has no publish step. These boundaries are intentional and must remain visible in release claims.
