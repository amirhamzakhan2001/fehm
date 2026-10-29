import { listText, pct, plural, type SectionBuilder } from "./builder.js";
import { ClaimSet, ev, nodeEv } from "./evidence.js";
import type { BriefingFacts, FileMetrics } from "./facts.js";
import type { Block, BriefingSection, SectionId } from "./types.js";

// ─── 16 Important components ──────────────────────────────────────

export interface RankedComponent {
  path: string;
  score: number;
  metrics: FileMetrics;
  why: string[];
}

/**
 * Importance of a source file from graph signals only: how many files depend
 * on it, how many entry points reach it, how much of its API is used from
 * elsewhere, and its size/fan-out. Each signal is normalized by the
 * repository maximum so scores compare within one repository only.
 */
export function rankComponents(facts: BriefingFacts): RankedComponent[] {
  const all = [...facts.metrics.values()];
  if (!all.length) return [];
  const max = (k: keyof FileMetrics): number => Math.max(1, ...all.map((m) => m[k] as number));
  const mx = { dependents: max("dependents"), entryReach: max("entryReach"), inbound: max("inboundSymbolEdges"), defines: max("defines"), deps: max("dependencies") };
  const entries = new Set(facts.entryFiles.map((e) => e.path));
  return all
    .map((m) => {
      const score = 0.35 * (m.dependents / mx.dependents) + 0.2 * (m.entryReach / mx.entryReach) + 0.2 * (m.inboundSymbolEdges / mx.inbound) + 0.1 * (m.defines / mx.defines) + 0.1 * (m.dependencies / mx.deps) + (entries.has(m.path) ? 0.05 : 0);
      const why: string[] = [];
      if (m.dependents) why.push(`used by ${plural(m.dependents, "source file")}`);
      if (m.entryReach) why.push(`reachable from ${plural(m.entryReach, "entry point")}`);
      if (m.inboundSymbolEdges) why.push(`${m.inboundSymbolEdges} inbound calls/references`);
      if (entries.has(m.path)) why.push("is an entry point");
      if (m.dependencies >= 6) why.push(`orchestrates ${plural(m.dependencies, "file")}`);
      return { path: m.path, score: Math.round(score * 1000) / 1000, metrics: m, why };
    })
    .sort((a, b) => b.score - a.score || (a.path < b.path ? -1 : 1));
}

export const components: SectionBuilder = ({ facts }) => {
  const set = new ClaimSet("components");
  const ranked = rankComponents(facts).slice(0, 10);
  const rows = ranked.map((r) => {
    const key = facts.keySymbols(r.path, 3).filter((k) => k.inbound > 0 || k.node.exported);
    const desc = facts.describe(r.path);
    const claim = set.observed(
      `${r.path}: ${r.why.join(", ") || "low connectivity"}.`,
      [ev(r.path, undefined, { nodeId: `file:${r.path}`, provenance: "filesystem" }), ...key.map((k) => nodeEv(k.node, `${k.inbound} inbound`))],
      "Ranking uses static graph centrality; it measures structural importance, not runtime load.",
    );
    return {
      name: r.path,
      path: r.path,
      nodeId: `file:${r.path}`,
      score: r.score,
      why: [...(desc ? [desc] : []), ...r.why, ...(key.length ? [`key symbols: ${key.map((k) => k.node.name.split(".").at(-1)).join(", ")}`] : [])],
      metrics: { dependents: r.metrics.dependents, dependencies: r.metrics.dependencies, entryReach: r.metrics.entryReach, inbound: r.metrics.inboundSymbolEdges, symbols: r.metrics.defines },
      claim,
    };
  });
  if (!rows.length) set.unknown("No source files to rank.");
  // Most-used individual symbols across the repository.
  const symbols = facts.graph
    .nodes()
    .filter((n) => (n.kind === "function" || n.kind === "class" || n.kind === "method" || n.kind === "interface") && !n.isTest && facts.roleByPath.get(n.path ?? "") === "source")
    .map((n) => ({ n, callers: new Set(facts.graph.edgesOf(n.id, "in", ["calls", "references", "uses", "extends", "implements"]).map((e) => facts.fileOf(e.source)).filter((p) => p && p !== n.path)).size }))
    .filter((x) => x.callers >= 2)
    .sort((a, b) => b.callers - a.callers || (a.n.id < b.n.id ? -1 : 1))
    .slice(0, 10);
  const blocks: Block[] = [{ type: "ranking", title: "Most important files", rows }];
  if (symbols.length) blocks.push({ type: "list", title: "Most widely used symbols", items: symbols.map(({ n, callers }) => ({ title: n.name, detail: `${n.kind} · used from ${plural(callers, "file")}${n.doc ? ` · ${n.doc}` : ""}`, path: n.path!, ...(n.location ? { line: n.location.line } : {}), nodeId: n.id, claim: set.observed(`${n.name} is used from ${plural(callers, "other file")}.`, [nodeEv(n)]) })) });
  return { id: "components", title: "Important code components", question: "Which parts matter most?", summary: rows.length ? `Top: ${listText(rows.slice(0, 4).map((r) => r.name), 4)}` : "—", blocks, set, links: [{ label: "Explore in graph", href: "/graph" }] };
};

