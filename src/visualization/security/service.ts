import { statSync } from "node:fs";
import { join } from "node:path";
import type { FehmEngine } from "../../engine.js";
import { isReviewStatus, REVIEW_FILE, writeReview } from "../../findings/review.js";
import { ADVISORY_FILE } from "../../health/advisories.js";
import { CONFIG_FILE } from "../../health/config.js";
import { clearBaseline, writeBaseline } from "../../health/history.js";
import type { SourceExcerpt } from "../../health/types.js";
import { stateDir } from "../../persistence.js";
import { redactLine } from "../../security/secrets.js";
import { buildSecurityReport, SECURITY_BASELINE_FILE, toSarif } from "../../security/security.js";
import type { SecurityPagePayload, SecurityReport } from "../../security/types.js";
import { ArchitectureService } from "../architecture/service.js";

export interface SecurityServiceOptions {
  stateDirectory?: string;
  /** Never write reviews, baselines or trend points. */
  dryRun?: boolean;
  /** Share 3.3's per-engine facts (the server passes its architecture service). */
  architecture?: ArchitectureService;
}

type Scope = "all" | "changed";

/**
 * Feature 3.6's server side. One report per engine instance, scope and state
 * (reviews, baseline, advisory results, configuration), so reviewing a
 * finding or setting a baseline is picked up without re-indexing.
 *
 * Source excerpts pass through secret redaction: a finding that points at a
 * credential never shows the credential.
 */
export class SecurityService {
  private readonly built = new WeakMap<FehmEngine, Map<string, { signature: string; report: SecurityReport }>>();
  private readonly architecture: ArchitectureService;

  constructor(private readonly options: SecurityServiceOptions = {}) {
    this.architecture = options.architecture ?? new ArchitectureService({ ...(options.stateDirectory ? { stateDirectory: options.stateDirectory } : {}), ...(options.dryRun ? { dryRun: true } : {}) });
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
    return [join(engine.root, CONFIG_FILE), ...[REVIEW_FILE, SECURITY_BASELINE_FILE, ADVISORY_FILE].map((f) => join(state, f))].map(sig).join("|");
  }

  report(engine: FehmEngine, scope: Scope = "all"): SecurityReport {
    const signature = this.signature(engine);
    let per = this.built.get(engine);
    if (!per) this.built.set(engine, (per = new Map()));
    const hit = per.get(scope);
    if (hit && hit.signature === signature) return { ...hit.report, freshness: engine.freshness() };
    const report = buildSecurityReport({ engine, facts: this.architecture.facts(engine), stateDirectory: this.state(engine), ...(this.options.dryRun ? { dryRun: true } : {}), scope });
    per.set(scope, { signature: this.signature(engine), report });
    return report;
  }

  payload(engine: FehmEngine, scope: Scope = "all"): SecurityPagePayload {
    return { ...this.report(engine, scope), writable: !this.options.dryRun };
  }

  sarif(engine: FehmEngine, scope: Scope = "all"): unknown {
    return toSarif(this.report(engine, scope));
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
    writeBaseline(this.state(engine), r.findings, r.provenance.commit, SECURITY_BASELINE_FILE);
    return { ok: true, findings: r.findings.length };
  }

  clearBaseline(engine: FehmEngine): { ok: true } | { error: string } {
    if (this.options.dryRun) return { error: "read-only (dry run)" };
    clearBaseline(this.state(engine), SECURITY_BASELINE_FILE);
    return { ok: true };
  }

  /** Excerpt of an indexed file with detected secrets masked. */
  source(engine: FehmEngine, path: string, line: number, radius = 8): SourceExcerpt | undefined {
    const lines = engine.sourceLines(path);
    if (!lines) return undefined;
    const focus = Math.min(Math.max(1, Math.floor(line) || 1), Math.max(1, lines.length));
    const start = Math.max(1, focus - radius);
    const end = Math.min(lines.length, focus + radius);
    return { path, start, focus, lines: lines.slice(start - 1, end).map((l) => redactLine(l.length > 240 ? `${l.slice(0, 239)}…` : l)) };
  }
}
