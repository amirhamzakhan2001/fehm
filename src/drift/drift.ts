import { buildArchitectureModel } from "../architecture/model.js";
import type { ArchitectureModel } from "../architecture/types.js";
import { BriefingFacts } from "../codebase-briefing/facts.js";
import type { FehmEngine } from "../engine.js";
import { CONTRACT_FILE, matchesAny, readContract } from "./contract.js";
import { detectContext, inventory } from "./context.js";
import { readDecisions, type DecisionsFile } from "./decisions.js";
import { assemble } from "./group.js";
import { minePatterns } from "./mining.js";
import { evaluateRules } from "./rules.js";
import { ATTENTION_ORDER } from "./signal.js";
import { aiSignals } from "./signals.js";
import { DRIFT_SCHEMA, DRIFT_VERSION, type Attention, type BaselineSummary, type Confidence, type DriftGroup, type DriftReport, type PracticeComparison, type RuleResult } from "./types.js";
import { extractUnits } from "./units.js";

/**
 * Feature 3.4 — Architecture Drift (spec §32):
 *
 *   inventory → project context (language, framework, project type, style)
 *     → comparable units (units.ts) → project convention mining (mining.ts)
 *     → framework / industry baselines (knowledge.ts) → explicit rules (rules.ts)
 *     → AI-associated structural signals (signals.ts)
 *     → deduplication, confidence, attention (group.ts) → findings
 *
 * Deterministic and model-free. The reference (explicit rules, decisions) is
 * read from `configRoot`, which history sets to the working tree while it
 * analyses an older commit's code.
 */

export interface DriftInputs {
  engine: FehmEngine;
  facts?: BriefingFacts;
  model?: ArchitectureModel;
  /** Where `.fehm/architecture.json` and `.fehm/drift-decisions.json` are read. Defaults to the engine root. */
  configRoot?: string;
  /** Skip the git/walk inventory (history snapshots pass their own file list). */
  files?: string[];
}

export function analyzeDrift({ engine, facts = new BriefingFacts(engine), model = buildArchitectureModel(engine, facts), configRoot = engine.root, files }: DriftInputs): { report: DriftReport; model: ArchitectureModel } {
  const started = performance.now();
  const inv = files ?? inventory(engine.root);
  const context = detectContext(engine.root, facts, inv);
  const decisions: DecisionsFile = readDecisions(configRoot);
  const contractRead = readContract(configRoot, CONTRACT_FILE);
  const contract = contractRead.ok ? contractRead.contract : undefined;
  const ignore = contract?.ignore ?? [];
  const skip = ignore.length ? (p: string) => matchesAny(p, ignore) : undefined;
  const units = extractUnits(facts, model, skip);
  const patternDecisions = Object.fromEntries(Object.entries(decisions.patterns).map(([id, d]) => [id, d.decision]));
  const mined = minePatterns({ units, facts, model, context, files: inv, decisions: patternDecisions });
  const outsideName = (id: string): string => model.nodes.find((n) => n.id === id)?.name ?? id;
  const rules: { results: RuleResult[]; signals: typeof mined.signals } = contract ? evaluateRules(contract, units, outsideName) : { results: [], signals: [] };
  const ai = aiSignals(engine, facts, skip);
  const signals = [...rules.signals, ...mined.signals, ...ai];
  const { findings, decided, clusters } = assemble(signals, { units, model, practices: mined.practices, context, decisions });

  const byGroup = Object.fromEntries((["structure", "dependencies", "responsibilities", "patterns", "runtime", "engineering", "historical", "ai"] as DriftGroup[]).map((g) => [g, 0])) as Record<DriftGroup, number>;
  const byConfidence: Record<Confidence, number> = { high: 0, medium: 0, low: 0 };
  const byAttention = Object.fromEntries(ATTENTION_ORDER.map((a) => [a, 0])) as Record<Attention, number>;
  for (const f of findings) {
    byGroup[f.group] += 1;
    byConfidence[f.confidence] += 1;
    byAttention[f.attention] += 1;
  }
  const established = mined.patterns.filter((p) => p.established);

  // Industry vs project vs observed (spec §49).
  const fwLabel = new Map(context.frameworks.map((f) => [f.id, f.label]));
  const kinds = new Map<string, number>();
  for (const s of signals) if (!decisions.findings[s.subject]) kinds.set(s.kind, (kinds.get(s.kind) ?? 0) + 1);
  const comparison: PracticeComparison[] = [];
  for (const measure of [...new Set(mined.practices.map((p) => p.measuredBy).filter((m): m is string => Boolean(m)))]) {
    const ind = mined.practices.find((p) => p.source === "industry" && p.measuredBy === measure);
    const fw = mined.practices.find((p) => p.source === "framework" && p.measuredBy === measure);
    const pats = mined.patterns.filter((p) => p.kind === measure).sort((a, b) => Number(b.established) - Number(a.established) || b.comparable - a.comparable);
    const pat = pats[0];
    comparison.push({
      practice: ind?.title ?? fw!.title,
      category: (ind ?? fw)!.category,
      industry: Boolean(ind),
      ...(fw ? { framework: fwLabel.get(fw.framework ?? "") ?? fw.framework! } : {}),
      ...(pat ? { project: { share: pat.frequency, comparable: pat.comparable, pattern: pat.statement } } : {}),
      deviations: kinds.get(measure) ?? 0,
    });
  }

  const baseline: BaselineSummary = {
    project: { patterns: mined.patterns.length, established: established.length, approved: mined.patterns.filter((p) => p.decision === "approved").length },
    framework: { conventions: mined.practices.filter((p) => p.source === "framework").length, frameworks: context.frameworks.map((f) => f.label) },
    industry: { practices: mined.practices.filter((p) => p.source === "industry").length, projectType: context.primaryType },
    explicit: { rules: rules.results.length, ...(contract ? { file: CONTRACT_FILE } : {}), ...(!contractRead.ok && "issues" in contractRead ? { rejected: { file: CONTRACT_FILE, issues: contractRead.issues } } : {}) },
  };

  const deps: Record<string, string[]> = {};
  for (const u of units) deps[u.path] = [...u.fileDeps, ...u.outside.keys()].sort();

  const unknowns = [...context.unknowns];
  unknowns.push("Relationships are static (imports, calls, SQL, SDK imports). Runtime-only coupling — dependency-injection containers, reflection, message topics, HTTP between services — is not observed.");
  unknowns.push("Responsibilities are detected from code signals (routes, SQL, SDK imports, env reads, validation and auth calls). Business logic as such is not classified.");
  if (mined.patterns.length && !established.length) unknowns.push("No project pattern is strong enough to be called a convention yet (too few comparable units, or they disagree).");
  if (baseline.explicit.rejected) unknowns.push(`${CONTRACT_FILE} could not be used (${baseline.explicit.rejected.issues.length} problems); explicit rules were skipped.`);
  if (facts.signals.truncated) unknowns.push("Source signal extraction was truncated on this large repository.");

  const report: DriftReport = {
    schemaVersion: DRIFT_SCHEMA,
    version: DRIFT_VERSION,
    repository: model.repository,
    fingerprint: model.fingerprint,
    generatedAt: new Date().toISOString(),
    context,
    baseline,
    patterns: mined.patterns,
    practices: mined.practices,
    comparison,
    rules: rules.results,
    findings,
    decided,
    clusters,
    summary: { findings: findings.length, new: 0, highAttention: findings.filter((f) => f.attention === "high" || f.attention === "critical").length, patterns: established.length, categories: new Set(findings.map((f) => f.category)).size, byGroup, byConfidence, byAttention, decided: decided.length },
    deps,
    unknowns,
    freshness: engine.freshness(),
    durationMs: Math.round(performance.now() - started),
  };
  return { report, model };
}

