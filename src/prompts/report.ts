import type { FehmEngine } from '../engine.js';
import { BriefingFacts } from '../codebase-briefing/facts.js';
import type { SecurityReport } from '../security/types.js';
import { analyzePrompt } from './analysis.js';
import { digest, discoverPrompts } from './discovery.js';
import type { PromptPolicy, PromptReport } from './types.js';
export function buildPromptReport(options: {
    engine: FehmEngine;
    facts?: BriefingFacts;
    security?: SecurityReport;
    policy?: PromptPolicy;
}): PromptReport {
    const facts = options.facts ?? new BriefingFacts(options.engine);
    const { prompts, coverage } = discoverPrompts(options.engine, facts);
    for (const p of prompts) {
        analyzePrompt(p, options.policy);
        p.securityFindingIds = (options.security?.findings ?? []).filter(f => f.file === p.path && (f.line === undefined || Math.abs(f.line - p.line) < 10) || f.evidence.some(e => e.path === p.path && e.line === p.line)).map(f => f.id);
    }
    const duplicates = new Map<string, typeof prompts>();
    for (const p of prompts)
        if (p.text.length > 40) {
            const key = digest(p.text.trim());
            duplicates.set(key, [...(duplicates.get(key) ?? []), p]);
        }
    for (const group of duplicates.values())
        if (group.length > 1)
            for (const p of group)
                p.findings.push({ id: `${p.id}:PI015`, ruleId: 'PI015', promptId: p.id, category: 'ai-code', severity: 'low', confidence: 'verified', detectionConfidence: 1, title: 'Duplicate prompt', message: `Exact prompt text occurs at ${group.length} sites.`, why: 'Duplicated instructions may drift independently.', action: 'Consider a shared prompt component; preserve the stable prefix for caching.', file: p.path, line: p.line, evidence: group.filter(x => x !== p).map(x => ({ type: 'pattern', path: x.path, line: x.line, detail: x.id })), more: 0, verification: ["Re-scan after consolidating the shared instructions."], autofixAvailable: false });
    const findings = prompts.flatMap(p => p.findings);
    return { schemaVersion: 1, generatedAt: new Date().toISOString(), repository: facts.name, digest: digest([...options.engine.fileHashes()].sort().map(([p, h]) => `${p}:${h}`).join('\n')), prompts, findings,
        summary: { aiCalls: prompts.filter(p => p.call !== 'template').length, prompts: prompts.length, behavioralInstructions: prompts.filter(p => p.behavioralInstruction === 'present').length, missingInstructions: prompts.filter(p => p.behavioralInstruction === 'not-detected' && p.call !== 'template').length, unknownInstructions: prompts.filter(p => p.behavioralInstruction === 'unknown').length, averageScore: prompts.length ? Math.round(prompts.reduce((n, p) => n + p.score.static, 0) / prompts.length) : null, critical: findings.filter(f => f.severity === 'critical' || f.severity === 'high').length, staticTokens: prompts.reduce((n, p) => n + p.tokens.static, 0) }, coverage,
        unknowns: ['Scores describe detected static signals, not measured task quality. Unknown dimensions are excluded from the average.', 'Python/config discovery is heuristic. Dynamic builders, reflection, runtime configuration and unsupported languages may hide prompts.', 'Call-graph dependencies are references, not proof that instructions propagate. Unresolved instructions are unknown, not missing.', 'Parser evidence is scoped to the enclosing function; association with a particular response requires review.', 'Token counts use a byte heuristic. Dynamic context, output tokens, provider pricing and effective cache cost are unknown.', 'Semantic and behavioral evaluations are opt-in. Generated cases require review; no model calls or application tools run during scanning.', ...(options.security ? [] : ['Security findings were not supplied; prompt-local checks do not replace Feature 3.6.'])] };
}
export function renderPromptText(r: PromptReport): string {
    return [`Prompt intelligence — ${r.repository}`, `${r.summary.aiCalls} AI calls · ${r.summary.prompts} prompts · static score ${r.summary.averageScore ?? 'unknown'}/100`, `${r.summary.missingInstructions} missing instructions · ${r.summary.unknownInstructions} unresolved`, ...r.prompts.flatMap(p => [`\n${p.id} ${p.kind} ${p.path}:${p.line} · ${p.score.static}/100 · ~${p.tokens.static} static tokens`, ...p.findings.map(f => `  [${f.severity}] ${f.ruleId} ${f.title}`)]), '\nNot determined:', ...r.unknowns.map(s => `  ${s}`)].join('\n');
}
