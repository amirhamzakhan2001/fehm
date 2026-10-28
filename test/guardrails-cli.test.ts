import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { test } from 'node:test';
import { makeRepo, REPO_ROOT, writeFile } from './helpers.js';
test('CLI integration: start, approve, gate and invalidate a verification run', () => {
  const root = makeRepo({'test.mjs':"import {test} from 'node:test'; test('acceptance',()=>{});"});
  writeFile(root,'task.json',JSON.stringify({task:'CLI acceptance',requirements:[{id:'r',text:'Acceptance passes',origin:'user',confirmed:true,checks:['unit']}],policy:{checks:[{id:'unit',category:'unit',argv:[process.execPath,'--test','--test-reporter=tap','test.mjs'],cwd:'.',required:true}],requiredCategories:['unit'],tdd:false,security:false,maxAttempts:0,timeoutMs:3000,execution:'host-approved'}}));
  const prefix = ['--import','tsx',join(REPO_ROOT,'src/cli.ts'),'guardrails'];
  const args = (...rest:string[]) => [...prefix,...rest,'--root',root,'--json'];
  const call = (...rest:string[]) => JSON.parse(execFileSync(process.execPath,args(...rest),{cwd:REPO_ROOT,encoding:'utf8',timeout:20000}));
  const run = call('start','--file',join(root,'task.json')) as {id:string};
  assert.equal(call('run','--run-id',run.id,'--check-id','unit').readiness,'not_verified');
  assert.equal(call('run','--run-id',run.id,'--check-id','unit','--approve').readiness,'verified_required');
  assert.equal(call('report','--run-id',run.id,'--gate').readiness,'verified_required');
  writeFile(root,'source.js','export const modified = true;');
  const stale = spawnSync(process.execPath,args('report','--run-id',run.id,'--gate'),{cwd:REPO_ROOT,encoding:'utf8',timeout:20000});
  assert.equal(stale.status,1);
  assert.equal(JSON.parse(stale.stdout).checks[0].status,'stale');
});

test('change CLI analysis needs no task file and an unexecuted gate cannot pass', () => {
  const root = makeRepo({'source.js':'export const value = 1;'});
  const args = ['--import','tsx',join(REPO_ROOT,'src/cli.ts'),'guardrails','verify','--root',root,'--json','--gate'];
  const result = spawnSync(process.execPath,args,{cwd:REPO_ROOT,encoding:'utf8',timeout:20000});
  assert.equal(result.status,1);
  const value = JSON.parse(result.stdout);
  assert.equal(value.report,null); assert.equal(value.analysis.tdd,'unknown');
  assert.ok(value.analysis.unknowns.length);
});
