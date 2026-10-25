import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, join, relative, sep } from "node:path";
import { estimateTokens } from "./compression.js";
import type { MetadataProvenance, SkillRecord, SkillSectionOutline, SkillSource, SkillStyle, TaskIntent } from "./skill-model.js";
import {
  classifySection,
  detectTechnologies,
  extractTriggers,
  inferCapabilities,
  inferRiskFlags,
  inferStyle,
  INTENT_RULES,
  matchDomains,
  matchRules,
  useConditions,
  words,
} from "./skill-vocabulary.js";
import { tokenize } from "./text.js";

/* ── Frontmatter ──────────────────────────────────────────────────────── */

export type FrontmatterValue = string | string[] | Record<string, string>[] | Record<string, string>;

const unquote = (v: string): string => {
  const t = v.trim();
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    const inner = t.slice(1, -1);
    return t.startsWith("'") ? inner.replace(/''/g, "'") : inner.replace(/\\"/g, '"');
  }
  return t;
};

/**
 * The YAML subset skill files use: scalars (plain/quoted), block scalars
 * (| and >), inline [a, b] lists, block lists of scalars and of flat maps.
 * Anything else is kept as a raw string rather than guessed.
 */
export function parseFrontmatter(text: string): { data: Record<string, FrontmatterValue>; body: string; raw: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  if (!m) return { data: {}, body: text, raw: "" };
  const lines = m[1]!.split(/\r?\n/);
  const data: Record<string, FrontmatterValue> = {};
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!;
    const kv = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line);
    if (!kv) continue;
    const key = kv[1]!;
    const rest = kv[2]!.trim();
    const childIndent = (j: number): number => /^(\s*)/.exec(lines[j] ?? "")![1]!.length;
    if (rest === "|" || rest === ">" || rest === "|-" || rest === ">-") {
      const block: string[] = [];
      while (i + 1 < lines.length && (lines[i + 1]!.trim() === "" || childIndent(i + 1) > 0)) block.push(lines[++i]!.trim());
      data[key] = rest.startsWith("|") ? block.join("\n").trim() : block.join(" ").replace(/\s+/g, " ").trim();
    } else if (rest.startsWith("[") && rest.endsWith("]")) {
      data[key] = rest.slice(1, -1).split(",").map(unquote).filter(Boolean);
    } else if (rest === "") {
      const items: string[] = [];
      const maps: Record<string, string>[] = [];
      const map: Record<string, string> = {};
      while (i + 1 < lines.length && (lines[i + 1]!.trim() === "" || childIndent(i + 1) > 0 || lines[i + 1]!.startsWith("- "))) {
        const child = lines[++i]!;
        const trimmed = child.trim();
        if (!trimmed) continue;
        const item = /^-\s*(.*)$/.exec(trimmed);
        if (item) {
          const inner = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(item[1]!);
          if (inner) maps.push({ [inner[1]!]: unquote(inner[2]!) });
          else items.push(unquote(item[1]!));
        } else {
          const inner = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(trimmed);
          if (inner && maps.length) maps[maps.length - 1]![inner[1]!] = unquote(inner[2]!);
          else if (inner) map[inner[1]!] = unquote(inner[2]!);
        }
      }
      data[key] = maps.length ? maps : Object.keys(map).length ? map : items;
    } else data[key] = unquote(rest);
  }
  return { data, body: text.slice(m[0].length), raw: m[1]! };
}

const str = (v: FrontmatterValue | undefined): string | undefined => (typeof v === "string" ? v : undefined);
const list = (v: FrontmatterValue | undefined): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : typeof v === "string" && v ? v.split(/,\s*/) : [];

/* ── Body structure ───────────────────────────────────────────────────── */

export interface ParsedSection {
  heading: string;
  depth: number;
  text: string;
}

const LIBRARY_NOTICE = /^> \*\*Library use:\*\*.*$/m;

