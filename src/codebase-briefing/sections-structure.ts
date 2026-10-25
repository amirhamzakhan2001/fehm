import { posix } from "node:path";
import type { FlowStep } from "../engine.js";
import type { GraphNode } from "../model.js";
import { fileItem, listText, plural, type BuildContext, type SectionBuilder } from "./builder.js";
import { ClaimSet, ev, nodeEv, type SectionDraft } from "./evidence.js";
import type { BriefingFacts, CliCommand, Route } from "./facts.js";
import type { Block, BriefingEvidence, BriefingItem, FlowStepView } from "./types.js";

const LANGUAGE_LABEL: Record<string, string> = { typescript: "TypeScript", javascript: "JavaScript", python: "Python", go: "Go", rust: "Rust", java: "Java" };

export function languagesOf(facts: BriefingFacts): { name: string; files: number }[] {
  const counts = new Map<string, number>();
  for (const f of facts.files) {
    if (f.role !== "source" && f.role !== "test") continue;
    const l = f.node.language && LANGUAGE_LABEL[f.node.language];
    if (l) counts.set(l, (counts.get(l) ?? 0) + 1);
  }
  return [...counts.entries()].map(([name, files]) => ({ name, files })).sort((a, b) => b.files - a.files);
}

function manifestEv(facts: BriefingFacts, path: string, line?: number): BriefingEvidence {
  return ev(path, line, { source: facts.roleByPath.get(path) === "docs" ? "documentation" : "manifest", provenance: "filesystem" });
}

// ─── 6.1 Overview ─────────────────────────────────────────────────

export const overview: SectionBuilder = ({ facts, upstream, archetype }) => {
  const set = new ClaimSet("overview");
  const m = facts.primaryManifest;
  const readme = facts.readme;
  const name = m?.name ?? facts.name;
  const blocks: Block[] = [];
  let purposeClaim: string;
  let purpose: string;
  if (m?.description) {
    purpose = m.description;
    purposeClaim = set.declared(`Declared purpose: ${m.description}`, [manifestEv(facts, m.path, m.descriptionLine)], "Stated by the project manifest; the rest of this briefing checks it against the code.");
  } else if (readme) {
    purpose = readme.text;
    purposeClaim = set.declared(`README: ${readme.text}`, [ev(readme.path, readme.line, { source: "documentation" })], "Stated by documentation, which can drift from the code.");
  } else {
    purpose = `A ${languagesOf(facts)[0]?.name ?? "multi-language"} ${ARCHETYPE_NOUN[archetype.primary]}.`;
    purposeClaim = set.inferred(purpose, [], 0.5, "No manifest description or README paragraph was found; inferred from interfaces only.");
    set.unknowns.push("Project purpose is not documented in a manifest description or README.");
  }
  blocks.push({ type: "text", text: purpose, claim: purposeClaim });

  const consumers: BriefingItem[] = [];
  for (const mf of facts.manifests) for (const b of mf.bin) consumers.push({ title: `Command-line users`, detail: `\`${b.name}\` binary → ${b.target}`, claim: set.declared(`Ships a \`${b.name}\` command-line binary.`, [manifestEv(facts, mf.path, b.line)]) });
  const routes = facts.signals.routes;
  if (routes.length) {
    const servers = [...new Set(routes.map((r) => r.path))];
    consumers.push({ title: "HTTP clients", detail: `${plural(routes.length, "route")} in ${listText(servers, 3)}`, claim: set.observed(`Exposes ${plural(routes.length, "HTTP route")}.`, routes.slice(0, 6).map((r) => ev(r.path, r.line, { provenance: "heuristic", detail: `${r.method} ${r.route}` }))) });
  }
  const libs = facts.manifests.filter((mf) => mf.main && mf.kind === "npm");
  for (const mf of libs) consumers.push({ title: "Library consumers", detail: `package entry ${mf.main}`, claim: set.declared(`Importable as a package (main: ${mf.main}).`, [manifestEv(facts, mf.path)]) });
  if (archetype.primary === "frontend") consumers.push({ title: "Browser users", detail: "UI framework and component files", claim: set.inferred("Serves a browser user interface.", [], 0.65) });
  if (!consumers.length) set.unknown("Primary consumers could not be determined: no binary, routes or package entry were found.");

  const langs = languagesOf(facts);
  const stats = facts.graph.stats();
  const sizeClaim = set.observed(`${plural(facts.sourceFiles.length, "source file")}, ${plural(facts.testFiles.length, "test file")}, ${stats.nodes - stats.files} graph entities and ${stats.edges} relationships.`, [ev(".", undefined, { source: "index", provenance: "filesystem", detail: "Feature 1 index" })]);
  const arch = upstream.get("architecture");
  const features = upstream.get("features");
  const rows = [
    { label: "Project", value: name },
    { label: "Languages", value: langs.map((l) => `${l.name} (${l.files})`).join(", ") || "none detected", claim: sizeClaim },
    { label: "Kind", value: `${ARCHETYPE_NOUN[archetype.primary]}${archetype.secondary.length ? ` (also ${archetype.secondary.map((a) => ARCHETYPE_NOUN[a]).join(", ")})` : ""}` },
    ...(arch ? [{ label: "Architecture", value: arch.summary }] : []),
    { label: "Primary users", value: consumers.map((c) => c.title).join(", ") || "unknown" },
    { label: "Scale", value: `${facts.sourceFiles.length} source · ${facts.testFiles.length} test files · ${stats.edges} relationships`, claim: sizeClaim },
  ];
  blocks.push({ type: "facts", rows });
  blocks.push({ type: "list", title: "Primary users / consumers", items: consumers, empty: "Unknown" });
  const capabilities = (features?.blocks.find((b) => b.type === "list") as Extract<Block, { type: "list" }> | undefined)?.items.slice(0, 8) ?? [];
  if (capabilities.length) blocks.push({ type: "list", title: "Major capabilities (inferred)", items: capabilities.map((c) => ({ title: c.title, ...(c.detail ? { detail: c.detail } : {}), ...(c.claim ? { claim: c.claim } : {}) })) });
  return {
    id: "overview",
    title: "Project overview",
    question: "What does this system actually do?",
    summary: purpose,
    blocks,
    set,
  };
};

