/** Small labelled rule benchmark, not a production accuracy claim. */
import { mkdtempSync,mkdirSync,writeFileSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname,join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { FehmEngine } from '../src/engine.js';
import { OntologyIndex } from '../src/concepts/catalog.js';
import { analyzeConcepts } from '../src/concepts/analysis.js';
import { conceptContext } from '../src/concepts/context.js';
const fixtures=[
  {name:'typescript-await',files:{'app.ts':'export async function fetchData(){return await Promise.resolve(1)}'},concept:'p-flow.asynchronous-execution',status:'explicitly_observed',scope:'implementation',expected:true},
  {name:'javascript-await',files:{'app.js':'export async function fetchData(){return await Promise.resolve(1)}'},concept:'p-flow.asynchronous-execution',status:'explicitly_observed',scope:'implementation',expected:true},
  {name:'unused-dependency',files:{'package.json':'{"devDependencies":{"opossum":"1"}}'},concept:'s22.circuit-breaker',status:'structurally_supported',scope:'implementation',expected:false},
  {name:'misleading-class',files:{'app.ts':'export class CircuitBreaker {}'},concept:'s22.circuit-breaker',status:'structurally_supported',scope:'implementation',expected:false},
  {name:'documented-architecture',files:{'README.md':'# Architecture\nWe use microservices.'},concept:'s24.microservices',status:'explicitly_observed',scope:'documented_claim',expected:true},
  {name:'docs-not-production',files:{'README.md':'# Architecture\nWe use microservices.'},concept:'s24.microservices',status:'structurally_supported',scope:'implementation',expected:false},
  {name:'retry-candidate',files:{'a.ts':'function run(){for(let i=0;i<3;i++){try{return operation()}catch{continue}}}'},concept:'s27.retry-mechanism',status:'contextually_inferred',scope:'implementation',expected:true},
  {name:'loop-not-retry',files:{'a.ts':'function run(){for(let i=0;i<3;i++){console.log(i)}}'},concept:'s27.retry-mechanism',status:'contextually_inferred',scope:'implementation',expected:false},
  {name:'python-name-only',files:{'a.py':'class CircuitBreaker:\n    pass\n'},concept:'s22.circuit-breaker',status:'structurally_supported',scope:'implementation',expected:false},
  {name:'go-name-only',files:{'a.go':'package main\nfunc Authentication() bool { return true }\n'},concept:'s39.authentication',status:'structurally_supported',scope:'implementation',expected:false},
  {name:'dynamic-dispatch-unknown',files:{'a.ts':'export function dispatch(o:any,name:string){return o[name]();}'},concept:'s39.authorization',status:'structurally_supported',scope:'implementation',expected:false},
  {name:'unreachable-syntax-not-runtime',files:{'a.ts':'async function neverCalled(){await Promise.resolve(1)}'},concept:'p-flow.asynchronous-execution',status:'structurally_supported',scope:'operation',expected:false},
];
const root=mkdtempSync(join(tmpdir(),'fehm-concept-bench-')),ontology=OntologyIndex.open(),rows=[];
try{
 for(const [i,f] of fixtures.entries()){
  const folder=join(root,String(i));mkdirSync(folder,{recursive:true});
  for(const [path,text] of Object.entries(f.files)){if(text===undefined)continue;mkdirSync(dirname(join(folder,path)),{recursive:true});writeFileSync(join(folder,path),text);}
  const start=performance.now(),engine=FehmEngine.open(folder),report=analyzeConcepts({engine,ontology}),coldMs=performance.now()-start;
  const t=performance.now(),warm=analyzeConcepts({engine,ontology}),warmMs=performance.now()-t;
  const actual=report.findings.some(r=>r.concept_id===f.concept&&r.status===f.status&&r.scope===f.scope);
  const context=conceptContext(report,ontology,ontology.get(f.concept)!.name);
  rows.push({name:f.name,label:{concept:f.concept,status:f.status,scope:f.scope},expected:f.expected,actual,pass:actual===f.expected,coldMs:Math.round(coldMs*100)/100,warmMs:Math.round(warmMs*100)/100,reusedFiles:warm.coverage.reused,contextBytes:context.bytes,modelTokens:context.tokens});
 }
 const tp=rows.filter(r=>r.expected&&r.actual).length,fp=rows.filter(r=>!r.expected&&r.actual).length,fn=rows.filter(r=>r.expected&&!r.actual).length;
 const output={scope:'Twelve small labelled rule fixtures; not representative production detection accuracy. Negative labels test conservative abstention, including languages without executable concept rules.',ontologyHash:ontology.hash,fixtures:rows.length,passed:rows.filter(r=>r.pass).length,precision:tp+fp?tp/(tp+fp):null,recall:tp+fn?tp/(tp+fn):null,falsePositiveRate:rows.filter(r=>!r.expected).length?fp/rows.filter(r=>!r.expected).length:null,modelTokenMeasurement:'Unavailable: no target-model tokenizer configured. Context bytes are measured; no token-saving percentage is claimed.',rows};
 writeFileSync('eval/concepts-benchmark.json',JSON.stringify(output,null,2)+'\n');console.log(JSON.stringify(output,null,2));if(rows.some(r=>!r.pass))process.exitCode=1;
}finally{ontology.close();rmSync(root,{recursive:true,force:true});}
