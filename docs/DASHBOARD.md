# Localhost dashboard

`fehm serve` opens the dashboard at `http://127.0.0.1:4317/`. It has a sidebar listing every feature, an overview home page (project, index size, freshness, rescan), and each feature page shown in place.

## How it works

- **One registry.** `src/visualization/features.ts` (`FEATURES`) is the only list of pages. The sidebar, the home cards, every page's cross-feature links (`featureNav`), the `fehm serve` output and `test/dashboard.test.ts` are all generated from it.
- **Addresses.** `/#/<id>` selects a view (`/#/home`, `/#/graph`, `/#/explain`, `/#/architecture`, `/#/drift`, `/#/health`, `/#/security`, `/#/engine`). `/#/<id>?<fragment>` forwards `#<fragment>` to that page; for example, `/#/graph?node=<id>` focuses a graph node.
- **Pages stay standalone.** Each page is still served on its own route (`/graph`, `/explain`, `/architecture`, `/drift`, `/health`, `/security`, `/engine`). The dashboard frames it with `?embedded`, which marks `<html class="embedded">` on the server so the page's own brand and cross-feature links are hidden before first paint.
- **Pages stay alive.** A page is framed on its first visit and then kept, so switching back is instant and keeps its camera, selection and scroll. After **Rescan index**, open pages reload the next time they are shown.
- **Links between features.** A link inside a page that points at another feature's route (for example the briefing's `graph` links, `/graph#node=…`) switches the dashboard instead of nesting one page inside another.
- **Server.** `src/server.ts` asks each `ViewRoutes` module (`src/visualization/http.ts`) in turn: dashboard, engine, graph, then briefing. They all share one `FehmEngine`. Every page uses `pageHeaders()`, which gives a same-origin CSP with `frame-ancestors 'self'`.

## Adding a feature page

1. Add an entry to `FEATURES`: `id`, spec `code`, `title`, one-sentence `summary`, `path`, `icon` and `group` (`feature` or `tool`). An icon key the dashboard doesn't know gets a neutral icon; add the SVG to `ICONS` in `dashboard/page.ts`.
2. Build the page under `src/visualization/<feature>/` as a `ViewRoutes` module. Serve `path` with `renderPage(PAGE, url)` and `pageHeaders()`, and its browser modules through `pageAsset`.
3. Put `${featureNav("<id>")}` in the page header, and add `${CHROME_CSS}` to its style. Give the header `class="brand"` / `class="sep"` spans to match the other pages.
4. Register the module in `src/server.ts`.

`test/dashboard.test.ts` fails if a registered page isn't served, can't be framed, has no embedded variant, or is missing the shared nav.