export const ARCHETYPE_NOUN: Record<string, string> = { cli: "command-line tool", api: "HTTP API service", frontend: "frontend application", library: "library", ml: "machine-learning project", service: "service" };

// ─── 7 Repository & architecture ──────────────────────────────────

export function styleOf(facts: BriefingFacts): { text: string; claims: { text: string; confidence: number; evidence: BriefingEvidence[]; observed?: boolean }[] } {
  const claims: { text: string; confidence: number; evidence: BriefingEvidence[]; observed?: boolean }[] = [];
  const pkgManifests = facts.manifests.filter((m) => m.path.includes("/"));
  const parts: string[] = [];
  if (pkgManifests.length >= 1 && facts.manifests.length >= 2) {
    parts.push(`multi-package repository (${facts.manifests.length} manifests)`);
    claims.push({ text: `Contains ${facts.manifests.length} package manifests: ${listText(facts.manifests.map((m) => m.path), 4)}.`, confidence: 1, evidence: facts.manifests.map((m) => ev(m.path, 1, { source: "manifest", provenance: "filesystem" })), observed: true });
  }
  const modules = facts.modules;
  const shape = modules.length >= 4 ? "modular monolith" : modules.length > 1 ? "small modular codebase" : "single-module codebase";
  parts.push(shape);
  claims.push({ text: `${plural(modules.length, "source module")} in one deployable unit per manifest → ${shape}.`, confidence: 0.6, evidence: modules.slice(0, 6).map((m) => ev(m.files[0]!, undefined, { provenance: "filesystem", detail: `module ${m.name}` })) });
  const interfaces: string[] = [];
  if (facts.manifests.some((m) => m.bin.length) || facts.signals.cli.length) interfaces.push("CLI");
  const servers = facts.signals.runtime.filter((r) => r.kind === "server");
  if (servers.length || facts.signals.routes.length) {
    const local = facts.signals.listenHosts.some((h) => h.text === "127.0.0.1" || h.text === "localhost");
    interfaces.push(local ? "localhost HTTP server" : "HTTP server");
  }
  if (facts.manifests.some((m) => m.main)) interfaces.push("library API");
  if (interfaces.length) parts.push(`with ${listText(interfaces)} interfaces`);
  const layers = layering(facts);
  if (layers) {
    parts.push(layers.ok ? "layered" : "partially layered");
    claims.push({ text: layers.text, confidence: layers.ok ? 0.7 : 0.55, evidence: layers.evidence });
  }
  const text = parts.join(", ").replace(/^./, (c) => c.toUpperCase());
  return { text, claims };
}

const LAYER_OF: [RegExp, number, string][] = [
  [/(^|\/)(routes?|controllers?|handlers?|api|views?|endpoints?|resolvers?)(\/|$)/, 0, "presentation"],
  [/(^|\/)(services?|domain|usecases?|use-cases|core|logic|business)(\/|$)/, 1, "service"],
  [/(^|\/)(repositor(y|ies)|db|dal|models?|entities|store|stores|persistence|data|dao)(\/|$)/, 2, "data"],
];

function layering(facts: BriefingFacts): { ok: boolean; text: string; evidence: BriefingEvidence[] } | undefined {
  const layerOf = (p: string): number | undefined => LAYER_OF.find(([re]) => re.test(posix.dirname(p)))?.[1];
  const present = new Set(facts.sourceFiles.map(layerOf).filter((l): l is number => l !== undefined));
  if (present.size < 2) return undefined;
  let down = 0;
  const up: BriefingEvidence[] = [];
  const downEv: BriefingEvidence[] = [];
  for (const [a, targets] of facts.fileDeps.out) {
    const la = layerOf(a);
    if (la === undefined) continue;
    for (const b of targets) {
      const lb = layerOf(b);
      if (lb === undefined || la === lb) continue;
      if (lb > la) {
        down += 1;
        if (downEv.length < 4) downEv.push(ev(a, undefined, { provenance: facts.edgeProvenance(a, b) ?? "heuristic", detail: `${a} → ${b}` }));
      } else if (up.length < 6) up.push(ev(a, undefined, { provenance: facts.edgeProvenance(a, b) ?? "heuristic", detail: `upward: ${a} → ${b}` }));
    }
  }
  const names = [...present].sort().map((l) => LAYER_OF.find(([, n]) => n === l)![2]);
  if (!up.length) return { ok: true, text: `Directories form ${names.join(" → ")} layers and all ${down} cross-layer dependencies point downward.`, evidence: downEv };
  return { ok: false, text: `Directories suggest ${names.join(" → ")} layers, but ${up.length} dependencies point upward.`, evidence: up };
}

