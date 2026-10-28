import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { test } from 'node:test';
import { makeRepo, writeFile } from './helpers.js';
import { analyzeChange } from '../src/guardrails/change.js';
import { Guardrails } from '../src/guardrails/workflow.js';
function fixture() {
  const root = makeRepo({'package.json': JSON.stringify({scripts:{test:'node --test --test-reporter=tap test.mjs'}}), 'test.mjs': "import {test} from 'node:test'; import assert from 'node:assert/strict'; test('behavior',()=>assert.equal(1,1));",'source.js':'export const value = 1;'});
  const git = (...args:string[]) => execFileSync('git',args,{cwd:root,stdio:'pipe'});
  git('init'); git('add','.'); git('-c','user.name=Test','-c','user.email=test@example.com','commit','-m','baseline');
  return root;
}
test('detect existing, added and deleted working-tree files and skip documentation checks', () => {
  const root = fixture(); writeFile(root,'notes.md','documentation');
  const analysis = analyzeChange(root);
  assert.deepEqual(analysis.files.map(f=>f.path),['notes.md']);
  assert.ok(analysis.checks.every(c=>c.status === 'skipped')); assert.equal(analysis.policy.tdd,false);
  execFileSync('git',['rm','source.js'],{cwd:root});
  assert.ok(analyzeChange(root).files.some(f=>f.path === 'source.js' && f.status.includes('D')));
});
test('batch execution records real evidence, reuses passes and invalidates subsequent edits', async () => {
  const root = fixture(); writeFile(root,'source.js','export const value = 2;');
  const guard = new Guardrails(root);
  assert.equal((await guard.verifyChange()).report,null); assert.equal(guard.history().length,0);
  const result = await guard.verifyChange(true); assert.ok(result.report);
  assert.equal(result.report.checks[0]?.status,'passed');
  assert.ok(result.report.changedFiles.includes('source.js'));
  const again = await guard.verifyChange(true); assert.equal(again.report?.run.id,result.report.run.id);
  assert.equal(again.report?.run.evidence.length,1);
  writeFile(root,'source.js','export const value = 3;');
  assert.equal(guard.report(result.report.run.id).checks[0]?.status,'stale');
});
test('missing Git/test infrastructure remains unknown and failures are not passes', async () => {
  const root = makeRepo({'source.js':'export const x=1;'});
  assert.ok(analyzeChange(root).unknowns.some(s=>s.includes('Git')));
  assert.ok(analyzeChange(root).unknowns.some(s=>s.includes('No executable test')));
  const tracked = fixture(); writeFile(tracked,'test.mjs',"import {test} from 'node:test'; import assert from 'node:assert/strict'; test('behavior',()=>assert.equal(1,2));");
  const result = await new Guardrails(tracked).verifyChange(true);
  assert.equal(result.report?.checks[0]?.status,'failed'); assert.equal(result.report?.readiness,'failed');
});