/**
 * Catalog boilerplate removed before measuring or loading: the per-file
 * "Library use" notice (the composer states the contract once) and the
 * trailing link list of related skills. Instructional text is untouched.
 */
export function cleanBody(body: string): string {
  return body
    .replace(LIBRARY_NOTICE, "")
    .replace(/\n## Related skills and principles\n[\s\S]*$/, "\n")
    .replace(/^\s+/, "")
    .replace(/\s+$/, "\n");
}

/** Split at headings of depth ≤ 3 (outside code fences); deeper headings stay inside their section. */
export function parseSections(body: string): ParsedSection[] {
  const sections: ParsedSection[] = [];
  let current: ParsedSection = { heading: "", depth: 0, text: "" };
  let fence = false;
  for (const line of body.split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) fence = !fence;
    const h = fence ? null : /^(#{1,3})\s+(.+?)\s*#*\s*$/.exec(line);
    if (h) {
      if (current.text.trim() || current.heading) sections.push(current);
      current = { heading: h[2]!, depth: h[1]!.length, text: `${line}\n` };
    } else current.text += `${line}\n`;
  }
  if (current.text.trim() || current.heading) sections.push(current);
  return sections;
}

export function sectionOutline(sections: readonly ParsedSection[]): SkillSectionOutline[] {
  return sections.map((s, i) => ({
    heading: s.heading || "(intro)",
    depth: s.depth,
    // The untitled intro and a document title are activation context.
    category: !s.heading || (i === 0 && s.depth === 1) ? "activation" : classifySection(s.heading),
    tokens: estimateTokens(s.text),
  }));
}

/** First prose paragraph (not a heading, list, quote, table or code), cut at a sentence boundary. */
export function leadParagraph(body: string, maxWords = 60): string {
  let fence = false;
  for (const block of body.split(/\n\s*\n/)) {
    const t = block.trim();
    if (/^(```|~~~)/.test(t)) fence = !fence;
    if (fence || !t || /^(#|>|\||[-*+] |\d+\. |```|<)/.test(t)) continue;
    const text = t.replace(/\s+/g, " ");
    const w = text.split(" ");
    if (w.length <= maxWords) return text;
    const cut = w.slice(0, maxWords).join(" ");
    const end = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("! "), cut.lastIndexOf("? "));
    return end > 40 ? cut.slice(0, end + 1) : `${cut} …`;
  }
  return "";
}

export function summaryText(record: Pick<SkillRecord, "name" | "description" | "sections">, body: string): string {
  const lead = leadParagraph(body);
  const covers = record.sections.filter((s) => s.depth === 2).map((s) => s.heading).slice(0, 10);
  return [record.description, lead && lead !== record.description ? lead : "", covers.length ? `Covers: ${covers.join(" · ")}` : ""].filter(Boolean).join("\n");
}

/* ── Signatures ───────────────────────────────────────────────────────── */

const SIGNATURE_SIZE = 64;

function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** Bottom-k sketch of the distinct stemmed terms of a body. */
export function termSignature(text: string): number[] {
  const hashes = [...new Set(tokenize(text))].map(fnv1a);
  return [...new Set(hashes)].sort((a, b) => a - b).slice(0, SIGNATURE_SIZE);
}

/** Bottom-k Jaccard estimate between two sketches. */
export function signatureSimilarity(a: readonly number[], b: readonly number[]): number {
  if (!a.length || !b.length) return 0;
  const setA = new Set(a);
  const setB = new Set(b);
  const union = [...new Set([...a, ...b])].sort((x, y) => x - y).slice(0, SIGNATURE_SIZE);
  const both = union.filter((h) => setA.has(h) && setB.has(h)).length;
  return both / union.length;
}

export const sha256 = (text: string | Buffer): string => createHash("sha256").update(text).digest("hex");

/* ── Adapter contract ─────────────────────────────────────────────────── */