function directoryTree(facts: BriefingFacts): string[] {
  const count = new Map<string, { source: number; test: number; docs: number; config: number; other: number }>();
  for (const f of facts.files) {
    const segs = f.path.split("/");
    for (let d = 1; d <= Math.min(2, segs.length - 1); d += 1) {
      const dir = segs.slice(0, d).join("/");
      const c = count.get(dir) ?? { source: 0, test: 0, docs: 0, config: 0, other: 0 };
      const k = f.role === "manifest" ? "config" : f.role;
      c[k as keyof typeof c] += 1;
      count.set(dir, c);
    }
  }
  const describe = (d: string): string => {
    const c = count.get(d)!;
    return [c.source && `${c.source} source`, c.test && `${c.test} test`, c.docs && `${c.docs} docs`, c.config && `${c.config} config`].filter(Boolean).join(" · ") || `${c.other} files`;
  };
  const top = [...count.keys()].filter((d) => !d.includes("/")).sort();
  const lines = [`${facts.name}/`];
  const maxTop = 14;
  top.slice(0, maxTop).forEach((d, i) => {
    const last = i === Math.min(top.length, maxTop) - 1;
    lines.push(`${last ? "└──" : "├──"} ${`${d}/`.padEnd(22)} ${describe(d)}`);
    const kids = [...count.keys()].filter((k) => k.startsWith(`${d}/`)).sort((a, b) => count.get(b)!.source - count.get(a)!.source || (a < b ? -1 : 1));
    kids.slice(0, 6).forEach((k, j) => {
      lines.push(`${last ? "    " : "│   "}${j === Math.min(kids.length, 6) - 1 && kids.length <= 6 ? "└──" : "├──"} ${`${posix.basename(k)}/`.padEnd(18)} ${describe(k)}`);
    });
    if (kids.length > 6) lines.push(`${last ? "    " : "│   "}└── … ${kids.length - 6} more`);
  });
  if (top.length > maxTop) lines.push(`└── … ${top.length - maxTop} more`);
  const rootFiles = facts.files.filter((f) => !f.path.includes("/")).length;
  if (rootFiles) lines.push(`    (+ ${plural(rootFiles, "file")} at the root)`);
  return lines;
}

/** Module layers: modules nothing depends on at the top, modules depending on nothing at the bottom (cycles collapsed). */
export function moduleLayers(facts: BriefingFacts): string[][] {
  const mods = facts.modules;
  const names = mods.map((m) => m.name);
  const index = new Map(names.map((n, i) => [n, i]));
  // Condense cycles so layering is well-defined.
  const comp = new Map<string, number>();
  let c = 0;
  const visitedOrder: string[] = [];
  const seen = new Set<string>();
  const dfs1 = (n: string): void => {
    const stack: [string, number][] = [[n, 0]];
    seen.add(n);
    while (stack.length) {
      const top = stack[stack.length - 1]!;
      const succ = [...(mods[index.get(top[0])!]!.dependsOn.keys())];
      if (top[1] < succ.length) {
        const w = succ[top[1]++]!;
        if (!seen.has(w)) (seen.add(w), stack.push([w, 0]));
      } else (stack.pop(), visitedOrder.push(top[0]));
    }
  };
  for (const n of names) if (!seen.has(n)) dfs1(n);
  for (const n of visitedOrder.reverse()) {
    if (comp.has(n)) continue;
    const stack = [n];
    comp.set(n, c);
    while (stack.length) {
      const cur = stack.pop()!;
      for (const w of mods[index.get(cur)!]!.dependents.keys()) if (!comp.has(w)) (comp.set(w, c), stack.push(w));
    }
    c += 1;
  }
  const level = new Map<number, number>();
  const compDeps = new Map<number, Set<number>>();
  for (const m of mods) for (const d of m.dependsOn.keys()) if (comp.get(m.name) !== comp.get(d)) {
    const s = compDeps.get(comp.get(m.name)!) ?? new Set();
    s.add(comp.get(d)!);
    compDeps.set(comp.get(m.name)!, s);
  }
  // Longest path to a sink: sinks are level 0 (bottom).
  const depth = (k: number, guard = 0): number => {
    if (level.has(k)) return level.get(k)!;
    if (guard > 200) return 0;
    let best = 0;
    for (const d of compDeps.get(k) ?? []) best = Math.max(best, depth(d, guard + 1) + 1);
    level.set(k, best);
    return best;
  };
  const byLevel = new Map<number, string[]>();
  for (const n of names) {
    const l = depth(comp.get(n)!);
    byLevel.set(l, [...(byLevel.get(l) ?? []), n]);
  }
  return [...byLevel.entries()].sort((a, b) => b[0] - a[0]).map(([, ns]) => ns.sort((a, b) => sizeOf(facts, b) - sizeOf(facts, a) || (a < b ? -1 : 1)));
}

