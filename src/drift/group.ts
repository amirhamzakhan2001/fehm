import type { ArchitectureModel } from "../architecture/types.js";
import type { DecisionsFile } from "./decisions.js";
import { ATTENTION_ORDER, CONFIDENCE_ORDER, GROUP_OF, raise, type Signal } from "./signal.js";
import type { Basis, BasisLine, DriftCluster, DriftFinding, DriftGroup, Evidence, Practice, ProjectContext } from "./types.js";
import { ROLE_LABEL, type Unit } from "./units.js";

/**
 * Deduplication (spec §72) and assembly. Signals that describe the same
 * deviation share a subject; the one from the highest rung of the baseline
 * ladder becomes the finding, the others become its related signals, and all
 * of their baselines are listed as the reasons it was generated.
 */

const BASIS_ORDER: Basis[] = ["explicit-rule", "approved-pattern", "project-pattern", "framework", "industry", "heuristic"];
const COUPLING = new Set(["dependency", "layer", "database", "external-service", "module-boundary", "cycle", "monorepo", "api"]);

export const GROUP_LABEL: Record<DriftGroup, string> = {
  structure: "Structure",
  dependencies: "Dependency boundaries",
  responsibilities: "Responsibilities",
  patterns: "Patterns",
  runtime: "Runtime boundaries",
  engineering: "Engineering organisation",
  historical: "Historical",
  ai: "AI-associated signals",
};