/** Everything an adapter knows about one skill before Fehm derives metadata. */
export interface RawSkill {
  id: string;
  name: string;
  description: string;
  kind: string;
  category: string;
  path: string;
  content: string;
  sources: SkillSource[];
  license: string;
  version: string;
  /** Intents assigned by catalog curation (frontmatter `intents`, routing.json). */
  catalogIntents: TaskIntent[];
  canonicalRank: Partial<Record<TaskIntent, number>>;
  catalogStyle: SkillStyle;
  catalogConflicts: string[];
  /** Technology implied by the catalog path (languages/go, frameworks/react). */
  catalogTechnology?: { kind: "language" | "framework"; name: string };
  principles: string[];
  dependencies: string[];
  resources: string[];
  provenance: Record<string, MetadataProvenance>;
}

/** A discovered skill, readable lazily so unchanged skills are never re-read. */
export interface SkillEntry {
  id: string;
  /** Absolute file path. */
  file: string;
  /** Hash of the adapter's descriptor (e.g. the manifest entry) — changes force re-derivation. */
  descriptorHash: string;
  read(): RawSkill;
}

export interface SkillAdapter {
  name: string;
  /** Adapter-level issues (unknown routing ids, unreadable manifest entries…). */
  warnings: string[];
  discover(): SkillEntry[];
}

/* ── Licenses ─────────────────────────────────────────────────────────── */

/** SPDX-ish id from license text; "unknown" unless the text says so. */
export function detectLicense(text: string | undefined): string {
  if (!text) return "unknown";
  const head = text.slice(0, 600);
  if (/\bMIT License\b|this MIT license/i.test(head)) return "MIT";
  if (/Apache License,?\s+Version 2\.0/i.test(head)) return "Apache-2.0";
  if (/BSD 3-Clause/i.test(head)) return "BSD-3-Clause";
  if (/BSD 2-Clause/i.test(head)) return "BSD-2-Clause";
  if (/Business Source License/i.test(head)) return "BSL-1.1";
  if (/GNU GENERAL PUBLIC LICENSE\s+Version 3/i.test(head)) return "GPL-3.0";
  return "unknown";
}

const readOptional = (file: string): string | undefined => {
  try {
    return readFileSync(file, "utf8");
  } catch {
    return undefined;
  }
};

/* ── Catalog adapter (skills/manifest.json) ───────────────────────────── */

interface ManifestSkill {
  id: string;
  name: string;
  category: string;
  path: string;
  description: string;
  kind: string;
  sources: { repository: string; original_path: string; sha256?: string; section?: string }[];
  principles?: string[];
  dependencies?: string[];
  steps?: { skill: string }[];
  resources?: unknown[];
  source_metadata?: { repository: string; frontmatter?: Record<string, unknown> }[];
  status?: string;
  superseded_by?: string;
}

interface Manifest {
  version?: string;
  sources: { repository: string; url?: string; revision?: string; commit?: string }[];
  skills: ManifestSkill[];
}

export interface CatalogRouting {
  intents: Partial<Record<TaskIntent, string[]>>;
  styles: Record<string, SkillStyle>;
  conflicts: [string, string][];
}

export function readRouting(dir: string): CatalogRouting {
  const text = readOptional(join(dir, "routing.json"));
  if (!text) return { intents: {}, styles: {}, conflicts: [] };
  const data = JSON.parse(text) as Partial<CatalogRouting>;
  return { intents: data.intents ?? {}, styles: data.styles ?? {}, conflicts: data.conflicts ?? [] };
}

const CATEGORY_INTENTS: Record<string, TaskIntent[]> = {
  debugging: ["debug"],
  testing: ["test"],
  verification: ["verify"],
  security: ["security"],
  performance: ["performance"],
  documentation: ["docs"],
  git: ["git"],
  release: ["ship"],
  devops: ["devops"],
  databases: ["database"],
  frontend: ["ui"],
  design: ["ui"],
  accessibility: ["ui"],
  ai: ["ai"],
  research: ["research"],
  "code-intelligence": ["explain"],
};

const INTENT_NAMES = new Set(Object.keys(INTENT_RULES));

