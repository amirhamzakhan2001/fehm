import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync, spawnSync } from 'node:child_process';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { FehmEngine } from '../src/engine.js';
import { Guardrails } from '../src/guardrails/workflow.js';
import { investigate } from '../src/debugging/investigate.js';
import { InvestigationStore } from '../src/debugging/store.js';
import { startServer } from '../src/server.js';
import { makeRepo, writeFile, REPO_ROOT } from './helpers.js';

test('real failure, saved investigation, authorized rerun and original test result',async()=>{
  const root=makeRepo({'source.mjs':'export const value = 1;','test/behavior.test.mjs':"import {test} from 'node:test'; import assert from 'node:assert/strict'; import {value} from '../source.mjs'; test('expected value',()=>assert.equal(value,2));"});
  const guard=new Guardrails(root), run=guard.start('Behavior',[],{checks:[{id:'unit',category:'unit',argv:[process.execPath,'--test','--test-reporter=tap','test/behavior.test.mjs'],cwd:'.',required:true}],requiredCategories:[],tdd:false,security:false,maxAttempts:0,timeoutMs:5000,execution:'host-approved'});
  const failed=(await guard.execute(run.id,'unit','green',true)).evidence.at(-1)!;
  assert.equal(failed.status,'failed');assert.equal(failed.testOutcomes?.complete,true);
  const r=investigate(FehmEngine.open(root,{dryRun:true}),{runId:run.id,evidenceId:failed.id});
  assert.equal(r.reproduction.status,'reproduced');assert.equal(r.actions[0]?.kind,'run-check');
  const store=new InvestigationStore(root);store.save(r);
  await assert.rejects(store.run(r.id,r.actions[0]!.id,false),/approval/);
  writeFile(root,'source.mjs','export const value = 2;');
  const after=await store.run(r.id,r.actions[0]!.id,true);
  assert.equal(after.reproduction.status,'original test passed');
  assert.equal(after.hypotheses.every(h=>h.status === 'proposed'),true);
  assert.equal(guard.load(run.id).evidence.length,2);
  const command=['--import','tsx',join(REPO_ROOT,'src/cli.ts'),'debug','report','--id',r.id,'--root',root,'--json'];
  const current=JSON.parse(execFileSync(process.execPath,command,{cwd:REPO_ROOT,encoding:'utf8'}));
  assert.equal(current.stale,true);assert.equal(current.reproduction.status,'original test passed');
});
test('CLI supports ephemeral analysis, bounded export and immutable saved reports',()=>{
  const root=makeRepo({'src/a.ts':'export const x = 1;','failure.txt':'TypeError\n at a (src/a.ts:1:2)'});
  const call=(...args:string[])=>execFileSync(process.execPath,['--import','tsx',join(REPO_ROOT,'src/cli.ts'),'debug',...args,'--root',root,'--json'],{cwd:REPO_ROOT,encoding:'utf8'});
  const report=JSON.parse(call('--input',join(root,'failure.txt')));
  assert.equal(report.frames[0].status,'resolved');assert.equal(existsSync(join(root,'.fehm','debugging')),false);
  const saved=JSON.parse(call('--input',join(root,'failure.txt'),'--save'));
  const context=JSON.parse(call('context','--id',saved.id,'--tokens','256'));assert.ok(context.estimatedTokens<=256);
  const invalid=spawnSync(process.execPath,['--import','tsx',join(REPO_ROOT,'src/cli.ts'),'debug','--location','src/a.ts','--line','0','--root',root],{cwd:REPO_ROOT,encoding:'utf8'});assert.notEqual(invalid.status,0);
  assert.equal(JSON.parse(call('delete','--id',saved.id)).deleted,true);
});
test('HTTP analysis is same-origin, bounded, non-executing, and only saves server-generated reports',async()=>{
  const root=makeRepo({'src/a.ts':'export const value = process.env.VALUE;'});
  const server=await startServer(root,0,{dryRun:true});const base=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    assert.match(await fetch(`${base}/debug`).then(r=>r.text()),/Failure investigation/);
    const asset=await fetch(`${base}/debug/assets/debugging/ui/main.js`);assert.equal(asset.status,200);assert.doesNotMatch(await asset.text(),/from ['"]node:/);
    assert.equal((await fetch(`${base}/debug/assets/debugging/routes.js`)).status,404);
    const {nonce}=await fetch(`${base}/api/debug/session`).then(r=>r.json()) as {nonce:string};
    const send=(path:string,value:unknown,headers:Record<string,string>={})=>fetch(`${base}/api/debug/${path}`,{method:'POST',headers:{'content-type':'application/json','x-fehm-debug':nonce,...headers},body:JSON.stringify(value)});
    assert.equal((await send('investigate',{text:'failure'},{origin:'https://evil.example'})).status,403);
    assert.equal((await send('investigate',{text:'failure'},{'x-fehm-debug':'wrong'})).status,403);
    assert.equal((await send('investigate',{text:'x'.repeat(140000)})).status,413);
    const response=await send('investigate',{text:'Missing configuration\n at a (src/a.ts:1:2)'});assert.equal(response.status,200);
    const report=await response.json() as {id:string;hypotheses:unknown[]};assert.equal(report.hypotheses.length,1);
    assert.equal(existsSync(join(root,'.fehm','debugging')),false);
    assert.equal((await send('save',{id:'untrusted',report})).status,400);
    assert.equal((await send('save',{id:report.id})).status,200);
    assert.equal((await fetch(`${base}/api/debug/report?id=${report.id}`)).status,200);
    assert.equal((await send('run',{id:report.id})).status,404);
    assert.equal((await send('delete',{id:report.id})).status,200);
    assert.equal((await fetch(`${base}/api/debug/report?id=${report.id}`)).status,404);
  } finally {await new Promise<void>((resolve,reject)=>server.close(err=>err ? reject(err):resolve()));}
});
