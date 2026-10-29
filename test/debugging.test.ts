import assert from 'node:assert/strict';
import { test } from 'node:test';
import { symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { FehmEngine } from '../src/engine.js';
import { investigate } from '../src/debugging/investigate.js';
import { parseFrames, resolveFrames, validateInput } from '../src/debugging/input.js';
import { InvestigationStore } from '../src/debugging/store.js';
import { investigationContext } from '../src/debugging/context.js';
import { parseTestOutcomes } from '../src/guardrails/test-outcomes.js';
import { compareReproduction } from '../src/debugging/verification.js';
import type { CheckEvidence } from '../src/guardrails/types.js';
import { makeRepo, writeFile } from './helpers.js';

const fixture=()=>makeRepo({'src/service.ts':'export function read(value: any) {\n  return value.name;\n}\n','src/main.ts':"import {read} from './service.js';\nexport const main = () => read(null);",'test/service.test.ts':"import {read} from '../src/service.js';\nexport const check = () => read({name:'ok'});"});
const engine=(root:string)=>FehmEngine.open(root,{dryRun:true});
for (const [label,text,path,line] of [
  ['Node','TypeError: missing\n    at read (src/service.ts:2:10)','src/service.ts',2],
  ['Node absolute','    at read (/app/src/service.ts:2:10)','/app/src/service.ts',2],
  ['Python','  File "src/service.ts", line 2, in read','src/service.ts',2],
  ['spaces','    at read (/app/my project/src/service.ts:2:10)','/app/my project/src/service.ts',2],
  ['Windows','    at read (C:\\project\\src\\service.ts:2:10)','C:\\project\\src\\service.ts',2],
] as const) test(`trace parser preserves ${label} locations`,()=>{
  const frames=parseFrames({text});assert.equal(frames[0]?.path,path);assert.equal(frames[0]?.line,line);
  assert.equal(resolveFrames(engine(fixture()),frames)[0]?.resolvedPath,'src/service.ts');
});
test('invalid, external and ambiguous paths do not resolve by guess',()=>{
  const root=makeRepo({'a/common.ts':'export const x=1;','b/common.ts':'export const y=2;'}), e=engine(root);
  for (const path of ['../../etc/passwd','https://evil.test/a/common.ts']) assert.equal(resolveFrames(e,parseFrames({location:{path,line:1}}))[0]?.status,'invalid');
  assert.equal(resolveFrames(e,parseFrames({location:{path:'common.ts',line:1}}))[0]?.status,'ambiguous');
  assert.equal(resolveFrames(e,parseFrames({location:{path:'a/common.ts',line:999}}))[0]?.status,'invalid');
});
test('investigation cites actual edges and lines, remains tentative, and uses no execution claims',()=>{
  const r=investigate(engine(fixture()),{text:'TypeError: Cannot read properties of null\n at read (src/service.ts:2:10)'});
  assert.equal(r.frames[0]?.status,'resolved');assert.equal(r.hypotheses.length,1);assert.equal(r.hypotheses[0]?.status,'proposed');
  assert.equal(r.reproduction.status,'not attempted');
  assert.ok(r.evidence.some(e=>e.kind === 'source' && e.text.includes('2:   return value.name;')));
  assert.ok(r.evidence.some(e=>e.edgeId));
  for (const h of r.hypotheses) for (const id of h.evidenceIds) assert.ok(r.evidence.some(e=>e.id === id));
  assert.ok(r.bounds.files<=12 && r.bounds.nodes<=60 && r.bounds.evidence<=80);
});
test('unknown behavior and mismatched revisions abstain',()=>{
  for (const input of [{text:'It sometimes fails in production'},{text:'TypeError\n at read (src/service.ts:2:10)',failureRevision:'abcdef12345'}]) {
    const r=investigate(engine(fixture()),input);assert.equal(r.hypotheses.length,0);assert.match(r.summary,/not established/);
  }
});
test('configuration lead requires a matching source read and never reads environment values',()=>{
  const root=makeRepo({'src/config.ts':'export const url = process.env.DATABASE_URL;'});
  const r=investigate(engine(root),{text:'Error: missing DATABASE_URL\n at config (src/config.ts:1:10)'});
  assert.match(r.hypotheses[0]?.cause ?? '',/configuration/);assert.match(r.hypotheses[0]?.missing ?? '',/failing process/);
});
test('stale engine invalidates conclusions and saved investigations detect later edits',()=>{
  const root=fixture(),e=engine(root), input={text:'TypeError\n at read (src/service.ts:2:10)'};
  const report=investigate(e,input), store=new InvestigationStore(root);store.save(report);
  assert.throws(()=>store.save(report),/immutable/);
  writeFile(root,'src/service.ts','export function read(value:any) { return value; }');
  assert.equal(investigate(e,input).stale,true);assert.equal(store.current(report.id,engine(root)).stale,true);
  store.remove(report.id);assert.throws(()=>store.load(report.id));
});
test('oversized inputs, unsafe IDs and storage symlinks fail closed',()=>{
  assert.throws(()=>validateInput({text:'x'.repeat(140000)}),/128 KiB/);
  assert.throws(()=>validateInput({runId:'bad',evidenceId:'bad'}),/valid run ID/);
  const root=fixture(),store=new InvestigationStore(root),r=investigate(engine(root),{text:'unknown failure'});
  assert.throws(()=>store.load('../../etc/passwd'),/Invalid/);
  symlinkSync(makeRepo({}),join(root,'.fehm'));
  assert.throws(()=>store.save(r),/symlinks/);
});
test('export enforces complete packet budget and redacts common secrets',()=>{
  const r=investigate(engine(fixture()),{text:'password=hunter2\nTypeError\n at read (src/service.ts:2:10)'});
  assert.doesNotMatch(JSON.stringify(r),/hunter2/);
  const packet=investigationContext(r,256);assert.ok(packet.estimatedTokens<=256);assert.equal(packet.truncated,true);
});
const tap=(status='ok',name='behavior',directive='')=>`TAP version 13\n${status} 1 - ${name}${directive}\n1..1\n# tests 1\n# pass ${status === 'ok' ? 1:0}\n# fail ${status === 'ok' ? 0:1}\n# cancelled 0\n`;
const evidence=(output:string,status:CheckEvidence['status'],id='a'):CheckEvidence=>({id,checkId:'unit',phase:'green',status,fingerprint:'current',started:'2026-01-01',durationMs:1,exitCode:status === 'passed' ? 0:1,output,approved:true,argv:['node','--test'],cwd:'.',policyHash:'policy',testFingerprint:'tests',testOutcomes:parseTestOutcomes(output)});
test('same original named test can pass later without confirming cause',()=>{
  const r=compareReproduction(evidence(tap('not ok'),'failed'),evidence(tap(),'passed','b'),'current');
  assert.equal(r.status,'original test passed');assert.match(r.explanation,/not proof/);
});
for (const [label,output] of [['renamed',tap('ok','different')],['skipped',tap('ok','behavior',' # SKIP')],['truncated','TAP version 13\nok 1 - behavior'],['nested','TAP version 13\n    ok 1 - child\nok 1 - suite\n1..1\n# tests 2'],['duplicate','TAP version 13\nok 1 - behavior\nok 2 - behavior\n1..2\n# tests 2']] as const) test(`${label} test output cannot establish a fix`,()=>{
  assert.equal(compareReproduction(evidence(tap('not ok'),'failed'),evidence(output,'passed','b'),'current').status,'inconclusive');
});
test('changed tests, stale outcomes and blocked execution cannot establish a fix',()=>{
  const before=evidence(tap('not ok'),'failed'),after=evidence(tap(),'passed','b');
  assert.equal(compareReproduction(before,{...after,testFingerprint:'changed'},'current').status,'inconclusive');
  assert.equal(compareReproduction(before,after,'new revision').status,'stale');
  assert.equal(compareReproduction(before,{...after,status:'blocked'},'current').status,'blocked');
});

test('file URL paths are decoded without reading external URLs or secret env files',()=>{
  const root=fixture();writeFile(root,'.env','PASSWORD=do-not-read');
  const e=engine(root);
  assert.equal(resolveFrames(e,parseFrames({text:` at read (file://${root}/src/service.ts:2:10)`}))[0]?.status,'resolved');
  assert.notEqual(resolveFrames(e,parseFrames({location:{path:'.env',line:1}}))[0]?.status,'resolved');
});
test('TAP inconsistent counts and cancelled streams are incomplete',()=>{
  assert.equal(parseTestOutcomes(tap('not ok').replace('# fail 1','# fail 0')).complete,false);
  assert.equal(parseTestOutcomes(tap().replace('# cancelled 0','# cancelled 1')).complete,false);
  assert.equal(parseTestOutcomes(tap(),true).complete,false);
});
test('a repository-internal alternate state directory is rejected unless excluded under .fehm',()=>{
  const root=fixture();assert.throws(()=>new InvestigationStore(root,join(root,'data')),/under .fehm/);
});
test('collection bounds hold for many reported frames and very long source lines',()=>{
  const root=makeRepo(Object.fromEntries(Array.from({length:20},(_,i)=>[`src/f${i}.ts`,`export const v${i} = "${'a'.repeat(1000)}";`])));
  const r=investigate(engine(root),{text:'TypeError\n'+Array.from({length:120},(_,i)=>` at f (src/f${i%20}.ts:1:5)`).join('\n')});
  assert.equal(r.frames.length,100);assert.ok(r.bounds.files<=12);assert.equal(r.bounds.truncated,true);
  for (const e of r.evidence) assert.ok(e.text.length<=6000);
});

test('Git regression investigation includes bounded historical hunks without attributing cause to recency',async()=>{
  const {execFileSync}=await import('node:child_process');
  const root=fixture(),git=(...args:string[])=>execFileSync('git',args,{cwd:root,stdio:'pipe'});
  git('init');git('add','.');git('-c','user.name=Test','-c','user.email=test@example.com','commit','-m','baseline');
  writeFile(root,'src/service.ts','export function read(value: any) {\n  return value.other;\n}\n');
  git('add','.');git('-c','user.name=Test','-c','user.email=test@example.com','commit','-m','change access');
  const r=investigate(engine(root),{text:'Wrong response after recent change\n at read (src/service.ts:2:10)'});
  assert.ok(r.evidence.some(e=>e.kind === 'change' && e.text.includes('+  return value.other;')));
  assert.equal(r.hypotheses.length,0);assert.equal(r.actions[0]?.kind,'compare-change');
});