/**
 * Fehm's curated catalog: manifest.json lists every skill with its upstream
 * sources and SHA-256; the SKILL.md frontmatter carries catalog fields; the
 * upstream author's own frontmatter is preserved in `source_metadata`.
 */
export function catalogAdapter(dir: string): SkillAdapter {
  const warnings: string[] = [];
  const adapter: SkillAdapter = {
    name: "catalog",
    warnings,
    discover() {
      warnings.length = 0;
      const manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8")) as Manifest;
      const routing = readRouting(dir);
      const byPath = new Map(manifest.skills.map((s) => [s.path, s.id]));
      const known = new Set(manifest.skills.map((s) => s.id));
      const repoInfo = new Map(manifest.sources.map((s) => [s.repository, s]));
      const licenseCache = new Map<string, string>();
      const licenseOf = (repository: string, upstream?: Record<string, unknown>): string => {
        if (!licenseCache.has(repository)) {
          const files = existsSync(join(dir, "licenses")) ? readdirSync(join(dir, "licenses")) : [];
          const file = files.find((f) => f.startsWith(`${repository}-LICENSE`));
          licenseCache.set(repository, detectLicense(file ? readOptional(join(dir, "licenses", file)) : undefined));
        }
        const fromFile = licenseCache.get(repository)!;
        if (fromFile !== "unknown") return fromFile;
        const declared = typeof upstream?.license === "string" ? upstream.license : undefined;
        return declared ?? "unknown";
      };
      const routingIntents = new Map<string, TaskIntent[]>();
      const canonical = new Map<string, Partial<Record<TaskIntent, number>>>();
      for (const [intent, ids] of Object.entries(routing.intents) as [TaskIntent, string[]][]) {
        if (!INTENT_NAMES.has(intent)) warnings.push(`routing.json: unknown intent "${intent}"`);
        ids.forEach((id, rank) => {
          if (!known.has(id)) warnings.push(`routing.json: unknown skill id "${id}" for intent ${intent}`);
          routingIntents.set(id, [...(routingIntents.get(id) ?? []), intent]);
          canonical.set(id, { ...canonical.get(id), [intent]: rank });
        });
      }
      for (const id of [...Object.keys(routing.styles), ...routing.conflicts.flat()]) if (!known.has(id)) warnings.push(`routing.json: unknown skill id "${id}"`);
      return manifest.skills.map((entry): SkillEntry => {
        const file = join(dir, entry.path);
        const catalogConflicts = routing.conflicts.filter((pair) => pair.includes(entry.id)).map((pair) => (pair[0] === entry.id ? pair[1] : pair[0]));
        const descriptor = { entry, routingIntents: routingIntents.get(entry.id) ?? [], style: routing.styles[entry.id] ?? {}, catalogConflicts, sources: entry.sources.map((s) => repoInfo.get(s.repository)) };
        return {
          id: entry.id,
          file,
          descriptorHash: sha256(JSON.stringify(descriptor)),
          read(): RawSkill {
            const content = readFileSync(file, "utf8");
            const { data } = parseFrontmatter(content);
            const upstream = entry.source_metadata?.[0]?.frontmatter;
            const primary = entry.sources[0];
            const repo = primary ? repoInfo.get(primary.repository) : undefined;
            const sources: SkillSource[] = entry.sources.map((s) => {
              const info = repoInfo.get(s.repository);
              const src: SkillSource = { repository: s.repository, commit: info?.commit ?? "unpinned", path: s.original_path };
              if (info?.url) src.url = info.url;
              if (s.sha256) src.sha256 = s.sha256;
              if (s.section) src.section = s.section;
              return src;
            });
            const dependencies: string[] = [];
            const resources: string[] = [];
            for (const d of entry.dependencies ?? []) {
              const target = byPath.get(d);
              if (target === entry.id) continue;
              if (target) dependencies.push(target);
              else resources.push(d);
            }
            for (const step of entry.steps ?? []) if (step.skill !== entry.id && known.has(step.skill)) dependencies.push(step.skill);
            const fmIntents = list(data.intents).filter((i): i is TaskIntent => INTENT_NAMES.has(i));
            const catalogIntents = [...new Set([...fmIntents, ...(routingIntents.get(entry.id) ?? [])])];
            const segs = entry.id.split("/");
            const catalogTechnology =
              (segs[0] === "languages" || segs[0] === "frameworks") && segs.length > 2
                ? { kind: segs[0] === "languages" ? ("language" as const) : ("framework" as const), name: segs[1]! }
                : undefined;
            const same = (field: string, value: string): boolean => typeof upstream?.[field] === "string" && upstream[field] === value;
            const raw: RawSkill = {
              id: entry.id,
              name: entry.name,
              description: entry.description,
              kind: entry.kind,
              category: entry.category,
              path: entry.path,
              content,
              sources,
              license: licenseOf(primary?.repository ?? "", upstream),
              version: typeof upstream?.version === "string" ? upstream.version : `catalog-${manifest.version ?? "0"}`,
              catalogIntents,
              canonicalRank: canonical.get(entry.id) ?? {},
              catalogStyle: routing.styles[entry.id] ?? {},
              catalogConflicts,
              principles: entry.principles ?? [],
              dependencies: [...new Set(dependencies)],
              resources,
              provenance: {
                name: same("name", entry.name) ? "upstream" : "catalog",
                description: same("description", entry.description) ? "upstream" : "catalog",
                category: "catalog",
                kind: "catalog",
                principles: "catalog",
                dependencies: "catalog",
                license: licenseCache.get(primary?.repository ?? "") !== "unknown" ? "catalog" : upstream?.license ? "upstream" : "inferred",
                version: typeof upstream?.version === "string" ? "upstream" : "catalog",
              },
            };
            if (catalogTechnology) raw.catalogTechnology = catalogTechnology;
            if (!repo?.commit) raw.provenance.sourceCommit = "catalog";
            return raw;
          },
        };
      });
    },
  };
  return adapter;
}