/** Merge adjacent dependency levels into at most `max` bands so the overview stays readable. */
export function bandLayers(levels: string[][], max: number): string[][] {
  if (levels.length <= max) return levels;
  const bands: string[][] = Array.from({ length: max }, () => []);
  levels.forEach((ns, i) => bands[Math.round((i * (max - 1)) / (levels.length - 1))]!.push(...ns));
  return bands.filter((b) => b.length);
}

function sizeOf(facts: BriefingFacts, module: string): number {
  return facts.modules.find((m) => m.name === module)?.files.length ?? 0;
}

export const architecture: SectionBuilder = ({ facts }) => {
  const set = new ClaimSet("architecture");
  const blocks: Block[] = [];
  const style = styleOf(facts);
  const styleClaims = style.claims.map((c) => (c.observed ? set.observed(c.text, c.evidence) : set.inferred(c.text, c.evidence, c.confidence)));
  const styleClaim = styleClaims[style.claims.findIndex((c) => !c.observed)] ?? styleClaims[0];
  blocks.push({ type: "facts", rows: [{ label: "Architecture style", value: style.text, ...(styleClaim ? { claim: styleClaim } : {}) }, { label: "Source modules", value: String(facts.modules.length) }, { label: "Top directories", value: facts.engine.systemMap().directories.length ? listText([...new Set(facts.sourceFiles.map((p) => p.split("/")[0]!))].filter((d) => !d.includes(".")), 6) : "—" }] });
  blocks.push({ type: "diagram", title: "Repository layout", lines: directoryTree(facts), claim: set.observed("Directory layout and file roles from the index.", [ev(".", undefined, { provenance: "filesystem", source: "index" })]) });
  const layers = bandLayers(moduleLayers(facts), 5);
  if (layers.length > 1) {
    const lines: string[] = [];
    const weight = (n: string): number => {
      const m = facts.modules.find((x) => x.name === n)!;
      return m.dependents.size * 2 + m.dependsOn.size + m.files.length;
    };
    layers.forEach((ns, i) => {
      const sorted = [...ns].sort((a, b) => weight(b) - weight(a) || (a < b ? -1 : 1));
      const shown = sorted.slice(0, 6).map((n) => facts.label(n));
      const tag = i === 0 ? "  ← entry side" : i === layers.length - 1 ? "  ← foundation" : "";
      lines.push(`[ ${shown.join(" · ")}${ns.length > 6 ? ` · +${ns.length - 6}` : ""} ]${tag}`);
      if (i < layers.length - 1) lines.push("      │", "      ▼");
    });
    const crossEdges = facts.modules.reduce((s, m) => s + [...m.dependsOn.values()].reduce((a, b) => a + b, 0), 0);
    const claim = set.observed(
      `Module dependency layers from ${crossEdges} cross-module file dependencies (top: nothing depends on it; bottom: depends on nothing)${layers.length < moduleLayers(facts).length ? `; ${moduleLayers(facts).length} levels merged into ${layers.length} bands` : ""}.`,
      facts.modules.slice(0, 8).map((m) => ev(m.files[0]!, undefined, { provenance: "filesystem", detail: `module ${m.name}: ${m.files.length} files` })),
      "Static dependencies only; cycles are collapsed into one layer.",
    );
    blocks.push({ type: "diagram", title: "Architecture at a glance (module dependency layers)", lines, claim });
  }
  const mods = [...facts.modules].sort((a, b) => b.dependents.size - a.dependents.size || b.files.length - a.files.length).slice(0, 12);
  blocks.push({
    type: "list",
    title: "Modules",
    items: mods.map((m) => ({
      title: facts.label(m.name),
      detail: `${m.name} · ${plural(m.files.length, "file")} · used by ${plural(m.dependents.size, "module")} · uses ${plural(m.dependsOn.size, "module")}`,
      path: m.files[0]!,
      nodeId: m.files.length === 1 ? `file:${m.files[0]}` : `directory:${posix.dirname(m.files[0]!)}`,
    })),
  });
  return {
    id: "architecture",
    title: "Repository & architecture",
    question: "How is it structured?",
    summary: style.text,
    blocks,
    set,
    links: [{ label: "Architecture diagram", href: "/architecture" }, { label: "Explore in graph", href: "/graph" }],
  };
};

// ─── 8 Entry points ───────────────────────────────────────────────

function handlerLabel(n: GraphNode | undefined): string {
  return n ? `${n.name} (${n.path}:${n.location?.line ?? "?"})` : "handler not resolved";
}

