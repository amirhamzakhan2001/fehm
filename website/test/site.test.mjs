import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { build, configuration, root } from '../scripts/build.mjs';
import { createServer } from '../scripts/serve.mjs';

test('production configuration prevents accidental preview indexing and invalid metadata',()=>{
  assert.equal(configuration({}).indexable,false);
  assert.throws(()=>configuration({SITE_INDEXABLE:'true'}),/HTTPS/);
  assert.throws(()=>configuration({SITE_URL:'https://domain.example',SITE_INDEXABLE:'true'}),/HTTPS/);
  assert.throws(()=>configuration({SITE_URL:'https://example.com/subpath'}),/origin/);
  assert.throws(()=>configuration({GA_MEASUREMENT_ID:'"><script>'}),/GA4/);
  assert.equal(configuration({SITE_URL:'https://fehm.dev',SITE_INDEXABLE:'true'}).indexable,true);
});

test('all static pages have meaningful SEO, resolvable local links and current release instructions',async()=>{
  const {content,output,config}=await build({});
  const titles=new Set();
  for(const page of content) {
    const file=path.join(output,page.path==='/404.html'?'404.html':page.path.slice(1)+'index.html');
    const html=await readFile(file,'utf8');
    assert.equal((html.match(/<h1[ >]/g)||[]).length,1,page.path);
    const title=html.match(/<title>(.*?)<\/title>/)[1];
    assert.ok(!titles.has(title),`Duplicate title: ${title}`); titles.add(title);
    assert.match(html,/<meta name="robots" content="noindex, nofollow">/);
    assert.match(html,/rel="canonical"/);
    assert.match(html,/application\/ld\+json/);
    assert.match(html,/class="site-art" aria-hidden="true"/);
    assert.doesNotMatch(html,/\bbeta\b/i);
    assert.doesNotMatch(html,/href="\/status\/"|Build from a source checkout|Deployment settings|release qualification|component readiness/i);
    assert.doesNotMatch(html,/<a\b[^>]*href="https?:\/\/(?:www\.)?github\.com/i, 'Visitor navigation must stay on-site');
    for(const [,url] of html.matchAll(/(?:href|src)="(\/[^"#]*)(?:#[^"]*)?"/g)) {
      const local=path.join(output,url.endsWith('/')?url+'index.html':url);
      assert.ok((await stat(local)).isFile(),`${page.path} -> ${url}`);
    }
  }
  const homepage=await readFile(path.join(output,'index.html'),'utf8');
  assert.equal((homepage.match(/class="capability-card"/g)||[]).length,10);
  assert.doesNotMatch(homepage,/Trace a request|request map|Pause motion|Analytics settings|data-scene/);
  const install=await readFile(path.join(output,'getting-started/index.html'),'utf8');
  assert.ok(install.includes(`fehm-${config.version}-py3-none-PLATFORM.whl`));
  assert.match(install,/Install with uv/);
  assert.match(await readFile(path.join(output,'robots.txt'),'utf8'),/Disallow: \//);
  const server=createServer();
  try {
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
    const base=`http://127.0.0.1:${server.address().port}`;
    assert.equal((await fetch(base+'/')).status,200);
    assert.equal((await fetch(base+'/missing-page/')).status,404);
    assert.equal((await fetch(base+'/status/')).status,404);
    assert.equal((await fetch(base+'/features',{redirect:'manual'})).status,301);
    for (const route of ['/releases/','/docs/installation/','/docs/mcp/','/integrations/codex/']) {
      assert.equal((await fetch(base+route)).status,200,route);
    }
    assert.equal((await fetch(base+'/',{method:'POST'})).status,405);
    assert.match((await fetch(base+'/styles.css')).headers.get('content-type'),/text\/css/);
    assert.match((await fetch(base+'/fonts/manrope.woff')).headers.get('content-type'),/font\/woff/);
    assert.equal((await fetch(base+'/%2e%2e%2fpackage.json')).status,404);
  } finally {
    server.closeAllConnections();
    await new Promise(resolve=>server.close(resolve));
  }
  try {
    await build({SITE_URL:'https://example.com',SITE_INDEXABLE:'true',GA_MEASUREMENT_ID:'G-TEST1234'});
    const home=await readFile(path.join(output,'index.html'),'utf8');
    const missing=await readFile(path.join(output,'404.html'),'utf8');
    assert.match(home,/<link rel="canonical" href="https:\/\/example.com\/">/);
    assert.match(home,/<meta name="robots" content="index, follow">/);
    assert.match(home,/<meta name="fehm-ga-id" content="G-TEST1234">/);
    assert.doesNotMatch(home,/<script[^>]+src="https:\/\/www.googletagmanager.com/);
    assert.match(missing,/<meta name="robots" content="noindex, nofollow">/);
    const sitemap=await readFile(path.join(output,'sitemap.xml'),'utf8');
    assert.equal((sitemap.match(/<loc>/g)||[]).length,content.length-1);
    assert.doesNotMatch(sitemap,/localhost|404.html/);
    assert.match(await readFile(path.join(output,'robots.txt'),'utf8'),/Sitemap: https:\/\/example.com\/sitemap.xml/);
  } finally {
    // Keep the developer preview unindexed and analytics-free after testing.
    await build({});
  }
});

function browserHarness(source, {id='G-TEST1234',stored=null,writeFails=false}={}) {
  const handlers={},scripts=[],events=[],storage=new Map();
  if(stored)storage.set('fehm-analytics-consent-v1',stored);
  const panel={hidden:true,querySelector:()=>({focus(){}})};
  const settings={addEventListener:(name,fn)=>handlers.settings=fn};
  const status={textContent:''};
  let reloaded=false;
  const document={title:'Fehm',head:{appendChild:s=>scripts.push(s)},createElement:()=>({}),
    querySelector:s=>({content:s.includes('fehm-ga-id')?id:'https://fehm.dev/getting-started/'}),
    getElementById:s=>s==='consent'?panel:s==='privacy-preferences'?settings:status,
    querySelectorAll:s=>s==='.copy'?[]:s==='[data-consent]'?['granted','denied'].map(choice=>({dataset:{consent:choice},addEventListener:(name,fn)=>handlers[choice]=fn})):['docs_click','install_guide_click','secret_command'].map(event=>({dataset:{event},addEventListener:(name,fn)=>handlers[event]=fn})),
  };
  const window={location:{reload:()=>reloaded=true},dataLayer:events};
  const context={document,window,localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>{if(writeFails)throw Error('blocked');storage.set(k,v);}},encodeURIComponent,Date};
  vm.runInNewContext(source,context);
  return {handlers,scripts,events,window,panel,storage,get reloaded(){return reloaded;}};
}

test('analytics is absent before consent, allowlists events, sanitizes page URL and supports withdrawal',async()=>{
  const source=await readFile(path.join(root,'public/app.js'),'utf8');
  const h=browserHarness(source);
  assert.equal(h.scripts.length,0);
  assert.equal(h.panel.hidden,false);
  h.handlers.docs_click(); assert.equal(h.events.length,0);
  h.handlers.denied(); assert.equal(h.scripts.length,0);
  h.handlers.granted(); assert.equal(h.scripts.length,1);
  h.handlers.granted(); assert.equal(h.scripts.length,1);
  h.handlers.docs_click(); h.handlers.secret_command();
  const emitted=h.events.filter(e=>e[0]==='event');
  assert.deepEqual(emitted.map(e=>e[1]),['page_view','docs_click']);
  for(const e of emitted) assert.equal(e[2].page_location,'https://fehm.dev/getting-started/');
  h.handlers.denied(); assert.equal(h.window['ga-disable-G-TEST1234'],true); assert.equal(h.reloaded,true);
  const count=h.events.length;h.handlers.docs_click();assert.equal(h.events.length,count);
  assert.equal(browserHarness(source,{id:''}).scripts.length,0);
  assert.equal(browserHarness(source,{stored:'denied'}).scripts.length,0);
  const blocked=browserHarness(source,{stored:'granted',writeFails:true});
  blocked.handlers.denied();assert.equal(blocked.reloaded,false);assert.equal(blocked.window['ga-disable-G-TEST1234'],true);
});

test('documentation search and visibility handling work with reduced motion',async()=>{
  const source=await readFile(path.join(root,'public/motion.js'),'utf8');
  const handlers={}, classes=new Set();
  const status={textContent:''};
  const input={value:'',addEventListener:(event,fn)=>handlers.search=fn};
  const cards=['Installation uv setup','Architecture drift','MCP connection'].map(search=>({dataset:{search},hidden:false}));
  const document={
    hidden:false,
    body:{classList:{toggle(name,force){const next=force===undefined?!classes.has(name):force;if(next)classes.add(name);else classes.delete(name);return next;}}},
    querySelectorAll:selector=>selector==='[data-search]'?cards:[],
    getElementById:id=>id==='docs-search'?input:status,
    addEventListener:(event,fn)=>handlers[event]=fn,
  };
  // Controls must remain fully functional when the visitor requests no motion.
  vm.runInNewContext(source,{document,window:{matchMedia:()=>({matches:true})}});
  input.value='  UV ';handlers.search();assert.deepEqual(cards.map(c=>c.hidden),[false,true,true]);assert.equal(status.textContent,'1 guide found.');
  input.value='no-such-guide';handlers.search();assert.ok(cards.every(c=>c.hidden));assert.equal(status.textContent,'0 guides found.');
  input.value='';handlers.search();assert.ok(cards.every(c=>!c.hidden));
  document.hidden=true;handlers.visibilitychange();assert.ok(classes.has('page-hidden'));
});
