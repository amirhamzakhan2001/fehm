import { pageHeaders, renderPage, type ViewRoutes } from '../http.js';
import { pageAsset } from '../graph/assets.js';
import { ConceptService, type ConceptServiceOptions } from './service.js';
import { CONCEPTS_PAGE, ONTOLOGY_PAGE } from './page.js';
export function createConceptRoutes(options: ConceptServiceOptions = {}): ViewRoutes & {
    service: ConceptService;
} {
    const service = new ConceptService(options);
    return { service, handle(req, url, ctx, reply) {
            const path = url.pathname, p = url.searchParams;
            if (['/concepts', '/concepts/', '/ontology', '/ontology/'].includes(path)) {
                reply(200, renderPage(path.startsWith('/ontology') ? ONTOLOGY_PAGE : CONCEPTS_PAGE, url), 'text/html; charset=utf-8', pageHeaders());
                return true;
            }
            if (path.startsWith('/concepts/assets/')) {
                const asset = pageAsset(path.slice('/concepts/assets/'.length));
                reply(asset === undefined ? 404 : 200, asset ?? 'not found', 'text/javascript; charset=utf-8', pageHeaders());
                return true;
            }
            if (path !== '/api/concepts' && !path.startsWith('/api/concepts/'))
                return false;
            const action = path.slice('/api/concepts'.length) || '/report';
            if (req.method !== (action === '/refresh' ? 'POST' : 'GET')) {
                reply(405, { error: action === '/refresh' ? 'POST required' : 'GET required' });
                return true;
            }
            if (action === '/refresh' && req.headers['x-fehm'] !== '1') {
                reply(403, { error: 'missing x-fehm header' });
                return true;
            }
            try {
                const engine = action === '/refresh' ? ctx.reindex() : ctx.engine();
                if (action === '/refresh')
                    service.refreshCatalog(engine);
                if (action === '/catalog')
                    reply(200, service.index(engine).summary());
                else if (action === '/lookup')
                    reply(200, service.index(engine).lookup(p.get('q') ?? '', { ...(p.get('section') ? { section: p.get('section')! } : {}), ...(p.get('type') ? { type: p.get('type')! } : {}), limit: Number(p.get('limit') ?? 30) }));
                else if (action === '/knowledge') {
                    const id = p.get('id') ?? '', index = service.index(engine), concept = index.get(id);
                    if (!concept)
                        reply(404, { error: 'Unknown concept' });
                    else
                        reply(200, { concept, guidance: index.guidance(id), neighborhood: index.neighborhood(id, Number(p.get('depth') ?? 1)), repositoryFindingsIncluded: false });
                }
                else if (action === '/detail')
                    reply(200, service.detail(engine, p.get('id') ?? ''));
                else if (action === '/graph')
                    reply(200, service.graph(engine, p.get('id') ?? ''));
                else if (action === '/history')
                    reply(200, service.history(engine, p.get('id') ?? ''));
                else if (action === '/source')
                    reply(200, service.excerpt(engine, p.get('path') ?? '', Number(p.get('line') ?? 1)));
                else if (action === '/context')
                    reply(200, service.context(engine, p.get('q') ?? '', Number(p.get('bytes') ?? 8000)));
                else if (['/report', '/refresh'].includes(action)) {
                    const report = service.report(engine), index = service.index(engine), query = p.get('q') ?? '';
                    const candidates = query ? index.lookup(query, { limit: 100 }) : null, ids = candidates ? new Set(candidates.candidates.map(c => c.id)) : null;
                    const findings = report.findings.filter(f => {
                        const c = index.get(f.concept_id)!;
                        return (!ids || ids.has(f.concept_id) || f.evidence.some(e => e.path.toLowerCase().includes(query.toLowerCase()))) && (!p.get('section') || c.section === p.get('section')) && (!p.get('type') || c.type === p.get('type')) && (!p.get('status') || f.status === p.get('status')) && (!p.get('scope') || f.scope === p.get('scope')) && (!p.get('path') || f.evidence.some(e => e.path.startsWith(p.get('path')!))) && (!p.get('language') || f.evidence.some(e => e.nodeId && engine.graph.node(e.nodeId)?.language === p.get('language')));
                    });
                    reply(200, { ...report, findings, concepts: [...new Set([...findings.map(f => f.concept_id), ...(candidates?.candidates.map(c => c.id) ?? [])])].map(id => index.get(id)), resolution: candidates });
                }
                else
                    reply(404, { error: 'Unknown concept endpoint' });
            }
            catch (e) {
                reply(400, { error: (e as Error).message });
            }
            return true;
        } };
}
