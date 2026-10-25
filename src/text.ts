import { stem } from "./stemmer.js";

/**
 * Identifier boundary rule.
 *
 * Upstream: DeusData/codebase-memory-mcp @ 92abefa3f57a94591a92bcecd6a6f102da373575
 * File:     src/store/store.c — camel_should_split() (MIT, see legal/upstream/codebase-memory)
 * Changes:  C → TypeScript; takes a JS string instead of a NUL-terminated buffer
 *           (out-of-range `next` reads as "" instead of '\0'). Rules unchanged:
 *   1. split before an uppercase letter preceded by a lowercase letter
 *      ("updateCloud" → "update Cloud")
 *   2. split before an uppercase letter preceded by an uppercase letter and
 *      followed by a lowercase letter ("XMLParser" → "XML Parser")
 */
export function camelShouldSplit(input: string, i: number): boolean {
  if (i <= 0) return false;
  const curr = input[i] ?? "";
  const prev = input[i - 1] ?? "";
  const next = input[i + 1] ?? "";
  if (curr >= "A" && curr <= "Z" && prev >= "a" && prev <= "z") return true;
  if (curr >= "A" && curr <= "Z" && prev >= "A" && prev <= "Z" && next >= "a" && next <= "z") return true;
  return false;
}

/**
 * Upstream `sqlite_camel_split` emits "original split words"; Fehm returns the
 * word parts only (the caller keeps the original separately). Fehm addition:
 * letter/digit transitions and `_`, `-`, `.`, `/` are also boundaries, since
 * Fehm does not sit behind FTS5's unicode61 tokenizer.
 */
export function splitIdentifier(identifier: string): string[] {
  let spaced = "";
  for (let i = 0; i < identifier.length; i += 1) {
    if (camelShouldSplit(identifier, i)) spaced += " ";
    spaced += identifier[i];
  }
  return spaced
    .split(/[^A-Za-z0-9]+|(?<=[A-Za-z])(?=[0-9])|(?<=[0-9])(?=[A-Za-z])/)
    .filter((part) => part.length > 0)
    .map((part) => part.toLowerCase());
}

const STOP_WORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "by", "can", "do", "does", "for", "from", "how",
  "i", "in", "is", "it", "me", "my", "of", "on", "or", "should", "show", "that", "the", "this",
  "to", "what", "when", "where", "which", "who", "why", "with", "work", "works",
]);

/**
 * Split free text or code into stemmed lowercase terms. Identifiers are split on
 * camelCase/acronym boundaries, and the whole identifier is kept too so exact
 * names still match.
 */
export function tokenize(text: string, options: { keepStopWords?: boolean } = {}): string[] {
  const out: string[] = [];
  for (const raw of text.match(/[A-Za-z_$][A-Za-z0-9_$]*|[0-9]+/g) ?? []) {
    const parts = splitIdentifier(raw);
    const whole = raw.toLowerCase().replace(/[$_]/g, "");
    if (parts.length > 1 && whole.length >= 2) out.push(whole);
    for (const part of parts) {
      if (part.length < 2) continue;
      if (!options.keepStopWords && STOP_WORDS.has(part)) continue;
      out.push(stem(part));
    }
  }
  return out;
}

/** Unique query terms in first-seen order. */
export function queryTerms(query: string): string[] {
  return [...new Set(tokenize(query))];
}