/* ── Directory adapter (upstream SKILL.md trees, agent definitions) ───── */

export interface DirectorySourceOptions {
  /** Source name used as the id prefix, e.g. "matt-pocock" → "matt-pocock:tdd". */
  name: string;
  url?: string;
  commit?: string;
  license?: string;
}

function walkMarkdown(root: string, dir = root, out: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir).sort();
  } catch {
    return out;
  }
  for (const name of entries) {
    if (name.startsWith(".") || name === "node_modules") continue;
    const abs = join(dir, name);
    const st = statSync(abs, { throwIfNoEntry: false });
    if (!st) continue;
    if (st.isDirectory()) walkMarkdown(root, abs, out);
    else if (name === "SKILL.md" || (name.endsWith(".md") && basename(dir) === "agents")) out.push(abs);
  }
  return out;
}

/** Commit from a checkout's .git (HEAD → ref), or undefined. */
export function gitCommit(root: string): string | undefined {
  const head = readOptional(join(root, ".git", "HEAD"))?.trim();
  if (!head) return undefined;
  if (/^[0-9a-f]{40}$/.test(head)) return head;
  const ref = /^ref: (.+)$/.exec(head)?.[1];
  const sha = ref ? readOptional(join(root, ".git", ref))?.trim() : undefined;
  return sha && /^[0-9a-f]{40}$/.test(sha) ? sha : undefined;
}

/**
 * Any directory of upstream skills: `**∕SKILL.md` (Agent Skills layout used by
 * Matt Pocock, Superpowers, Caveman, Ponytail) and `agents/*.md` agent
 * definitions with name/description frontmatter (ECC, Agency Agents).
 * Only name/description come from upstream; everything else is inferred.
 */
