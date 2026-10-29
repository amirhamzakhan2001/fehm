import { posix } from "node:path";
import type { CodeGraph } from "./graph.js";
import type { Language, NodeKind } from "./model.js";

/** Derived purely from the graph; no filesystem access. */
export function languageCounts(graph: CodeGraph): Partial<Record<Language, number>> {
  const out: Partial<Record<Language, number>> = {};
  for (const n of graph.nodes()) if (n.kind === "file" && n.language) out[n.language] = (out[n.language] ?? 0) + 1;
  return out;
}

function role(graph: CodeGraph, id: string): string {
  return /role=(\w+)/.exec(graph.node(id)?.evidence.detail ?? "")?.[1] ?? "other";
}

/** Directories holding the most non-test source files (top-level-most on ties). */
export function topDirectories(graph: CodeGraph, limit: number): string[] {
  const counts = new Map<string, number>();
  for (const n of graph.nodes()) {
    if (n.kind !== "file" || !n.path || role(graph, n.id) !== "source") continue;
    const dir = posix.dirname(n.path);
    counts.set(dir, (counts.get(dir) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].split("/").length - b[0].split("/").length || (a[0] < b[0] ? -1 : 1))
    .slice(0, limit)
    .map(([d]) => d);
}

const ENTRY_PATTERNS = [
  /^(src\/)?(index|main|app|server|cli)\.[cm]?[jt]sx?$/,
  /^(src\/)?(main|__main__|app|manage|wsgi|asgi)\.py$/,
  /(^|\/)__main__\.py$/,
  /^(cmd\/[^/]+\/)?main\.go$/,
  /^src\/(main|lib)\.rs$/,
  /(^|\/)Main\.java$/,
  /(^|\/)Application\.java$/,
];

/** Files that look like entry points by conventional name, plus files nothing imports that import others. */
export function entryPoints(graph: CodeGraph): string[] {
  const out = new Set<string>();
  for (const n of graph.nodes()) {
    if (n.kind !== "file" || !n.path || n.isTest) continue;
    if (ENTRY_PATTERNS.some((p) => p.test(n.path!))) out.add(n.path);
  }
  return [...out].sort();
}

export interface SystemMap {
  name: string;
  root: string;
  languages: Partial<Record<Language, number>>;
  files: { total: number; source: number; test: number; config: number; manifest: number; docs: number };
  symbols: Partial<Record<NodeKind, number>>;
  entryPoints: string[];
  manifests: string[];
  directories: { path: string; files: number; symbols: number; tests: number }[];
  externalPackages: { name: string; importers: number }[];
}

export function systemMap(graph: CodeGraph): SystemMap {
  const stats = graph.stats();
  const files = { total: 0, source: 0, test: 0, config: 0, manifest: 0, docs: 0 };
  const manifests: string[] = [];
  const dirs = new Map<string, { files: number; symbols: number; tests: number }>();
  for (const n of graph.nodes()) {
    if (n.kind === "file" && n.path) {
      files.total += 1;
      const r = role(graph, n.id) as keyof typeof files;
      if (r in files && r !== "total") files[r] += 1;
      if (r === "manifest") manifests.push(n.path);
      const d = posix.dirname(n.path);
      const entry = dirs.get(d) ?? { files: 0, symbols: 0, tests: 0 };
      entry.files += 1;
      if (n.isTest) entry.tests += 1;
      entry.symbols += graph.edgesOf(n.id, "out", ["defines"]).length;
      dirs.set(d, entry);
    }
  }
  const { nodesByKind } = stats;
  const symbols: Partial<Record<NodeKind, number>> = {};
  for (const k of ["module", "class", "interface", "enum", "function", "method", "field", "variable", "type", "route", "section"] as const) if (nodesByKind[k]) symbols[k] = nodesByKind[k];
  return {
    name: graph.node("repository:.")?.name ?? posix.basename(graph.root),
    root: graph.root,
    languages: languageCounts(graph),
    files,
    symbols,
    entryPoints: entryPoints(graph),
    manifests: manifests.sort(),
    directories: [...dirs.entries()].map(([path, v]) => ({ path, ...v })).sort((a, b) => (a.path < b.path ? -1 : 1)),
    externalPackages: graph
      .nodes()
      .filter((n) => n.kind === "package")
      .map((n) => ({ name: n.name, importers: graph.edgesOf(n.id, "in", ["imports"]).length }))
      .sort((a, b) => b.importers - a.importers || (a.name < b.name ? -1 : 1)),
  };
}

export interface ConnectivityReport {
  /** Connected components of the file-level dependency graph (imports + cross-file symbol edges). */
  components: { size: number; sample: string[] }[];
  /** Source files with no dependency edges in or out. */
  isolatedFiles: string[];
  /** Most depended-upon files. */
  hubs: { path: string; dependents: number }[];
  /** Symbols with no incoming calls/references/uses (candidates, not proof, of dead code). */
  unreferencedExports: string[];
  unresolved: Partial<Record<string, number>>;
  edgesByProvenance: Record<string, number>;
}

export function connectivity(graph: CodeGraph): ConnectivityReport {
  const fileOf = (id: string): string | undefined => {
    const n = graph.node(id);
    return n?.kind === "file" || (n && n.kind !== "package" && n.kind !== "directory" && n.kind !== "repository") ? n.path : undefined;
  };
  const sourceFiles = graph.nodes().filter((n) => n.kind === "file" && role(graph, n.id) !== "docs" && role(graph, n.id) !== "config" && role(graph, n.id) !== "manifest" && n.path).map((n) => n.path!);
  const adj = new Map<string, Set<string>>(sourceFiles.map((p) => [p, new Set()]));
  const dependents = new Map<string, Set<string>>();
  for (const e of graph.edges()) {
    if (e.kind === "contains" || e.kind === "defines") continue;
    const a = fileOf(e.source);
    const b = fileOf(e.target);
    if (!a || !b || a === b || !adj.has(a) || !adj.has(b)) continue;
    adj.get(a)!.add(b);
    adj.get(b)!.add(a);
    let set = dependents.get(b);
    if (!set) dependents.set(b, (set = new Set()));
    set.add(a);
  }
  const seen = new Set<string>();
  const components: ConnectivityReport["components"] = [];
  for (const start of [...adj.keys()].sort()) {
    if (seen.has(start)) continue;
    const members: string[] = [];
    const stack = [start];
    seen.add(start);
    while (stack.length) {
      const cur = stack.pop()!;
      members.push(cur);
      for (const next of adj.get(cur) ?? []) if (!seen.has(next)) (seen.add(next), stack.push(next));
    }
    components.push({ size: members.length, sample: members.sort().slice(0, 5) });
  }
  components.sort((a, b) => b.size - a.size || (a.sample[0]! < b.sample[0]! ? -1 : 1));
  const unreferencedExports = graph
    .nodes()
    .filter((n) => n.exported && !n.isTest && n.kind !== "file" && n.kind !== "package" && !/\.(constructor|__\w+__)$/.test(n.name))
    .filter((n) => graph.edgesOf(n.id, "in", ["calls", "references", "uses", "extends", "implements"]).length === 0)
    .map((n) => n.id);
  const unresolved: Partial<Record<string, number>> = {};
  for (const u of graph.unresolved) unresolved[u.kind] = (unresolved[u.kind] ?? 0) + 1;
  const stats = graph.stats();
  return {
    components: components.filter((c) => c.size > 1),
    isolatedFiles: components.filter((c) => c.size === 1).map((c) => c.sample[0]!),
    hubs: [...dependents.entries()].map(([path, s]) => ({ path, dependents: s.size })).sort((a, b) => b.dependents - a.dependents || (a.path < b.path ? -1 : 1)).slice(0, 10),
    unreferencedExports,
    unresolved,
    edgesByProvenance: stats.edgesByProvenance as Record<string, number>,
  };
}
