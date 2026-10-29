import { posix } from "node:path";
import { layerOf, matchesAny, targetMatches } from "./contract.js";
import { stronglyConnected } from "./graph-util.js";
import type { Signal } from "./signal.js";
import type { ArchitectureContract, ContractRule, Evidence, RuleResult } from "./types.js";
import { ROLE_LABEL, type Unit } from "./units.js";

/**
 * Explicit project rules — the top of the baseline ladder (spec §5). They
 * come from an optional `.fehm/architecture.json` a team writes and commits.
 * Nothing is inferred into it: without that file this module does nothing.
 * Deviations are still described as deviations from the project's rule,
 * with high confidence because the team stated the rule.
 */

interface Verdict {
  expected: "allowed" | "forbidden" | "undeclared" | "same";
  rule?: string;
  kind?: "upward" | "skips" | "explicit";
}

export function verdictFor(contract: ArchitectureContract, layerIndex: Map<string, number>, a: string, b: string): Verdict {
  if (a === b) return { expected: "same" };
  for (const r of contract.rules) if (r.to && targetMatches(r.to, b) && !r.onlyFrom!.includes(a)) return { expected: "forbidden", rule: r.id, kind: "explicit" };
  let best: { verdict: "allowed" | "forbidden"; score: number; rule: ContractRule } | undefined;
  for (const r of contract.rules) {
    if (!r.from || (r.from !== a && r.from !== "*")) continue;
    const fromScore = r.from === a ? 0.5 : 0;
    const consider = (list: string[] | undefined, verdict: "allowed" | "forbidden"): void => {
      for (const t of list ?? []) {
        if (!targetMatches(t, b)) continue;
        const score = (t === b ? 2 : t === "*" ? 0 : 1) + fromScore;
        if (!best || score > best.score || (score === best.score && verdict === "forbidden")) best = { verdict, score, rule: r };
      }
    };
    consider(r.allow, "allowed");
    consider(r.forbid, "forbidden");
  }
  if (best) return { expected: best.verdict, rule: best.rule.id, kind: "explicit" };
  for (const r of contract.rules) if (r.to && targetMatches(r.to, b) && r.onlyFrom!.includes(a)) return { expected: "allowed", rule: r.id, kind: "explicit" };
  const ia = layerIndex.get(a);
  const ib = layerIndex.get(b);
  if (ia !== undefined && ib !== undefined && contract.layering !== "none") {
    if (ib < ia) return { expected: "forbidden", rule: "layering", kind: "upward" };
    if (contract.layering === "strict" && ib > ia + 1) return { expected: "forbidden", rule: "layering", kind: "skips" };
    return { expected: "allowed", rule: "layering" };
  }
  return { expected: "undeclared" };
}

export function ruleText(r: ContractRule, name: (id: string) => string = (x) => x): string {
  const list = (xs: string[]): string => xs.map((x) => (x === "*" ? "anything" : name(x))).join(", ");
  if (r.to) return `only ${list(r.onlyFrom!)} may depend on ${name(r.to)}`;
  const from = r.from === "*" ? "every layer" : name(r.from!);
  return [r.allow?.length ? `${from} may depend on ${list(r.allow)}` : "", r.forbid?.length ? `${from} does not depend on ${list(r.forbid)}` : ""].filter(Boolean).join("; ");
}

const SEVERITY_ATTENTION = { high: "high", medium: "moderate", low: "low" } as const;