export function directoryAdapter(root: string, options: DirectorySourceOptions): SkillAdapter {
  const warnings: string[] = [];
  return {
    name: options.name,
    warnings,
    discover() {
      warnings.length = 0;
      const commit = options.commit ?? gitCommit(root) ?? "unpinned";
      const license = options.license ?? detectLicense(readOptional(join(root, "LICENSE")) ?? readOptional(join(root, "LICENSE.md")) ?? readOptional(join(root, "LICENSE.txt")));
      const seen = new Set<string>();
      const entries: SkillEntry[] = [];
      for (const file of walkMarkdown(root)) {
        const rel = relative(root, file).split(sep).join("/");
        const isAgent = basename(file) !== "SKILL.md";
        const slug = (isAgent ? basename(file, ".md") : basename(dirname(file))).toLowerCase().replace(/[^a-z0-9-]+/g, "-");
        let id = `${options.name}:${slug}`;
        if (seen.has(id)) {
          warnings.push(`duplicate skill slug "${slug}" at ${rel}; using path-qualified id`);
          id = `${options.name}:${rel.replace(/\/SKILL\.md$|\.md$/, "")}`;
        }
        seen.add(id);
        entries.push({
          id,
          file,
          descriptorHash: sha256(JSON.stringify({ id, rel, commit, license, url: options.url ?? "" })),
          read(): RawSkill {
            const content = readFileSync(file, "utf8");
            const { data } = parseFrontmatter(content);
            const name = str(data.name) ?? slug;
            const description = str(data.description) ?? leadParagraph(parseFrontmatter(content).body, 40);
            if (!str(data.description)) warnings.push(`${rel}: no description in frontmatter; used the first paragraph`);
            const source: SkillSource = { repository: options.name, commit, path: rel, sha256: sha256(content) };
            if (options.url) source.url = options.url;
            const parts = rel.split("/");
            return {
              id,
              name,
              description,
              kind: isAgent ? "agent" : "skill",
              category: parts.length > 2 ? parts[parts.length - 3]! : isAgent ? "agents" : "uncategorized",
              path: rel,
              content,
              sources: [source],
              license: str(data.license) ?? license,
              version: str(data.version) ?? commit,
              catalogIntents: [],
              canonicalRank: {},
              catalogStyle: {},
              catalogConflicts: [],
              principles: [],
              dependencies: list(data.dependencies ?? data.requires),
              resources: [],
              provenance: {
                name: str(data.name) ? "upstream" : "inferred",
                description: str(data.description) ? "upstream" : "inferred",
                category: "inferred",
                kind: "inferred",
                license: options.license ? "catalog" : str(data.license) ? "upstream" : "inferred",
                version: str(data.version) ? "upstream" : "inferred",
                dependencies: data.dependencies || data.requires ? "upstream" : "inferred",
              },
            };
          },
        });
      }
      return entries;
    },
  };
}

/* ── Normalization ────────────────────────────────────────────────────── */

const KIND_PRIORITY: Record<string, number> = {
  workflow: 1,
  methodology: 0.9,
  skill: 0.85,
  principle: 0.85,
  standard: 0.6,
  command: 0.6,
  agent: 0.55,
  context: 0.4,
  "reference-router": 0.3,
};