// ─── 20 Critical dependencies ─────────────────────────────────────

export const dependencies: SectionBuilder = ({ facts }) => {
  const set = new ClaimSet("deps");
  const blocks: Block[] = [];
  const metrics = [...facts.metrics.values()];
  const hubs = [...metrics].sort((a, b) => b.dependents - a.dependents || (a.path < b.path ? -1 : 1)).filter((m) => m.dependents >= 3).slice(0, 8);
  blocks.push({
    type: "list",
    title: "Change hotspots (observed centrality)",
    items: hubs.map((h) => ({
      title: h.path,
      detail: `used by ${plural(h.dependents, "file")} · reachable from ${plural(h.entryReach, "entry point")} · depends on ${plural(h.dependencies, "file")}`,
      path: h.path,
      nodeId: `file:${h.path}`,
      badge: h.dependents >= Math.max(8, metrics.length * 0.25) ? "hotspot" : "",
      claim: set.observed(`${h.path} has ${h.dependents} dependent source files.`, [...(facts.fileDeps.in.get(h.path) ?? [])].slice(0, 6).map((d) => ev(d, undefined, { nodeId: `file:${d}`, provenance: facts.edgeProvenance(d, h.path) ?? "heuristic", detail: `${d} → ${h.path}` })), "High centrality makes a file a potential change hotspot; it does not show a runtime bottleneck."),
    })),
    empty: "No file has three or more dependents.",
  });
  // Dependency depth from entry points.
  const depth = longestChain(facts);
  if (depth.chain.length > 1) blocks.push({ type: "flow", title: `Deepest static dependency chain (${depth.chain.length - 1} hops)`, steps: depth.chain.map((p) => ({ name: p, path: p, nodeId: `file:${p}`, layer: facts.label(facts.moduleOf(p)) })), claim: set.observed(`Longest dependency chain from an entry point is ${depth.chain.length - 1} hops.`, depth.chain.map((p) => ev(p, undefined, { nodeId: `file:${p}`, provenance: "filesystem" }))) });
  const external = facts.packages.filter((p) => !p.builtin && facts.runtimeImporters(p).length).slice(0, 10);
  if (external.length) blocks.push({ type: "list", title: "Most-used external packages", items: external.map((p) => ({ title: p.name, detail: `${p.info ? `${p.info.label} — ${p.info.purpose} · ` : ""}imported by ${plural(facts.runtimeImporters(p).length, "file")}`, nodeId: p.nodeId, claim: set.observed(`${p.name} imported by ${plural(facts.runtimeImporters(p).length, "source file")}.`, facts.runtimeImporters(p).slice(0, 4).map((i) => ev(i, undefined, { provenance: p.provenance }))) })) });
  const cycles = facts.cycles;
  if (cycles.length) blocks.push({ type: "list", title: "Dependency cycles", items: cycles.slice(0, 6).map((c) => ({ title: `${plural(c.length, "file")} in a cycle`, detail: listText(c, 4), path: c[0]!, nodeId: `file:${c[0]}`, claim: set.observed(`Dependency cycle among ${listText(c, 4)}.`, c.slice(0, 6).map((p) => ev(p, undefined, { nodeId: `file:${p}`, provenance: "filesystem" }))) })) });
  set.unknowns.push("Runtime performance bottlenecks require profiling; static centrality cannot identify them.");
  return { id: "dependencies", title: "Critical dependencies & hotspots", question: "What breaks the most if it changes?", summary: hubs.length ? `Hotspots: ${listText(hubs.slice(0, 3).map((h) => `${h.path} (${h.dependents})`), 3)}` : "No strong hubs", blocks, set };
};

