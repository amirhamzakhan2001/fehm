/**
 * Text measurement for layout. Widths are per-character advance widths (em)
 * of a Helvetica-class sans-serif, with a safety factor for system UI fonts.
 * The browser re-measures after rendering and compresses any text that still
 * overflows its box, so a font mismatch can never produce overlap.
 */

const EM: Record<string, number> = {};
const set = (chars: string, w: number): void => {
  for (const c of chars) EM[c] = w;
};
set("abcdeghknopqsuvxyz", 0.556);
set("cksvxyz", 0.5);
set("fjilt", 0.25);
set("r", 0.333);
set("mw", 0.8);
set("ABEKPSVXY", 0.667);
set("CDHNRUw", 0.722);
set("GOQ", 0.778);
set("FTZ", 0.611);
set("IJ", 0.35);
set("L", 0.556);
set("MW", 0.9);
set("0123456789", 0.556);
set(" .,:;'|!", 0.278);
set("-()[]{}/\\", 0.333);
set("_#$%&?+=<>~^", 0.6);
set("*", 0.389);
set("@", 1.0);
set("·", 0.3);
set("…→←", 1.0);

const SAFETY = 1.06;

export function measure(text: string, size: number, weight = 400): number {
  let em = 0;
  for (const c of text) em += EM[c] ?? (c.charCodeAt(0) > 0x2e80 ? 1.0 : 0.6);
  return em * size * SAFETY * (weight >= 600 ? 1.07 : 1);
}

/** Break points inside an over-long word: path separators, dashes, camelCase. */
function splitWord(word: string): string[] {
  return word.split(/(?<=[/\-_.])|(?<=[a-z])(?=[A-Z])/).filter(Boolean);
}

/**
 * Wrap to at most `maxLines` lines no wider than `maxWidth`. When the text
 * still does not fit, the last line ends with an ellipsis; the full text is
 * always kept in the node's accessible name and the inspector.
 */
export function wrap(text: string, maxWidth: number, size: number, weight: number, maxLines: number): string[] {
  const tokens: string[] = [];
  for (const word of text.split(/\s+/).filter(Boolean)) {
    if (measure(word, size, weight) <= maxWidth) tokens.push(word);
    else tokens.push(...splitWord(word).map((p, i, all) => (i < all.length - 1 ? `${p}​` : p)));
  }
  const lines: string[] = [];
  let cur = "";
  const join = (a: string, b: string): string => (!a ? b : a.endsWith("​") ? a + b : `${a} ${b}`);
  for (const t of tokens) {
    const next = join(cur, t);
    if (!cur || measure(next.replace(/​/g, ""), size, weight) <= maxWidth) cur = next;
    else {
      lines.push(cur);
      cur = t;
    }
  }
  if (cur) lines.push(cur);
  const clean = lines.map((l) => l.replace(/​/g, ""));
  if (clean.length <= maxLines) return clean.map((l) => fit(l, maxWidth, size, weight));
  const kept = clean.slice(0, maxLines);
  kept[maxLines - 1] = fit(`${kept[maxLines - 1]} ${clean.slice(maxLines).join(" ")}`, maxWidth, size, weight);
  return kept;
}

/** Shorten with an ellipsis until the text fits. */
export function fit(text: string, maxWidth: number, size: number, weight: number): string {
  if (measure(text, size, weight) <= maxWidth) return text;
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (measure(`${text.slice(0, mid)}…`, size, weight) <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  return `${text.slice(0, lo).trimEnd()}…`;
}
