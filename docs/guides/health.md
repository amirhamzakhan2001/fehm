# Health, readiness and security

Project Health combines test discovery, supplied coverage, dependencies, reliability and implementation-integrity signals. Its readiness view identifies risks and missing evidence, not an engineering grade or an AI-authorship score.

## Inspect reports

```sh
fehm health
fehm security
```

The localhost /health page can reference current Security and Drift evidence. CLI calls without those service adapters explicitly identify unavailable cross-feature evidence. Coverage artifacts are distinct from static test reachability; a test file's existence does not prove adequate coverage.

## Web delivery and SEO

Static literal-HTML checks include title/description signals, canonical conflicts, noindex, viewport metadata and missing image alt attributes. Configure public/private/local/unknown audience profiles in .fehm/health.json as described in the technical Health reference. Public search-discovery checks do not apply universally to private dashboards.

These checks do not crawl deployed sites, execute a browser, measure performance or prove that rendered content is indexable. Missing evidence is not a confirmed defect.

## Security boundaries

Static traces and recognized patterns support review, not a complete vulnerability assessment. Check source evidence and unresolved flows. Dependency advisory lookup is optional and uses the network when requested. FEHM does not label a codebase as written by AI, a novice or an engineer.
