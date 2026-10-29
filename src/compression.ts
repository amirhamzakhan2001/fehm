import type { Language } from "./model.js";

export const TOKEN_ESTIMATOR = "fehm-approx-v1";

/**
 * Deterministic, tokenizer-free token estimate. Deliberately a little
 * pessimistic for code (letters ≈ 4 chars/token, digits ≈ 3, every symbol
 * one token, each newline one token), so real BPE counts are usually lower.
 * It is an estimate: budgets are enforced against this estimator.
 */
export function estimateTokens(text: string): number {
  let tokens = 0;
  for (const m of text.matchAll(/[A-Za-z]+|[0-9]+|\n|[^\sA-Za-z0-9]/g)) {
    const t = m[0];
    if (t === "\n") tokens += 1;
    else if (/^[A-Za-z]/.test(t)) tokens += Math.ceil(t.length / 4);
    else if (/^[0-9]/.test(t)) tokens += Math.ceil(t.length / 3);
    else tokens += 1;
  }
  return tokens;
}

const LINE_COMMENT: Partial<Record<Language, RegExp>> = {
  typescript: /^\s*\/\/(?!\/\s*<reference)/,
  javascript: /^\s*\/\//,
  go: /^\s*\/\//,
  rust: /^\s*\/\/(?![/!])/,
  java: /^\s*\/\//,
  python: /^\s*#(?!!)/,
};

/**
 * Lossless-for-meaning compression of a source excerpt: drop comment-only
 * lines and non-doc block comments, blank lines, and trailing whitespace;
 * remove common indentation. Code tokens are never altered.
 */
export function compressSource(lines: readonly string[], language: Language | undefined): string[] {
  const lineComment = language ? LINE_COMMENT[language] : undefined;
  const slashBlocks = language !== "python" && language !== undefined;
  const out: string[] = [];
  let inBlock = false;
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, "");
    if (slashBlocks) {
      if (inBlock) {
        if (line.includes("*/")) inBlock = false;
        continue;
      }
      if (/^\s*\/\*(?!\*)/.test(line)) {
        if (!line.includes("*/")) inBlock = true;
        continue;
      }
    }
    if (!line.trim()) continue;
    if (lineComment?.test(line)) continue;
    out.push(line);
  }
  const indent = Math.min(...out.map((l) => /^\s*/.exec(l)![0].length));
  return Number.isFinite(indent) && indent > 0 ? out.map((l) => l.slice(indent)) : out;
}

/**
 * Focused excerpt: the first `head` lines (signature), then only lines that
 * mention a focus term, each with one line of context, joined by `…`.
 */
export function focusedExcerpt(lines: readonly string[], focus: readonly string[], maxLines = 24, head = 2): string[] {
  if (lines.length <= maxLines) return [...lines];
  const lowered = focus.map((f) => f.toLowerCase()).filter((f) => f.length >= 3);
  const keep = new Set<number>();
  for (let i = 0; i < Math.min(head, lines.length); i += 1) keep.add(i);
  for (let i = head; i < lines.length && keep.size < maxLines - 1; i += 1) {
    const l = lines[i]!.toLowerCase();
    if (lowered.some((f) => l.includes(f))) {
      for (const j of [i - 1, i, i + 1]) if (j >= 0 && j < lines.length && keep.size < maxLines - 1) keep.add(j);
    }
  }
  keep.add(lines.length - 1);
  const out: string[] = [];
  let prev = -1;
  for (const i of [...keep].sort((a, b) => a - b)) {
    if (prev >= 0 && i > prev + 1) out.push("…");
    out.push(lines[i]!);
    prev = i;
  }
  return out;
}

/** Cut text (at a line boundary where possible) so its estimate fits `maxTokens`. */
export function fitToBudget(text: string, maxTokens: number): string {
  if (estimateTokens(text) <= maxTokens) return text;
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >>> 1;
    if (estimateTokens(text.slice(0, mid)) <= maxTokens) lo = mid;
    else hi = mid - 1;
  }
  const cut = text.slice(0, lo);
  const nl = cut.lastIndexOf("\n");
  return nl > 0 ? cut.slice(0, nl) : cut;
}
