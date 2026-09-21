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
| Browser console | Syntax checks and simulated DOM interaction checks pass. A real-browser console/network audit remains to be done; no browser session is available in this environment. |

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

The intended domain is `fehm.com` on Cloudflare Pages; ownership and connection have not been verified. Search Console ownership, sitemap submission, production hosting and real-browser qualification have not been performed. The default build remains a safe local preview.

References: [Google SEO starter guide](https://developers.google.com/search/docs/fundamentals/seo-starter-guide), [sitemap submission](https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap), [llms.txt proposal](https://llmstxt.org/).

## Planned Cloudflare Pages deployment

Use these settings after confirming you control `fehm.com`:

| Setting | Value |
| --- | --- |
| Repository | The same Fehm repository |
| Root directory | Repository root |
| Build command | `npm --prefix website run build` |
| Output directory | `website/dist` |
| Node version | `24` |
| Production SITE_URL | `https://fehm.com` |
| Production SITE_INDEXABLE | `true`, once the custom domain is ready |
| Preview SITE_INDEXABLE | `false` |

Keeping the build root at the repository root lets the builder read the product version from the root package.json. Add `fehm.com` through Pages → Custom domains. An apex domain requires a Cloudflare zone and Cloudflare nameservers. Redirect the production pages.dev address and any www alias to the canonical domain, preserving paths. Check Cloudflare bot/WAF settings separately: generated robots.txt cannot override an edge-level crawler block.

Use DNS verification for a Search Console Domain property, then submit `https://fehm.com/sitemap.xml`. No account, DNS, deployment or Search Console changes have been made here.

Cloudflare references: [static HTML hosting](https://developers.cloudflare.com/pages/framework-guides/deploy-anything/), [custom domains and redirects](https://developers.cloudflare.com/pages/configuration/custom-domains/).
