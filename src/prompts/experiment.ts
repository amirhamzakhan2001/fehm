import { evaluatePrompt, judgeCandidate, type BehavioralProvider, type SemanticJudge } from './evaluation.js';
import { compareCandidate, improvePrompt } from './optimization.js';
import type { OptimizationMode, PromptCase, PromptRecord } from './types.js';
/** Opt-in experiment: both versions run the same reviewed suite before the hard regression gates. */
export async function evaluateCandidate(options: {
    prompt: PromptRecord;
    mode?: OptimizationMode;
    cases: PromptCase[];
    provider: BehavioralProvider;
    judge: SemanticJudge;
    model: string;
    timeoutMs?: number;
}) {
    const candidate = improvePrompt(options.prompt, options.mode);
    if (candidate.status === 'rejected')
        throw new Error(candidate.reasons.join(' '));
    const baseline = await evaluatePrompt(options.prompt.text, options.cases, options.provider, options.model, options.timeoutMs);
    const proposed = await evaluatePrompt(candidate.text, options.cases, options.provider, options.model, options.timeoutMs);
    const semantic = await judgeCandidate(options.prompt.text, candidate.text, candidate.intent.requirements, options.judge);
    return { baseline, proposed, semantic, candidate: compareCandidate(options.prompt, candidate, baseline, proposed, semantic) };
}