function longestChain(facts: BriefingFacts): { chain: string[] } {
  const memo = new Map<string, string[]>();
  const visiting = new Set<string>();
  const walk = (p: string): string[] => {
    if (memo.has(p)) return memo.get(p)!;
    if (visiting.has(p)) return [p];
    visiting.add(p);
    let best: string[] = [];
    for (const n of facts.fileDeps.out.get(p) ?? []) {
      if (facts.roleByPath.get(n) !== "source") continue;
      const c = walk(n);
      if (c.length > best.length) best = c;
    }
    visiting.delete(p);
    const out = [p, ...best.filter((x) => x !== p)];
    memo.set(p, out);
    return out;
  };
  let chain: string[] = [];
  for (const e of facts.entryFiles) {
    const c = walk(e.path);
    if (c.length > chain.length) chain = c;
  }
  return { chain: chain.slice(0, 12) };
}

// ─── 21 Risks ─────────────────────────────────────────────────────

export const risks: SectionBuilder = ({ facts, upstream }) => {
  const set = new ClaimSet("risks");
  const items: Extract<Block, { type: "risks" }>["items"] = [];
  const metrics = [...facts.metrics.values()];
  const n = Math.max(1, metrics.length);
  // Cycles.
  for (const c of facts.cycles.slice(0, 3)) {
    items.push({ severity: c.length >= 5 ? "high" : "medium", title: `Dependency cycle across ${plural(c.length, "file")}`, why: "Cyclic files must change and be tested together; cycles block clean layering.", claim: set.observed(`Cycle: ${listText(c, 5)}.`, c.slice(0, 6).map((p) => ev(p, undefined, { nodeId: `file:${p}`, provenance: "filesystem" }))) });
  }
  // Hotspots: high fan-in and fan-out.
  const fanIn = percentile(metrics.map((m) => m.dependents), 0.9);
  for (const m of metrics.filter((m) => m.dependents >= Math.max(5, fanIn) && m.dependencies >= 6).slice(0, 3)) {
    items.push({ severity: "medium", title: `${m.path} is both widely used and highly coupled`, why: `Used by ${m.dependents} files and depends on ${m.dependencies}; changes here ripple in both directions.`, claim: set.inferred(`${m.path}: fan-in ${m.dependents}, fan-out ${m.dependencies}.`, [ev(m.path, undefined, { nodeId: `file:${m.path}`, provenance: "filesystem" })], 0.7) });
  }
  // Large files.
  for (const m of metrics.filter((m) => m.lines >= 700 || m.defines >= 60).sort((a, b) => b.lines - a.lines).slice(0, 3)) {
    items.push({ severity: "low", title: `${m.path} is large (${m.lines} lines, ${m.defines} symbols)`, why: "Large files concentrate change risk and are harder to review.", claim: set.observed(`${m.path} has ${m.lines} lines and ${m.defines} symbols.`, [ev(m.path, undefined, { nodeId: `file:${m.path}`, provenance: "filesystem" })]) });
  }
  // Untested hotspots.
  const tests = facts.testFiles.length;
  const untestedHubs = metrics.filter((m) => m.dependents >= 3 && m.testReach === 0).sort((a, b) => b.dependents - a.dependents).slice(0, 4);
  if (!tests) items.push({ severity: "high", title: "No tests found", why: "Changes cannot be verified automatically.", claim: set.observed("No test files are in the index.", [ev(".", undefined, { provenance: "filesystem" })]) });
  else if (untestedHubs.length) items.push({ severity: "medium", title: `${plural(untestedHubs.length, "widely used file")} not reached by any test`, why: `${listText(untestedHubs.map((m) => m.path), 4)} have dependents but no static test reach.`, claim: set.inferred("Widely used files without static test reach.", untestedHubs.map((m) => ev(m.path, undefined, { nodeId: `file:${m.path}`, provenance: "filesystem" })), 0.65, "Static reachability; tests may exercise them indirectly through dynamic calls.") });
  // Security sinks.
  const sinks = facts.signals.sinks;
  if (sinks.length) items.push({ severity: sinks.some((s) => s.kind === "dynamic code evaluation" || s.kind === "unsafe deserialization") ? "medium" : "low", title: `${plural(sinks.length, "security-sensitive sink")} (${listText([...new Set(sinks.map((s) => s.kind))], 3)})`, why: "Places where untrusted input could reach code execution or markup; review input handling.", claim: set.observed("Sensitive sinks present.", sinks.slice(0, 6).map((s) => ev(s.path, s.line, { provenance: "heuristic", detail: s.text }))) });
  // Evidence quality.
  if (facts.heuristicShare > 0.3) items.push({ severity: "unknown", title: `${pct(facts.heuristicShare)} of relationships are pattern-extracted`, why: "Heuristic relationships can be missing or wrong; treat flows and centrality as approximate.", claim: set.observed(`${pct(facts.heuristicShare)} of non-structural edges are heuristic.`, [ev(".", undefined, { provenance: "filesystem", detail: "Context Engine edge provenance" })]) });
  const unresolved = facts.graph.unresolved.length;
  if (unresolved > 10) items.push({ severity: "unknown", title: `${unresolved} unresolved references`, why: "Calls/imports the analyzer could not resolve (dynamic imports, external symbols) are absent from flows.", claim: set.observed(`${unresolved} unresolved references.`, facts.graph.unresolved.slice(0, 5).map((u) => ev(u.location.path, u.location.line, { provenance: "heuristic", detail: `${u.kind}: ${u.text}` }))) });
  // Unreferenced exports (dead code candidates).
  const dead = facts.engine.connectivity().unreferencedExports.filter((id) => facts.roleByPath.get(facts.fileOf(id) ?? "") === "source");
  if (dead.length >= 5) items.push({ severity: "low", title: `${dead.length} exported symbols with no inbound references`, why: "Candidates for dead code, or public API used outside this repository.", claim: set.inferred(`${dead.length} unreferenced exports.`, dead.slice(0, 6).map((id) => { const node = facts.graph.node(id)!; return nodeEv(node); }), 0.5, "Candidates, not proof: entry points, public APIs and dynamic use look unreferenced too.") });
  // Upstream: deployment/CI unknowns.
  const infra = upstream.get("infrastructure");
  if (infra && !facts.configOf("ci").length) items.push({ severity: "unknown", title: "No CI configuration", why: "Nothing in the repository shows that tests run automatically.", claim: set.unknown("No CI configuration found.") });
  if (infra?.unknowns.some((u) => u.startsWith("Deployment target is unknown"))) items.push({ severity: "unknown", title: "Deployment is undocumented", why: "No deployment configuration was indexed; how this runs in production is unknown.", claim: set.unknown("Deployment target unknown.") });
  const order = { high: 0, medium: 1, low: 2, unknown: 3 };
  items.sort((a, b) => order[a.severity] - order[b.severity]);
  void n;
  return { id: "risks", title: "Architecture risks & technical debt", question: "What should I be careful about?", summary: items.length ? `${items.filter((i) => i.severity === "high").length} high · ${items.filter((i) => i.severity === "medium").length} medium · ${items.filter((i) => i.severity === "low").length} low · ${items.filter((i) => i.severity === "unknown").length} unknown` : "No structural risks detected", blocks: [{ type: "risks", items, empty: "No structural risks were detected by the available checks." }], set };
};

