import { existsSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { estimateTokens } from "./compression.js";
import { LexicalIndex } from "./lexical-index.js";
import { readJson, stateDir, writeJsonAtomic } from "./persistence.js";
import {
  catalogAdapter,
  cleanBody,
  directoryAdapter,
  normalizeSkill,
  parseFrontmatter,
  parseSections,
  sha256,
  summaryText,
  type DirectorySourceOptions,
  type ParsedSection,
  type SkillAdapter,
} from "./skill-adapters.js";
import { SECTION_PRIORITY, SKILL_INDEX_VERSION, SKILL_SCHEMA_VERSION, type LoadedSkill, type SkillLevel, type SkillRecord } from "./skill-model.js";
import { tokenize } from "./text.js";

/** The catalog shipped with Fehm (repository `skills/`, resolved from src/ or dist/). */
export const BUNDLED_CATALOG = fileURLToPath(new URL("../skills/", import.meta.url));

export interface RegistrySource {
  /** "catalog" for a manifest-based catalog, otherwise a directory source. */
  type: "catalog" | "directory";
  dir: string;
  options?: DirectorySourceOptions;
}

interface CachedEntry {
  record: SkillRecord;
  file: string;
  size: number;
  mtimeMs: number;
  descriptorHash: string;
  adapter: string;
}

interface RegistryFile {
  schemaVersion: string;
  indexVersion: string;
  sources: string[];
  entries: CachedEntry[];
}

export interface RegistryReport {
  mode: "full" | "incremental" | "cache-hit";
  reason?: string;
  added: string[];
  changed: string[];
  removed: string[];
  unchanged: number;
  /** Skills whose file content was read and re-derived in this refresh. */
  reindexed: number;
  warnings: string[];
  durationMs: number;
}

export class StaleSkillError extends Error {
  constructor(
    readonly skillId: string,
    readonly expected: string,
    readonly actual: string,
  ) {
    super(`skill ${skillId} changed on disk since it was indexed (hash ${expected.slice(0, 12)} → ${actual.slice(0, 12)}); run \`fehm skills index\``);
  }
}

export interface LoadOptions {
  /** Token allowance for the `sections` level. */
  maxTokens?: number;
  /** Task terms used to prefer relevant sections. */
  focus?: string[];
}

const sourceKey = (s: RegistrySource): string => `${s.type}:${resolve(s.dir)}${s.options ? `#${s.options.name}` : ""}`;

/**
 * Local skill registry. Holds level-0/1 records only; skill bodies are read
 * through `load()` after selection, verified against the indexed hash.
 */
export class SkillRegistry {
  readonly report: RegistryReport;
  private readonly records: Map<string, SkillRecord>;
  private readonly files: Map<string, string>;
  private lexical: LexicalIndex | undefined;
  /** Number of skill bodies read through `load()` — progressive-disclosure observability. */
  bodyReads = 0;

  private constructor(entries: CachedEntry[], report: RegistryReport) {
    const sorted = [...entries].sort((a, b) => (a.record.id < b.record.id ? -1 : 1));
    this.records = new Map(sorted.map((e) => [e.record.id, e.record]));
    this.files = new Map(sorted.map((e) => [e.record.id, e.file]));
    this.report = report;
  }

  /**
   * Open (and incrementally refresh) the registry. Unchanged skills — same
   * size, mtime and adapter descriptor — are reused without reading the file;
   * a touched file whose hash is unchanged is reused too.
   */
  static open(options: { sources?: RegistrySource[]; root?: string; stateDirectory?: string; force?: boolean; persist?: boolean } = {}): SkillRegistry {
    const started = performance.now();
    const sources = options.sources ?? [{ type: "catalog", dir: BUNDLED_CATALOG }];
    const cachePath = join(stateDir(options.root ?? ".", options.stateDirectory), "skills-registry.json");
    const keys = sources.map(sourceKey);
    const cached = options.force ? undefined : readJson<RegistryFile>(cachePath);
    let reason: string | undefined;
    let previous = new Map<string, CachedEntry>();
    if (options.force) reason = "forced";
    else if (!cached || !cached.ok) reason = cached?.ok === false && cached.reason === "malformed" ? "cache malformed" : "no cache";
    else if (cached.value.schemaVersion !== SKILL_SCHEMA_VERSION || cached.value.indexVersion !== SKILL_INDEX_VERSION) reason = "index version changed";
    else if (JSON.stringify(cached.value.sources) !== JSON.stringify(keys)) reason = "skill sources changed";
    else previous = new Map(cached.value.entries.map((e) => [e.record.id, e]));

    const indexedAt = new Date().toISOString();
    const warnings: string[] = [];
    const next: CachedEntry[] = [];
    const added: string[] = [];
    const changed: string[] = [];
    let reindexed = 0;
    const seen = new Set<string>();
    for (const source of sources) {
      const adapter: SkillAdapter = source.type === "catalog" ? catalogAdapter(source.dir) : directoryAdapter(source.dir, source.options ?? { name: "local" });
      const entries = adapter.discover();
      for (const entry of entries) {
        if (seen.has(entry.id)) {
          warnings.push(`duplicate skill id ${entry.id} from ${adapter.name}; first source wins`);
          continue;
        }
        seen.add(entry.id);
        const st = statSync(entry.file, { throwIfNoEntry: false });
        if (!st) {
          warnings.push(`${entry.id}: file missing (${entry.file})`);
          continue;
        }
        const prev = previous.get(entry.id);
        if (prev && prev.descriptorHash === entry.descriptorHash && prev.size === st.size && prev.mtimeMs === st.mtimeMs && prev.file === entry.file) {
          next.push(prev);
          continue;
        }
        if (prev && prev.descriptorHash === entry.descriptorHash && prev.file === entry.file && sha256(readFileSync(entry.file)) === prev.record.contentHash) {
          next.push({ ...prev, size: st.size, mtimeMs: st.mtimeMs });
          continue;
        }
        const record = normalizeSkill(entry.read(), indexedAt);
        reindexed += 1;
        (prev ? changed : added).push(entry.id);
        next.push({ record, file: entry.file, size: st.size, mtimeMs: st.mtimeMs, descriptorHash: entry.descriptorHash, adapter: adapter.name });
      }
      warnings.push(...adapter.warnings.map((w) => `${adapter.name}: ${w}`));
    }
    const removed = [...previous.keys()].filter((id) => !seen.has(id)).sort();
    const mode: RegistryReport["mode"] = reason ? "full" : added.length || changed.length || removed.length ? "incremental" : "cache-hit";
    // Validate declared dependencies against the final id set.
    const ids = new Set(next.map((e) => e.record.id));
    for (const e of next) for (const d of e.record.dependencies) if (!ids.has(d)) warnings.push(`${e.record.id}: dependency ${d} is not in the registry`);
    const report: RegistryReport = {
      mode,
      added: added.sort(),
      changed: changed.sort(),
      removed,
      unchanged: next.length - added.length - changed.length,
      reindexed,
      warnings,
      durationMs: Math.round(performance.now() - started),
    };
    if (reason) report.reason = reason;
    if (mode !== "cache-hit" && options.persist !== false) {
      writeJsonAtomic(cachePath, { schemaVersion: SKILL_SCHEMA_VERSION, indexVersion: SKILL_INDEX_VERSION, sources: keys, entries: next } satisfies RegistryFile);
    }
    return new SkillRegistry(next, report);
  }

  /** Build directly from adapters without persistence (tests, benchmarks). */
  static fromSources(sources: RegistrySource[]): SkillRegistry {
    return SkillRegistry.open({ sources, persist: false, force: true });
  }

  get size(): number {
    return this.records.size;
  }

  get(id: string): SkillRecord | undefined {
    return this.records.get(id);
  }

  all(): SkillRecord[] {
    return [...this.records.values()];
  }

  list(filter: { category?: string; source?: string; kind?: string } = {}): SkillRecord[] {
    return this.all().filter(
      (r) =>
        (!filter.category || r.category === filter.category || r.category.startsWith(`${filter.category}/`)) &&
        (!filter.source || r.source === filter.source) &&
        (!filter.kind || r.kind === filter.kind),
    );
  }

  /** BM25 over metadata only (name, id, triggers, description, use-when, tags, section headings). */
  get index(): LexicalIndex {
    if (!this.lexical) {
      const index = new LexicalIndex();
      for (const r of this.records.values()) {
        index.add({
          id: r.id,
          fields: [
            { text: `${r.name} ${r.id.replace(/[/:]/g, " ")}`, weight: 4 },
            { text: r.triggers.join(" "), weight: 3 },
            { text: r.description, weight: 2 },
            { text: `${r.useWhen.join(" ")} ${r.tasks.join(" ")} ${r.domains.join(" ")} ${r.languages.join(" ")} ${r.frameworks.join(" ")}`, weight: 1 },
            { text: r.sections.map((s) => s.heading).join(" "), weight: 1 },
          ],
        });
      }
      this.lexical = index;
    }
    return this.lexical;
  }

  search(query: string, limit = 10): { record: SkillRecord; score: number; matchedTerms: string[] }[] {
    return this.index
      .search(query, limit)
      .map((s) => ({ record: this.records.get(s.id)!, score: Math.round((s.lexical + s.semantic) * 1e4) / 1e4, matchedTerms: s.matchedTerms }));
  }

  /** Resolve a skill id, a unique name, or a unique id suffix. */
  resolve(target: string): SkillRecord | { ambiguous: string[] } | undefined {
    const direct = this.records.get(target);
    if (direct) return direct;
    const t = target.toLowerCase();
    const matches = this.all().filter((r) => r.name.toLowerCase() === t || r.id.endsWith(`/${t}`) || r.id.endsWith(`:${t}`));
    if (matches.length === 1) return matches[0];
    return matches.length ? { ambiguous: matches.map((m) => m.id) } : undefined;
  }

  /** Current on-disk hash check without loading into context. */
  isStale(id: string): boolean {
    const record = this.records.get(id);
    const file = this.files.get(id);
    if (!record || !file || !existsSync(file)) return true;
    return sha256(readFileSync(file)) !== record.contentHash;
  }

  /** The skill file exactly as indexed (for installation), verified against its hash. */
  source(id: string): string {
    const record = this.records.get(id);
    if (!record) throw new Error(`unknown skill ${id}`);
    const content = readFileSync(this.files.get(id)!, "utf8");
    this.bodyReads += 1;
    const actual = sha256(content);
    if (actual !== record.contentHash) throw new StaleSkillError(id, record.contentHash, actual);
    return content;
  }

  /**
   * Load a skill at a disclosure level. `metadata` and `routing` never touch
   * the file. Higher levels read the file once and verify its hash; content
   * that changed since indexing is refused rather than silently used.
   */
  load(id: string, level: SkillLevel, options: LoadOptions = {}): LoadedSkill {
    const record = this.records.get(id);
    if (!record) throw new Error(`unknown skill ${id}`);
    if (level === "metadata" || level === "routing") {
      const text = level === "metadata" ? metadataText(record) : routingText(record);
      return { id, level, text, tokens: estimateTokens(text), includedSections: [], omittedSections: record.sections.map((s) => s.heading) };
    }
    const file = this.files.get(id)!;
    const content = readFileSync(file, "utf8");
    this.bodyReads += 1;
    const actual = sha256(content);
    if (actual !== record.contentHash) throw new StaleSkillError(id, record.contentHash, actual);
    const body = cleanBody(parseFrontmatter(content).body);
    const sections = parseSections(body);
    if (level === "summary") {
      const text = summaryText(record, body);
      return { id, level, text, tokens: estimateTokens(text), includedSections: [], omittedSections: sections.map((s) => s.heading || "(intro)") };
    }
    if (level === "full") {
      return { id, level, text: body, tokens: estimateTokens(body), includedSections: sections.map((s) => s.heading || "(intro)"), omittedSections: [] };
    }
    return selectSections(record, sections, options);
  }
}

export function metadataText(r: SkillRecord): string {
  return `${r.name} (${r.id}): ${r.description}`;
}

export function routingText(r: SkillRecord): string {
  const line = (label: string, values: readonly string[]): string => (values.length ? `${label}: ${values.join(", ")}` : "");
  return [
    metadataText(r),
    line("tasks", r.tasks),
    line("domains", r.domains),
    line("technologies", [...r.languages, ...r.frameworks]),
    line("triggers", r.triggers),
    line("use when", r.useWhen),
    line("do not use when", r.doNotUseWhen),
    line("depends on", r.dependencies),
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * Level 3: whole sections chosen by compression priority (activation →
 * constraints → workflow → output → examples → background), preferring
 * sections that mention task terms, emitted in original order. A section is
 * never cut mid-way: one that does not fit is left out and listed.
 */
function selectSections(record: SkillRecord, sections: ParsedSection[], options: LoadOptions): LoadedSkill {
  const allowance = options.maxTokens ?? Math.max(200, Math.ceil(record.tokens.full / 3));
  const focus = new Set((options.focus ?? []).flatMap((f) => tokenize(f)));
  const outline = record.sections;
  const order = sections
    .map((s, i) => {
      const category = outline[i]?.category ?? "background";
      const terms = new Set(tokenize(s.text));
      const hits = [...focus].filter((f) => terms.has(f)).length;
      return { i, s, category, rank: SECTION_PRIORITY.indexOf(category), hits, tokens: estimateTokens(s.text) };
    })
    .sort((a, b) => a.rank - b.rank || b.hits - a.hits || a.i - b.i);
  const chosen = new Set<number>();
  let used = 0;
  for (const c of order) {
    if (used + c.tokens > allowance) continue;
    chosen.add(c.i);
    used += c.tokens;
  }
  // The most important section that did not fit may still open the remaining
  // allowance: cut at a line boundary outside code fences, and say so.
  const partial = new Map<number, string>();
  const rest = allowance - used;
  const next = order.find((c) => !chosen.has(c.i));
  if (next && rest >= 80) {
    const kept: string[] = [];
    let fence = false;
    let lastSafe = 0;
    for (const line of next.s.text.split("\n")) {
      if (/^\s*(```|~~~)/.test(line)) fence = !fence;
      kept.push(line);
      if (estimateTokens(kept.join("\n")) > rest - 20) break;
      if (!fence) lastSafe = kept.length;
    }
    const cut = kept.slice(0, lastSafe).join("\n").trimEnd();
    if (cut && lastSafe > 1) partial.set(next.i, `${cut}\n\n_[… section continues — load the full level for the rest]_`);
  }
  const included = sections.filter((_, i) => chosen.has(i) || partial.has(i));
  const omitted = sections.filter((_, i) => !chosen.has(i)).map((s) => s.heading || "(intro)");
  let text = sections
    .map((s, i) => (chosen.has(i) ? s.text.trimEnd() : partial.get(i)))
    .filter((t): t is string => t !== undefined)
    .join("\n\n");
  if (omitted.length) text += `\n\n_Omitted sections (load with \`fehm skills show ${record.id} --level full\`): ${omitted.join(" · ")}_`;
  return { id: record.id, level: "sections", text, tokens: estimateTokens(text), includedSections: included.map((s) => s.heading || "(intro)"), omittedSections: omitted };
}

export interface UpstreamFreshness {
  repository: string;
  checked: number;
  current: string[];
  /** Upstream file changed since the catalog recorded it: re-import before trusting. */
  changed: { skillId: string; path: string; recorded: string; actual: string }[];
  missing: { skillId: string; path: string }[];
}

/**
 * Compare the upstream SHA-256 recorded for each skill source against a newer
 * checkout of that repository. Only changed skills need re-import; nothing is
 * rewritten here.
 */
export function checkUpstreamFreshness(registry: SkillRegistry, repository: string, checkout: string): UpstreamFreshness {
  const out: UpstreamFreshness = { repository, checked: 0, current: [], changed: [], missing: [] };
  for (const record of registry.all()) {
    for (const src of record.sources) {
      if (src.repository !== repository || !src.sha256) continue;
      out.checked += 1;
      const file = join(checkout, src.path);
      if (!existsSync(file)) {
        out.missing.push({ skillId: record.id, path: src.path });
        continue;
      }
      const actual = sha256(readFileSync(file));
      if (actual === src.sha256) out.current.push(record.id);
      else out.changed.push({ skillId: record.id, path: src.path, recorded: src.sha256, actual });
    }
  }
  out.current = [...new Set(out.current)].filter((id) => !out.changed.some((c) => c.skillId === id)).sort();
  return out;
}
