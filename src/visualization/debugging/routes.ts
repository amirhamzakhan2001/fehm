import { randomUUID } from 'node:crypto';
import { investigate, indexDigest } from '../../debugging/investigate.js';
import { InvestigationStore } from '../../debugging/store.js';
import { MAX_INPUT_BYTES, validateInput } from '../../debugging/input.js';
import { investigationContext } from '../../debugging/context.js';
import type { Investigation } from '../../debugging/types.js';
import { pageHeaders, renderPage, type ViewRoutes } from '../http.js';
import { pageAsset } from '../graph/assets.js';
import { PAGE } from './page.js';

export function createDebuggingRoutes(options:{stateDirectory?:string}={}):ViewRoutes {
  const nonce=randomUUID(), ephemeral=new Map<string,Investigation>();
  return {handle(req,url,ctx,reply) {
    if (url.pathname === '/debug' || url.pathname === '/debug/') {reply(200,renderPage(PAGE,url),'text/html; charset=utf-8',pageHeaders());return true;}
    if (url.pathname.startsWith('/debug/assets/')) {const asset=pageAsset(url.pathname.slice('/debug/assets/'.length));reply(asset ? 200:404,asset ?? 'not found','text/javascript',pageHeaders());return true;}
    if (!url.pathname.startsWith('/api/debug')) return false;
    const host=req.headers.host ?? '', origin=req.headers.origin;
    if (!/^(?:localhost|127\.0\.0\.1)(?::\d+)?$/.test(host) || (origin && origin !== `http://${host}`) || req.headers['sec-fetch-site'] === 'cross-site') {reply(403,{error:'Same-origin localhost requests required'});return true;}
    const store=new InvestigationStore(ctx.engine().root,options.stateDirectory);
    const remember=(r:Investigation) => {if (ephemeral.size>=20) ephemeral.delete(ephemeral.keys().next().value!);ephemeral.set(r.id,r);return r;};
    if (url.pathname === '/api/debug/session' && req.method === 'GET') {reply(200,{nonce});return true;}
    if (url.pathname === '/api/debug/report' && req.method === 'GET') {
      try {reply(200,store.current(url.searchParams.get('id') ?? '',ctx.reindex()));} catch(err) {reply(404,{error:String(err)});}return true;
    }
    if (url.pathname === '/api/debug/context' && req.method === 'GET') {
      try { const id=url.searchParams.get('id') ?? '';const engine=ctx.reindex();const report=ephemeral.get(id) ?? store.current(id,engine);report.stale ||= report.indexDigest !== indexDigest(engine) || !engine.freshness().fresh;reply(200,investigationContext(report)); } catch(err) {reply(400,{error:String(err)});}return true;
    }
    if (!['/api/debug/investigate','/api/debug/save','/api/debug/delete'].includes(url.pathname)) {reply(404,{error:'Unknown investigation route'});return true;}
    if (req.method !== 'POST') {reply(405,{error:'POST required'});return true;}
    if (req.headers['x-fehm-debug'] !== nonce || !req.headers['content-type']?.startsWith('application/json')) {reply(403,{error:'Session nonce and JSON content type required'});return true;}
    let body='',oversized=false;
    req.setEncoding('utf8');
    req.on('data',(part:string)=>{if (oversized) return;body+=part;if (Buffer.byteLength(body)>MAX_INPUT_BYTES) {oversized=true;body='';reply(413,{error:'Failure input exceeds 128 KiB'});}});
    req.on('end',()=>{
      if (oversized) return;
      try {
        const value:unknown=JSON.parse(body);
        if (url.pathname === '/api/debug/investigate') {reply(200,remember(investigate(ctx.reindex(),validateInput(value))));return;}
        if (!value || typeof value !== 'object' || typeof (value as {id?:unknown}).id !== 'string') throw new Error('Investigation ID required');
        const id=(value as {id:string}).id;
        if (url.pathname === '/api/debug/save') {
          const report=ephemeral.get(id);if (!report) throw new Error('Analysis expired; analyze again before saving');store.save(report);reply(200,{id});
        } else {store.remove(id);ephemeral.delete(id);reply(200,{deleted:true});}
      } catch(err) {reply(400,{error:(err as Error).message});}
    });
    return true;
  }};
}
