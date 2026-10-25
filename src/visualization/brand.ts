/**
 * Fehm brand marks for the localhost pages, inlined from assets/brand/ (the
 * dark-background variants) so no page loads an external image.
 */

const RIBBON_A = "M12 24 31 10Q33 8 35 10L52 22 43 29 33 22 22 30 32 37 23 44 12 36Q8 33 8 30T12 24Z";
const RIBBON_B = "m41 20 11 8q4 3 4 6t-4 6L33 54q-2 2-4 0L12 42l9-7 10 7 11-8-10-7Z";
const WORD =
  "M90 61V30q0-15 15-15h8v9h-7q-6 0-6 7v4h13v9h-13v17z M122 43q0-18 17-18t17 19v5h-24q2 7 12 7h10v8h-12q-20 0-20-21zm10-2h14q-1-8-7-8t-7 8z M166 15h10v15q5-5 12-5 15 0 15 17v22h-10V43q0-9-8-9t-9 9v21h-10z M214 27h9v4q4-6 11-6 9 0 12 7 5-7 13-7 15 0 15 17v22h-10V43q0-9-6-9-7 0-7 9v21h-10V43q0-9-7-9-10 0-10 9v21h-10z";

/** The aperture mark alone (fehm-mark-light.svg). */
export const FEHM_MARK = `<svg class="fehm-mark" xmlns="http://www.w3.org/2000/svg" viewBox="6 6 52 52" role="img" aria-label="Fehm"><path d="${RIBBON_A}" fill="#ffffff"/><path d="${RIBBON_B}" fill="#7ee0c3"/></svg>`;

/** Mark plus wordmark (fehm-logo-light.svg), cropped to its drawing. */
export const FEHM_LOGO = `<svg class="fehm-logo" xmlns="http://www.w3.org/2000/svg" viewBox="6 12 272 60" role="img" aria-label="Fehm"><g transform="translate(0 8)"><path d="${RIBBON_A}" fill="#ffffff"/><path d="${RIBBON_B}" fill="#7ee0c3"/></g><path d="${WORD}" fill="#ffffff"/></svg>`;

/** App icon (fehm-icon.svg) as a favicon data URL. */
export const FEHM_FAVICON = `data:image/svg+xml,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="17" fill="#12283f"/><g transform="translate(5 5) scale(.84375)"><path d="${RIBBON_A}" fill="#f5f8fc"/><path d="${RIBBON_B}" fill="#7ee0c3"/></g></svg>`,
)}`;
