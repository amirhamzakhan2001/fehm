import type { SecurityService } from '../security/service.js';
import type { DriftService } from '../drift/service.js';
import { isOpen } from '../../findings/model.js';
import { statSync } from "node:fs";
import { join } from "node:path";
import type { FehmEngine } from "../../engine.js";
import { isReviewStatus, REVIEW_FILE, writeReview } from "../../findings/review.js";
import { ADVISORY_FILE, checkAdvisories, type Fetcher } from "../../health/advisories.js";
import { indexFingerprint, RUNS_FILE, runCheckAsync } from "../../health/build.js";
import { COVERAGE_CANDIDATES } from "../../health/coverage.js";
import { readHealthConfig } from "../../health/config.js";
import { posix } from "node:path";
import { CONFIG_FILE } from "../../health/config.js";
import { cycloneDx, spdx } from "../../health/dependencies.js";
import { buildHealthReport, FEHM_VERSION } from "../../health/health.js";
import { BASELINE_FILE, clearBaseline, writeBaseline } from "../../health/history.js";
import type { HealthPagePayload, HealthReport, RunResult, SourceExcerpt } from "../../health/types.js";
import { stateDir } from "../../persistence.js";
import { redactLine } from "../../security/secrets.js";
import { ArchitectureService } from "../architecture/service.js";

export interface HealthServiceOptions {
  security?: SecurityService;
  drift?: DriftService;
  stateDirectory?: string;
  /** Never write reviews, baselines, runs, advisories, trend or cache; never run checks. */
  dryRun?: boolean;
  /** Share 3.3's per-engine facts (the server passes its architecture service). */
  architecture?: ArchitectureService;
  /** For tests: the advisory fetcher. */
  fetcher?: Fetcher;
}

type Scope = "all" | "changed";

/**
 * Feature 3.5's server side. One report per engine instance, scope and
 * state: editing .fehm/health.json, reviewing a finding, setting a baseline,
 * running a check or checking advisories is picked up on the next request
 * without re-indexing.
 */
export class HealthService {
  private readonly built = new WeakMap<FehmEngine, Map<string, { signature: string; report: HealthReport }>>();
  private readonly architecture: ArchitectureService;
  private readonly running = new Set<string>();

  constructor(private readonly options: HealthServiceOptions = {}) {
    this.architecture = options.architecture ?? new ArchitectureService({ ...(options.stateDirectory ? { stateDirectory: options.stateDirectory } : {}), ...(options.dryRun ? { dryRun: true } : {}) });
  }

  get writable(): boolean {
    return !this.options.dryRun;
  }

  private state(engine: FehmEngine): string {
    return stateDir(engine.root, this.options.stateDirectory);
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
    const state = this.state(engine);
    const facts = this.architecture.facts(engine);
    const dirs = new Set(['', ...facts.manifests.map(manifest => posix.dirname(manifest.path))]);
    const artifacts = [...dirs].flatMap(dir => COVERAGE_CANDIDATES.map(([path]) => join(engine.root, dir, path)));
    artifacts.push(...readHealthConfig(engine.root).config.coverage.map(path => join(engine.root, path)));
    // Coverage files are intentionally excluded from the source index. Observe their
    // creation, replacement and deletion independently of source reindexing.
    return [...artifacts, ...[...engine.fileHashes().keys()].map(path => join(engine.root, path)), join(engine.root, CONFIG_FILE), ...[REVIEW_FILE, BASELINE_FILE, RUNS_FILE, ADVISORY_FILE].map((f) => join(state, f))].map(sig).join("|");
  }

  report(engine: FehmEngine, scope: Scope = "all"): HealthReport {
    const signature = this.signature(engine);
    let perEngine = this.built.get(engine);
    if (!perEngine) this.built.set(engine, (perEngine = new Map()));
    const hit = perEngine.get(scope);
    if (hit && hit.signature === signature) return this.withReadinessEvidence(engine, { ...hit.report, freshness: engine.freshness() });
    const report = buildHealthReport({ engine, facts: this.architecture.facts(engine), stateDirectory: this.state(engine), ...(this.options.dryRun ? { dryRun: true } : {}), scope });
    perEngine.set(scope, { signature: this.signature(engine), report });
    return this.withReadinessEvidence(engine, report);
  }

