import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync,readFileSync,writeFileSync,unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';
import { makeRepo,tempDir,writeFile,REPO_ROOT } from './helpers.js';
import { ONTOLOGY_PATH,OntologyIndex,normalizeConceptTerm,validateOntology } from '../src/concepts/catalog.js';
import { analyzeConcepts,conceptAssessment,conceptExcerpt } from '../src/concepts/analysis.js';
import { conceptContext } from '../src/concepts/context.js';
import { FehmEngine } from '../src/engine.js';
import { ConceptService } from '../src/visualization/concepts/service.js';
import { startServer } from '../src/server.js';
const catalog=()=>JSON.parse(readFileSync(ONTOLOGY_PATH,'utf8'));

test('ontology preserves every canonical/alias lookup, intentional ambiguities, stable IDs and bounded typed expansion',()=>{
  const source=validateOntology(catalog()),index=OntologyIndex.open();
  try{
    assert.equal(index.summary().concepts,2627);assert.equal(index.summary().sections.length,74);
    for(const section of source.sections)for(const c of section.concepts){
      for(const term of [c.name,...c.aliases])assert.ok(index.lookup(term).candidates.some(r=>r.id===c.id),`${c.id}: ${term}`);
    }
    assert.equal(index.lookup('LSP').ambiguous,true);assert.equal(index.lookup('DFA').candidates.length,2);
    assert.equal(normalizeConceptTerm('C++'),'c++');assert.notEqual(normalizeConceptTerm('C#'),normalizeConceptTerm('C++'));
    assert.equal(normalizeConceptTerm('  Rate_Limiting '),'rate limiting');
    const n=index.neighborhood('s22.circuit-breaker',2,5);assert.ok(n.nodes.length<=5);assert.ok(n.edges.every(e=>n.nodes.some(n=>n.id===e.target)));
    assert.ok(index.guidance('s22.circuit-breaker').anti_signals!.some(x=>x.includes('Timeout')));
    assert.ok(index.guidance('s22.circuit-breaker').limit);
    assert.throws(()=>index.lookup('x',{limit:NaN}));
    assert.doesNotThrow(()=>index.lookup("'; DROP TABLE concepts;--"));
    assert.equal(index.summary().concepts,2627);
  }finally{index.close();}
});

test('catalog rejects duplicate identities, invalid profiles, dangling edges and parent cycles before activation',()=>{
  const mutate=(fn:(c:any)=>void)=>{const c=catalog();fn(c);assert.throws(()=>validateOntology(c),/Invalid ontology/);};
  mutate(c=>c.sections[0].concepts[1].id=c.sections[0].concepts[0].id);
  mutate(c=>c.sections[0].concepts[0].detection.profile='invented');
  mutate(c=>c.sections[0].concepts[0].related.push('missing'));
  mutate(c=>{const[a,b]=c.sections[0].concepts;a.parent=b.id;b.parent=a.id;});
  mutate(c=>c.sections[0].concepts[0].definition='');
  const state=tempDir(),path=join(tempDir(),'catalog.json');writeFileSync(path,JSON.stringify(catalog()));
  let index=OntologyIndex.open({stateDirectory:state,catalogPath:path});assert.equal(index.rebuilt,true);index.close();
  index=OntologyIndex.open({stateDirectory:state,catalogPath:path});assert.equal(index.rebuilt,false);index.close();
  const before=readFileSync(join(state,'ontology.sqlite'));
  writeFileSync(path,'{}');assert.throws(()=>OntologyIndex.open({stateDirectory:state,catalogPath:path}));assert.deepEqual(readFileSync(join(state,'ontology.sqlite')),before);
  const c=catalog();c.metadata.version='1.0.1';c.sections[0].concepts[0].name+=' Revised';writeFileSync(path,JSON.stringify(c));
  index=OntologyIndex.open({stateDirectory:state,catalogPath:path});assert.equal(index.version,'1.0.1');index.close();
  assert.deepEqual(readFileSync(join(state,'ontology.sqlite.previous')),before);
});