export const entryPoints: SectionBuilder = ({ facts }) => {
  const set = new ClaimSet("entry");
  const groups: Extract<Block, { type: "groups" }>["groups"] = [];
  // CLI
  const cliItems: BriefingItem[] = [];
  for (const m of facts.manifests) for (const b of m.bin) {
    const src = facts.mapBuiltToSource(posix.join(posix.dirname(m.path), b.target));
    const main = src ? facts.definedIn(src).find((n) => n.name === "main") : undefined;
    cliItems.push({ title: b.name, detail: `binary → ${b.target}${src ? ` (source ${src})` : ""}`, badge: "bin", claim: set.declared(`\`${b.name}\` binary declared in ${m.path}.`, [ev(m.path, b.line, { source: "manifest" }), ...(src ? [ev(src, 1, { provenance: "filesystem" })] : [])]), ...(src ? { path: src, nodeId: `file:${src}` } : {}), ...(main ? { flowFrom: main.id } : src ? { flowFrom: `file:${src}` } : {}) });
  }
  const byGroup = new Map<string, CliCommand[]>();
  for (const c of facts.signals.cli) byGroup.set(`${c.path}::${c.group}`, [...(byGroup.get(`${c.path}::${c.group}`) ?? []), c]);
  const cliGroups = [...byGroup.entries()].sort((a, b) => b[1].length - a[1].length);
  for (const [key, cmds] of cliGroups) {
    const [path, group] = key.split("::") as [string, string];
    const claim = set.observed(`${plural(cmds.length, "command")} dispatched by ${group} in ${path}.`, cmds.slice(0, 8).map((c) => ev(c.path, c.line, { provenance: "heuristic", detail: `case "${c.name}"` })), "Pattern-extracted from switch/case or command declarations.");
    const prefix = group === "main" || cliGroups[0]![0] === key ? "" : `${group.replace(/Command$/, "")} `;
    for (const c of cmds) cliItems.push(stripItem({ title: `${prefix}${c.name}`, detail: handlerLabel(c.handler), claim, path: c.path, line: c.line, nodeId: c.handler?.id, flowFrom: c.handler?.id }));
  }
  if (cliItems.length) groups.push({ title: "CLI", items: cliItems.slice(0, 60), ...(cliItems.length > 60 ? { note: `${cliItems.length - 60} more not shown` } : {}) });

  // HTTP
  const routes = facts.signals.routes;
  if (routes.length) {
    const claim = set.observed(`${plural(routes.length, "HTTP route")} registered in ${listText([...new Set(routes.map((r) => r.path))], 4)}.`, routes.slice(0, 10).map((r) => ev(r.path, r.line, { provenance: "heuristic", detail: `${r.method} ${r.route}` })), "Route strings are pattern-extracted; dynamically built routes are not detected.");
    groups.push({ title: "HTTP", items: routes.slice(0, 40).map((r) => routeItem(r, claim)), ...(routes.length > 40 ? { note: `${routes.length - 40} more — see API design` } : {}) });
  }
  // Long-running / background
  const seenBg = new Set<string>();
  const bg = facts.signals.runtime.filter((r) => {
    if (r.kind !== "server" && r.kind !== "worker" && r.kind !== "scheduled" && r.kind !== "interval" && r.kind !== "watcher") return false;
    const key = `${r.kind}|${facts.enclosing(r.path, r.line)?.id ?? r.path}`;
    if (seenBg.has(key)) return false;
    seenBg.add(key);
    return true;
  });
  if (bg.length) {
    groups.push({
      title: "Servers, workers & schedules",
      items: bg.slice(0, 20).map((r) => {
        const encl = facts.enclosing(r.path, r.line);
        return stripItem({ title: `${RUNTIME_LABEL[r.kind] ?? r.kind}: ${encl?.name ?? posix.basename(r.path)}`, detail: `${r.path}:${r.line} — ${r.text}`, path: r.path, line: r.line, nodeId: encl?.id, flowFrom: encl?.id, claim: set.observed(`${RUNTIME_LABEL[r.kind]} started in ${r.path}:${r.line}.`, [ev(r.path, r.line, { provenance: "heuristic", detail: r.text })]) });
      }),
    });
  }
  // Library
  const lib: BriefingItem[] = [];
  for (const m of facts.manifests) if (m.main) {
    const src = facts.mapBuiltToSource(posix.join(posix.dirname(m.path), m.main));
    lib.push(stripItem({ title: m.name ?? m.path, detail: `main → ${m.main}${src ? ` (source ${src})` : ""}`, path: src, nodeId: src ? `file:${src}` : undefined, claim: set.declared(`Package entry ${m.main} declared in ${m.path}.`, [ev(m.path, 1, { source: "manifest" })]) }));
  }
  if (lib.length) groups.push({ title: "Library entry", items: lib });
  // Other conventional entry files
  const covered = new Set([...cliItems, ...lib].map((i) => i.path).filter(Boolean));
  const other = facts.entryFiles.filter((e) => !covered.has(e.path) && !routes.some((r) => r.path === e.path));
  if (other.length) groups.push({ title: "Other entry files", items: other.slice(0, 12).map((e) => ({ ...fileItem(e.path, e.reasons.join(", ")), flowFrom: `file:${e.path}`, claim: set.inferred(`${e.path} is an entry file (${e.reasons.join(", ")}).`, [ev(e.path, 1, { provenance: "filesystem" })], 0.7) })) });
  // Developer commands
  const scripts = facts.manifests.flatMap((m) => m.scripts.map((s) => ({ m, s })));
  if (scripts.length) groups.push({ title: "Developer scripts", items: scripts.slice(0, 12).map(({ m, s }) => ({ title: s.name, detail: s.command, badge: "script", claim: set.declared(`Script \`${s.name}\`: ${s.command}`, [ev(m.path, s.line, { source: "manifest" })]) })) });

  if (!groups.length) set.unknown("No entry points were detected: no binary, main, routes, conventional entry files or runtime starters.");
  if (facts.signals.truncated) set.unknowns.push("Signal extraction stopped at the file limit; some entry points may be missing.");
  const summary = [cliItems.length && `${plural(cliItems.length, "CLI entry", "CLI entries")}`, routes.length && plural(routes.length, "HTTP route"), bg.length && plural(bg.length, "server/worker start"), lib.length && "library entry"].filter(Boolean).join(" · ") || "No entry points detected";
  return { id: "entryPoints", title: "Entry points", question: "How does execution enter the system?", summary, blocks: [{ type: "groups", groups, empty: "No entry points detected." }], set };
};

