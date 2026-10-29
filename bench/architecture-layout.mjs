/** Run after npm run build. Comparison dependencies belong in an isolated directory:
 * node bench/architecture-layout.mjs /tmp/fehm-architecture-research/bench
 * Flat candidate adapters intentionally do not claim FEHM boundary/port/label validation parity.
 */
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { writeFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { FehmEngine } from '../dist/engine.js';
import { ArchitectureService } from '../dist/visualization/architecture/service.js';
const require = createRequire(resolve(process.argv[2], 'package.json'));
const ELK = require('elkjs/lib/elk.bundled.js');
const cytoscape = require('cytoscape');
const elk = new ELK();
const scratch = mkdtempSync(resolve(tmpdir(), 'fehm-layout-'));
const results = [], panels = [];
const esc = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function record(project, view, candidate, nodes, edges, ms, bounds) {
 const width = bounds?.width ?? Math.max(1,...nodes.map(n=>n.x+n.width))+30;
 const height = bounds?.height ?? Math.max(1,...nodes.map(n=>n.y+n.height))+30;
 let overlaps=0;
 for(let i=0;i<nodes.length;i++) for(let j=i+1;j<nodes.length;j++) {const a=nodes[i],b=nodes[j];if(a.x<b.x+b.width&&a.x+a.width>b.x&&a.y<b.y+b.height&&a.y+a.height>b.y) overlaps++;}
 results.push({project,view,candidate,nodes:nodes.length,edges:edges.length,ms:Math.round(ms*10)/10,width:Math.round(width),height:Math.round(height),fitScale:Math.round(Math.min(1,1100/width,650/height)*100)/100,overlaps});
 panels.push(`<section><h2>${esc(project)} / ${esc(view)} / ${esc(candidate)}</h2><p>${nodes.length} nodes, ${edges.length} edges. Open SVG at native size to inspect labels.</p><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="1100" height="650"><rect width="100%" height="100%" fill="#0c0f16"/>${edges.map(e=>`<polyline fill="none" stroke="#7183a0" stroke-width="1.5" points="${e.points.map(p=>`${p.x},${p.y}`).join(' ')}"/>`).join('')}${nodes.map(n=>`<rect x="${n.x}" y="${n.y}" width="${n.width}" height="${n.height}" rx="6" fill="#172136" stroke="#8fb0eb"/><text x="${n.x+8}" y="${n.y+25}" fill="#e0e5f0" font-size="13">${esc(n.name)}</text>`).join('')}</svg></section>`);
}
try {
for(const [project,root] of [['fehm',process.cwd()],['api-fixture',resolve('bench/corpus')]]) {
 const engine=FehmEngine.open(root,{stateDirectory:resolve(scratch,project)}), service=new ArchitectureService({dryRun:true});
 for(const [view,focus] of [['system','context'],['system',undefined],['dependencies',undefined]]) {
  const start=performance.now(), pub=service.view(engine,view,focus), ms=performance.now()-start;
  if(!pub.layout) throw Error(`${project}/${view}: no validated baseline`);
  const layout=pub.layout, name=focus??view;
  const nodes=layout.nodes.map(n=>({...n,name:pub.nodes.find(p=>p.id===n.id)?.name??n.id}));
  record(project,name,'FEHM (projection + validated layout)',nodes,layout.edges,ms,layout.viewBox);
  const startElk=performance.now();
  const graph=await elk.layout({id:'root',layoutOptions:{'elk.algorithm':'layered','elk.direction':'DOWN','elk.edgeRouting':'ORTHOGONAL','elk.randomSeed':'1','elk.spacing.nodeNode':'40'},children:nodes.map(n=>({id:n.id,width:n.width,height:n.height})),edges:layout.edges.map(e=>({id:e.id,sources:[e.source],targets:[e.target]}))});
  record(project,name,'ELK 0.12.0 (flat layout only)',graph.children.map(n=>({...n,name:nodes.find(p=>p.id===n.id).name})),graph.edges.map(e=>({points:e.sections?.flatMap(s=>[s.startPoint,...s.bendPoints??[],s.endPoint])??[]})),performance.now()-startElk,graph);
  const startCy=performance.now();
  const cy=cytoscape({headless:true,styleEnabled:true,elements:[...nodes.map(n=>({data:{id:n.id,width:n.width,height:n.height}})),...layout.edges.map(e=>({data:{id:e.id,source:e.source,target:e.target}}))],style:[{selector:'node',style:{width:'data(width)',height:'data(height)'}}]});
  cy.layout({name:'breadthfirst',directed:true,spacingFactor:1.3,avoidOverlap:true,animate:false}).run();
  const positioned=nodes.map(n=>({...n,x:cy.getElementById(n.id).position('x')-n.width/2,y:cy.getElementById(n.id).position('y')-n.height/2}));
  const minX=Math.min(...positioned.map(n=>n.x))-30,minY=Math.min(...positioned.map(n=>n.y))-30;
  positioned.forEach(n=>{n.x-=minX;n.y-=minY;});
  const byId=new Map(positioned.map(n=>[n.id,n]));
  record(project,name,'Cytoscape 3.33.1 breadthfirst (flat)',positioned,layout.edges.map(e=>({points:[e.source,e.target].map(id=>{const n=byId.get(id);return {x:n.x+n.width/2,y:n.y+n.height/2};})})),performance.now()-startCy);
  cy.destroy();
 }
}
mkdirSync('docs/research',{recursive:true});
writeFileSync('docs/research/architecture-layout-results.json',JSON.stringify({date:'2026-10-26',node:process.version,notes:'Single-run exploratory timings, not a statistical performance benchmark. FEHM includes extraction/projection/validation; candidates layout only. Identical node dimensions and edge endpoints. Flat adapters omit boundary/edge-label constraints; preview uses neutral shapes and straight Cytoscape edges.',results},null,2)+'\n');
writeFileSync('docs/research/architecture-layout-comparison.html',`<!doctype html><meta charset="utf-8"><title>FEHM layout comparison</title><style>body{background:#080b10;color:#d9e0ed;font:14px system-ui;margin:24px}section{margin-bottom:32px}svg{border:1px solid #39445a;max-width:100%}</style><h1>Architecture layout comparison</h1><p>Same FEHM-derived nodes, dimensions and relationships. Flat adapters; not production semantic rendering. See JSON for limitations and measurements.</p>${panels.join('')}`);
console.table(results);
} finally {rmSync(scratch,{recursive:true,force:true});}
