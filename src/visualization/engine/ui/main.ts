import type { EngineStatus } from '../../../engine.js';
import type { ContextPacket, ContextItem } from '../../../model.js';
import { $, fmt, h } from '../../graph/ui/dom.js';
import { readingGuide } from './reading-guide.js';

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init);
  if (!res.ok) throw new Error(`Request failed (HTTP ${res.status}). Please try again.`);
  return await res.json() as T;
}
let serial = 0;
let markdown = '';
let current: ContextPacket | undefined;
function graphLink(n: ContextItem): HTMLElement {
  return h('a', { href: `/graph#node=${encodeURIComponent(n.nodeId)}` }, `${n.name}${n.location ? ` · line ${n.location.line}` : ''}`);
}
function render(packet: ContextPacket): void {
  const guide = readingGuide(packet);
  const groups = guide.groups.map((g, index) => h('article', {class:'guide-card'},
    h('h3', {}, `${index + 1}. ${g.path.split('/').at(-1)}`), h('div',{class:'p'},g.path),
    h('p',{},g.description),
    h('p',{class:'muted'},'Selected symbols and sections:'),
    h('ul',{}, ...g.items.map(n => h('li',{},graphLink(n)))),
    h('details',{},h('summary',{},'Read selected source and signatures'), ...g.items.map(n => h('pre',{},n.text))),
  ));
  $('guide').replaceChildren(h('div', {},
    h('h2',{},'What the index found'), h('p',{},guide.summary),
    ...groups.slice(0,5),
    groups.length > 5 ? h('details',{},h('summary',{},`Show ${groups.length - 5} more locations`),...groups.slice(5)) : null,
    guide.connections.length ? h('section',{},h('h2',{},'How these pieces connect'),h('p',{class:'muted'},'These links describe indexed code relationships, not execution order.'),h('ul',{},...guide.connections.slice(0,8).map(c=>h('li',{},c))),guide.connections.length>8 ? h('details',{},h('summary',{},'More connections'),h('ul',{},...guide.connections.slice(8).map(c=>h('li',{},c)))) : null) : null,
    packet.tests.length ? h('section',{},h('h2',{},'Tests to inspect'),h('p',{class:'muted'},'Related test files; this does not establish coverage or passing results.'),h('ul',{},...packet.tests.map(path=>h('li',{},h('a',{href:`/graph#node=${encodeURIComponent(`file:${path}`)}`},path))))) : null,
    h('section',{},h('h2',{},'What still needs checking'),h('ul',{},...guide.caveats.map(c=>h('li',{},c)))),
  ));
  const b=packet.budget;
  $('budget').textContent=`${guide.groups.length} locations found. About ${fmt.format(b.usedTokens)} of ${fmt.format(b.maximumTokens)} tokens used in the AI context.${b.truncated ? ' Some details were shortened to fit.' : ''}`;
  $('diagnostics').textContent=`Task: ${packet.intent}; estimator: ${b.estimator}; omitted items: ${b.dropped}; shortened items: ${b.downgraded}. Search scores measure ranking, not correctness or confidence in an answer.`;
  $('nodes').replaceChildren(h('thead',{},h('tr',{},...['Search score','Detail','Estimated tokens','Symbol'].map(x=>h('th',{},x)))),h('tbody',{},...packet.recommendedNodes.map(n=>h('tr',{},h('td',{},n.score.toFixed(3)),h('td',{},n.detail),h('td',{},String(n.tokens)),h('td',{},graphLink(n))))));
  $('preview').textContent=markdown;
  $('export-panel').hidden=false;
  $('retrieval-panel').hidden=false;
  $('copy-status').textContent='';
}
async function load(init?: RequestInit, path='/api/status'): Promise<boolean> {
  try {
    const s=await json<EngineStatus>(path,init);
    $('project').textContent=s.root;
    const cards:[string,number][]=[['Files',s.stats.files],['Indexed items',s.stats.nodes],['Relationships',s.stats.edges],['Unresolved references',s.stats.unresolved]];
    $('stats').replaceChildren(...cards.map(([k,v])=>h('div',{class:'stat'},h('span',{},k),h('b',{},fmt.format(v)))));
    $('sync').textContent=`Index updated: ${s.sync.analyzedFiles.length} files analyzed, ${s.sync.reusedFiles.length} reused.`;
    $('sync').className='muted';
    return true;
  } catch(error) { $('sync').textContent=(error as Error).message; $('sync').className='err'; return false; }
}
$('rescan').addEventListener('click',async()=>{
  serial++;
  ($('build') as HTMLButtonElement).disabled=false;
  if(current){ current.index.fresh=false; render(current); }
  $('export-panel').hidden=true;
  const success = await load({method:'POST'},'/api/rescan');
  $('budget').textContent=success ? 'Rescan finished. Submit your question again to refresh the reading guide.' : 'Rescan failed. Existing results may be stale; try again.';
});
$('query').addEventListener('submit',async e=>{
  e.preventDefault(); const request=++serial;
  const params=new URLSearchParams(new FormData(e.target as HTMLFormElement) as unknown as Record<string,string>);
  ($('build') as HTMLButtonElement).disabled=true;
  $('budget').textContent='Finding relevant code…';
  current=undefined;
  $('guide').replaceChildren(); $('export-panel').hidden=true; $('retrieval-panel').hidden=true;
  try {
    const result=await json<{packet:ContextPacket;markdown:string}>(`/api/context?${params}`);
    if(request!==serial)return;
    markdown=result.markdown;current=result.packet;render(current);
  } catch(error) { if(request===serial)$('budget').textContent=(error as Error).message; }
  finally { if(request===serial)($('build') as HTMLButtonElement).disabled=false; }
});
$('copy').addEventListener('click',async()=>{
  try { await navigator.clipboard.writeText(markdown); $('copy-status').textContent='Context copied.'; }
  catch { $('copy-status').textContent='Clipboard unavailable. Download the Markdown or select the text below.'; }
});
$('download').addEventListener('click',()=>{
  const url=URL.createObjectURL(new Blob([markdown],{type:'text/markdown;charset=utf-8'}));
  const link=document.createElement('a');link.href=url;link.download='fehm-context.md';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
});
void load();