export function assemble(signals: Signal[], input: { units: Unit[]; model: ArchitectureModel; practices: Practice[]; context: ProjectContext; decisions: DecisionsFile }): { findings: DriftFinding[]; decided: DriftFinding[]; clusters: DriftCluster[] } {
  const unitOf = new Map(input.units.map((u) => [u.path, u]));
  const moduleFiles = new Map<string, string[]>();
  for (const u of input.units) moduleFiles.set(u.module, [...(moduleFiles.get(u.module) ?? []), u.path]);
  const nodeIds = new Set(input.model.nodes.map((n) => n.id));
  const bySubject = new Map<string, Signal[]>();
  for (const s of signals) bySubject.set(s.subject, [...(bySubject.get(s.subject) ?? []), s]);
  const rank = (s: Signal): number => BASIS_ORDER.indexOf(s.basis) * 100 + (2 - CONFIDENCE_ORDER.indexOf(s.confidence)) * 10 + (4 - ATTENTION_ORDER.indexOf(s.attention));
  const fwLabel = new Map(input.context.frameworks.map((f) => [f.id, f.label]));

  const all: DriftFinding[] = [];
  for (const [subject, list] of bySubject) {
    const sorted = [...list].sort((a, b) => rank(a) - rank(b) || (a.title < b.title ? -1 : 1));
    const p = sorted[0]!;
    // Evidence: union, primary first.
    const evidence: Evidence[] = [];
    for (const s of sorted) for (const e of s.evidence) if (e && !evidence.some((x) => x.path === e.path && (x.line === e.line || (!x.line && !e.line)))) evidence.push(e);
    // Reasons: every distinct baseline behind it, then the framework / industry practices that agree.
    const bases: BasisLine[] = [];
    const addBasis = (b: BasisLine): void => void (bases.some((x) => x.text === b.text) || bases.push(b));
    for (const s of sorted) addBasis({ source: s.source, basis: s.basis, text: s.explanation });
    const kinds = new Set(sorted.map((s) => s.kind));
    const categories = new Set(sorted.map((s) => s.category));
    for (const pr of input.practices) {
      if (!(pr.measuredBy && kinds.has(pr.measuredBy)) && !categories.has(pr.category)) continue;
      addBasis({ source: pr.source, basis: pr.source === "framework" ? "framework" : "industry", text: pr.source === "framework" ? `${fwLabel.get(pr.framework ?? "") ?? pr.framework}: ${pr.statement}` : pr.statement });
    }
    bases.sort((a, b) => BASIS_ORDER.indexOf(a.basis) - BASIS_ORDER.indexOf(b.basis));
    let attention = sorted.reduce((a, s) => (ATTENTION_ORDER.indexOf(s.attention) > ATTENTION_ORDER.indexOf(a) ? s.attention : a), p.attention);
    const unit = p.unit ? unitOf.get(p.unit) : undefined;
    if (unit && unit.dependents >= 10 && COUPLING.has(p.category) && attention !== "critical") attention = raise(attention);
    // Drift-map anchors at both levels (3.3 ids).
    const targetUnit = p.target ? unitOf.get(p.target) : undefined;
    const compA = unit?.component;
    const compB = targetUnit?.component ?? (p.target && nodeIds.has(p.target) ? p.target : undefined);
    const modA = unit ? `module:${unit.module}` : undefined;
    const modB = targetUnit ? `module:${targetUnit.module}` : undefined;
    const extraModules = sorted.flatMap((s) => s.modules ?? []);
    const extraComponents = extraModules.flatMap((m) => (moduleFiles.get(m.slice(7)) ?? []).map((f) => unitOf.get(f)?.component).filter((c): c is string => Boolean(c)));
    const nodes = [...new Set([compA, compB, ...extraComponents].filter((x): x is string => Boolean(x)))];
    const modules = [...new Set([modA, modB ?? (p.target && nodeIds.has(p.target) ? p.target : undefined), ...extraModules].filter((x): x is string => Boolean(x)))];
    const edges = compA && compB && compA !== compB ? [`rel:${compA}→${compB}`] : [];
    const moduleEdges = modA && modB && modA !== modB ? [`rel:${modA}→${modB}`] : modA && p.target && nodeIds.has(p.target) ? [`rel:${modA}→${p.target}`] : [];
    // A cycle: its consecutive members.
    if (p.category === "cycle" && extraModules.length > 1) for (let i = 0; i < extraModules.length; i += 1) moduleEdges.push(`rel:${extraModules[i]}→${extraModules[(i + 1) % extraModules.length]}`);
    const finding: DriftFinding = {
      id: subject,
      category: p.category,
      group: GROUP_OF[p.category],
      title: p.title,
      source: p.source,
      basis: p.basis,
      confidence: p.confidence,
      attention,
      observed: p.observed,
      baseline: p.baseline,
      explanation: p.explanation,
      impact: p.impact,
      ...(p.suggestion ? { suggestion: p.suggestion } : {}),
      ...(p.commonChain ? { commonChain: p.commonChain } : {}),
      ...(p.observedChain ? { observedChain: p.observedChain } : {}),
      ...(unit ? { unit: { path: unit.path, role: ROLE_LABEL[unit.role], module: unit.module, ...(unit.component ? { component: unit.component } : {}) } } : {}),
      ...(p.target ? { target: p.target } : {}),
      ...(p.pattern ? { pattern: p.pattern } : {}),
      ...(p.stats ? { stats: p.stats } : {}),
      bases,
      evidence: evidence.slice(0, 12),
      more: Math.max(0, evidence.length - 12) + sorted.reduce((sum, s) => sum + (s.more ?? 0), 0),
      related: sorted.slice(1).map((s) => ({ category: s.category, title: s.title, basis: s.basis })),
      map: { nodes, edges, modules, moduleEdges },
      status: "undated",
    };
    all.push(finding);
  }
  const order = (f: DriftFinding): number => (4 - ATTENTION_ORDER.indexOf(f.attention)) * 10 + (2 - CONFIDENCE_ORDER.indexOf(f.confidence));
  all.sort((a, b) => order(a) - order(b) || (a.id < b.id ? -1 : 1));

  const findings: DriftFinding[] = [];
  const decided: DriftFinding[] = [];
  for (const f of all) {
    const d = input.decisions.findings[f.id];
    if (d) decided.push({ ...f, decision: d });
    else findings.push(f);
  }

  const clusters: DriftCluster[] = [];
  for (const g of Object.keys(GROUP_LABEL) as DriftGroup[]) {
    const fs = findings.filter((f) => f.group === g);
    if (fs.length) clusters.push({ id: `group:${g}`, label: GROUP_LABEL[g], kind: "group", findings: fs.map((f) => f.id), categories: [...new Set(fs.map((f) => f.category))] });
  }
  const byComponent = new Map<string, DriftFinding[]>();
  for (const f of findings) if (f.unit?.component) byComponent.set(f.unit.component, [...(byComponent.get(f.unit.component) ?? []), f]);
  const compName = new Map(input.model.nodes.map((n) => [n.id, n.name]));
  for (const [c, fs] of [...byComponent].sort((a, b) => b[1].length - a[1].length).slice(0, 12)) clusters.push({ id: c, label: compName.get(c) ?? c, kind: "module", findings: fs.map((f) => f.id), categories: [...new Set(fs.map((f) => f.category))] });
  return { findings, decided, clusters };
}
