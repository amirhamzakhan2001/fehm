import { createHash } from "node:crypto";
import { join } from "node:path";
import type { FehmEngine } from "../engine.js";
import { ANALYSIS_VERSION, GRAPH_SCHEMA_VERSION, type FileRole } from "../model.js";
import { readJson, stateDir, writeJsonAtomic } from "../persistence.js";
import { classifyRole, detectLanguage } from "../scanner.js";
import { detectArchetype, expandedByDefault, priorityOf, type ArchetypeInfo, type SectionBuilder } from "./builder.js";
import { finishSection, round } from "./evidence.js";
import { BriefingFacts } from "./facts.js";
import { cheatSheet, components, dependencies, engineerMustKnow, risks } from "./sections-analysis.js";
import { api, database, infrastructure, integrations, security, technology, testing } from "./sections-interfaces.js";
import { architecture, ARCHETYPE_NOUN, dataFlows, entryPoints, features, overview, runtime } from "./sections-structure.js";
import { BRIEFING_SCHEMA, BRIEFING_VERSION, SECTION_IDS, type BriefingFreshness, type BriefingSection, type CodebaseBriefing, type SectionId } from "./types.js";

const ALL_ROLES: FileRole[] = ["source", "test", "config", "manifest", "docs", "other"];
const CODE: FileRole[] = ["source", "manifest"];

/**
 * What each section reads. `content`: roles whose file *contents* feed the
 * section; `presence`: roles whose file *paths* (added/removed files) matter;
 * `upstream`: sections it summarizes. A change invalidates a section only
 * when it touches one of these, so a README edit leaves the database,
 * runtime and security sections cached.
 */
export const SECTION_DEPENDENCIES: Record<SectionId, { content: FileRole[]; presence?: FileRole[]; upstream?: SectionId[] }> = {
  architecture: { content: ["source", "test", "manifest"], presence: ALL_ROLES },
  entryPoints: { content: CODE },
  features: { content: ["source", "test", "manifest"] },
  dataFlows: { content: CODE },
  api: { content: CODE },
  database: { content: ["source", "manifest", "config"], presence: ALL_ROLES },
  integrations: { content: CODE },
  infrastructure: { content: ["config", "manifest"], presence: ALL_ROLES },
  security: { content: CODE },
  components: { content: CODE },
  technology: { content: ["source", "test", "manifest"] },
  testing: { content: ["source", "test", "manifest", "config"] },
  runtime: { content: ["source", "manifest", "config"] },
  dependencies: { content: CODE },
  overview: { content: ["source", "test", "manifest", "docs"], upstream: ["architecture", "features"] },
  risks: { content: ["source", "test", "manifest", "config"], upstream: ["infrastructure"] },
  engineerMustKnow: { content: ["source", "test", "manifest"], upstream: ["entryPoints", "components", "dataFlows", "database", "runtime", "testing", "integrations", "risks"] },
  cheatSheet: { content: CODE, upstream: SECTION_IDS.filter((s) => s !== "cheatSheet") as SectionId[] },
};

const BUILDERS: Record<SectionId, SectionBuilder> = {
  overview, architecture, entryPoints, features, dataFlows, api, database, integrations, infrastructure,
  security, components, technology, testing, runtime, dependencies, risks, engineerMustKnow, cheatSheet,
};

/** Upstream sections first. */
export const BUILD_ORDER: SectionId[] = (() => {
  const out: SectionId[] = [];
  const visit = (id: SectionId): void => {
    if (out.includes(id)) return;
    for (const u of SECTION_DEPENDENCIES[id].upstream ?? []) visit(u);
    out.push(id);
  };
  for (const id of SECTION_IDS) visit(id);
  return out;
})();

interface CacheFile {
  version: string;
  schema: string;
  sections: Partial<Record<SectionId, { fingerprint: string; section: BriefingSection }>>;
  meta?: { fingerprint: string; archetype: ArchetypeInfo };
}

export interface BriefingOptions {
  stateDirectory?: string;
  /** Do not read or write `.fehm/briefing.json`. */
  dryRun?: boolean;
  /** Ignore the cache (still writes it unless dryRun). */
  force?: boolean;
}

export const briefingCachePath = (root: string, dir?: string): string => join(stateDir(root, dir), "briefing.json");

function roleOf(path: string, roles: Map<string, FileRole>): FileRole {
  return roles.get(path) ?? classifyRole(path, detectLanguage(path));
}

/**
 * Build the Feature 3.2 briefing from the Feature 1 engine. Deterministic:
 * no model call, no API key. Sections whose inputs are unchanged since the
 * last build are reused from `.fehm/briefing.json`.
 */
