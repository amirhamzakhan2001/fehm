# Fehm website implementation plan

## Goal and repository decision

Build a public product and documentation website that explains Fehm, helps developers install the local tool, and directs them to a verified release. The website does not process repositories, proxy localhost, or become the cockpit.

Keep `website/` in the **same repository** as the engine. Changes to commands, capabilities, and installation instructions can then ship with their documentation. Use a separate package, build directory, CI job, and deployment target. Split repositories later only if ownership, access control, or release cadence requires it; separate hosting does not require separate Git repositories.

## Architecture

- Dependency-free static HTML generator using Node 20+, semantic HTML, CSS, and small progressive-enhancement JavaScript.
- `src/content.mjs` owns website copy, grouped capabilities, and assistant pages; `src/guides.mjs` provides thirteen complete on-site documentation guides. Root `package.json` supplies the displayed Fehm version.
- `src/layout.mjs` owns shared navigation/footer and SEO. `scripts/build.mjs` emits routable directories, assets, sitemap, robots, and hosting headers into `dist/`.
- `public/` contains responsive styles, copy controls, workflow illustrations, finite entrance motion, documentation search, analytics consent handling, locally hosted licensed fonts, a favicon, and PNG/SVG social cards.
- No client routing or hydration dependency; pages and code examples remain useful with JavaScript disabled.
- Local preview binds to loopback and returns a real 404. Any static host can serve the output; configure its 404 and headers explicitly if it does not recognize `_headers`.

## Information architecture

| Route | Purpose |
| --- | --- |
| `/` | Context-packet hero, drift and change-impact illustrations, ten capability groups |
| `/features/` | All ten website capability groups with commands, examples, and limitations |
| `/getting-started/` | Current source/wheel installation, scan/query/serve, upgrades |
| `/integrations/` | Assistant selection and distinction between skills and MCP |
| `/integrations/{claude,cursor,codex,gemini,copilot,vscode}/` | Scope, registration, invocation, refresh, troubleshooting |
| `/engineering-practices/` | Architecture versus practice drift, policy approval, evidence limits |
| `/docs/` and `/docs/{guide}/` | Searchable guide index and thirteen native articles with sidebar navigation and table of contents |
| `/releases/` | Current source release notes |
| `/privacy/` | Local-tool boundary, optional website measurement and controls |
| `/404.html` | Real missing-page response and recovery links |

## Visual direction

A product-led visual system: midnight blue context canvas, mint evidence packet, sea-glass engineering-practice panel, lavender change-impact panel, and pale blue reading surfaces. Self-hosted Manrope provides interface typography; italic Newsreader adds selective emphasis. All fonts and licenses ship locally. Every route uses the same grid-and-orbit background, dark blue introduction panels, mint/lavender accents and card treatments. Background light responds to link/button hover and keyboard focus using CSS; touch devices retain the static artwork, and reduced-motion preferences disable transitions. Documentation keeps its reading layout within the same visual system.

The homepage explains three implemented workflows: context assembly, practice-baseline comparison, and change-impact inspection. The diagrams are labeled workflow illustrations, not captured reports or live product output. Their staggered entrance animations finish within two seconds, run once on intersection, respect reduced motion, and pause in hidden tabs. No animation dependency or continuous decorative loop is required. All content remains available without JavaScript.