const ATT: Record<Attention, string> = { critical: "CRIT", high: "HIGH", moderate: "MOD ", low: "LOW ", informational: "INFO" };

/** Plain-text report for the CLI. */
export function renderDriftText(report: DriftReport, options: { all?: boolean } = {}): string {
  const c = report.context;
  const out: string[] = [];
  out.push(`Architecture drift — ${report.repository.name}`);
  out.push(`Context: ${[c.languages[0]?.name, ...c.frameworks.map((f) => f.label)].filter(Boolean).join(" · ")} · ${c.projectTypes[0]?.label ?? "project type unknown"} · ${c.architectureSignals.map((a) => a.label).join(", ")}`);
  out.push(`Baseline: ${report.baseline.project.established} established project patterns · ${report.baseline.framework.conventions} framework conventions · ${report.baseline.industry.practices} industry practices${report.baseline.explicit.rules ? ` · ${report.baseline.explicit.rules} explicit rules` : ""}`);
  const s = report.summary;
  out.push(`Findings: ${s.findings} (${s.new} new · ${s.highAttention} high attention · ${s.categories} categories)${s.decided ? ` · ${s.decided} decided` : ""}`);
  out.push("Observed deviations from established or common practice — not errors. The developer decides.");
  out.push("");
  const shown = options.all ? report.findings : report.findings.filter((f) => f.group !== "ai").slice(0, 40);
  for (const f of shown) {
    out.push(`[${ATT[f.attention]}] ${f.title}  (${f.category}, ${f.confidence} confidence, ${f.basis.replace("-", " ")}${f.status !== "undated" ? `, ${f.status}` : ""})`);
    out.push(`    observed: ${f.observed}`);
    out.push(`    baseline: ${f.baseline}`);
    for (const e of f.evidence.slice(0, 2)) out.push(`    ${e.path}${e.line ? `:${e.line}` : ""}${e.detail ? `  ${e.detail}` : ""}`);
    if (f.related.length) out.push(`    related: ${f.related.map((r) => r.category).join(", ")}`);
  }
  if (!options.all && report.findings.length > shown.length) out.push(`… ${report.findings.length - shown.length} more (AI-associated signals and the rest: --all or --json)`);
  if (report.unknowns.length) {
    out.push("");
    out.push("Not determined:");
    for (const u of report.unknowns) out.push(`  ? ${u}`);
  }
  return out.join("\n");
}
