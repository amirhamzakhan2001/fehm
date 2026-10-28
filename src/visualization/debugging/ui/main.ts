import type { FailureInput, Investigation } from '../../../debugging/types.js';
const el=<T extends HTMLElement>(id:string)=>document.getElementById(id) as T;
const status=el('status'),result=el('result');
let nonce='',report:Investigation|undefined,saved=false;
let linked:Pick<FailureInput,'runId'|'evidenceId'>={};
async function request(path:string,value?:unknown):Promise<unknown> {
  const response=await fetch(path,value === undefined ? {}:{method:'POST',headers:{'content-type':'application/json','x-fehm-debug':nonce},body:JSON.stringify(value)});
  const data=await response.json() as {error?:string};if (!response.ok) throw new Error(data.error ?? 'Request failed');return data;
}
function text(tag:string,value:string,parent:HTMLElement):HTMLElement {const node=document.createElement(tag);node.textContent=value;parent.append(node);return node;}
function detail(title:string,parent:HTMLElement):HTMLElement {const d=document.createElement('details');text('summary',title,d);parent.append(d);return d;}
function render(r:Investigation):void {
  report=r;result.replaceChildren();el('tools').hidden=false;el('delete').hidden=!saved;el<HTMLButtonElement>('save').disabled=saved;
  status.textContent=r.stale ? 'Stale evidence — analyze again before using these conclusions.' : `Analyzed ${r.bounds.files} files · ${r.bounds.nodes} nodes · failure revision ${r.revisionStatus}`;
  const summary=document.createElement('section');summary.className='card';result.append(summary);
  text('h2',r.summary,summary);text('p',`${r.reproduction.status}: ${r.reproduction.explanation}`,summary);
  if (r.reproduction.runId) {const a=document.createElement('a');a.href='/guardrails';a.textContent='Open verification history';summary.append(a);}
  const action=r.actions[0];
  if (action) {
    const box=document.createElement('section');box.className='card primary';result.append(box);
    text('h2','Next diagnostic action',box);text('h3',action.title,box);text('p',action.reason,box);text('p',`Supports: ${action.confirms}`,box);text('p',`Rejects: ${action.rejects}`,box);
    if (action.kind === 'run-check') {text('pre',JSON.stringify({argv:action.argv,cwd:action.cwd},null,2),box);text('p','Save this investigation to run the existing check from the CLI. This page does not execute commands.',box);if (saved) text('pre',`fehm debug run --id ${r.id} --action-id ${action.id} --approve`,box);}
  }
  if (r.hypotheses.length) text('h2','Possible causes',result);
  for (const h of r.hypotheses) {
    const d=detail(`${h.cause} · tentative`,result);text('p',h.rationale,d);text('p',`Missing: ${h.missing}`,d);text('p',`Alternatives: ${h.alternatives.join(' ')}`,d);
    const a=r.actions.find(x=>x.id === h.actionId);if (a) text('p',`Diagnostic: ${a.title}. ${a.reason}`,d);
    for (const id of h.evidenceIds) {const link=document.createElement('a');link.href=`#${id}`;link.textContent=`Evidence ${id} `;d.append(link);}
  }
  const gaps=detail('Unknowns and limits',result);for (const u of [...r.unknowns,...r.limitations]) text('p',u,gaps);
  const frames=detail('Reported stack locations',result);
  for (const f of r.frames) text('p',`${f.path}:${f.line} → ${f.status}${f.resolvedPath ? ` (${f.resolvedPath}, ${f.mapping})`:''}${f.status === 'ambiguous' ? `: ${f.candidates.join(', ')}`:''}`,frames);
  text('h2','Evidence',result);
  for (const e of r.evidence) {
    const d=detail(`${e.id} · ${e.origin} · ${e.path ? `${e.path}:${e.line ?? 1}`:e.kind}`,result);d.id=e.id;
    if (e.kind === 'source') {
      const pre=document.createElement('pre');d.append(pre);
      for (const line of e.text.split('\n')) {const span=text('span',line,pre);span.className='source-line';const number=Number(line.match(/^\d+/)?.[0]);if (r.frames.some(f=>f.resolvedPath === e.path && f.line === number)) span.classList.add('focus');}
    } else text('pre',e.text,d);
    if (e.nodeId) {const a=document.createElement('a');a.href=`/graph#node=${encodeURIComponent(e.nodeId)}`;a.textContent='Open in code graph';d.append(a);}
  }
}
function download(name:string,value:string,type:string):void {const url=URL.createObjectURL(new Blob([value],{type}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
el('input').addEventListener('submit',event=>{event.preventDefault();void (async()=>{
  el<HTMLButtonElement>('analyze').disabled=true;status.textContent='Collecting local evidence…';
  try {const input:FailureInput={...linked,text:el<HTMLTextAreaElement>('failure').value};const path=el<HTMLInputElement>('path').value.trim(),revision=el<HTMLInputElement>('revision').value.trim();if (path) input.location={path,line:Number(el<HTMLInputElement>('line').value)};if (revision) input.failureRevision=revision;saved=false;render(await request('/api/debug/investigate',input) as Investigation);}catch(e){status.textContent=String(e);}finally{el<HTMLButtonElement>('analyze').disabled=false;}
})();});
el('clear').addEventListener('click',()=>{linked={};status.textContent='Linked check cleared. New analysis will use the supplied text and location.';});
el('save').addEventListener('click',()=>{if (!report) return;void request('/api/debug/save',{id:report.id}).then(()=>{saved=true;history.replaceState(null,'',`?id=${report!.id}`);render(report!);status.textContent='Investigation saved locally.';}).catch(e=>{status.textContent=String(e);});});
el('delete').addEventListener('click',()=>{if (!report) return;void request('/api/debug/delete',{id:report.id}).then(()=>{saved=false;el('delete').hidden=true;el<HTMLButtonElement>('save').disabled=true;status.textContent='Saved investigation deleted. Analyze again to save a new version.';history.replaceState(null,'','/debug');}).catch(e=>{status.textContent=String(e);});});
el('json').addEventListener('click',()=>{if (report) download(`fehm-investigation-${report.id}.json`,JSON.stringify(report,null,2),'application/json');});
el('export').addEventListener('click',()=>{if (report) void request(`/api/debug/context?id=${report.id}`).then(value=>download('fehm-failure-context.txt',(value as {text:string}).text,'text/plain')).catch(e=>{status.textContent=String(e);});});
void (async()=>{
  try {
    nonce=(await request('/api/debug/session') as {nonce:string}).nonce;
    const params=new URLSearchParams(location.search),id=params.get('id'),runId=params.get('run-id'),evidenceId=params.get('evidence-id');
    if (id) {saved=true;const r=await request(`/api/debug/report?id=${encodeURIComponent(id)}`) as Investigation;linked={...(r.input.runId ? {runId:r.input.runId,evidenceId:r.input.evidenceId!}:{})};el<HTMLTextAreaElement>('failure').value=r.input.text ?? '';el<HTMLInputElement>('revision').value=r.input.failureRevision ?? '';if (r.input.location) {el<HTMLInputElement>('path').value=r.input.location.path;el<HTMLInputElement>('line').value=String(r.input.location.line);}render(r);}
    else if (params.has('path')) {el<HTMLInputElement>('path').value=params.get('path')!;el<HTMLInputElement>('line').value=params.get('line') ?? '1';status.textContent='Location selected. Describe the unexpected behavior, then analyze.';}
    else if (runId && evidenceId) {linked={runId,evidenceId};render(await request('/api/debug/investigate',linked) as Investigation);}
  } catch(e) {status.textContent=String(e);}
})();
