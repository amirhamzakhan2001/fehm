import type { Severity } from '../findings/model.js';
import type { PromptFinding, PromptPolicy, PromptRecord, PromptScore } from './types.js';
export const estimateTokens = (text: string): number => Math.ceil(Buffer.byteLength(text, 'utf8') / 4);
export const DIMENSIONS = ['Intent clarity', 'Role definition', 'Context quality', 'Input boundaries', 'Constraints', 'Output contract', 'Failure handling', 'Grounding', 'Security', 'Tool behavior', 'Token efficiency', 'Maintainability'];
export function analyzePrompt(p: PromptRecord, policy: PromptPolicy = {}): void {
    const findings: PromptFinding[] = [];
    const scores = new Map<string, {
        score: number | null;
        reason: string;
    }>(DIMENSIONS.map(name => [name, { score: null, reason: 'Not established by static analysis.' }]));
    const set = (name: string, score: number, reason: string): void => { scores.set(name, { score, reason }); };
    const issue = (id: string, title: string, severity: Severity, why: string, action: string, dimension: string, score: number, fix = false): void => {
        findings.push({ id: `${p.id}:${id}`, ruleId: id, promptId: p.id, category: id.startsWith('PI3') ? 'security' : 'ai-code', severity, confidence: p.confidence >= .9 ? 'strong' : 'inferred', detectionConfidence: p.confidence,
            title, message: why, why, action, file: p.path, line: p.line, ...(p.functionId ? { nodeId: p.functionId } : {}), evidence: [{ type: p.confidence >= .9 ? 'ast' : 'pattern', path: p.path, line: p.line, detail: why }], more: 0, verification: ["Review the evidence and run representative prompt cases."], autofixAvailable: fix });
        set(dimension, score, why);
    };
    const staticText = p.text.replace(/\$\{[^}]*\}|\{\{[^}]*\}\}|\{[a-zA-Z_]\w*\}/g, '');
    p.tokens.static = estimateTokens(staticText);
    const firstVariable = p.text.search(/\$\{|\{\{|\{[a-zA-Z_]\w*\}/);
    p.tokens.stablePrefix = estimateTokens(firstVariable < 0 ? p.text : p.text.slice(0, firstVariable));
    if (!p.text.trim() && p.reconstruction === 'complete')
        issue('PI003', 'Empty prompt', 'high', 'The reconstructed prompt is empty.', 'Define the task before invoking the model.', 'Intent clarity', 0);
    else if (/\b(?:classify|extract|summarize|translate|rewrite|generate|answer|identify|return|review)\b/i.test(staticText))
        set('Intent clarity', 85, 'An explicit task verb was detected; semantic correctness is not measured.');
    else if (p.text.trim())
        issue('PI002', 'Task not explicit', 'low', 'No explicit task verb was detected in reconstructed instructions.', 'Describe the required task and success criteria.', 'Intent clarity', 50);
    const complex = p.kind !== 'generation' || p.tools.length > 0;
    if (p.behavioralInstruction === 'present')
        set('Role definition', 90, 'A resolved system/developer instruction is supplied.');
    else if (p.behavioralInstruction === 'not-detected' && p.call !== 'template')
        issue('PI012', 'Behavioral instruction not detected', policy.missingInstructionSeverity ?? (p.tools.length ? 'high' : complex ? 'medium' : 'info'), 'No system/developer instruction was reconstructed for this call.', 'Define persistent behavior if the application requires it; a simple generation utility may not need this.', 'Role definition', complex ? 35 : 80);
    const delimited = /<(?:input|user_input|context|document|untrusted)>[\s\S]*?<\/(?:input|user_input|context|document|untrusted)>|```[\s\S]*?```/i.test(p.text);
    const separated = p.fragments.some(f => ['system', 'developer'].includes(f.role)) && p.fragments.some(f => f.role === 'user');
    if (p.variables.length) {
        if (delimited || separated)
            set('Input boundaries', 85, 'Separate messages or paired delimiters detected; this is not an injection defense guarantee.');
        else
            issue('PI010', 'Dynamic data mixed with instructions', 'medium', 'Dynamic values appear without a detected message or delimiter boundary. Their trust is not proven.', 'Separate variable content from trusted instructions and validate outputs.', 'Input boundaries', 35);
    }
    if (p.outputContract.enforced)
        set('Output contract', 95, 'Structured output configuration detected; runtime schema validity is not checked.');
    else if (p.outputContract.format === 'json' && !/\bjson\b/i.test(p.text))
        issue('PI007', 'Possible output parser mismatch', 'medium', p.outputContract.evidence.join(' '), 'Require JSON and enforce the exact schema in code.', 'Output contract', 25, true);
    else if (/\bjson\b|return only|output format/i.test(p.text))
        set('Output contract', 80, 'Output instructions detected; prose does not enforce a schema.');
    if (complex && !/\bif\b[\s\S]{0,180}(?:unknown|uncertain|missing|cannot|insufficient|fail|empty)|insufficient_context/i.test(p.text))
        issue('PI011', 'Failure behavior not detected', 'low', 'This workflow has no detected instruction for missing or uncertain inputs.', 'Choose a fallback compatible with the application contract.', 'Failure handling', 45);
    else if (complex)
        set('Failure handling', 85, 'Conditional fallback language detected.');
    if (p.kind === 'rag') {
        if (/only (?:use|the|supplied)|cite|supported by|do not invent/i.test(p.text))
            set('Grounding', 85, 'Grounding instructions detected; faithfulness requires behavioral evaluation.');
        else
            issue('PI106', 'Grounding constraint not detected', 'medium', 'Context/retrieval language suggests a grounded workflow, but no source restriction was detected.', 'Require use of supplied context and define unsupported-answer behavior.', 'Grounding', 40, true);
    }
    if (/\b(?:must|never|only|do not)\b/i.test(p.text))
        set('Constraints', 80, 'Explicit constraints detected; completeness requires semantic review.');
    if (p.tools.length) {
        if (/tool|confirm|approval|allowlist/i.test(p.text))
            set('Tool behavior', 80, 'Tool policy language detected; enforcement belongs in code.');
        else
            issue('PI303', 'Tool behavior is unspecified', 'high', 'The call has tools but reconstructed instructions contain no tool-use policy.', 'Define allowed tools, argument validation and approval boundaries.', 'Tool behavior', 25);
    }
    if ((p.text.includes('[REDACTED') || /•{8,}/.test(p.text)) || /\$\{[^}]*(?:SECRET|API_KEY|PASSWORD|TOKEN)[^}]*\}/.test(p.text))
        issue('PI306', 'Sensitive prompt content', 'high', 'A redacted secret or secret-named dynamic value appears in the prompt.', 'Remove credentials from model inputs; keep credentials within tools.', 'Security', 0);
    if (p.tokens.static > (policy.staticTokenLimit ?? 2000))
        issue('PI008', 'Large static instruction overhead', 'low', `Approximately ${p.tokens.static} static tokens before runtime context.`, 'Review redundant instructions and measure behavior before shortening.', 'Token efficiency', 50);
    else
        set('Token efficiency', 90, 'Static size is below the configured threshold; dynamic cost is unknown.');
    const sentences = p.text.split(/\n|(?<=[.!?])\s+/).map(s => s.trim()).filter(s => s.length > 25);
    if (new Set(sentences).size < sentences.length)
        issue('PI005', 'Repeated instruction', 'low', 'Identical instruction text occurs more than once.', 'Review whether repetition is intentional before extracting shared instructions.', 'Maintainability', 60);
    else
        set('Maintainability', 90, 'No exact repeated instruction detected within this prompt.');
    if (/always[\s\S]{0,30}json/i.test(p.text) && /never[\s\S]{0,30}json/i.test(p.text))
        issue('PI013', 'Potential conflicting JSON instructions', 'medium', 'Both always-JSON and never-JSON language occur.', 'Resolve the contradictory output requirements.', 'Output contract', 20);
    p.findings = findings;
    const dimensions = [...scores].map(([name, value]) => ({ name, ...value }));
    const known = dimensions.filter(d => d.score !== null);
    const score = known.length ? Math.round(known.reduce((n, d) => n + d.score!, 0) / known.length) : 0;
    p.score = { static: score, semantic: null, behavioral: null, composite: score, dimensions, band: scoreBand(score) };
}
export function scoreBand(score: number): string { return score >= 90 ? 'Excellent' : score >= 80 ? 'Strong' : score >= 70 ? 'Acceptable' : score >= 60 ? 'Needs improvement' : score >= 40 ? 'Weak' : 'Critical'; }
export function combineScores(base: PromptScore, semantic: number | null, behavioral: number | null): PromptScore {
    for (const v of [semantic, behavioral])
        if (v !== null && (!Number.isFinite(v) || v < 0 || v > 100))
            throw new Error('Scores must be finite values between 0 and 100');
    const values = [base.static, semantic, behavioral].filter((x): x is number => x !== null);
    const composite = Math.round(values.reduce((a, b) => a + b, 0) / values.length);
    return { ...base, semantic, behavioral, composite, band: scoreBand(composite) };
}
