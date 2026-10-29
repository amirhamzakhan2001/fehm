import { execFileSync } from 'node:child_process';
import { lstatSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import type { FehmEngine } from '../engine.js';
import { readJson, writeJsonAtomic } from '../persistence.js';
import { hashContent } from '../scanner.js';
import { digest } from './discovery.js';
import { compareCandidate } from './optimization.js';
import type { EvaluationRun, PromptCandidate, PromptRecord, SemanticResult } from './types.js';
export interface PromptRevision {
    version: number;
    optimizationId: string;
    promptId: string;
    at: string;
    sourceCommit: string | null;
    originalDigest: string;
    candidateDigest: string;
    score: number;
    tokens: number;
    status: PromptCandidate['status'] | 'applied';
    changes: string[];
}
const HISTORY = 'prompt-revisions.json';
export function promptHistory(state: string, promptId?: string): PromptRevision[] {
    const stored = readJson<unknown>(join(state, HISTORY));
    if (!stored.ok)
        return [];
    if (!Array.isArray(stored.value))
        return [];
    return stored.value.filter((r): r is PromptRevision => !!r && typeof r === 'object' && typeof r.promptId === 'string' && typeof r.optimizationId === 'string' && Number.isInteger(r.version) && typeof r.at === 'string').filter(r => !promptId || r.promptId === promptId);
}
/** Record references and measurements only, not another copy of source or Git history. */
export function recordRevision(root: string, state: string, c: PromptCandidate, applied = false): PromptRevision {
    const history = promptHistory(state);
    const previous = history.find(r => r.optimizationId === c.id && r.status === (applied ? 'applied' : c.status));
    if (previous)
        return previous;
    let sourceCommit: string | null = null;
    try {
        sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 2000 }).trim();
    }
    catch { /* uncommitted repository */ }
    const version = Math.max(0, ...history.filter(r => r.promptId === c.promptId).map(r => r.version)) + 1;
    const revision: PromptRevision = { version, optimizationId: c.id, promptId: c.promptId, at: new Date().toISOString(), sourceCommit, originalDigest: c.originalDigest, candidateDigest: digest(c.text), score: c.score.composite, tokens: c.tokens, status: applied ? 'applied' : c.status, changes: c.changes.map(x => x.ruleId) };
    writeJsonAtomic(join(state, HISTORY), [...history, revision].slice(-1000));
    return revision;
}
export interface ApplyPromptOptions {
    engine: FehmEngine;
    prompt: PromptRecord;
    candidate: PromptCandidate;
    baseline: EvaluationRun;
    proposed: EvaluationRun;
    semantic: SemanticResult;
    /** Explicit developer approval, distinct from the candidate's recommendation. */
    approved: boolean;
    dryRun?: boolean;
    stateDirectory?: string;
    /** Runs relevant application checks after the edit. False/throw rolls back this file. */
    validate: () => Promise<boolean>;
}
/** Applies only a known literal span. Never executes application tools or commits changes. */
export async function applyPromptCandidate(options: ApplyPromptOptions): Promise<{
    path: string;
    candidateId: string;
    applied: boolean;
}> {
    const { engine, prompt: p, candidate } = options;
    if (!options.approved)
        throw new Error('Explicit developer approval is required');
    const checked = compareCandidate(p, candidate, options.baseline, options.proposed, options.semantic);
    if (checked.status !== 'recommended')
        throw new Error('Candidate rejected: ' + checked.reasons.join(' '));
    if (!p.sourceSpan)
        throw new Error('No unambiguous source span is available');
    if (typeof options.validate !== 'function')
        throw new Error('Relevant code validation is required');
    const root = realpathSync(engine.root), target = resolve(root, p.path), rel = relative(root, target);
    if (isAbsolute(rel) || rel === '..' || rel.startsWith('..' + (process.platform === 'win32' ? '\\' : '/')) || lstatSync(target).isSymbolicLink())
        throw new Error('Source path is outside the repository or is a symlink');
    const real = realpathSync(target), realRel = relative(root, real);
    if (realRel.startsWith('..') || isAbsolute(realRel))
        throw new Error('Source path escapes the repository');
    const original = readFileSync(real, 'utf8');
    const normalized = original.replace(/\r\n/g, '\n');
    if (hashContent(original) !== engine.fileHashes().get(p.path) || normalized !== engine.sourceLines(p.path)?.join('\n') || normalized.slice(p.sourceSpan.start, p.sourceSpan.end) !== p.sourceSpan.original)
        throw new Error('Source changed after analysis; re-scan before applying');
    if (options.dryRun)
        return { path: p.path, candidateId: candidate.id, applied: false };
    const replacement = p.sourceSpan.encoding === 'js' ? JSON.stringify(candidate.text) : candidate.text;
    let next = normalized.slice(0, p.sourceSpan.start) + replacement + normalized.slice(p.sourceSpan.end);
    if (original.includes('\r\n'))
        next = next.replace(/\n/g, '\r\n');
    writeFileSync(real, next);
    try {
        if (!await options.validate())
            throw new Error('Relevant code checks failed');
        if (readFileSync(real, 'utf8') !== next)
            throw new Error('Source changed during validation; refusing to claim the candidate was applied');
    }
    catch (error) {
        if (readFileSync(real, 'utf8') === next)
            writeFileSync(real, original);
        else
            throw new Error('Validation failed and another writer changed the source; not overwriting that change. ' + String(error));
        throw error;
    }
    if (options.stateDirectory)
        recordRevision(engine.root, options.stateDirectory, checked, true);
    return { path: p.path, candidateId: candidate.id, applied: true };
}
