import { getSynonyms } from "./synonyms.js";
import { tokenize } from "./text.js";

/**
 * BM25 inverted index with prefix and synonym expansion.
 *
 * Upstream: rohitg00/agentmemory @ bcf4f0d00d1c71e9221287a4778e4122ce2d7574
 * File:     src/state/search-index.ts — class SearchIndex (Apache-2.0, see legal/upstream/agentmemory)
 * Kept:     k1 = 1.2, b = 0.75, BM25 idf formula, prefix matches at half idf,
 *           synonym terms at weight 0.7, sorted-terms lower-bound prefix scan,
 *           add/remove bookkeeping.
 * Changed:  - documents are Fehm {id, text} instead of CompressedObservation;
 *             sessionId, serialize/deserialize, restoreFrom and CJK segmentation removed
 *           - tokenization is Fehm's identifier-aware `tokenize`
 *           - exact+prefix contributions are reported as `lexical`, synonym
 *             contributions separately as `semantic` (Fehm keeps signals apart)
 *           - results are tie-broken by id so ranking is deterministic
 */
export interface LexicalDocument {
  id: string;
  /** Weighted text fields; weight repeats the field's tokens. */
  fields: { text: string; weight: number }[];
}

export interface LexicalScore {
  id: string;
  lexical: number;
  semantic: number;
  /** Distinct query terms matched exactly or by prefix. */
  matchedTerms: string[];
}

export class LexicalIndex {
  private readonly lengths = new Map<string, number>();
  private readonly inverted = new Map<string, Set<string>>();
  private readonly termCounts = new Map<string, Map<string, number>>();
  private totalLength = 0;
  private sortedTerms: string[] | null = null;

  private readonly k1 = 1.2;
  private readonly b = 0.75;

  add(doc: LexicalDocument): void {
    if (this.lengths.has(doc.id)) this.remove(doc.id);
    const freq = new Map<string, number>();
    let length = 0;
    for (const field of doc.fields) {
      const repeat = Math.max(1, Math.round(field.weight));
      for (const term of tokenize(field.text)) {
        freq.set(term, (freq.get(term) ?? 0) + repeat);
        length += repeat;
      }
    }
    this.lengths.set(doc.id, length);
    this.termCounts.set(doc.id, freq);
    this.totalLength += length;
    for (const term of freq.keys()) {
      let posting = this.inverted.get(term);
      if (!posting) this.inverted.set(term, (posting = new Set()));
      posting.add(doc.id);
    }
    this.sortedTerms = null;
  }

  remove(id: string): void {
    const length = this.lengths.get(id);
    if (length === undefined) return;
    for (const term of this.termCounts.get(id)?.keys() ?? []) {
      const posting = this.inverted.get(term);
      posting?.delete(id);
      if (posting?.size === 0) this.inverted.delete(term);
    }
    this.termCounts.delete(id);
    this.totalLength = Math.max(0, this.totalLength - length);
    this.lengths.delete(id);
    this.sortedTerms = null;
  }

  get size(): number {
    return this.lengths.size;
  }

  search(query: string, limit = 50): LexicalScore[] {
    const raw = [...new Set(tokenize(query))];
    const n = this.lengths.size;
    if (raw.length === 0 || n === 0) return [];
    const avg = this.totalLength / n || 1;

    const terms: { term: string; weight: number; synonym: boolean }[] = [];
    const seen = new Set<string>();
    for (const term of raw) {
      if (!seen.has(term)) {
        seen.add(term);
        terms.push({ term, weight: 1, synonym: false });
      }
      for (const syn of getSynonyms(term)) {
        if (!seen.has(syn)) {
          seen.add(syn);
          terms.push({ term: syn, weight: 0.7, synonym: true });
        }
      }
    }

    const acc = new Map<string, LexicalScore>();
    const bump = (id: string, value: number, synonym: boolean, term: string): void => {
      let entry = acc.get(id);
      if (!entry) acc.set(id, (entry = { id, lexical: 0, semantic: 0, matchedTerms: [] }));
      if (synonym) entry.semantic += value;
      else {
        entry.lexical += value;
        if (!entry.matchedTerms.includes(term)) entry.matchedTerms.push(term);
      }
    };
    const bm25 = (id: string, indexTerm: string, idf: number): number => {
      const tf = this.termCounts.get(id)?.get(indexTerm) ?? 0;
      const len = this.lengths.get(id) ?? 0;
      return idf * ((tf * (this.k1 + 1)) / (tf + this.k1 * (1 - this.b + this.b * (len / avg))));
    };

    const sorted = this.getSortedTerms();
    for (const { term, weight, synonym } of terms) {
      const docs = this.inverted.get(term);
      if (docs) {
        const idf = Math.log((n - docs.size + 0.5) / (docs.size + 0.5) + 1);
        for (const id of docs) bump(id, bm25(id, term, idf) * weight, synonym, term);
      }
      if (term.length < 3) continue; // Fehm: no prefix expansion for 1–2 char terms
      for (let i = lowerBound(sorted, term); i < sorted.length; i += 1) {
        const indexTerm = sorted[i]!;
        if (!indexTerm.startsWith(term)) break;
        if (indexTerm === term) continue;
        const ids = this.inverted.get(indexTerm)!;
        const idf = Math.log((n - ids.size + 0.5) / (ids.size + 0.5) + 1) * 0.5;
        for (const id of ids) bump(id, bm25(id, indexTerm, idf) * weight, synonym, term);
      }
    }

    return [...acc.values()]
      .sort((a, b) => b.lexical + b.semantic - (a.lexical + a.semantic) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
      .slice(0, limit);
  }

  private getSortedTerms(): string[] {
    if (!this.sortedTerms) this.sortedTerms = [...this.inverted.keys()].sort();
    return this.sortedTerms;
  }
}

function lowerBound(arr: string[], target: string): number {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (arr[mid]! < target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
