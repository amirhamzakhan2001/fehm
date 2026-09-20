# Fehm public website

Plan: [PLAN.md](PLAN.md). This is a standalone static website in the Fehm repository, separate from the local cockpit and Python/npm distributions.

## Local use

Requires Node 20+. No dependencies need installing.

```bash
cd website
npm run dev
```

Open http://126.0.0.1:4321. Edit files, rerun the build, and refresh; the initial server does not implement hot reload.

```bash
npm run check
```

## Production build

From a full repository checkout, set build variables in your host:

```bash
SITE_URL=https://your-real-domain.com SITE_INDEXABLE=true npm --prefix website run build
```

Publish `website/dist/` as static output. Defaults are `http://localhost:4321`, noindex, and analytics disabled. `.env.example` lists settings; the builder reads environment variables directly and does not automatically load `.env` files. Do not use an invented canonical domain in production.

Optional `GA_MEASUREMENT_ID=G-...` enables the consent controls; Google is loaded only after opt-in. Configure your own property, retention, and disclosures before launch. Analytics reports visits/events, not the identity of every visitor. Disable enhanced measurement in the GA property to keep the documented page-view/guide-navigation event scope. Verify network requests and page locations on the live domain.

Set the host to serve directory `index.html` files and return HTTP 404 using `404.html` for missing routes. `_headers` includes the site's security policy for hosts that support that file; apply equivalent headers on other hosts. The CSP permits only the Google tag/collection endpoints needed by optional GA. Verify these headers after hosting configuration changes.

A 1200×630 PNG social card is included alongside the SVG source graphic. Manrope and Newsreader font subsets are served locally; their SIL Open Font Licenses are included. Domain, hosting, live analytics, visual-browser qualification, and deployment are still pending. The build does not publish the site or change the Fehm package's publication status.

## Design and content

The site has 28 generated pages, including thirteen native documentation guides, six assistant guides, user-facing release notes. Visitor navigation stays on-site. Documentation has side navigation, section anchors, and guide filtering. The homepage presents three animated workflow illustrations and ten capability groups, with finite entrance motion and reduced-motion handling.

All routes share the same grid artwork, blue introduction panels, color palette, and card styling. Subtle hover/focus responses respect reduced motion. Beta labels are removed without changing package availability claims.

Homepage copy is in `src/home.mjs`; other product copy is in `src/content.mjs`; detailed documentation is in `src/guides.mjs`. Update these alongside core command changes. Fonts, styles, graphics, and interaction scripts are in `public/`. Automated interaction tests use a simulated DOM; a real browser review is still required before deployment.