test('names, docs and unused dependencies do not become implementation or production guarantees',()=>{
  const root=makeRepo({'README.md':'# Architecture\nWe use Microservices and a Circuit Breaker.\n','app.ts':'export class CircuitBreaker {}\nexport function authentication() { return true; }\n','package.json':'{"devDependencies":{"opossum":"1.0.0"}}'});
  const engine=FehmEngine.open(root),index=OntologyIndex.open();
  try{
    const report=analyzeConcepts({engine,ontology:index});
    const breaker=report.findings.filter(f=>f.concept_id==='s22.circuit-breaker');assert.ok(breaker.length>=2);
    assert.ok(breaker.every(f=>f.scope!=='implementation'));
    assert.ok(breaker.some(f=>f.scope==='documented_claim'&&f.status==='explicitly_observed'));
    assert.ok(breaker.some(f=>f.status==='weakly_indicated'));
    assert.ok(report.findings.every(f=>!('confidence' in f)));
    const absence=conceptAssessment(report,index,'s48.retrieval-augmented-generation');assert.equal(absence.unverified.status,'not_verifiable');assert.match(absence.unverified.reason,/not proof of absence/);
    assert.throws(()=>conceptExcerpt(engine,'../secret',1));
  }finally{index.close();}
});

test('incremental local evidence invalidates by content/catalog/rules, removes deleted files and matches a clean rebuild',()=>{
  const root=makeRepo({'a.ts':'export async function fetchData(){ return await Promise.resolve(1); }\n','b.ts':'export function stable(){ return 1; }\n'}),index=OntologyIndex.open();
  try{
    let engine=FehmEngine.open(root),first=analyzeConcepts({engine,ontology:index});assert.equal(first.coverage.analyzed,2);
    const next=analyzeConcepts({engine,ontology:index});assert.equal(next.coverage.reused,2);assert.deepEqual(first.findings,next.findings);
    writeFile(root,'b.ts','export async function stable(){ return await Promise.resolve(2); }\n');engine=FehmEngine.open(root);
    const changed=analyzeConcepts({engine,ontology:index});assert.equal(changed.coverage.analyzed,1);assert.equal(changed.coverage.reused,1);
    const clean=analyzeConcepts({engine,ontology:index,options:{force:true,dryRun:true}});assert.deepEqual(changed.findings,clean.findings);
    unlinkSync(join(root,'a.ts'));engine=FehmEngine.open(root);const removed=analyzeConcepts({engine,ontology:index});assert.equal(removed.coverage.removed,1);assert.ok(removed.findings.every(f=>f.evidence.every(e=>e.path!=='a.ts')));
    const state=tempDir();analyzeConcepts({engine,ontology:index,options:{stateDirectory:state,dryRun:true}});assert.equal(existsSync(join(state,'concept-evidence.json')),false);
  }finally{index.close();}
});

test('syntax, retry/cache candidates and existing-feature adapters retain their scope and graph provenance',()=>{
  const root=makeRepo({'app.ts':`export async function load(key:string){const cache=new Map();if(cache.has(key))return cache.get(key);const value=await Promise.resolve(key);cache.set(key,value);return value;}
export function attempt(){for(let i=0;i<3;i++){try{return load('x')}catch{continue}}}
`, 'assistant.prompt.txt':'You are a helpful assistant. Return JSON only.\n'});
  const engine=FehmEngine.open(root),service=new ConceptService({dryRun:true});
  try{
    const r=service.report(engine);assert.ok(r.findings.some(f=>f.concept_id==='p-flow.asynchronous-execution'&&f.status==='explicitly_observed'));
    assert.ok(r.findings.some(f=>f.concept_id==='s28.caching'&&f.status==='contextually_inferred'));
    assert.ok(r.findings.some(f=>f.concept_id==='s27.retry-mechanism'&&f.status==='contextually_inferred'));
    assert.ok(r.findings.some(f=>f.evidence.some(e=>e.method==='prompt-adapter')));
    const overlay=service.graph(engine,'p-flow.asynchronous-execution');assert.ok(overlay.edges.some(e=>e.kind==='implemented_by'));assert.ok(overlay.highlightIds.every(id=>engine.graph.node(id)));
    const weak=service.graph(engine,'s27.retry-mechanism');assert.ok(weak.edges.every(e=>e.kind!=='implemented_by'));
  }finally{service.close();}
});