function percentile(values: number[], p: number): number {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))]!;
}

// ─── 22 What an engineer must know ────────────────────────────────

function firstClaim(s: BriefingSection | undefined): string | undefined {
  return s?.claims.find((c) => c.state !== "unknown")?.id;
}

export const engineerMustKnow: SectionBuilder = ({ facts, upstream }) => {
  const set = new ClaimSet("know");
  const notes: { text: string; from: SectionId }[] = [];
  const get = (id: SectionId): BriefingSection | undefined => upstream.get(id);
  const entry = get("entryPoints");
  const bins = facts.manifests.flatMap((m) => m.bin);
  if (bins.length) notes.push({ text: `The \`${bins[0]!.name}\` binary is the primary entry point${facts.binTargets[0] ? ` (${facts.binTargets[0]})` : ""}; ${entry?.summary ?? ""}.`, from: "entryPoints" });
  else if (entry && entry.state !== "unknown") notes.push({ text: `Execution enters through: ${entry.summary}.`, from: "entryPoints" });
  const ranked = rankComponents(facts);
  if (ranked[0]) notes.push({ text: `${ranked[0].path} is the most central file (${ranked[0].why.slice(0, 2).join(", ")}); changes there ripple widely.`, from: "components" });
  const flow = get("dataFlows");
  const firstFlow = flow?.blocks.find((b) => b.type === "flow") as Extract<Block, { type: "flow" }> | undefined;
  if (firstFlow) notes.push({ text: `Main flow: ${firstFlow.steps.map((s) => s.name).slice(0, 6).join(" → ")}.`, from: "dataFlows" });
  const db = get("database");
  if (db) notes.push({ text: `Data: ${db.summary}.`, from: "database" });
  const rt = get("runtime");
  if (rt && rt.state !== "unknown") notes.push({ text: `Runtime: ${rt.summary}.`, from: "runtime" });
  const test = get("testing");
  const verify = test?.blocks.find((b) => b.type === "facts") as Extract<Block, { type: "facts" }> | undefined;
  const howTo = verify?.rows.find((r) => r.label === "How to verify a change");
  if (test) notes.push({ text: `Tests: ${test.summary}${howTo ? `; verify with ${howTo.value}` : ""}.`, from: "testing" });
  const integ = get("integrations");
  if (integ) notes.push({ text: `Integrations: ${integ.summary}.`, from: "integrations" });
  const risk = get("risks");
  const topRisk = (risk?.blocks[0] as Extract<Block, { type: "risks" }> | undefined)?.items.find((i) => i.severity !== "unknown");
  if (topRisk) notes.push({ text: `Watch out: ${topRisk.title} — ${topRisk.why}`, from: "risks" });
  if (facts.heuristicShare > 0.15) notes.push({ text: `${pct(facts.heuristicShare)} of relationships are pattern-extracted; the graph is static and does not prove runtime behaviour.`, from: "risks" });
  else notes.push({ text: "The briefing is built from a static graph; it does not prove runtime behaviour.", from: "risks" });
  const items = notes.slice(0, 10).map((n) => {
    const src = get(n.from);
    const claimId = firstClaim(src);
    const from = src?.claims.find((c) => c.id === claimId);
    const id = set.add(n.text, from?.basis ?? "inferred", from?.evidence ?? [], { confidence: from?.confidence ?? 0.6 });
    return { title: n.text, claim: id, badge: src?.title ?? "" };
  });
  return { id: "engineerMustKnow", title: "What an engineer must know", question: "What do I need before modifying it?", summary: `${items.length} things to understand before changing this code`, blocks: [{ type: "list", ordered: true, items }], set };
};