export function evaluateRules(contract: ArchitectureContract, units: Unit[], outsideName: (id: string) => string): { results: RuleResult[]; signals: Signal[] } {
  const layerIndex = new Map(contract.layers.map((l, i) => [l.id, i]));
  const layerName = new Map(contract.layers.map((l) => [l.id, l.name]));
  const name = (id: string): string => layerName.get(id) ?? outsideName(id);
  const live = units.filter((u) => !matchesAny(u.path, contract.ignore));
  const layerOfUnit = new Map(live.map((u) => [u.path, layerOf(u.path, contract)]));
  const roleOf = new Map(units.map((u) => [u.path, u.role]));
  const signals: Signal[] = [];
  const deviations = new Map<string, number>();
  const exercised = new Set<string>();

  for (const u of live) {
    const a = layerOfUnit.get(u.path);
    if (!a) continue;
    const targets: { key: string; b: string; e: Evidence; target: string }[] = [];
    for (const d of u.fileDeps) {
      const b = layerOfUnit.get(d);
      if (b && b !== a) targets.push({ key: `role:${roleOf.get(d)}`, b, e: { path: u.path, detail: `depends on ${d}` }, target: d });
    }
    for (const [id, e] of u.outside) targets.push({ key: id, b: id, e, target: id });
    for (const t of targets) {
      const v = verdictFor(contract, layerIndex, a, t.b);
      if (v.rule) exercised.add(v.rule);
      if (v.expected !== "forbidden") continue;
      const rule = contract.rules.find((r) => r.id === v.rule);
      deviations.set(v.rule!, (deviations.get(v.rule!) ?? 0) + 1);
      const text = rule ? ruleText(rule, name) : v.kind === "upward" ? `${name(a)} depends only on layers below it` : `${name(a)} depends only on the layer directly below it`;
      signals.push({
        subject: `${u.path}|${t.key}`,
        category: v.kind === "explicit" ? (t.b === "store:database" ? "database" : t.b.startsWith("external:") ? "external-service" : "dependency") : "layer",
        source: "project",
        basis: "explicit-rule",
        confidence: "high",
        attention: SEVERITY_ATTENTION[rule?.severity ?? (v.kind === "skips" ? "medium" : "high")],
        title: `${posix.basename(u.path)} (${name(a)}) → ${name(t.b)} differs from project rule ${v.rule}`,
        observed: `${ROLE_LABEL[u.role]} ${u.path} in layer ${name(a)} depends on ${name(t.b)}.`,
        baseline: `Explicit project rule ${v.rule}: ${text}.`,
        explanation: `The team's architecture file (.fehm/architecture.json) states: ${text}.${rule?.reason ? ` Reason given: ${rule.reason}` : ""}`,
        impact: rule?.reason ?? (v.kind === "upward" ? "A dependency against the declared layer order couples lower layers to upper ones." : "The declared boundary is weakened."),
        suggestion: { text: `Possible restructuring: route the dependency the way rule ${v.rule} describes, or change the rule if this is intended.` },
        observedChain: [name(a), name(t.b)],
        unit: u.path,
        target: t.target,
        kind: "rule",
        evidence: [t.e],
      });
    }
  }
  if (!contract.allowUnassigned) {
    for (const u of live.filter((x) => !layerOfUnit.get(x.path))) {
      signals.push({ subject: `${u.path}|layer`, category: "module-boundary", source: "project", basis: "explicit-rule", confidence: "high", attention: "low", title: `${u.path} belongs to no declared layer`, observed: `${u.path} matches no layer path of .fehm/architecture.json.`, baseline: "Explicit project rule: every source file belongs to a declared layer.", explanation: "Code outside every declared layer is not covered by the team's dependency rules.", impact: "Deviations in this file cannot be measured against the declared layers.", suggestion: { text: "Possible organisation: add the file's directory to a layer, move the file, or list it under `ignore`." }, unit: u.path, kind: "rule", evidence: [{ path: u.path, nodeId: `file:${u.path}` }] });
    }
  }
  if (contract.cycles !== "allow") {
    const edges = new Map<string, Set<string>>();
    for (const u of live) for (const d of u.fileDeps) {
      const a = layerOfUnit.get(u.path);
      const b = layerOfUnit.get(d);
      if (a && b && a !== b) edges.set(a, (edges.get(a) ?? new Set()).add(b));
    }
    for (const scc of stronglyConnected(contract.layers.map((l) => l.id), (id) => [...(edges.get(id) ?? [])])) {
      deviations.set("cycles", (deviations.get("cycles") ?? 0) + 1);
      signals.push({ subject: `cycle:layers:${scc.join("+")}`, category: "cycle", source: "project", basis: "explicit-rule", confidence: "high", attention: contract.cycles === "forbid" ? "high" : "moderate", title: `Declared layers depend on each other in a cycle: ${scc.map(name).join(" ⇄ ")}`, observed: `${scc.map(name).join(" → ")} → ${name(scc[0]!)}`, baseline: `Explicit project rule: cycles between layers — ${contract.cycles}.`, explanation: "The team's architecture file states the layers form no cycle.", impact: "Layers in a cycle cannot be built, tested or replaced independently.", observedChain: [...scc.map(name), name(scc[0]!)], kind: "rule", evidence: [] });
    }
    exercised.add("cycles");
  }

  const results: RuleResult[] = [];
  if (contract.layering !== "none") results.push({ id: "layering", text: contract.layering === "strict" ? "each layer depends only on the layer directly below it" : "each layer depends only on layers below it", status: deviations.get("layering") ? "deviation" : exercised.has("layering") ? "met" : "unverified", deviations: deviations.get("layering") ?? 0 });
  for (const r of contract.rules) results.push({ id: r.id, text: ruleText(r, name), status: deviations.get(r.id) ? "deviation" : exercised.has(r.id) ? "met" : "unverified", deviations: deviations.get(r.id) ?? 0 });
  if (contract.cycles !== "allow") results.push({ id: "cycles", text: "declared layers form no cycle", status: deviations.get("cycles") ? "deviation" : "met", deviations: deviations.get("cycles") ?? 0 });
  return { results, signals };
}
