# Fehm brand kit

The aperture mark: two asymmetric, folded ribbons surround a diagonal opening. The interlocking silhouette represents separate pieces of code becoming a connected understanding. Its angled cuts and offset halves replace the literal F and graph dots. Navy provides contrast; mint distinguishes the second ribbon. All SVG marks are original vector artwork, with no external resources. These assets are covered by the repository’s MIT license.

| Asset | Use |
| --- | --- |
| `fehm-icon.svg` | App icon and favicon, navy rounded tile |
| `fehm-icon-512.png` | 512 × 512 raster icon for uploads |
| `fehm-mark.svg` | Transparent mark on light backgrounds |
| `fehm-mark-light.svg` | Transparent mark on dark backgrounds |
| `fehm-mark-mono.svg` | Single-color mark; inline SVG inherits currentColor |
| `fehm-logo.svg` | Path-based wordmark for light backgrounds |
| `fehm-logo-light.svg` | Path-based wordmark for dark backgrounds |
| `readme-banner.svg` | Repository header illustration |

Colors: navy `#12283F`, mint `#7EE0C3`, darker mint for light surfaces `#22977A`, off-white `#F5F8FC`. Leave at least one ribbon width of clear space around the mark. Keep its proportions. Use the icon at small sizes, and the wordmark when there is enough room to read the name.

## Website and Vite

The existing static website uses the icon in its header and `/favicon.svg`; an 180px Apple touch icon is included. Fehm’s website does not need to migrate to Vite to use the assets.

For a Vite project, copy `fehm-icon.svg` into `public/favicon.svg`, then replace the default Vite icon link in `index.html`:

```html
<link rel="icon" type="image/svg+xml" href="%BASE_URL%favicon.svg">
```

For a React component, put the desired logo in `src/assets/` and import it:

```jsx
import logo from './assets/fehm-logo.svg';

export function Brand() {
  return <img src={logo} width="145" height="40" alt="Fehm" />;
}
```

The wordmarks use paths, so they do not require installed fonts. The README banner uses ordinary text for its tagline. To export PNG files with librsvg:

```bash
rsvg-convert -w 512 -h 512 assets/brand/fehm-icon.svg -o assets/brand/fehm-icon-512.png
```