  private withReadinessEvidence(engine: FehmEngine, report: HealthReport): HealthReport {
    const readiness = { ...report.readiness, areas: report.readiness.areas.map(a => ({ ...a })), limitations: [...report.readiness.limitations] };
    for (const owner of ["/security", "/drift"] as const) {
      const area = readiness.areas.find(a => a.owner === owner)!;
      try {
        const source = owner === "/security" ? this.options.security?.report(engine, report.scope) : this.options.drift?.report(engine);
        if (!source) continue;
        if (!source.freshness.fresh) { area.detail = "Source index is stale; refresh before assessing these findings."; continue; }
        const entries = owner === "/security"
          ? (source as ReturnType<SecurityService["report"]>).findings.filter(isOpen)
          : (source as ReturnType<DriftService["report"]>).findings.filter(f => !f.decision && f.status !== "resolved");
        area.findingIds = entries.map(f => f.id);
        area.references = entries.slice(0, 10).map(f => ({ title: f.title, href: owner }));
        area.status = entries.length ? "risks-detected" : "evidence-incomplete";
        area.detail = `${entries.length} open findings in the existing ${owner === "/security" ? "Security" : "repository-wide Drift"} report. Static findings require review; absence does not establish correctness.`;
      } catch {
        area.detail = "Related analysis unavailable; open the owning feature to inspect the failure. This is not a clean result.";
      }
    }
    if (readiness.areas.some(a => a.status === "risks-detected")) { readiness.status = "risks-detected"; readiness.summary = "Engineering risks detected. Inspect the evidence and verify the affected behavior."; }
    return { ...report, readiness };
  }

  payload(engine: FehmEngine, scope: Scope = "all"): HealthPagePayload {
    return { ...this.report(engine, scope), writable: this.writable };
  }

  review(engine: FehmEngine, id: string, status: string, note?: string): { ok: true } | { error: string } {
    if (this.options.dryRun) return { error: "read-only (dry run)" };
    if (!id || id.length > 500) return { error: "finding id required" };
    if (status !== "clear" && !isReviewStatus(status)) return { error: `unknown review status ${status}` };
    writeReview(this.state(engine), id, status === "clear" ? null : status, note);
    return { ok: true };
  }

  setBaseline(engine: FehmEngine): { ok: true; findings: number } | { error: string } {
    if (this.options.dryRun) return { error: "read-only (dry run)" };
    const r = this.report(engine, "all");
    writeBaseline(this.state(engine), r.findings, r.git.commit);
    return { ok: true, findings: r.findings.length };
  }

  clearBaseline(engine: FehmEngine): { ok: true } | { error: string } {
    if (this.options.dryRun) return { error: "read-only (dry run)" };
    clearBaseline(this.state(engine));
    return { ok: true };
  }

  /** Run one detected check (by id; the command itself is never taken from the request). */
  async run(engine: FehmEngine, checkId: string): Promise<RunResult | { error: string }> {
    if (this.options.dryRun) return { error: "read-only (dry run): checks are not run" };
    const check = this.report(engine).build.checks.find((c) => c.id === checkId);
    if (!check) return { error: "unknown check" };
    if (this.running.has(check.id)) return { error: "this check is already running" };
    this.running.add(check.id);
    try {
      return await runCheckAsync(engine.root, this.state(engine), check, indexFingerprint(engine), this.report(engine).git.commit);
    } finally {
      this.running.delete(check.id);
    }
  }

  async advisories(engine: FehmEngine): Promise<HealthReport["dependencies"]["advisories"] | { error: string }> {
    if (this.options.dryRun) return { error: "read-only (dry run): no network lookups" };
    const result = await checkAdvisories(this.state(engine), this.report(engine).dependencies.components, this.options.fetcher);
    return result.status === "error" ? { error: result.reason ?? "advisory check failed" } : result;
  }

  sbom(engine: FehmEngine, format: string): unknown {
    const r = this.report(engine);
    const subject = { name: r.repository.name, components: r.dependencies.components, toolVersion: FEHM_VERSION, generatedAt: new Date().toISOString() };
    return format === "spdx" ? spdx(subject) : cycloneDx(subject);
  }

  source(engine: FehmEngine, path: string, line: number, radius = 8): SourceExcerpt | undefined {
    const lines = engine.sourceLines(path);
    if (!lines) return undefined;
    const focus = Math.min(Math.max(1, Math.floor(line) || 1), Math.max(1, lines.length));
    const start = Math.max(1, focus - radius);
    const end = Math.min(lines.length, focus + radius);
    return { path, start, focus, lines: lines.slice(start - 1, end).map((l) => redactLine(l.length > 240 ? `${l.slice(0, 239)}…` : l)) };
  }
}
