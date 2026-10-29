import { posix } from "node:path";
import type { BriefingFacts } from "./facts.js";
import type { SectionDraft } from "./evidence.js";
import type { Archetype, BriefingItem, BriefingSection, SectionId } from "./types.js";

export interface ArchetypeInfo {
  primary: Archetype;
  secondary: Archetype[];
  signals: string[];
}

export interface BuildContext {
  facts: BriefingFacts;
  archetype: ArchetypeInfo;
  /** Already-built sections this one depends on (see SECTION_DEPENDENCIES). */
  upstream: Map<SectionId, BriefingSection>;
}

export type SectionBuilder = (ctx: BuildContext) => SectionDraft;

/**
 * Repository archetype from interface evidence. It changes section depth and
 * order only; every section is still produced.
 */
export function detectArchetype(facts: BriefingFacts): ArchetypeInfo {
  const score = new Map<Archetype, number>();
  const signals: string[] = [];
  const bump = (a: Archetype, n: number, why: string): void => {
    score.set(a, (score.get(a) ?? 0) + n);
    signals.push(why);
  };
  const s = facts.signals;
  const pkgs = new Set(facts.packages.filter((p) => facts.runtimeImporters(p).length).map((p) => p.name));
  const declared = new Set(facts.declaredDependencies.map((d) => d.name));
  const has = (n: string): boolean => pkgs.has(n) || declared.has(n);
  if (facts.manifests.some((m) => m.bin.length)) bump("cli", 3, "declares a command-line binary");
  if (s.cli.length) bump("cli", 2, `${s.cli.length} CLI command dispatch cases`);
  const apiRoutes = s.routes.filter((r) => r.route.startsWith("/api") || r.style !== "switch");
  if (s.routes.length) bump(s.routes.length >= 3 && apiRoutes.length ? "api" : "service", Math.min(4, 1 + s.routes.length / 5), `${s.routes.length} HTTP routes`);
  if (["express", "fastify", "koa", "hono", "@nestjs/core", "flask", "fastapi", "django", "github.com/gin-gonic/gin"].some(has)) bump("api", 2, "web framework dependency");
  if (["react", "vue", "svelte", "@angular/core", "next"].some(has)) bump("frontend", 3, "UI framework dependency");
  const tsx = facts.sourceFiles.filter((p) => /\.(tsx|jsx|vue|svelte)$/.test(p)).length;
  if (tsx >= 5) bump("frontend", 2, `${tsx} component files`);
  if (["torch", "tensorflow", "sklearn", "scikit-learn", "transformers"].some(has)) bump("ml", 4, "ML framework dependency");
  if (s.runtime.some((r) => r.kind === "worker" || r.kind === "scheduled")) bump("service", 1, "background workers or schedules");
  if (facts.manifests.some((m) => m.main) && !facts.manifests.some((m) => m.bin.length) && !s.routes.length) bump("library", 2, "package entry (main) without binary or routes");
  const ranked = [...score.entries()].sort((a, b) => b[1] - a[1]);
  const primary = ranked[0]?.[0] ?? "library";
  return { primary, secondary: ranked.slice(1).filter(([, v]) => v >= 2).map(([k]) => k), signals };
}

/** Section relevance per archetype (higher = more relevant, ordered first among collapsible sections). */
const PRIORITY: Record<Archetype, Partial<Record<SectionId, number>>> = {
  cli: { entryPoints: 9, runtime: 8, dataFlows: 8, features: 8, components: 7, integrations: 5, api: 3, database: 3 },
  api: { api: 9, security: 8, database: 8, dataFlows: 8, infrastructure: 7, integrations: 7 },
  frontend: { entryPoints: 8, features: 8, api: 6, infrastructure: 6, technology: 7 },
  library: { components: 9, api: 3, technology: 7, testing: 7, dependencies: 7 },
  ml: { dataFlows: 9, integrations: 8, runtime: 8, technology: 8 },
  service: { runtime: 9, infrastructure: 8, integrations: 8, dataFlows: 7 },
};

export function priorityOf(id: SectionId, a: ArchetypeInfo): number {
  return Math.max(PRIORITY[a.primary][id] ?? 5, ...a.secondary.map((s) => (PRIORITY[s][id] ?? 5) - 1));
}

/** Level-1/2 sections open by default, plus the archetype's most relevant collapsible section. */
export function expandedByDefault(id: SectionId, a: ArchetypeInfo): boolean {
  if (id === "overview" || id === "architecture" || id === "entryPoints" || id === "features" || id === "cheatSheet") return true;
  const top: Partial<Record<Archetype, SectionId>> = { cli: "dataFlows", api: "api", ml: "dataFlows", service: "runtime", library: "components", frontend: "dataFlows" };
  return top[a.primary] === id;
}

const GENERIC = new Set(["src", "lib", "ui", "core", "utils", "util", "common", "shared", "internal", "pkg", "app", "main", "index", "helpers", "components"]);

/**
 * `src/skill-*` → "Skill", `src/visualization/graph/ui/main` → "Graph UI main",
 * `src/util` → "Util". Generic trailing segments borrow their parent's name.
 */
export function humanizeModule(module: string, extraSegments = 0): string {
  const parts = module.replace(/\*$/, "").split("/").filter((p) => p && p !== ".");
  if (!parts.length) return "Root";
  const picked: string[] = [];
  for (let i = parts.length - 1; i >= 0; i -= 1) {
    const seg = parts[i]!;
    const generic = GENERIC.has(seg.toLowerCase());
    if (generic && i === 0 && picked.length) break;
    picked.unshift(seg);
    if (!generic && extraSegments-- <= 0) break;
  }
  const words = picked
    .map((w) => (w.toLowerCase() === "ui" ? "UI" : w.toLowerCase() === "api" ? "API" : w.toLowerCase() === "cli" ? "CLI" : w))
    .join(" ")
    .replace(/[-_.]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Human labels for every module, widened with parent segments until they are unique. */
export function moduleLabels(modules: string[]): Map<string, string> {
  const out = new Map<string, string>();
  const extra = new Map<string, number>(modules.map((m) => [m, 0]));
  for (let round = 0; round < 4; round += 1) {
    const byLabel = new Map<string, string[]>();
    for (const m of modules) {
      const l = humanizeModule(m, extra.get(m)!);
      out.set(m, l);
      byLabel.set(l, [...(byLabel.get(l) ?? []), m]);
    }
    const clashes = [...byLabel.values()].filter((ms) => ms.length > 1);
    if (!clashes.length) break;
    for (const ms of clashes) for (const m of ms) extra.set(m, extra.get(m)! + 1);
  }
  return out;
}

export function fileItem(path: string, detail?: string, badge?: string): BriefingItem {
  return { title: path, path, nodeId: `file:${path}`, ...(detail ? { detail } : {}), ...(badge ? { badge } : {}) };
}

export function plural(n: number, word: string, pluralWord = `${word}s`): string {
  return `${n} ${n === 1 ? word : pluralWord}`;
}

export function listText(items: string[], max = 5): string {
  const shown = items.slice(0, max);
  if (items.length <= 1) return shown.join("");
  const more = items.length > max ? ` and ${items.length - max} more` : "";
  return more ? `${shown.join(", ")}${more}` : `${shown.slice(0, -1).join(", ")} and ${shown.at(-1)}`;
}

export function shortPath(path: string): string {
  return path.length > 48 ? `…/${posix.basename(posix.dirname(path))}/${posix.basename(path)}` : path;
}

export function pct(v: number): string {
  return `${Math.round(v * 100)}%`;
}
