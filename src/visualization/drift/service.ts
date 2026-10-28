import { execFileSync } from "node:child_process";
import { statSync } from "node:fs";
import { join } from "node:path";
import { resolveCommit } from "../../architecture/view-delta.js";
import { CONTRACT_FILE } from "../../drift/contract.js";
import { decideFinding, decidePattern, DECISIONS_FILE } from "../../drift/decisions.js";
import { analyzeDrift } from "../../drift/drift.js";
import { clearBaseline, commitWindow, dateFindings, HistoryEvaluator, pointOf, readBaseline, writeBaseline } from "../../drift/history.js";
import { mapView } from "../../drift/map.js";
import type { CommitDetail, DecisionKind, DriftFinding, DriftHistory, DriftPagePayload, DriftReport, HistoryPoint, SourceExcerpt } from "../../drift/types.js";
import type { FehmEngine } from "../../engine.js";
import { stateDir } from "../../persistence.js";
import { ArchitectureService } from "../architecture/service.js";

export interface DriftServiceOptions {
  stateDirectory?: string;
  /** Never write decisions, the baseline or the history cache. */
  dryRun?: boolean;
  /** Share 3.3's per-engine model, facts and validated views. */
  architecture?: ArchitectureService;
}

interface Built {
  signature: string;
  report: DriftReport;
  history: DriftHistory;
}

/**
 * Feature 3.4's server side. One analysis per engine instance and per state
 * of the reference files (explicit rules, decisions, baseline) — editing
 * them is picked up on the next request without re-indexing. Findings are
 * dated as soon as every commit of the git window has been analysed (the
 * page analyses them progressively; results are cached per commit).
 */
export class DriftService {
  private readonly built = new WeakMap<FehmEngine, Built>();
  private readonly architecture: ArchitectureService;
  private readonly histories = new Map<string, HistoryEvaluator>();

  constructor(private readonly options: DriftServiceOptions = {}) {
    this.architecture = options.architecture ?? new ArchitectureService({ ...(options.stateDirectory ? { stateDirectory: options.stateDirectory } : {}), ...(options.dryRun ? { dryRun: true } : {}) });
  }

  private state(engine: FehmEngine): string {
    return stateDir(engine.root, this.options.stateDirectory);
  }

  private evaluator(engine: FehmEngine): HistoryEvaluator {
    let h = this.histories.get(engine.root);
    if (!h) this.histories.set(engine.root, (h = new HistoryEvaluator(engine.root, this.options.dryRun ? undefined : this.state(engine))));
    return h;
  }

  private signature(engine: FehmEngine): string {
    const sig = (path: string): string => {
      try {
        const s = statSync(path);
        return `${s.mtimeMs}:${s.size}`;
      } catch {
        return "-";
      }
    };
    return [sig(join(engine.root, CONTRACT_FILE)), sig(join(engine.root, DECISIONS_FILE)), sig(join(this.state(engine), "drift-baseline.json")), sig(join(this.state(engine), "drift-history.json"))].join("|");
  }

  private base(engine: FehmEngine): Built {
    const signature = this.signature(engine);
    const hit = this.built.get(engine);
    if (hit && hit.signature === signature) return hit;
    const { report } = analyzeDrift({ engine, facts: this.architecture.facts(engine), model: this.architecture.model(engine) });
    const history = commitWindow(engine.root);
    const baseline = this.options.dryRun ? undefined : readBaseline(this.state(engine));
    const h = this.evaluator(engine);
    const cached = history.commits.map((c) => h.cached(c.ref)).filter((p): p is HistoryPoint => Boolean(p));
    history.analysed = cached.length;
    if (baseline) history.baseline = { createdAt: baseline.createdAt, ...(baseline.commit ? { commit: baseline.commit } : {}), findings: baseline.findings.length };
    const complete = history.git && cached.length === history.commits.length;
    if (baseline || complete) {
      const current = pointOf("working-tree", "working tree", "Current state", undefined, report);
      const dated = dateFindings(report.findings, current, complete ? cached : [], baseline);
      report.findings = dated.findings;
      report.summary.new = dated.findings.filter((f) => f.status === "new").length;
      if (complete) history.changes = dated.changes;
      history.resolved = dated.resolved;
      if (dated.comparison) history.comparison = dated.comparison;
    }
    const built = { signature, report, history };
    this.built.set(engine, built);
    return built;
  }

  report(engine: FehmEngine): DriftReport {
    return { ...this.base(engine).report, freshness: engine.freshness() };
  }

  payload(engine: FehmEngine): DriftPagePayload {
    const { report, history } = this.base(engine);
    const { deps: _d, ...rest } = report;
    void _d;
    return {
      ...rest,
      freshness: engine.freshness(),
      map: { components: mapView("components", this.architecture.view(engine, "system"), report.findings), modules: mapView("modules", this.architecture.view(engine, "dependencies"), report.findings) },
      history,
      writable: !this.options.dryRun,
    };
  }

  decideFinding(engine: FehmEngine, id: string, kind: DecisionKind | null, reason: string): { ok: true } | { error: string } {
    if (this.options.dryRun) return { error: "read-only (dry run)" };
    const { report } = this.base(engine);
    const f = [...report.findings, ...report.decided].find((x) => x.id === id);
    if (!f) return { error: "unknown finding" };
    if (kind && !reason.trim()) return { error: "a reason is required" };
    decideFinding(engine.root, id, kind, reason, f.unit?.path ?? id);
    return { ok: true };
  }

