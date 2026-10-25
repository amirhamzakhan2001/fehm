import { Guardrails } from '../../guardrails/workflow.js';
import { pageHeaders, renderPage, type ViewRoutes } from '../http.js';
import { pageAsset } from '../graph/assets.js';
import { PAGE } from './page.js';
export function createGuardrailRoutes(): ViewRoutes {
  return {handle(req,url,ctx,reply) {
    if (url.pathname === '/guardrails' || url.pathname === '/guardrails/') { reply(200,renderPage(PAGE,url),'text/html; charset=utf-8',pageHeaders()); return true; }
    if (url.pathname.startsWith('/guardrails/assets/')) { const asset = pageAsset(url.pathname.slice('/guardrails/assets/'.length)); reply(asset ? 200 : 404,asset ?? 'not found','text/javascript',pageHeaders()); return true; }
    if (!['/api/guardrails','/api/guardrails/report'].includes(url.pathname)) return false;
    if (req.method !== 'GET') { reply(405,{error:'Read-only dashboard. Use the CLI for explicit approvals.'}); return true; }
    try { const service = new Guardrails(ctx.engine().root); reply(200,url.pathname.endsWith('/report') ? service.report(url.searchParams.get('id') ?? '') : service.history()); }
    catch (err) { reply(400,{error:(err as Error).message}); }
    return true;
  }};
}
