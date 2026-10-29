import type { SecurityService } from "../security/service.js";
import { pageAsset } from '../graph/assets.js';
import { pageHeaders, renderPage, type ViewRoutes } from '../http.js';
import type { SecurityServiceOptions } from '../security/service.js';
import { evaluatePrompt, suggestedCases, validateCases } from '../../prompts/evaluation.js';
import { digest } from '../../prompts/discovery.js';
import { compareCandidate } from '../../prompts/optimization.js';
import { MODES, type SemanticResult, type OptimizationMode } from '../../prompts/types.js';
import { PromptService } from './service.js';
import { PROMPTS_PAGE } from './page.js';
export function createPromptRoutes(options: SecurityServiceOptions & { security?: SecurityService } = {}): ViewRoutes & { service: PromptService } {
    const service = new PromptService(options);
    return { service, handle(req, url, ctx, reply) {
            const path = url.pathname;
            if (path === '/prompts' || path === '/prompts/') {
                reply(200, renderPage(PROMPTS_PAGE, url), 'text/html; charset=utf-8', pageHeaders());
                return true;
            }
            if (path.startsWith('/prompts/assets/')) {
                const asset = pageAsset(path.slice('/prompts/assets/'.length));
                reply(asset === undefined ? 404 : 200, asset ?? 'not found', 'text/javascript; charset=utf-8', pageHeaders());
                return true;
            }
            if (path !== '/api/prompts' && !path.startsWith('/api/prompts/'))
                return false;
            if (path === '/api/prompts/refresh') {
                if (req.method !== 'POST')
                    reply(405, { error: 'POST required' });
                else if (req.headers['x-fehm'] !== '1')
                    reply(403, { error: 'missing x-fehm header' });
                else
                    reply(200, service.report(ctx.reindex()));
                return true;
            }
            if (path === '/api/prompts/save') {
                if (req.method !== 'POST')
                    reply(405, { error: 'POST required' });
                else if (req.headers['x-fehm'] !== '1')
                    reply(403, { error: 'missing x-fehm header' });
                else {
                    try {
                        const mode = (url.searchParams.get('mode') ?? 'balanced') as OptimizationMode;
                        if (!MODES.includes(mode))
                            throw new Error('Invalid mode');
                        reply(200, service.save(ctx.engine(), url.searchParams.get('id') ?? '', mode));
                    }
                    catch (e) {
                        reply(409, { error: (e as Error).message });
                    }
                }
                return true;
            }
            if (path === '/api/prompts/evaluate' || path === '/api/prompts/compare' || path === '/api/prompts/proposal') {
                if (req.method !== 'POST') {
                    reply(405, { error: 'POST required' });
                    return true;
                }
                if (req.headers['x-fehm'] !== '1') {
                    reply(403, { error: 'missing x-fehm header' });
                    return true;
                }
                let body = '';
                let oversized = false;
                req.setEncoding('utf8');
                req.on('data', (chunk: string) => { if (oversized)
                    return; body += chunk; if (Buffer.byteLength(body) > 1000000) {
                    oversized = true;
                    reply(413, { error: 'Evaluation request exceeds 1 MB' });
                } });
                req.on('end', () => {
                    if (oversized)
                        return;
                    void (async () => {
                        try {
                            const data: unknown = JSON.parse(body);
                            if (!data || typeof data !== 'object')
                                throw new Error('Expected an evaluation object');
                            const d = data as Record<string, unknown>;
                            if (path === '/api/prompts/proposal') {
                                if (typeof d.promptId !== 'string' || typeof d.text !== 'string' || d.text.length > 200000 || !MODES.includes(d.mode as OptimizationMode) || typeof d.save !== 'boolean') throw new Error('promptId, text, valid mode and boolean save are required');
                                reply(200, service.proposal(ctx.engine(), d.promptId, d.mode as OptimizationMode, d.text, d.save)); return;
                            }
                            if (typeof d.promptId !== 'string' || typeof d.model !== 'string' || !d.outputs || typeof d.outputs !== 'object' || Array.isArray(d.outputs))
                                throw new Error('promptId, model and recorded outputs are required');
                            validateCases(d.cases);
                            const p = service.report(ctx.engine()).prompts.find(p => p.id === d.promptId);
                            if (!p)
                                throw new Error('Unknown prompt');
                            const mode = d.mode;
                            if (mode !== undefined && !MODES.includes(mode as OptimizationMode))
                                throw new Error('Invalid mode');
                            const candidate = d.candidateId !== undefined ? service.proposals(ctx.engine(), p.id).find(c => c.id === d.candidateId) : mode ? service.candidate(ctx.engine(), p.id, mode as OptimizationMode) : undefined;
                            if (d.candidateId !== undefined && (!candidate || candidate.originalDigest !== digest(p.text))) throw new Error('Saved proposal is missing or belongs to an older prompt version');
                            const text = candidate?.text ?? p.text;
                            if (path === '/api/prompts/compare') {
                                if (!candidate || !d.baselineOutputs || typeof d.baselineOutputs !== 'object' || !d.semantic || typeof d.semantic !== 'object')
                                    throw new Error('Comparison needs mode, baselineOutputs, candidate outputs and semantic review');
                                const semantic = d.semantic as SemanticResult;
                                if (!Number.isFinite(semantic.score) || semantic.score < 0 || semantic.score > 100 || typeof semantic.intentPreserved !== 'boolean' || typeof semantic.model !== 'string' || typeof semantic.rationale !== 'string' || !semantic.rationale)
                                    throw new Error('Invalid semantic review');
                                const recorded = (outputs: Record<string, unknown>) => async ({ test }: {
                                    test: {
                                        id: string;
                                    };
                                }): Promise<string> => { const output = outputs[test.id]; if (typeof output !== 'string')
                                    throw new Error('Missing recorded output'); return output; };
                                const baseline = await evaluatePrompt(p.text, d.cases, recorded(d.baselineOutputs as Record<string, unknown>), d.model);
                                const proposed = await evaluatePrompt(text, d.cases, recorded(d.outputs as Record<string, unknown>), d.model);
                                reply(200, { baseline, proposed, semantic, candidate: compareCandidate(p, candidate, baseline, proposed, semantic), source: 'User-supplied outputs and semantic review; execution provenance is not verified' });
                                return;
                            }
                            const outputs = d.outputs as Record<string, unknown>;
                            const run = await evaluatePrompt(text, d.cases, async ({ test }) => { const output = outputs[test.id]; if (typeof output !== 'string')
                                throw new Error('Missing recorded output for ' + test.id); return output; }, d.model);
                            reply(200, { ...run, source: 'user-supplied recorded outputs; model execution is not verified' });
                        }
                        catch (e) {
                            reply(400, { error: (e as Error).message });
                        }
                    })();
                });
                req.on('error', () => { if (!oversized)
                    reply(400, { error: 'Could not read evaluation request' }); });
                return true;
            }
            if (req.method !== 'GET') {
                reply(405, { error: 'GET required' });
                return true;
            }
            const engine = ctx.engine();
            if (path === '/api/prompts' || path === '/api/prompts/report') {
                reply(200, service.report(engine));
                return true;
            }
            const p = service.report(engine).prompts.find(p => p.id === url.searchParams.get('id'));
            if (!p) {
                reply(404, { error: 'Prompt not found' });
                return true;
            }
            if (path === '/api/prompts/proposals') {
                try { reply(200, service.proposals(engine, p.id)); } catch (error) { reply(409, { error: (error as Error).message }); }
                return true;
            }
            if (path === '/api/prompts/history') {
                reply(200, service.history(engine, p.id));
                return true;
            }
            if (path === '/api/prompts/detail') {
                reply(200, { prompt: p, cases: suggestedCases(p) });
                return true;
            }
            if (path === '/api/prompts/candidate' || path === '/api/prompts/patch') {
                const mode = (url.searchParams.get('mode') ?? 'balanced') as OptimizationMode;
                if (!MODES.includes(mode)) {
                    reply(400, { error: 'Invalid optimization mode' });
                    return true;
                }
                const c = service.candidate(engine, p.id, mode);
                if (path.endsWith('/patch'))
                    reply(c.patch ? 200 : 409, c.patch ?? 'No safe single source span: review the logical prompt diff manually.', 'text/plain; charset=utf-8', { 'content-disposition': `attachment; filename="${c.id}.patch"` });
                else
                    reply(200, c);
                return true;
            }
            reply(404, { error: 'not found' });
            return true;
        } };
}