export const RUNTIME_LABEL: Record<string, string> = { server: "Server", interval: "Interval timer", watcher: "File watcher", scheduled: "Scheduled job", worker: "Worker / consumer", "signal-handler": "Signal handler", "main-guard": "Script main", "child-process": "Child process" };

function routeItem(r: Route, claim: string): BriefingItem {
  return stripItem({ title: `${r.method === "ANY" ? "" : `${r.method} `}${r.route}`, detail: handlerLabel(r.handler), badge: r.method === "ANY" ? "any" : r.method.toLowerCase(), claim, path: r.path, line: r.line, nodeId: r.handler?.id, flowFrom: r.handler?.id ?? r.enclosing?.id });
}

export function stripItem(i: { [K in keyof BriefingItem]?: BriefingItem[K] | undefined }): BriefingItem {
  const o = { ...i } as Record<string, unknown>;
  for (const k of Object.keys(o)) if (o[k] === undefined) delete o[k];
  return o as unknown as BriefingItem;
}

// ─── 9 Features ───────────────────────────────────────────────────

export const features: SectionBuilder = ({ facts }) => {
  const set = new ClaimSet("features");
  const entryByModule = new Map<string, string[]>();
  const noteEntry = (node: GraphNode | undefined, label: string): void => {
    if (!node?.path || facts.roleByPath.get(node.path) !== "source") return;
    const m = facts.moduleOf(node.path);
    entryByModule.set(m, [...(entryByModule.get(m) ?? []), label]);
  };
  for (const c of facts.signals.cli) noteEntry(c.handler, `${c.name}`);
  for (const r of facts.signals.routes) noteEntry(r.handler, `${r.method === "ANY" ? "" : `${r.method} `}${r.route}`);
  const testsByModule = new Map<string, Set<string>>();
  for (const t of facts.testFiles) for (const dep of facts.fileDeps.out.get(t) ?? []) {
    if (facts.roleByPath.get(dep) !== "source") continue;
    const m = facts.moduleOf(dep);
    const s = testsByModule.get(m) ?? new Set();
    s.add(t);
    testsByModule.set(m, s);
  }
  const scored = facts.modules
    .map((m) => {
      const entries = entryByModule.get(m.name) ?? [];
      const byCentrality = [...m.files].sort((a, b) => (facts.metrics.get(b)?.dependents ?? 0) - (facts.metrics.get(a)?.dependents ?? 0) || (a < b ? -1 : 1));
      const described = byCentrality.map((f) => facts.describe(f)).find(Boolean);
      const score = entries.length * 3 + m.dependents.size * 2 + m.files.length + (described ? 2 : 0);
      return { m, entries, described, score };
    })
    .filter((x) => x.entries.length || x.m.dependents.size || x.m.files.length >= 2)
    .sort((a, b) => b.score - a.score || (a.m.name < b.m.name ? -1 : 1))
    .slice(0, 10);
  const items: BriefingItem[] = scored.map(({ m, entries, described }) => {
    const central = [...m.files].sort((a, b) => (facts.metrics.get(b)?.dependents ?? 0) - (facts.metrics.get(a)?.dependents ?? 0))[0]!;
    const key = facts.keySymbols(central, 3).map((k) => k.node);
    const tests = testsByModule.get(m.name)?.size ?? 0;
    const detailParts = [described ?? `${plural(m.files.length, "file")} in ${m.name}`, entries.length ? `reached from ${listText([...new Set(entries)], 4)}` : "", tests ? `imported by ${plural(tests, "test file")}` : "no test imports it"];
    const claim = set.inferred(
      `${facts.label(m.name)}: ${detailParts.filter(Boolean).join("; ")}.`,
      [...key.map((n) => nodeEv(n)), ...m.files.slice(0, 3).map((f) => ev(f, undefined, { provenance: "filesystem" }))],
      entries.length && described ? 0.75 : described || entries.length ? 0.65 : 0.5,
      "Capability boundaries are inferred from module structure, doc comments and entry points.",
    );
    return { title: facts.label(m.name), detail: detailParts.filter(Boolean).join(" · "), path: central, nodeId: m.files.length === 1 ? `file:${central}` : `directory:${posix.dirname(central)}`, claim, badge: `${m.files.length}f` };
  });
  if (!items.length) set.unknown("No feature clusters could be derived from module structure.");
  set.unknowns.push("Business intent behind each capability is inferred from names and doc comments, not verified.");
  return { id: "features", title: "Main features & use cases", question: "What are the important capabilities?", summary: items.length ? `${plural(items.length, "capability cluster")}: ${listText(items.map((i) => i.title), 6)}` : "No capability clusters derived", blocks: [{ type: "list", items }], set };
};