/** Fehm's derivation from a RawSkill; records which fields it inferred. */
export function normalizeSkill(raw: RawSkill, indexedAt: string): SkillRecord {
  const { body: rawBody } = parseFrontmatter(raw.content);
  const body = cleanBody(rawBody);
  const sections = sectionOutline(parseSections(body));
  const headline = `${raw.name} ${raw.id.split(/[/:]/).at(-1)} ${raw.description}`;
  const headTokens = words(headline);
  const nameTokens = words(`${raw.name} ${raw.id.split(/[/:]/).at(-1)}`);

  // Intents: catalog curation, the category and the name are strong evidence;
  // decisive words that appear only in the description are weak evidence.
  const taskEvidence: Partial<Record<TaskIntent, number>> = {};
  for (const i of [...raw.catalogIntents, ...(CATEGORY_INTENTS[raw.category.split("/")[0]!] ?? [])]) taskEvidence[i] = 1;
  for (const m of matchRules(nameTokens, INTENT_RULES)) taskEvidence[m.name] = 1;
  for (const m of matchRules(headTokens, INTENT_RULES)) if (m.weight >= 1) taskEvidence[m.name] ??= 0.5;
  const tasks = (Object.keys(taskEvidence) as TaskIntent[]).sort();

  const languages = new Set<string>();
  const frameworks = new Set<string>();
  if (raw.catalogTechnology) (raw.catalogTechnology.kind === "language" ? languages : frameworks).add(raw.catalogTechnology.name);
  const LANGUAGE_NAMES = new Set(["typescript", "javascript", "python", "go", "rust", "java", "kotlin", "swift", "ruby", "php", "perl", "cpp", "csharp", "dart", "fsharp"]);
  for (const t of detectTechnologies(headline, { strict: true })) (LANGUAGE_NAMES.has(t) ? languages : frameworks).add(t);

  const { useWhen, doNotUseWhen } = useConditions(raw.description);
  const triggers = extractTriggers(raw.description, `${raw.name} ${raw.id.split(/[/:]/).at(-1)}`);
  const explicit = triggers.length > 0 && /\b(use for|trigger:?)\s*["“/]/i.test(raw.description);
  const style = { ...inferStyle(`${raw.name} ${raw.description}`), ...raw.catalogStyle };
  const crossCutting = raw.kind === "principle";

  const summaryTokens = estimateTokens(summaryText({ name: raw.name, description: raw.description, sections }, body));
  const metadataText = `${raw.id} — ${raw.name}: ${raw.description}`;
  const primary = raw.sources[0] ?? { repository: "unknown", commit: "unpinned", path: raw.path };

  return {
    id: raw.id,
    name: raw.name,
    description: raw.description,
    kind: raw.kind,
    category: raw.category,
    source: primary.repository,
    sourceRepository: primary.url ?? primary.repository,
    sourceCommit: primary.commit,
    sourcePath: primary.path,
    sources: raw.sources,
    license: raw.license || "unknown",
    version: raw.version,
    domains: [...new Set([...matchDomains(headTokens), ...(raw.category.split("/")[0] === "security" ? ["security"] : [])])].sort(),
    tasks,
    taskEvidence,
    languages: [...languages].sort(),
    frameworks: [...frameworks].sort(),
    triggers,
    useWhen,
    doNotUseWhen,
    dependencies: raw.dependencies,
    resources: raw.resources,
    conflicts: [...new Set(raw.catalogConflicts)].sort(),
    style,
    principles: raw.principles,
    crossCutting,
    canonicalFor: raw.canonicalRank,
    priority: KIND_PRIORITY[raw.kind] ?? 0.5,
    invocationMode: explicit ? "explicit" : "auto",
    capabilities: inferCapabilities(body),
    riskFlags: inferRiskFlags(body),
    tokens: { metadata: estimateTokens(metadataText), summary: summaryTokens, full: estimateTokens(body) },
    sections,
    signature: termSignature(body),
    path: raw.path,
    contentHash: sha256(raw.content),
    indexedAt,
    metadataProvenance: {
      ...raw.provenance,
      tasks: raw.catalogIntents.length ? "catalog" : "inferred",
      taskEvidence: "inferred",
      canonicalFor: "catalog",
      languages: raw.catalogTechnology?.kind === "language" ? "catalog" : "inferred",
      frameworks: raw.catalogTechnology?.kind === "framework" ? "catalog" : "inferred",
      domains: "inferred",
      triggers: "inferred",
      useWhen: "inferred",
      doNotUseWhen: "inferred",
      conflicts: raw.catalogConflicts.length ? "catalog" : "inferred",
      style: Object.keys(raw.catalogStyle).length ? "catalog" : "inferred",
      priority: "inferred",
      invocationMode: "inferred",
      capabilities: "inferred",
      riskFlags: "inferred",
      tokens: "inferred",
    },
  };
}