  decidePattern(engine: FehmEngine, id: string, decision: "approved" | "rejected" | "ignored" | null): { ok: true } | { error: string } {
    if (this.options.dryRun) return { error: "read-only (dry run)" };
    if (!this.base(engine).report.patterns.some((p) => p.id === id)) return { error: "unknown pattern" };
    decidePattern(engine.root, id, decision);
    return { ok: true };
  }

  setBaseline(engine: FehmEngine): { ok: true; createdAt: string; findings: number } | { error: string } {
    if (this.options.dryRun) return { error: "read-only (dry run)" };
    const b = writeBaseline(this.state(engine), this.base(engine).report, resolveCommit(engine.root, "HEAD"));
    return { ok: true, createdAt: b.createdAt, findings: b.findings.length };
  }

  clearBaseline(engine: FehmEngine): { ok: true } | { error: string } {
    if (this.options.dryRun) return { error: "read-only (dry run)" };
    clearBaseline(this.state(engine));
    return { ok: true };
  }

  /** Analyse one commit of the window (cached afterwards). The page calls it commit by commit. */
  historyPoint(engine: FehmEngine, ref: string): Omit<HistoryPoint, "deps"> {
    const { deps: _d, ...p } = this.evaluator(engine).point(ref);
    void _d;
    return p;
  }

  commit(engine: FehmEngine, ref: string, path?: string): CommitDetail | { error: string } {
    const commit = resolveCommit(engine.root, ref);
    if (!commit) return { error: `unknown revision ${ref}` };
    const git = (args: string[]): string => execFileSync("git", ["-C", engine.root, ...args], { stdio: ["ignore", "pipe", "ignore"], maxBuffer: 1 << 26, timeout: 20_000 }).toString();
    try {
      const [subject, author, date] = git(["log", "-n", "1", "--format=%s%x09%an%x09%cI", commit]).trim().split("\t") as [string, string, string];
      const files = git(["show", "--numstat", "--format=", commit]).trim().split("\n").filter(Boolean).slice(0, 200).map((l) => {
        const [a, r, p] = l.split("\t") as [string, string, string];
        return { path: p, added: Number(a) || 0, removed: Number(r) || 0 };
      });
      const out: CommitDetail = { ref: commit, short: commit.slice(0, 7), subject, author, date, files };
      // The path goes after `--`, so git treats it as a path, never an option.
      if (path && (path.includes("..") || path.startsWith("/"))) return {error:"Invalid source path"};
      const diff = git(["show", "--no-ext-diff", "--no-textconv", "--no-color", "--format=", commit, "--", ...(path ? [path] : [])]).split("\n");
      out.diff = diff.slice(0, 240);
      out.diffTruncated = diff.length > 240;
      return out;
    } catch (e) {
      return { error: (e as Error).message.split("\n")[0]! };
    }
  }

  source(engine: FehmEngine, path: string, line: number, radius = 8): SourceExcerpt | undefined {
    const lines = engine.sourceLines(path);
    if (!lines) return undefined;
    const focus = Math.min(Math.max(1, Math.floor(line) || 1), Math.max(1, lines.length));
    const start = Math.max(1, focus - radius);
    const end = Math.min(lines.length, focus + radius);
    return { path, start, focus, lines: lines.slice(start - 1, end).map((l) => (l.length > 240 ? `${l.slice(0, 239)}…` : l)) };
  }

  /**
   * A small, self-contained context for asking an LLM about one finding
   * (spec §59): the finding, its baseline, the pattern statistics and the
   * exact source lines — never the repository.
   */
  llmContext(engine: FehmEngine, id: string): string | undefined {
    const { report } = this.base(engine);
    const f = [...report.findings, ...report.decided].find((x) => x.id === id);
    if (!f) return undefined;
    const p = report.patterns.find((x) => x.id === f.pattern);
    const out: string[] = [];
    out.push(`# Architecture drift finding: ${f.title}`, "");
    out.push(`Project: ${report.repository.name} — ${[report.context.languages[0]?.name, ...report.context.frameworks.map((x) => x.label)].filter(Boolean).join(", ")}; ${report.context.projectTypes[0]?.label ?? "unknown type"}`);
    out.push(`Category: ${f.category} · confidence ${f.confidence} · attention ${f.attention} · basis ${f.basis}`, "");
    out.push(`Observed: ${f.observed}`, `Common / established: ${f.baseline}`, `Why detected: ${f.explanation}`, `Possible impact: ${f.impact}`);
    if (f.commonChain) out.push(`Common chain: ${f.commonChain.join(" → ")}`);
    if (f.observedChain) out.push(`Observed chain: ${f.observedChain.join(" → ")}`);
    if (p) out.push("", `Project pattern "${p.statement}": ${p.matching} of ${p.comparable} ${p.unitLabel}. Examples: ${p.examples.map((e) => e.path).join(", ")}`);
    if (f.bases.length) out.push("", "Baselines:", ...f.bases.map((b) => `- (${b.basis}) ${b.text}`));
    out.push("", "Evidence:");
    for (const e of f.evidence.slice(0, 5)) {
      out.push(`- ${e.path}${e.line ? `:${e.line}` : ""}${e.detail ? ` — ${e.detail}` : ""}`);
      const x = e.line ? this.source(engine, e.path, e.line, 3) : undefined;
      if (x) out.push("```", ...x.lines.map((l, i) => `${x.start + i}: ${l}`), "```");
    }
    out.push("", "Task: explain whether this deviation looks intentional, what it risks, and a possible restructuring. It is a deviation from observed convention, not necessarily an error; the developer decides.");
    return out.join("\n");
  }

  /** Findings by id (current and decided), for the drawer. */
  finding(engine: FehmEngine, id: string): DriftFinding | undefined {
    const { report } = this.base(engine);
    return [...report.findings, ...report.decided].find((x) => x.id === id);
  }
}