// ─── 23 Cheat sheet ───────────────────────────────────────────────

export const cheatSheet: SectionBuilder = ({ upstream, facts }) => {
  const set = new ClaimSet("cheat");
  const s = (id: SectionId): string => upstream.get(id)?.summary ?? "—";
  const unknownCount = [...upstream.values()].reduce((a, sec) => a + sec.unknowns.length, 0);
  const ranked = rankComponents(facts).slice(0, 4).map((r) => r.path);
  const rows = [
    { label: "What", value: s("overview") },
    { label: "Architecture", value: s("architecture") },
    { label: "Components", value: s("components").replace(/^Top: /, "") },
    { label: "Entry points", value: s("entryPoints") },
    { label: "Features", value: s("features") },
    { label: "Database", value: s("database") },
    { label: "APIs", value: s("api") },
    { label: "Data flows", value: s("dataFlows") },
    { label: "Integrations", value: s("integrations") },
    { label: "Deployment", value: s("infrastructure") },
    { label: "Security", value: s("security") },
    { label: "Key files", value: ranked.join(", ") || "—" },
    { label: "Risks", value: s("risks") },
    { label: "Unknowns", value: `${unknownCount} open questions` },
  ];
  const know = upstream.get("engineerMustKnow");
  const remember = (know?.blocks[0] as Extract<Block, { type: "list" }> | undefined)?.items.slice(0, 8) ?? [];
  const evidence = [...upstream.values()].flatMap((sec) => sec.claims.filter((c) => c.state !== "unknown").slice(0, 1).flatMap((c) => c.evidence.slice(0, 1)));
  set.inferred("Digest of the sections above; each row links back to its section's evidence.", evidence, 0.75);
  return { id: "cheatSheet", title: "Meeting cheat sheet", question: "What do I need to remember?", summary: s("overview"), blocks: [{ type: "facts", rows }, { type: "list", title: `${remember.length} things to remember`, ordered: true, items: remember }], set };
};