References reviewed: [Graphify](https://graphify.com/), [Code Review Graph](https://code-review-graph.com/), [Linear](https://linear.app/), and [Lapa Ninja](https://www.lapa.ninja/). Product-led visual explanations, layered surfaces, deliberate contrast and grouped feature navigation informed the original implementation. No competitor source, brand assets, statistics or testimonials were copied.

## Product accuracy

The ten website groups reorganize the seven canonical workflows in `docs/FEATURES.md`: testing and security expand the quality workflow; agent accountability expands the AI workflow. This is a presentation grouping, not additional functionality. Public-facing beta labels have been removed; factual installation availability and known limitations remain visible on the relevant guides and installation guide. Installation remains uv for users and npm for contributors. Public package publication stays pending. Feature details retain analysis, execution, language and provider limitations. No unsupported hosted accounts, certification or performance claims are advertised.

## SEO

Emit page-specific titles/descriptions, canonical URLs, Open Graph/Twitter metadata, WebPage/WebSite structured data, sitemap.xml, and robots.txt. Default previews to `noindex`; require an explicit HTTPS `SITE_URL` and `SITE_INDEXABLE=true` for production indexing. Missing pages stay noindex and return HTTP 404. Use crawlable links, one descriptive H1 per page, semantic landmarks, and meaningful content. After deployment, verify canonical redirects and submit the sitemap in Search Console. SEO implementation cannot guarantee indexing or ranking.

Reference: [Google Search starter guide](https://developers.google.com/search/docs/fundamentals/seo-starter-guide).

## Google Analytics

Optional GA4 configured by `GA_MEASUREMENT_ID`. No Google script loads before explicit opt-in. Reject and accept receive equally accessible controls; the privacy page permits changing the decision when analytics is configured. Store only the consent preference locally. Disable advertising signals and send sanitized page locations without query strings/fragments, plus allowlisted `install_guide_click` and `docs_click` events. Do not collect command text, source, repository paths, user IDs, or form contents. Do not claim to identify every visitor. Retention, region-specific disclosures, and the live property setup remain deployment decisions.

Reference: [Google consent setup](https://developers.google.com/tag-platform/security/guides/consent).

## Delivery phases and acceptance

1. **Foundation — implemented:** isolated package, static generator, responsive shared layout, product pages, assistant pages, real 404 preview, code copying.
2. **Discoverability — implemented:** page metadata, sitemap/robots, structured data, version synchronization, noindex preview defaults.
3. **Measurement — implemented but not connected:** consent UI, opt-in loader, sanitized allowlisted events, withdrawal controls. Needs a real GA4 property and network verification in a browser.
4. **Automated qualification — passed locally:** build validation across 28 pages, route/link checks, production canonical/sitemap/robots output, preview noindex defaults, real HTTP 200/301/404/405 responses, consent behavior, interactive workflow illustrations, finite entrance motion, and documentation search tests. Run `npm run check` from this folder. Consent tests use a simulated DOM and do not replace real-browser network validation.
5. **Visual/accessibility qualification — pending:** inspect desktop/mobile, keyboard navigation, contrast, zoom, long code blocks, copy success/failure, and consent controls in real browsers. Run Lighthouse against the production preview; record results rather than promising scores.
6. **Launch — pending:** choose hosting/domain, configure HTTPS URL, connect GA4 if wanted, review disclosures, verify release links, configure production 404/headers, deploy, verify analytics events and sitemap, then enable indexing. No automatic deployment is configured by this implementation.

## Operations

Use a website-only CI job with `working-directory: website`. Build deployment from the repository root checkout so the generator can read the engine manifest; run `npm --prefix website run build` and publish `website/dist`. Keep `website/` out of npm/Python package contents. Before a Fehm release, update website publication status, validate command examples, rebuild, and review preview links. Revert the website deployment independently if needed.

## Public audience

The website serves Fehm users. Keep maintainer build commands, deployment configuration, test qualification and release checklists in repository documentation. The former `/status/` readiness page is removed. Public guides retain installation availability, usage instructions, troubleshooting, and practical limitations. Release notes describe user-visible capabilities.

## Open-source workflow documentation

The `/docs/open-source/` guide explains the six project contributions and distinguishes the bundled Open Code Review engine from five selected source adaptations. The docs directory, navigation, integrations overview and release page link to the guide. It covers existing commands, local context processing, opt-in provider review and the limits of file diversity and source-freshness checks. Source pins and implementation details remain in the repository integration document.