// ─── 10 Data flows ────────────────────────────────────────────────

function linearize(step: FlowStep, facts: BriefingFacts, max = 7): FlowStep[] {
  const weight = (s: FlowStep, seen: Set<string>): number => {
    let w = s.path && !seen.has(s.path) ? 2 : 1;
    const next = new Set(seen);
    if (s.path) next.add(s.path);
    for (const c of s.children) if (!c.repeated) w += weight(c, next) * 0.6;
    return w;
  };
  const chain: FlowStep[] = [step];
  let cur = step;
  const seenFiles = new Set(step.path ? [step.path] : []);
  while (chain.length < max) {
    const options = cur.children.filter((c) => !c.repeated && facts.roleByPath.get(c.path ?? "") !== "test");
    if (!options.length) break;
    options.sort((a, b) => weight(b, seenFiles) - weight(a, seenFiles) || (a.name < b.name ? -1 : 1));
    cur = options[0]!;
    chain.push(cur);
    if (cur.path) seenFiles.add(cur.path);
  }
  return chain;
}

export const dataFlows: SectionBuilder = ({ facts }) => {
  const set = new ClaimSet("flows");
  const starts: { label: string; node: GraphNode }[] = [];
  const seenNodes = new Set<string>();
  const push = (label: string, node: GraphNode | undefined): void => {
    if (!node || seenNodes.has(node.id)) return;
    seenNodes.add(node.id);
    starts.push({ label, node });
  };
  for (const r of facts.signals.routes) push(`HTTP ${r.method === "ANY" ? "" : `${r.method} `}${r.route}`, r.handler);
  for (const c of facts.signals.cli) push(`CLI \`${c.name}\``, c.handler);
  for (const s of facts.signals.runtime.filter((r) => r.kind === "server" || r.kind === "worker" || r.kind === "scheduled")) {
    const encl = facts.enclosing(s.path, s.line);
    push(`${RUNTIME_LABEL[s.kind]} (${encl?.name ?? s.path})`, encl);
  }
  for (const e of facts.entryFiles) for (const n of facts.definedIn(e.path)) if (/^(main|run|start|bootstrap|handler)$/i.test(n.name)) push(`${e.path}`, n);

  const flows: { label: string; steps: FlowStep[]; signature: string; score: number }[] = [];
  for (const s of starts.slice(0, 80)) {
    const tree = facts.engine.flow(s.node.id, 5);
    if (tree.status !== "found") continue;
    const steps = linearize(tree.result, facts);
    if (steps.length < 2) continue;
    const signature = steps.map((x) => (x.path ? facts.moduleOf(x.path) : x.name)).filter((v, i, a) => a.indexOf(v) === i).join(">");
    flows.push({ label: s.label, steps, signature, score: new Set(steps.map((x) => x.path)).size * 2 + steps.length });
  }
  const bySig = new Map<string, (typeof flows)[number]>();
  for (const f of flows) if (!bySig.has(f.signature) || bySig.get(f.signature)!.score < f.score) bySig.set(f.signature, f);
  const chosen = [...bySig.values()].sort((a, b) => b.score - a.score).slice(0, 6);
  const blocks: Block[] = [];
  for (const f of chosen) {
    const views: FlowStepView[] = [{ name: f.label, layer: "entry" }];
    for (const st of f.steps) {
      const node = facts.graph.node(st.id);
      views.push(
        stripFlow({ name: st.name, path: st.path, line: node?.location?.line, nodeId: st.id, layer: st.path ? facts.label(facts.moduleOf(st.path)) : undefined, provenance: st.depth ? st.provenance : undefined }),
      );
    }
    const last = f.steps.map((s) => s.path).filter((p): p is string => Boolean(p));
    const writes = facts.signals.fileWrites.filter((w) => last.includes(w.path));
    const sql = [...facts.signals.tables.entries()].filter(([, locs]) => locs.some((l) => last.includes(l.path)));
    if (sql.length) views.push({ name: `SQL: ${listText(sql.map(([t]) => t), 3)}`, layer: "data" });
    else if (writes.length) views.push({ name: `writes files (${posix.basename(writes[0]!.path)}:${writes[0]!.line})`, path: writes[0]!.path, line: writes[0]!.line, layer: "data" });
    const heuristic = f.steps.some((s) => s.depth && s.provenance === "heuristic");
    const claim = set.observed(
      `${f.label} → ${f.steps.map((s) => s.name).join(" → ")}`,
      f.steps.slice(1).map((s) => ev(s.path ?? s.name, facts.graph.node(s.id)?.location?.line, { nodeId: s.id, provenance: s.provenance })),
      `Most significant path through the static call tree (depth ≤ 5)${heuristic ? "; includes pattern-extracted calls" : ""}. Dynamic dispatch and callbacks may be missing.`,
    );
    blocks.push({ type: "flow", title: f.label, steps: views, claim });
  }
  if (!chosen.length) set.unknown("No call flows could be traced from detected entry points.");
  set.unknowns.push("Runtime data flow (payload shapes, async hand-offs, network hops) is not observable statically.");
  const layerPath = chosen[0] ? [...new Set(chosen[0].steps.map((s) => (s.path ? facts.label(facts.moduleOf(s.path)) : s.name)))].join(" → ") : "";
  return { id: "dataFlows", title: "System & data flow", question: "How does data move through it?", summary: chosen.length ? `${plural(chosen.length, "traced flow")}; main path: ${layerPath}` : "No flows traced", blocks, set, links: [{ label: "Visualize in graph", href: "/graph" }] };
};

