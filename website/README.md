# Fehm public website

This is a standalone static website in the Fehm repository, separate from the local cockpit and Python/npm distributions.

## Local use

Requires Node 20+. No dependencies need installing.

```bash
cd website
npm run dev
```

Open http://127.0.0.1:4321. Edit files, rerun the build, and refresh; the initial server does not implement hot reload.

```bash
npm run check
```

## Production build

From a full repository checkout, set build variables in your host:

```bash
SITE_URL=https://fehm.pages.dev SITE_INDEXABLE=true npm --prefix website run build
```

Publish `website/dist/` as static output. Defaults are `http://localhost:4321`, noindex, and analytics disabled. `.env.example` lists settings; the builder reads environment variables directly and does not automatically load `.env` files. Do not use an invented canonical domain in production.

Optional `GA_MEASUREMENT_ID=G-...` enables the consent controls; Google is loaded only after opt-in. Configure your own property, retention, and disclosures before launch. Analytics reports visits/events, not the identity of every visitor. Disable enhanced measurement in the GA property to keep the documented page-view/guide-navigation event scope. Verify network requests and page locations on the live domain.

Set the host to serve directory `index.html` files and return HTTP 404 using `404.html` for missing routes. `_headers` includes the site's security policy for hosts that support that file; apply equivalent headers on other hosts. The CSP permits only the Google tag/collection endpoints needed by optional GA. Verify these headers after hosting configuration changes.

A 1200×630 PNG social card is included alongside the SVG source graphic. Manrope and Newsreader font subsets are served locally; their SIL Open Font Licenses are included. The public site uses `https://fehm.pages.dev`; analytics and Search Console require their own account configuration. The build does not publish the site or change the Fehm package's publication status.

## Design and content

The site has 28 generated pages, including thirteen native documentation guides, six assistant guides, user-facing release notes. Visitor navigation stays on-site. Documentation has side navigation, section anchors, and guide filtering. The homepage presents three animated workflow illustrations and ten capability groups, with finite entrance motion and reduced-motion handling.

All routes share the same grid artwork, blue introduction panels, color palette, and card styling. Subtle hover/focus responses respect reduced motion. Package availability text must reflect the actual distribution state.

Homepage copy is in `src/home.mjs`; other product copy is in `src/content.mjs`; detailed documentation is in `src/guides.mjs`. Update these alongside core command changes. Fonts, styles, graphics, and interaction scripts are in `public/`. Automated interaction tests use a simulated DOM. A local Chromium audit covered 27 content routes at 320, 390, 768 and 1024px after the responsive fixes; production browser and analytics checks remain separate.

## Search and indexing

Optional `GOOGLE_SITE_VERIFICATION` adds your Search Console HTML verification token. The build also generates `/llms.txt` and its `/llm.txt` alias.

## Cloudflare Pages

Keep the root directory at the repository root, use `npm --prefix website run build`, and publish `website/dist`. Set these build environment variables:

| Variable | Production | Preview |
| --- | --- | --- |
| `NODE_VERSION` | `24` | `24` |
| `SKIP_DEPENDENCY_INSTALL` | `true` | `true` |
| `SITE_URL` | `https://fehm.pages.dev` | Assigned preview origin, or leave unset |
| `SITE_INDEXABLE` | `true` | `false` |

Skipping dependency installation prevents Cloudflare from attempting `pip install .` on the root engine package. The website requires no third-party build dependencies. Redeploy after changing variables.

For Search Console, add a URL-prefix property for `https://fehm.pages.dev/`, choose HTML tag verification, and set `GOOGLE_SITE_VERIFICATION` to the supplied content value. Rebuild, verify, and submit `/sitemap.xml`. Keep the verification token configured. No custom domain or DNS verification is needed.

Before publishing, check production canonicals, robots.txt, HTTP 404 behavior, mobile navigation and the browser console. The checks validate unique titles/descriptions, one H1 per page, language/alt attributes, JSON-LD, links, crawler files and the first-party JavaScript budget. Optional GA requests require a separate live consent/network check. Search indexing and rankings are not guaranteed.