export function buildCodebaseBriefing(engine: FehmEngine, options: BriefingOptions = {}): CodebaseBriefing {
  const started = performance.now();
  const facts = new BriefingFacts(engine);
  const roles = new Map<string, FileRole>(facts.files.map((f) => [f.path, f.role]));
  const hashes = engine.fileHashes();
  const byRole = new Map<FileRole, { content: string[]; presence: string[] }>();
  for (const [path, hash] of [...hashes.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    const r = roleOf(path, roles);
    const e = byRole.get(r) ?? { content: [], presence: [] };
    e.content.push(`${path}:${hash}`);
    e.presence.push(path);
    byRole.set(r, e);
  }
  const digest = (parts: string[]): string => createHash("sha256").update(parts.join("\n")).digest("hex").slice(0, 32);
  const roleDigest = new Map<string, string>();
  const inputDigest = (kind: "content" | "presence", rs: FileRole[]): string => {
    const key = `${kind}:${rs.join(",")}`;
    if (!roleDigest.has(key)) roleDigest.set(key, digest(rs.flatMap((r) => byRole.get(r)?.[kind] ?? [])));
    return roleDigest.get(key)!;
  };
  const base = `${BRIEFING_VERSION}|${GRAPH_SCHEMA_VERSION}|${ANALYSIS_VERSION}`;

  const cachePath = briefingCachePath(engine.root, options.stateDirectory);
  const read = options.dryRun || options.force ? undefined : readJson<CacheFile>(cachePath);
  const cache: CacheFile = read?.ok && read.value.version === BRIEFING_VERSION && read.value.schema === BRIEFING_SCHEMA ? read.value : { version: BRIEFING_VERSION, schema: BRIEFING_SCHEMA, sections: {} };

  const metaFingerprint = digest([base, "meta", inputDigest("content", CODE)]);
  const archetype = cache.meta?.fingerprint === metaFingerprint ? cache.meta.archetype : detectArchetype(facts);
  cache.meta = { fingerprint: metaFingerprint, archetype };

  const built = new Map<SectionId, BriefingSection>();
  const fingerprints = new Map<SectionId, string>();
  const reused: SectionId[] = [];
  const rebuilt: SectionId[] = [];
  for (const id of BUILD_ORDER) {
    const dep = SECTION_DEPENDENCIES[id];
    const fp = digest([base, id, inputDigest("content", dep.content), dep.presence ? inputDigest("presence", dep.presence) : "", ...(dep.upstream ?? []).map((u) => fingerprints.get(u) ?? "")]);
    fingerprints.set(id, fp);
    const hit = cache.sections[id];
    let section: BriefingSection;
    if (hit && hit.fingerprint === fp) {
      section = { ...hit.section, priority: priorityOf(id, archetype), expanded: expandedByDefault(id, archetype) };
      reused.push(id);
    } else {
      const upstream = new Map<SectionId, BriefingSection>();
      for (const u of dep.upstream ?? []) upstream.set(u, built.get(u)!);
      section = finishSection(BUILDERS[id]({ facts, archetype, upstream }), priorityOf(id, archetype), expandedByDefault(id, archetype));
      cache.sections[id] = { fingerprint: fp, section };
      rebuilt.push(id);
    }
    built.set(id, section);
  }
  if (!options.dryRun && rebuilt.length) writeJsonAtomic(cachePath, cache);

  const sections = SECTION_IDS.map((id) => built.get(id)!);
  const claims = sections.flatMap((s) => s.claims);
  const unknowns: CodebaseBriefing["unknowns"] = [];
  const seenUnknown = new Set<string>();
  for (const s of sections) for (const u of s.unknowns) if (!seenUnknown.has(u)) (seenUnknown.add(u), unknowns.push({ section: s.id, text: u }));
  const stats = engine.graph.stats();
  let heuristic = 0;
  let relationships = 0;
  for (const [k, v] of Object.entries(stats.edgesByKind)) if (k !== "contains" && k !== "defines") relationships += v ?? 0;
  heuristic = stats.edgesByProvenance.heuristic ?? 0;
  const overviewSec = built.get("overview")!;
  const name = (overviewSec.blocks.find((b) => b.type === "facts") as { rows: { label: string; value: string }[] } | undefined)?.rows.find((r) => r.label === "Project")?.value ?? facts.name;
  return {
    schemaVersion: BRIEFING_SCHEMA,
    mode: "deterministic",
    repository: { name, root: engine.root, fingerprint: digest([...hashes.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([p, h]) => `${p}:${h}`)) },
    generatedAt: new Date().toISOString(),
    headline: { name, tagline: tagline(overviewSec.summary), tags: headlineTags(built, archetype) },
    archetype,
    metrics: {
      claims: claims.length,
      confirmedShare: claims.length ? round(claims.filter((c) => c.state === "confirmed").length / claims.length) : 0,
      unknowns: unknowns.length,
      files: stats.files,
      symbols: stats.nodes - stats.files - (stats.nodesByKind.directory ?? 0) - (stats.nodesByKind.repository ?? 0) - (stats.nodesByKind.package ?? 0),
      relationships,
      heuristicShare: relationships ? round(Math.min(1, heuristic / relationships)) : 0,
    },
    freshness: { fresh: true, checkedAt: new Date().toISOString(), changed: { added: [], modified: [], deleted: [] }, affectedSections: [] },
    sections,
    unknowns,
    cache: { reused, rebuilt, durationMs: Math.round(performance.now() - started) },
  };
}

function tagline(summary: string): string {
  const first = /^(.+?[.!?])(\s|$)/.exec(summary)?.[1] ?? summary;
  return first.length > 160 ? `${first.slice(0, 157)}…` : first;
}

function headlineTags(built: Map<SectionId, BriefingSection>, archetype: ArchetypeInfo): string[] {
  const tags: string[] = [];
  const tech = built.get("technology");
  const rows = (tech?.blocks.find((b) => b.type === "facts") as { rows: { label: string; value: string }[] } | undefined)?.rows ?? [];
  for (const l of (rows.find((r) => r.label === "Languages")?.value ?? "").split(", ")) {
    const n = l.replace(/\s*\(.*$/, "").trim();
    if (n && n !== "—") tags.push(n);
  }
  const runtimeRow = rows.find((r) => r.label === "Runtime")?.value;
  if (runtimeRow) tags.push(...runtimeRow.split(", ").map((r) => r.replace(/\s*[>=<^~].*$/, "").trim()));
  const style = built.get("architecture")?.summary ?? "";
  if (/CLI/.test(style)) tags.push("CLI");
  if (/localhost HTTP/.test(style)) tags.push("Local server");
  else if (/HTTP server/.test(style)) tags.push("HTTP server");
  if (/library/.test(style)) tags.push("Library");
  tags.push(ARCHETYPE_NOUN[archetype.primary] ?? archetype.primary);
  return [...new Set(tags)].slice(0, 8);
}

/** Sections a set of changed paths invalidates (direct inputs, then everything downstream). */
export function affectedSections(changed: BriefingFreshness["changed"], roles: Map<string, FileRole>): SectionId[] {
  const contentRoles = new Set<FileRole>();
  const presenceRoles = new Set<FileRole>();
  for (const p of changed.modified) contentRoles.add(roleOf(p, roles));
  for (const p of [...changed.added, ...changed.deleted]) {
    const r = roleOf(p, roles);
    contentRoles.add(r);
    presenceRoles.add(r);
  }
  const hit = new Set<SectionId>();
  for (const id of BUILD_ORDER) {
    const d = SECTION_DEPENDENCIES[id];
    if (d.content.some((r) => contentRoles.has(r)) || d.presence?.some((r) => presenceRoles.has(r)) || d.upstream?.some((u) => hit.has(u))) hit.add(id);
  }
  return SECTION_IDS.filter((s) => hit.has(s));
}

/**
 * Overlay working-tree freshness on a built briefing: which files changed
 * since the index, which sections that affects, and which evidence points at
 * a changed file. Old information is flagged, never presented as current.
 */
export function withFreshness(briefing: CodebaseBriefing, engine: FehmEngine): CodebaseBriefing {
  const c = engine.changes();
  const changed = { added: c.added, modified: c.modified, deleted: c.deleted };
  const all = new Set([...c.added, ...c.modified, ...c.deleted]);
  if (!all.size) return { ...briefing, freshness: { fresh: true, checkedAt: new Date().toISOString(), changed, affectedSections: [] } };
  const roles = new Map<string, FileRole>();
  for (const n of engine.graph.nodes()) if (n.kind === "file" && n.path) roles.set(n.path, (/role=(\w+)/.exec(n.evidence.detail ?? "")?.[1] as FileRole | undefined) ?? "other");
  const affected = affectedSections(changed, roles);
  const sections = briefing.sections.map((s) => {
    let stale = affected.includes(s.id);
    const claims = s.claims.map((cl) => {
      if (!cl.evidence.some((e) => all.has(e.path))) return cl;
      stale = true;
      return { ...cl, evidence: cl.evidence.map((e) => (all.has(e.path) ? { ...e, stale: true } : e)) };
    });
    return stale ? { ...s, stale: true, claims } : s;
  });
  return { ...briefing, sections, freshness: { fresh: false, checkedAt: new Date().toISOString(), changed, affectedSections: affected } };
}

/** Cheap freshness summary for polling (no briefing rebuild). */
export function briefingFreshness(engine: FehmEngine): BriefingFreshness {
  const c = engine.changes();
  const changed = { added: c.added, modified: c.modified, deleted: c.deleted };
  const roles = new Map<string, FileRole>();
  for (const n of engine.graph.nodes()) if (n.kind === "file" && n.path) roles.set(n.path, (/role=(\w+)/.exec(n.evidence.detail ?? "")?.[1] as FileRole | undefined) ?? "other");
  const fresh = !c.added.length && !c.modified.length && !c.deleted.length;
  return { fresh, checkedAt: new Date().toISOString(), changed, affectedSections: fresh ? [] : affectedSections(changed, roles) };
}
