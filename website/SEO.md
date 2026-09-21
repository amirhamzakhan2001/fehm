# Search visibility and website audit

## Implemented checks

| Item | Implementation and verification |
| --- | --- |
| View source | All 28 pages contain static HTML content; rendering does not require JavaScript. |
| Missing routes | Custom 404 HTML and real HTTP 404 responses tested on the local server. Hosting must preserve this behavior. |
| Default app branding | No Vite/React runtime or starter title. Custom Fehm SVG favicon, Apple touch icon and social preview. |
| Titles and descriptions | Unique titles and meaningful unique descriptions checked across every generated page. |
| Headings and language | One H1 per page; `html lang="en"`. |
| Canonical links | One absolute canonical per page, derived from SITE_URL. |
| Social previews | Open Graph and Twitter title, description and image; PNG is 1200 × 630. |
| Structured data | Valid JSON-LD WebPage or TechArticle, language and parent WebSite. No invented ratings or reviews. |
| Image alternatives | All HTML images have alt attributes. The header icon has empty alt because its link already has an accessible name. |
| Sitemap | Includes 27 canonical content URLs and excludes the 404 page. |
| Robots | Production allows all crawlers and advertises the sitemap. Previews disallow crawling and emit noindex. No named AI-crawler block. |
| LLM index | Generated llms.txt links to on-site documentation; llm.txt is an alias. This is supplemental documentation, not a Google indexing requirement. |
| JavaScript | Two first-party files total 4,688 bytes uncompressed; regression budget 15 KB. Optional Google Analytics is separate and loads only with consent. |
| Source maps | No generated .map files or sourceMappingURL references in shipped JavaScript. |
| Browser console | Syntax checks and simulated DOM interaction checks pass. A local headless Chromium audit visited all 27 content routes at 320, 390, 768 and 1024px: no uncaught JavaScript exceptions after the responsive fix. Production network/analytics checks remain pending. |

## Page targeting

These are editorial targets based on implemented capabilities, not search-volume research or ranking promises. Use Search Console query data after launch to refine them.

| Page | Primary search intent |
| --- | --- |
| `/` | Codebase context for AI coding assistants |
| `/features/` | Codebase intelligence features and dependency analysis |
| `/docs/installation/` | Install Fehm with uv |
| `/docs/quickstart/` | Build and query a repository code graph |
| `/docs/architecture/` | Architecture drift and engineering-practice checks |
| `/docs/open-code-review/` | Open Code Review setup with Fehm |
| `/docs/mcp/` | Codebase context MCP server |
| `/docs/verification/` | Change impact and code verification |
| `/integrations/{assistant}/` | Fehm setup for that specific assistant |
| `/docs/cockpit/` | Local codebase graph viewer |

Keep each guide focused on its own task. Prefer concrete instructions and source-backed product claims over repeated slogans. No meta-keywords tag, keyword stuffing, hidden search text or fabricated testimonials are used.

## Production and Google Search Console

1. Choose and deploy the real HTTPS domain. Set `SITE_URL` to its origin and `SITE_INDEXABLE=true` in the hosting build environment. Never use the sample domain as a production canonical.
2. Run `npm --prefix website run check`, then build with the production variables. Tests deliberately restore the unindexed preview, so the production build must run afterward.
3. Publish `website/dist/`. Configure directory index handling, trailing-slash redirects and genuine 404 responses. Do not use an all-routes-to-index.html SPA fallback.
4. Add the domain to Google Search Console. Verify a Domain property through DNS, or use a URL-prefix property with its HTML verification token supplied as `GOOGLE_SITE_VERIFICATION` and rebuild. This token is public verification metadata, not a credential.
5. Inspect the deployed homepage source: public canonical, index/follow, unique metadata, reachable assets and no host-level X-Robots-Tag noindex. Check the production robots.txt allows crawling.
6. Submit `/sitemap.xml` in Search Console. Inspect the homepage and key guides with URL Inspection. Confirm Google sees the intended content and canonical.
7. Check an unknown URL returns HTTP 404; test mobile navigation, copy buttons, reduced motion and the browser console. Check optional analytics requests only after consent.
8. Monitor indexing, queries, clicks and Core Web Vitals after traffic becomes available. Review title/description relevance using actual query data. Indexing and positions are decided by search engines.

The selected production address is `https://fehm.pages.dev`; the live deployment has not been verified here. Search Console ownership, sitemap submission, production hosting and full cross-browser qualification have not been performed. The default build remains a safe local preview.

References: [Google SEO starter guide](https://developers.google.com/search/docs/fundamentals/seo-starter-guide), [sitemap submission](https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap), [llms.txt proposal](https://llmstxt.org/).

## Cloudflare Pages production setup

The chosen public origin is `https://fehm.pages.dev`. Confirm that this is the project’s assigned production URL, not a branch preview. No custom domain, DNS changes or registrar purchase is required.

| Setting | Value |
| --- | --- |
| Root directory | Repository root (leave empty in dashboard) |
| Build command | `npm --prefix website run build` |
| Output directory | `website/dist` |
| NODE_VERSION | `24` |
| SKIP_DEPENDENCY_INSTALL | `true` for production and preview |
| Production SITE_URL | `https://fehm.pages.dev` |
| Production SITE_INDEXABLE | `true` |
| Preview SITE_INDEXABLE | `false` |

Skipping automatic dependency installation prevents Cloudflare from running `pip install .` on the engine package. The website has no third-party build dependencies. Set the production branch to the branch containing the current website changes. Keep preview deployments unindexed. Redeploy after changing build variables.

In Search Console, add a **URL-prefix** property for `https://fehm.pages.dev/` and choose HTML tag verification. Set `GOOGLE_SITE_VERIFICATION` to only the supplied tag’s `content` value, rebuild, then verify. Keep the token configured after verification. Submit `https://fehm.pages.dev/sitemap.xml`. DNS verification of a Domain property is not appropriate because you do not control pages.dev DNS.

Optional analytics uses `GA_MEASUREMENT_ID` for your actual web stream. The existing consent flow controls loading. No verification, account or deployment changes are performed by local documentation edits.

References: [Search Console property types](https://support.google.com/webmasters/answer/34592), [Cloudflare preview indexing](https://developers.cloudflare.com/pages/configuration/preview-deployments/).

## Responsive layout verification

Local Chromium reproduced overflow on documentation and assistant guides caused by the sidebar’s intrinsic minimum width. Grid children now use `min-width: 0`; mobile columns use `minmax(0, 1fr)`. Integration overview columns and the FAQ stack on phones. Narrow-screen padding and wrapping were adjusted without hiding page overflow. All 108 content-route/viewport combinations passed document-width checks, and the 390px installation guide screenshot was visually inspected. Sidebar navigation and code examples retain intentional internal horizontal scrolling. Safari, Firefox and physical-device testing remain separate.
