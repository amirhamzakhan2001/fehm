import { createHash } from "node:crypto";
import { join } from "node:path";
import type { CodeGraph } from "./graph.js";
import type { MemoryEntry } from "./model.js";
import { readJson, stateDir, writeJsonAtomic } from "./persistence.js";
import { queryTerms, tokenize } from "./text.js";

/**
 * Project memory: small, local, inspectable facts about the project
 * ("auth uses JWT", "we avoid ORM X"), linked to paths/symbols. Kept separate
 * from the code graph — memory is never turned into code edges.
 */
interface MemoryStore {
  version: 1;
  entries: MemoryEntry[];
}

const memoryPath = (root: string, dir?: string): string => join(stateDir(root, dir), "memory.json");

export function loadMemory(root: string, dir?: string): MemoryEntry[] {
  const read = readJson<MemoryStore>(memoryPath(root, dir));
  return read.ok && Array.isArray(read.value?.entries) ? read.value.entries : [];
}

export function addMemory(root: string, input: { text: string; links?: string[]; tags?: string[] }, dir?: string): MemoryEntry {
  const text = input.text.trim();
  if (!text) throw new Error("memory text is empty");
  const entries = loadMemory(root, dir);
  const entry: MemoryEntry = {
    id: createHash("sha256").update(text).digest("hex").slice(0, 12),
    text: text.slice(0, 500),
    links: [...new Set(input.links ?? [])].sort(),
    tags: [...new Set((input.tags ?? []).map((t) => t.toLowerCase()))].sort(),
    createdAt: new Date().toISOString(),
  };
  const next = entries.filter((e) => e.id !== entry.id);
  next.push(entry);
  writeJsonAtomic(memoryPath(root, dir), { version: 1, entries: next } satisfies MemoryStore);
  return entry;
}

export function removeMemory(root: string, id: string, dir?: string): boolean {
  const entries = loadMemory(root, dir);
  const next = entries.filter((e) => e.id !== id);
  if (next.length === entries.length) return false;
  writeJsonAtomic(memoryPath(root, dir), { version: 1, entries: next } satisfies MemoryStore);
  return true;
}

/*
 * ── Upstream adaptation ───────────────────────────────────────────────────
 * Upstream: affaan-m/ECC @ 9ac593b55cba44c8b20152a5c7f28d300a67ec7e
 * File:     scripts/lib/instinct-relevance.js (MIT; attribution in THIRD_PARTY_NOTICES.md)
 * Kept:     DEFAULT_PROJECT_SCOPE_BOOST 0.25, DEFAULT_STACK_MATCH_BOOST 0.2,
 *           whole-token `tokenize` (avoids `go` matching `good`),
 *           computeRelevanceBoost's additive structure.
 * Changed:  - "project scope" becomes *location* relevance: the entry links a
 *             path/symbol that is in the current context selection
 *           - stack keywords come from the graph (languages + external
 *             packages) instead of reading the filesystem (detectProjectType)
 *           - the base score is query-term relevance instead of instinct confidence
 *           - env toggle (ECC_INSTINCT_RELEVANCE_RANKING) removed
 */
export const DEFAULT_LOCATION_BOOST = 0.25;
export const DEFAULT_STACK_MATCH_BOOST = 0.2;

export function wholeTokens(value: string): string[] {
  return String(value || "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

export function stackKeywords(graph: CodeGraph): Set<string> {
  const keywords = new Set<string>();
  for (const node of graph.nodes()) {
    if (node.kind === "file" && node.language && node.language !== "other") keywords.add(node.language);
    if (node.kind === "package") for (const t of wholeTokens(node.name)) if (t.length >= 2) keywords.add(t);
  }
  return keywords;
}

export function memoryMatchesStack(entry: MemoryEntry, keywords: ReadonlySet<string>): boolean {
  if (keywords.size === 0) return false;
  const tokens = new Set([...wholeTokens(entry.tags.join(" ")), ...wholeTokens(entry.text)]);
  for (const k of keywords) if (tokens.has(k)) return true;
  return false;
}

export function computeRelevanceBoost(entry: MemoryEntry, selected: ReadonlySet<string>, keywords: ReadonlySet<string>): number {
  let boost = 0;
  if (entry.links.some((l) => selected.has(l))) boost += DEFAULT_LOCATION_BOOST;
  if (memoryMatchesStack(entry, keywords)) boost += DEFAULT_STACK_MATCH_BOOST;
  return boost;
}

export interface RankedMemory {
  entry: MemoryEntry;
  score: number;
  relevance: number;
  boost: number;
}

/**
 * Rank memory for a query. An entry must be relevant on its own (query terms
 * or a link into the selection); the stack boost only reorders relevant
 * entries, it never admits an unrelated one.
 */
export function rankMemory(
  entries: readonly MemoryEntry[],
  query: string,
  selected: ReadonlySet<string>,
  keywords: ReadonlySet<string>,
  limit = 3,
): RankedMemory[] {
  const terms = queryTerms(query);
  const ranked: RankedMemory[] = [];
  for (const entry of entries) {
    const tokens = new Set(tokenize(`${entry.text} ${entry.tags.join(" ")} ${entry.links.join(" ")}`));
    const relevance = terms.length ? terms.filter((t) => tokens.has(t)).length / terms.length : 0;
    const linked = entry.links.some((l) => selected.has(l));
    if (relevance === 0 && !linked) continue;
    const boost = computeRelevanceBoost(entry, selected, keywords);
    ranked.push({ entry, relevance, boost, score: Math.round((relevance + boost) * 1e6) / 1e6 });
  }
  ranked.sort((a, b) => b.score - a.score || (a.entry.id < b.entry.id ? -1 : 1));
  return ranked.slice(0, limit);
}