test('context is a bounded projection with explicit tokenizer availability and ambiguity',()=>{
  const engine=FehmEngine.open(makeRepo({'readme.md':'# LSP\nLSP is mentioned here.\n'})),index=OntologyIndex.open();
  try{
    const r=analyzeConcepts({engine,ontology:index,options:{dryRun:true}}),p=conceptContext(r,index,'LSP',{maxBytes:600});
    assert.equal(p.payload.ambiguous,true);assert.ok(p.bytes<=600);assert.equal(p.tokens,null);assert.equal(p.catalogIncluded,false);
    assert.throws(()=>conceptContext(r,index,'LSP',{maxTokens:500}),/tokenizer/);
    const measured=conceptContext(r,index,'LSP',{maxBytes:5000,maxTokens:1000,tokenizer:s=>[...s].length});
    assert.ok(measured.tokens!<=1000);assert.equal(measured.tokens,[...measured.serialized].length);
  }finally{index.close();}
});

test('packaged assets and attribution no longer depend on removable input folders',()=>{
  const pkg=JSON.parse(readFileSync(join(REPO_ROOT,'package.json'),'utf8'));
  assert.ok(pkg.files.includes('assets/ontology'));assert.ok(pkg.files.includes('THIRD_PARTY_NOTICES.md'));assert.ok(!pkg.files.includes('third_party'));
  assert.equal(createHash('sha256').update(readFileSync(ONTOLOGY_PATH)).digest('hex'),'c845161771f6656ec99b1faf5bbe3a96f4da4c8e057e4becb343dcaa9211de71');
  const result=JSON.parse(execFileSync(process.execPath,['--import','tsx','src/cli.ts','ontology','LSP','--dry-run','--json'],{cwd:REPO_ROOT,encoding:'utf8'}));assert.equal(result.ambiguous,true);
});

test('concept and ontology pages, API filters, source guards, refresh protection and graph highlights',async()=>{
  const root=makeRepo({'a.ts':'export async function fetchData(){ return await Promise.resolve(1); }\n'});
  const server=await startServer(root,0,{stateDirectory:tempDir()}),port=(server.address() as AddressInfo).port;
  const request=(path:string,method='GET',headers={})=>new Promise<{status:number;body:string}>((resolve,reject)=>{const req=http.request({host:'127.0.0.1',port,path,method,headers},res=>{let body='';res.on('data',c=>body+=c);res.on('end',()=>resolve({status:res.statusCode!,body}));});req.on('error',reject);req.end();});
  try{
    for(const path of ['/concepts','/ontology','/concepts/assets/concepts/ui/main.js'])assert.equal((await request(path)).status,200);
    const inventory=JSON.parse((await request('/api/concepts/inventory')).body);
    assert.equal(inventory.concepts.length,catalog().metadata.total_concepts);
    assert.equal((await request('/concepts')).body,(await request('/ontology')).body);
    assert.equal((await request('/concepts/assets/concepts/service.js')).status,404);
    assert.equal(JSON.parse((await request('/api/concepts/lookup?q=DFA')).body).ambiguous,true);
    assert.equal((await request('/api/concepts/refresh')).status,405);assert.equal((await request('/api/concepts/refresh','POST')).status,403);
    assert.equal((await request('/api/concepts/refresh','POST',{'x-fehm':'1'})).status,200);
    assert.equal((await request('/api/concepts/source?path=../etc/passwd&line=1')).status,400);
    const graph=JSON.parse((await request('/api/concepts/graph?id=p-flow.asynchronous-execution')).body);assert.ok(graph.highlightIds.length);
    const report=JSON.parse((await request('/api/concepts?scope=documented_claim')).body);assert.equal(report.findings.length,0);
  }finally{await new Promise<void>(r=>server.close(()=>r()));}
});