function stripFlow(v: { [K in keyof FlowStepView]?: FlowStepView[K] | undefined }): FlowStepView {
  const o = { ...v } as Record<string, unknown>;
  for (const k of Object.keys(o)) if (o[k] === undefined) delete o[k];
  return o as unknown as FlowStepView;
}

// ─── 19 Runtime model ─────────────────────────────────────────────

export const runtime: SectionBuilder = ({ facts }) => {
  const set = new ClaimSet("runtime");
  const groups: Extract<Block, { type: "groups" }>["groups"] = [];
  const bins = facts.manifests.flatMap((m) => m.bin.map((b) => ({ m, b })));
  if (bins.length || facts.signals.cli.length) {
    const claim = bins.length ? set.declared(`Command-line runs are on demand (${listText(bins.map((x) => x.b.name))}).`, bins.map(({ m, b }) => ev(m.path, b.line, { source: "manifest" }))) : set.observed("Command-line dispatch runs on demand.", facts.signals.cli.slice(0, 3).map((c) => ev(c.path, c.line, { provenance: "heuristic" })));
    groups.push({ title: "On demand", items: [{ title: "CLI invocation", detail: "each command runs and exits", claim }] });
  }
  const kinds: [string, string, string[]][] = [
    ["Long-running", "server", ["server"]],
    ["Periodic", "interval", ["interval", "scheduled"]],
    ["Continuous", "watcher", ["watcher"]],
    ["Asynchronous / background", "worker", ["worker"]],
    ["Spawns processes", "child", ["child-process"]],
    ["Lifecycle", "signal", ["signal-handler", "main-guard"]],
  ];
  for (const [title, , ks] of kinds) {
    const hits = facts.signals.runtime.filter((r) => ks.includes(r.kind));
    if (!hits.length) continue;
    const byFile = new Map<string, typeof hits>();
    for (const h of hits) byFile.set(h.path, [...(byFile.get(h.path) ?? []), h]);
    groups.push({
      title,
      items: [...byFile.entries()].slice(0, 10).map(([path, hs]) => {
        const encl = facts.enclosing(path, hs[0]!.line);
        return stripItem({ title: `${encl?.name ?? posix.basename(path)}`, detail: `${path}:${hs[0]!.line} — ${hs[0]!.text}${hs.length > 1 ? ` (+${hs.length - 1})` : ""}`, path, line: hs[0]!.line, nodeId: encl?.id, claim: set.observed(`${title}: ${RUNTIME_LABEL[hs[0]!.kind]} in ${path}.`, hs.slice(0, 4).map((h) => ev(h.path, h.line, { provenance: "heuristic", detail: h.text }))) });
      }),
    });
  }
  const cron = facts.configOf("ci").filter((c) => facts.lines(c.path).some((l) => /^\s*-?\s*cron:/.test(l)));
  if (cron.length) groups.push({ title: "Scheduled (CI)", items: cron.map((c) => ({ title: c.path, detail: facts.lines(c.path).find((l) => /cron:/.test(l))!.trim(), claim: set.declared(`Scheduled CI workflow ${c.path}.`, [ev(c.path, facts.lines(c.path).findIndex((l) => /cron:/.test(l)) + 1, { source: "configuration" })]) })) });
  const hosts = facts.signals.listenHosts;
  if (hosts.length) {
    const local = hosts.every((h) => h.text === "127.0.0.1" || h.text === "localhost");
    set.observed(local ? "Servers bind to localhost only." : `Servers bind to ${listText([...new Set(hosts.map((h) => h.text))])}.`, hosts.map((h) => ev(h.path, h.line, { provenance: "heuristic" })));
  }
  if (!groups.length) set.unknown("No runtime starters (servers, timers, workers, schedules) were detected.");
  set.unknowns.push("Concurrency, scaling and process supervision in production cannot be determined from source.");
  const summary = groups.map((g) => g.title).join(" · ") || "Unknown";
  return { id: "runtime", title: "Runtime & execution model", question: "What runs, when, and for how long?", summary, blocks: [{ type: "groups", groups, empty: "No runtime behaviour detected." }], set };
};

export type { SectionDraft, BuildContext };
