import { parseTestOutcomes } from './test-outcomes.js';
import { analyzeChange } from './change.js';
import { optionalGit } from '../git-memory/git.js';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, realpathSync, openSync, closeSync, unlinkSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { FehmEngine } from '../engine.js';
import { BriefingFacts } from '../codebase-briefing/facts.js';
import { detectBuild } from '../health/build.js';
import { buildSecurityReport } from '../security/security.js';
import { readJson, writeJsonAtomic } from '../persistence.js';
import { changedFiles, digest, snapshot } from './snapshot.js';
import type { CheckStatus, GuardPolicy, GuardRun, Phase, Requirement } from './types.js';
export { snapshot } from './snapshot.js';
export type * from './types.js';

export function classify(exit: number | null, output: string, tests: boolean): CheckStatus {
  if (/Cannot find module|MODULE_NOT_FOUND|command not found|ENOENT|SyntaxError|EADDRINUSE|Missing script|No module named/.test(output)) return 'blocked';
  if (exit === null) return 'blocked';
  if (exit !== 0) return 'failed';
  if (!tests) return 'passed';
  const count = (s: string): number => Number(output.match(new RegExp(`^# ${s} (\\d+)\\s*$`, 'm'))?.[1] ?? 0);
  return count('tests') > 0 && count('pass') === count('tests') && count('fail') === 0 && count('skipped') === 0 && count('todo') === 0 && count('cancelled') === 0 ? 'passed' : 'inconclusive';
}
export function redact(output: string): string {
  return output.replace(/\x1b\[[0-9;]*m/g, '').replace(/((?:token|password|secret|api[_-]?key|authorization)\s*[:=]\s*)[^\s,;]+/gi, '$1[REDACTED]').replace(/(?:gh[pousr]_[A-Za-z0-9_]{16,}|sk-[A-Za-z0-9_-]{16,}|AKIA[A-Z0-9]{16}|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)/g, '[REDACTED]').slice(-32_000);
}
export function validatePolicy(p: GuardPolicy): void {
  if (!p || !Array.isArray(p.checks) || !Array.isArray(p.requiredCategories) || !['host-approved','isolated'].includes(p.execution) || typeof p.tdd !== 'boolean' || typeof p.security !== 'boolean' || !Number.isInteger(p.maxAttempts) || p.maxAttempts < 0 || p.maxAttempts > 10 || !Number.isInteger(p.timeoutMs) || p.timeoutMs < 100 || p.timeoutMs > 600_000) throw new Error('Invalid guardrails policy');
  const ids = new Set<string>(), categories = ['unit','integration','regression','build','lint'];
  for (const c of p.checks) {
    if (!c || !/^[\w.-]{1,80}$/.test(c.id) || ids.has(c.id) || !categories.includes(c.category) || typeof c.required !== 'boolean' || typeof c.cwd !== 'string' || isAbsolute(c.cwd) || c.cwd.split(/[\\/]/).includes('..') || !Array.isArray(c.argv) || !c.argv.length || c.argv.some(a => typeof a !== 'string' || !a || a.includes('\0'))) throw new Error('Invalid or duplicate check');
    ids.add(c.id);
  }
  if (p.requiredCategories.some(c => !categories.includes(c))) throw new Error('Unknown required category');
}
export function suggestedPolicy(root: string): GuardPolicy {
  const engine = FehmEngine.open(root, { dryRun: true });
  const checks = detectBuild(root, new BriefingFacts(engine)).checks;
  return { checks: checks.map((c, i) => ({ id: `check-${i + 1}`, category: c.kind === 'test' ? 'regression' : c.kind === 'lint' ? 'lint' : 'build', argv: c.argv, cwd: c.cwd, required: true })), requiredCategories: ['unit','integration','regression'], tdd: true, security: true, maxAttempts: 2, timeoutMs: 120_000, execution: 'host-approved' };
}
export class Guardrails {
  readonly directory: string;
  constructor(readonly root: string) { this.directory = join(root, '.fehm', 'guardrails'); }
  private path(id: string): string { if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error('Invalid run id'); return join(this.directory, `${id}.json`); }
  private save(run: GuardRun): void { writeJsonAtomic(this.path(run.id), run); }
  private event(run: GuardRun, event: string, detail: string): void { run.timeline.push({ at: new Date().toISOString(), event, detail: redact(detail) }); this.save(run); }
  load(id: string): GuardRun {
    const result = readJson<GuardRun>(this.path(id));
    if (!result.ok) throw new Error(`Run unavailable: ${result.reason}`);
    const run = result.value;
    validatePolicy(run.policy);
    if (run.version !== 1 || run.id !== id || digest(run.policy) !== run.policyHash) throw new Error('Run policy changed; start a new run');
    return run;
  }
  history(): { id: string; task: string; created: string }[] {
    if (!existsSync(this.directory)) return [];
    return readdirSync(this.directory).filter(p => /^[a-f0-9-]{36}\.json$/.test(p)).map(p => this.load(p.slice(0,-5))).sort((a,b) => b.created.localeCompare(a.created)).map(({id,task,created}) => ({id,task,created}));
  }
  start(task: string, requirements: Requirement[], policy: GuardPolicy, mode: GuardRun['mode'] = 'verification-only'): GuardRun {
    validatePolicy(policy);
    if (!task.trim() || !['agent-integration','fehm-directed','verification-only'].includes(mode) || !Array.isArray(requirements) || requirements.some(r => !r.id || !r.text || !['user','inferred'].includes(r.origin) || typeof r.confirmed !== 'boolean' || !Array.isArray(r.checks) || r.checks.some(id => !policy.checks.some(c => c.id === id))) || new Set(requirements.map(r => r.id)).size !== requirements.length) throw new Error('Invalid task or requirement mappings');
    const run: GuardRun = { version: 1, id: randomUUID(), task, mode, created: new Date().toISOString(), requirements: structuredClone(requirements), policy: structuredClone(policy), policyHash: digest(policy), base: snapshot(this.root), evidence: [], attempts: [], timeline: [] };
    this.event(run, 'intake', 'Requirements and policy frozen. Commands require per-invocation approval.');
    return run;
  }
  async verifyChange(approve = false) {
    const change = analyzeChange(this.root);
    if (!approve) return { analysis: change, report: null };
    // Reuse only identical scope/policy and currently passing evidence.
    const previous = this.history().map(h => this.load(h.id)).find(r => r.change?.fingerprint === change.fingerprint && r.change.head === change.head && digest(r.policy) === digest(change.policy) && digest(r.change.files) === digest(change.files));
    const run = previous ?? this.start('Verify current working-tree change', [], change.policy);
    if (!previous) { run.change = change; this.save(run); }
    if (snapshot(this.root).fingerprint !== change.fingerprint) throw new Error('Change modified during planning; refresh verification');
    for (const check of run.policy.checks) {
      if (snapshot(this.root).fingerprint !== change.fingerprint) break;
      const latest = [...this.load(run.id).evidence].reverse().find(e => e.checkId === check.id);
      if (latest?.status === 'passed' && latest.fingerprint === change.fingerprint) continue;
      await this.execute(run.id, check.id, 'green', true);
      if (snapshot(this.root).fingerprint !== change.fingerprint) break;
    }
    const current = snapshot(this.root);
    if (run.policy.security && !current.incomplete.length && current.fingerprint === change.fingerprint && this.load(run.id).security?.fingerprint !== current.fingerprint) this.assessSecurity(run.id);
    return {analysis:change,report:this.report(run.id)};
  }
  exception(id: string, reason: string): void { this.withLease(() => this.recordException(id, reason)); }
  private recordException(id: string, reason: string): void {
    if (!reason.trim()) throw new Error('A TDD exception requires a reason');
    const run = this.load(id); run.exception = {reason: redact(reason), at: new Date().toISOString()}; this.event(run, 'tdd-exception', reason);
  }
  review(id: string, reason: string): void { this.withLease(() => this.recordReview(id, reason)); }
  private recordReview(id: string, reason: string): void {
    if (!reason.trim()) throw new Error('A review requires a reason');
    const run = this.load(id); run.review = { fingerprint: snapshot(this.root).fingerprint, reason: redact(reason) }; this.event(run, 'human-review', reason);
  }
  async execute(id: string, checkId: string, phase: Phase, approve = false, expectedTest?: string): Promise<GuardRun> {
    if (!['baseline','red','green','refactor'].includes(phase)) throw new Error('Unknown phase');
    return this.withAsyncLease(() => this.executeLocked(id, checkId, phase, approve, expectedTest));
  }
  private lease(): () => void {
    mkdirSync(this.directory, {recursive:true});
    const lock = join(this.directory, 'execution.lock');
    let fd: number;
    try { fd = openSync(lock, 'wx'); } catch { throw new Error('Another verification is running; inspect execution.lock if an earlier process crashed'); }
    return () => { closeSync(fd); unlinkSync(lock); };
  }
  private withLease<T>(fn: () => T): T { const release = this.lease(); try { return fn(); } finally { release(); } }
  private async withAsyncLease<T>(fn: () => Promise<T>): Promise<T> { const release = this.lease(); try { return await fn(); } finally { release(); } }

  private async executeLocked(id: string, checkId: string, phase: Phase, approve: boolean, expectedTest?: string): Promise<GuardRun> {
    const run = this.load(id), check = run.policy.checks.find(c => c.id === checkId);
    if (!check) throw new Error('Check is not allowlisted in this run');
    const before = snapshot(this.root);
    const e: GuardRun['evidence'][number] = { id: randomUUID(), checkId, phase, status: 'pending', fingerprint: before.fingerprint, started: new Date().toISOString(), durationMs: 0, exitCode: null, output: '', approved: approve, argv: [...check.argv], cwd: check.cwd, policyHash: run.policyHash, ...(expectedTest ? {expectedTest} : {}) };
    e.testFingerprint = digest(before.tests);
    run.evidence.push(e);
    let blocked = '';
    if (!approve) blocked = 'Explicit approval required for exact argv, cwd and current revision';
    else if (run.policy.execution === 'isolated') blocked = 'OS filesystem/network isolation is unavailable in the host runner';
    else if (before.incomplete.length) blocked = 'Snapshot incomplete';
    else if (phase === 'baseline' && before.fingerprint !== run.base.fingerprint) blocked = 'Baseline must be captured before changes';
    let cwd = '';
    try { cwd = realpathSync(resolve(this.root, check.cwd)); const rel = relative(realpathSync(this.root), cwd); if (rel === '..' || rel.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) || isAbsolute(rel)) blocked = 'Working directory escapes repository'; } catch { blocked = 'Working directory unavailable'; }
    if (blocked) { e.status = 'blocked'; e.output = blocked; this.event(run, 'blocked', `${checkId}: ${blocked}`); return run; }
    e.status = 'running'; this.event(run, 'execution-approved', `${checkId} ${phase} ${before.fingerprint} ${JSON.stringify(check.argv)} (host permissions; no isolation)`);
    const start = Date.now();
    const result = await new Promise<{exit: number|null; output: string; timeout: boolean; truncated: boolean}>((done) => {
      const env: NodeJS.ProcessEnv = { PATH: process.env.PATH ?? '', CI: '1', NO_COLOR: '1' };
      for (const key of ['SystemRoot','TEMP','TMP','TMPDIR','PATHEXT']) if (process.env[key]) env[key] = process.env[key];
      // npm is a .cmd wrapper on Windows, and .cmd cannot run with shell:false.
      // npm_execpath is provided by npm itself; invoke that JS CLI with Node.
      const useNpmCli = process.platform === 'win32' && check.argv[0] === 'npm' && !!process.env.npm_execpath;
      const command = useNpmCli ? process.execPath : check.argv[0]!;
      const argv = useNpmCli ? [process.env.npm_execpath!, ...check.argv.slice(1)] : check.argv.slice(1);
      const child = spawn(command, argv, {cwd, env, shell:false, detached: process.platform !== 'win32', stdio:['ignore','pipe','pipe']});
      let output = '', timeout = false, truncated = false;
      const capture = (data: Buffer): void => { output += data.toString(); if (output.length > 64_000) { truncated = true; output = output.slice(-64_000); } };
      child.stdout.on('data', capture); child.stderr.on('data', capture);
      const kill = (): void => { try { if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, 'SIGKILL'); else child.kill('SIGKILL'); } catch { /* already exited */ } };
      const timer = setTimeout(() => { timeout = true; kill(); }, run.policy.timeoutMs);
      child.on('error', err => { output += `\nENOENT or execution error: ${err.message}`; });
      child.on('close', exit => { clearTimeout(timer); kill(); done({exit,output,timeout,truncated}); });
    });
    e.durationMs = Date.now() - start; e.exitCode = result.exit; e.output = redact(result.output);
    e.status = result.timeout ? 'blocked' : result.truncated ? 'inconclusive' : classify(result.exit, result.output, ['unit','integration','regression'].includes(check.category));
    if (['unit','integration','regression'].includes(check.category)) e.testOutcomes = parseTestOutcomes(redact(result.output), result.truncated || result.output.length > 32_000);
    const after = snapshot(this.root);
    if (after.fingerprint !== before.fingerprint || after.incomplete.length) e.status = 'stale';
    e.baselineFailure = e.status === 'failed' && run.evidence.some(x => x.phase === 'baseline' && x.checkId === checkId && x.status === 'failed');
    if (phase === 'red') {
      e.validRed = e.status === 'failed' && !!expectedTest && result.output.split(/(?=^\s*(?:not )?ok \d+ - )/m).some(block => block.split('\n')[0]?.trim().replace(/^not ok \d+ - /, '') === expectedTest && block.includes('ERR_ASSERTION')) && before.implementation === run.base.implementation && digest(before.tests) !== digest(run.base.tests);
      if (e.validRed) run.red = {tests: before.tests, checkId, evidenceId:e.id};
    }
    this.event(run, 'check-completed', `${checkId} ${phase}: ${e.status}`);
    return run;
  }
  assessSecurity(id: string): GuardRun { return this.withLease(() => this.assessSecurityLocked(id)); }
  private assessSecurityLocked(id: string): GuardRun {
    const run = this.load(id), before = snapshot(this.root);
    const report = buildSecurityReport({engine: FehmEngine.open(this.root, {dryRun:true}), dryRun:true});
    if (snapshot(this.root).fingerprint !== before.fingerprint || before.incomplete.length) throw new Error('Source changed or snapshot incomplete during security review');
    if (run.security) (run.securityHistory ??= []).push(run.security);
    run.security = { fingerprint:before.fingerprint, at:new Date().toISOString(), findings:report.findings.filter(f => !run.change || [f.file, ...f.evidence.map(e => e.path)].some(p => p && run.change!.affected.includes(p)) || (!f.file && !f.evidence.some(e => e.path))).map(f => ({...f,id:f.id,severity:f.severity,title:f.title,confidence:f.confidence,action:f.action,...(f.line ? {line:f.line} : {}),...(f.file ? {file:f.file} : {})})), limitations:[...report.unknowns, ...report.analyzers.filter(a => a.status === 'error').map(a => `Analyzer error: ${a.id}`), 'Separate deterministic static analysis, not an independent model or penetration test.', 'Analyzer coverage and configuration remain subject to Security Review limitations; no dynamic/network scans performed.'] };
    this.event(run, 'security-assessed', `${report.findings.length} static findings`); return run;
  }
  async remediate(id: string, reason: string, approved: boolean, adapter: (context: ReturnType<Guardrails['report']>) => Promise<void>): Promise<ReturnType<Guardrails['report']>> {
    return this.withAsyncLease(() => this.remediateLocked(id, reason, approved, adapter));
  }
  private async remediateLocked(id: string, reason: string, approved: boolean, adapter: (context: ReturnType<Guardrails['report']>) => Promise<void>): Promise<ReturnType<Guardrails['report']>> {
    let run = this.load(id);
    if (!approved || !reason.trim()) throw new Error('Explicit remediation approval and reason required');
    if (run.attempts.length >= run.policy.maxAttempts) throw new Error('Remediation limit reached');
    if (run.policy.execution !== 'host-approved') throw new Error('Isolated remediation unavailable');
    const before = snapshot(this.root), attempt = {at:new Date().toISOString(),reason:redact(reason),before:before.fingerprint,outcome:'running',after:''};
    run.attempts.push(attempt); this.event(run,'remediation-approved',reason);
    try { await adapter(this.report(id)); attempt.outcome = 'completed'; } catch (err) { attempt.outcome = `failed: ${redact(String(err))}`; }
    const after = snapshot(this.root); attempt.after = after.fingerprint;
    if (digest(before.tests) !== digest(after.tests)) attempt.outcome = 'requires_human_review: remediation modified tests';
    this.save(run);
    if (attempt.outcome === 'completed') {
      for (const check of run.policy.checks.filter(c => c.required)) await this.executeLocked(id,check.id,'green',true);
      run = this.load(id); if (run.policy.security) this.assessSecurityLocked(id);
    }
    return this.report(id);
  }
  context(id: string, characters = 12000): {text:string; truncated:boolean} {
    const report = this.report(id);
    const text = JSON.stringify({runId:id, task:report.run.task, requirements:report.run.requirements, readiness:report.readiness, reasons:report.reasons, impact:report.impact, checks:report.checks.map(c => ({id:c.id,status:c.status,output:c.evidence?.output.slice(-2000)})), security:report.run.security, limitations:report.limitations},null,2);
    const limit = Number.isFinite(characters) ? Math.max(1000, Math.min(50000,characters)) : 12000;
    return {text:text.slice(0,limit),truncated:text.length > limit};
  }
  report(id: string) {
    const run = this.load(id), current = snapshot(this.root), reasons: string[] = [];
    const checks = run.policy.checks.map(c => {
      const e = [...run.evidence].reverse().find(e => e.checkId === c.id && ['red','green','refactor'].includes(e.phase));
      const status: CheckStatus = e ? e.fingerprint === current.fingerprint ? e.status : 'stale' : 'pending';
      if (c.required && status !== 'passed') reasons.push(`${c.id}: ${status}`);
      return {...c,status,evidence:e};
    });
    for (const category of run.policy.requiredCategories) if (!checks.some(c => c.category === category && c.required && c.status === 'passed')) reasons.push(`Required ${category} evidence missing`);
    if (!run.requirements.length && !run.change) reasons.push('No acceptance criteria');
    if (run.change) { reasons.push(...run.change.unknowns); if (run.change.fingerprint !== current.fingerprint) reasons.push('Change analysis stale; analyze the current change again'); }
    for (const r of run.requirements) if (!r.confirmed || !r.checks.length || r.checks.some(id => !checks.some(c => c.id === id && c.status === 'passed'))) reasons.push(`Requirement ${r.id} unverified`);
    if (run.policy.tdd && !run.exception && (!run.red || digest(run.red.tests) !== digest(current.tests) || !checks.some(c => c.id === run.red?.checkId && c.status === 'passed'))) reasons.push('Valid red-to-green evidence missing or tests changed after red');
    const securityCurrent = run.security?.fingerprint === current.fingerprint;
    if (run.policy.security && !securityCurrent) reasons.push('Security assessment missing or stale');
    const securityBlock = securityCurrent && run.security!.findings.some(f => ['critical','high'].includes(f.severity));
    if (securityBlock) reasons.push('High/critical static findings require review and remediation');
    if (securityCurrent && run.security!.limitations.some(s => s.startsWith('Analyzer error:'))) reasons.push('Security analyzer failed');
    if (run.attempts.at(-1)?.outcome === 'running') reasons.push('Remediation is running or was interrupted');
    reasons.push(...current.incomplete);
    const changed = [...new Set([...(run.change?.files.map(f => f.path) ?? []), ...changedFiles(run.base,current)])];
    const engine = FehmEngine.open(this.root, {dryRun:true}), facts = new BriefingFacts(engine);
    const impacted = new Set(changed), queue = [...changed];
    for (let i = 0; i < queue.length && i < 10_000; i++) for (const p of facts.fileDeps.in.get(queue[i]!) ?? []) if (!impacted.has(p)) { impacted.add(p); queue.push(p); }
    const impact = { paths:[...impacted], suggestedTests:facts.testFiles.filter(p => impacted.has(p)), graphNodes:engine.graph.nodes().filter(n => n.path && impacted.has(n.path)).slice(0,100).map(n => ({id:n.id,name:n.name,path:n.path,href:`/graph#node=${encodeURIComponent(n.id)}`})), limitation:'Static reverse dependencies are advisory; dynamic relationships and test completeness are not established.' };
    const git = {head:optionalGit(this.root,['rev-parse','HEAD']), diff:redact(optionalGit(this.root,['diff','--no-ext-diff','--no-textconv','--no-color','HEAD','--','.']) ?? '')};
    // Changed existing tests/config warrant review; this is a heuristic, not an accusation.
    const testChanges = changedFiles(run.base,current).filter(p => run.base.tests[p] || /(^|\/)(package\.json|.*lock.*|.*test.*config.*)$/.test(p));
    const reviewNeeded = (testChanges.length > 0 || run.attempts.some(a => a.outcome.startsWith('requires_human_review'))) && run.review?.fingerprint !== current.fingerprint;
    if (reviewNeeded) reasons.push('Existing tests or test configuration changed; human review required');
    const readiness = checks.some(c => c.required && c.status === 'failed') ? 'failed' : securityBlock || reviewNeeded ? 'requires_human_review' : reasons.length ? 'not_verified' : run.exception || (securityCurrent && run.security!.findings.length) ? 'verified_warnings' : 'verified_required';
    return {run, fingerprint:current.fingerprint, changedFiles:changed, impact, git, testReviewPaths:testChanges, checks, readiness, reasons, securityCurrent, limitations:['Evidence covers configured checks and confirmed mappings only; passing does not prove correctness.', 'Host-approved commands and adapters have host permissions. No filesystem, network or memory isolation.', 'Snapshots include .fehm/health.json and findings-review.json but exclude other .fehm runtime files, .git, node_modules, dist, build, coverage, .cache and __pycache__. Dependencies and external services are not fingerprinted.', 'Local ledger is auditable history, not tamper-proof attestation. Test output is trusted only as much as the approved runner.']};
  }
}
