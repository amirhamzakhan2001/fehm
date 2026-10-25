import assert from 'node:assert/strict';
import { test } from 'node:test';
import { classify } from '../src/guardrails/workflow.js';
test('guardrails requires actual tests and distinguishes setup failures', () => {
  assert.equal(classify(0, '', true), 'inconclusive');
  assert.equal(classify(0, '# tests 1\n# pass 1\n# fail 0\n', true), 'passed');
  assert.equal(classify(1, 'Cannot find module x', true), 'blocked');
  assert.equal(classify(1, 'ERR_ASSERTION', true), 'failed');
  assert.equal(classify(0, '# tests 1\n# skipped 1', true), 'inconclusive');
});

import { Guardrails, snapshot, validatePolicy, type GuardPolicy } from '../src/guardrails/workflow.js';
import { makeRepo, writeFile } from './helpers.js';
const policy = (overrides: Partial<GuardPolicy> = {}): GuardPolicy => ({checks:[{id:'unit',category:'unit',argv:[process.execPath,'--test','--test-reporter=tap','test.mjs'],cwd:'.',required:true}],requiredCategories:['unit'],tdd:false,security:false,maxAttempts:1,timeoutMs:3000,execution:'host-approved',...overrides});
const passing = "import { test } from 'node:test'; import assert from 'node:assert/strict'; test('acceptance', () => assert.equal(1,1));\n";
const failing = passing.replace('equal(1,1)','equal(1,2)');
function fixture(p = policy()) {
  const root = makeRepo({'test.mjs':passing,'implementation.js':'export const answer = 1;\n'}), service = new Guardrails(root);
  const run = service.start('Implement acceptance',[{id:'acceptance',text:'Returns expected value',origin:'user',confirmed:true,checks:['unit']}],p);
  return {root,service,run};
}
test('approval required, exact approved execution passes, subsequent edits invalidate evidence', async () => {
  const {root,service,run} = fixture();
  assert.equal((await service.execute(run.id,'unit','green')).evidence.at(-1)?.status,'blocked');
  assert.equal(service.report(run.id).readiness,'not_verified');
  assert.equal((await service.execute(run.id,'unit','green',true)).evidence.at(-1)?.status,'passed');
  assert.equal(service.report(run.id).readiness,'verified_required');
  writeFile(root,'new.unknown','unindexed source');
  assert.equal(service.report(run.id).checks[0]?.status,'stale');
});
test('red-to-green requires changed tests before implementation and unchanged tests at green', async () => {
  const root = makeRepo({'implementation.mjs':'export const answer = 1;\n'}), service = new Guardrails(root);
  const run = service.start('answer becomes two',[{id:'answer',text:'returns two',origin:'user',confirmed:true,checks:['unit']}],policy({tdd:true}));
  writeFile(root,'test.mjs',"import {test} from 'node:test'; import assert from 'node:assert/strict'; import {answer} from './implementation.mjs'; test('acceptance',()=>assert.equal(answer,2));\n");
  assert.equal((await service.execute(run.id,'unit','red',true,'acceptance')).evidence.at(-1)?.validRed,true);
  writeFile(root,'implementation.mjs','export const answer = 2;\n');
  await service.execute(run.id,'unit','green',true);
  assert.equal(service.report(run.id).readiness,'verified_required');
});
test('setup failure cannot count as red, and unavailable isolation blocks execution', async () => {
  const {root,service,run} = fixture(policy({tdd:true}));
  writeFile(root,'test.mjs',"import 'missing-package';");
  const evidence = (await service.execute(run.id,'unit','red',true,'acceptance')).evidence.at(-1)!;
  assert.equal(evidence.status,'blocked'); assert.equal(evidence.validRed,false);
  const isolated = fixture(policy({execution:'isolated'}));
  assert.equal((await isolated.service.execute(isolated.run.id,'unit','green',true)).evidence.at(-1)?.status,'blocked');
});
test('pre-existing failures remain visible, exception and test review are explicit', async () => {
  const {root,service,run} = fixture(policy({tdd:true}));
  writeFile(root,'test.mjs',failing);
  const baseline = service.start('fix old failure',run.requirements,run.policy);
  await service.execute(baseline.id,'unit','baseline',true);
  const failed = await service.execute(baseline.id,'unit','green',true);
  assert.equal(failed.evidence.at(-1)?.baselineFailure,true);
  assert.equal(service.report(baseline.id).readiness,'failed');
  writeFile(root,'test.mjs',passing);
  await service.execute(baseline.id,'unit','green',true);
  assert.equal(service.report(baseline.id).readiness,'requires_human_review');
  service.exception(baseline.id,'Repairing an existing test fixture; strict TDD exception reviewed');
  service.review(baseline.id,'Compared expected behavior against requirement; accepted fixture correction');
  assert.equal(service.report(baseline.id).readiness,'verified_warnings');
});
test('remediation is bounded, reruns checks, and test modification stops the loop', async () => {
  const {root,service,run} = fixture();
  const result = await service.remediate(run.id,'correct implementation',true,async () => writeFile(root,'implementation.js','export const answer=2;'));
  assert.equal(result.readiness,'verified_required');
  await assert.rejects(service.remediate(run.id,'again',true,async () => {}),/limit/);
  const other = fixture();
  const weakened = await other.service.remediate(other.run.id,'test change',true,async () => writeFile(other.root,'test.mjs',passing.replace('test(', 'test.skip(')));
  assert.equal(weakened.readiness,'requires_human_review');
  assert.equal(weakened.run.evidence.length,0);
});
test('policy rejects traversal and duplicates; test runner timeout and environment restrictions', async () => {
  const p = policy(); p.checks[0]!.cwd = '../outside'; assert.throws(() => validatePolicy(p));
  const duplicate = policy(); duplicate.checks.push(duplicate.checks[0]!); assert.throws(() => validatePolicy(duplicate));
  const {root,service,run} = fixture(policy({timeoutMs:100}));
  writeFile(root,'test.mjs','setInterval(()=>{},1000);');
  assert.equal((await service.execute(run.id,'unit','green',true)).evidence.at(-1)?.status,'blocked');
  process.env.FEHM_GUARDRAIL_SECRET = 'must-not-reach-child';
  const clean = fixture();
  writeFile(clean.root,'test.mjs',"import {test} from 'node:test'; import assert from 'node:assert/strict'; test('environment',()=>assert.equal(process.env.FEHM_GUARDRAIL_SECRET,undefined));");
  assert.equal((await clean.service.execute(clean.run.id,'unit','green',true)).evidence.at(-1)?.status,'passed');
  delete process.env.FEHM_GUARDRAIL_SECRET;
});
test('security evidence is revision-specific and history survives reopening', () => {
  const {root,service,run} = fixture(policy({security:true}));
  service.assessSecurity(run.id);
  assert.equal(service.report(run.id).securityCurrent,true);
  writeFile(root,'implementation.js','export const answer=3;');
  assert.equal(service.report(run.id).securityCurrent,false);
  assert.equal(new Guardrails(root).history()[0]?.id,run.id);
  assert.equal(snapshot(root).fingerprint,snapshot(root).fingerprint);
});

test('red checkpoint rejects failure in a different test; inferred requirements need confirmation', async () => {
  const {root,service,run} = fixture(policy({tdd:true}));
  writeFile(root,'test.mjs',passing + "test('other',()=>assert.equal(1,2));\n");
  const evidence = (await service.execute(run.id,'unit','red',true,'acceptance')).evidence.at(-1)!;
  assert.equal(evidence.validRed,false);
  const inferred = service.start('inferred',[{id:'r',text:'inferred behavior',origin:'inferred',confirmed:false,checks:['unit']}],policy());
  writeFile(root,'test.mjs',passing);
  await service.execute(inferred.id,'unit','green',true); service.review(inferred.id,'Restored fixture');
  assert.ok(service.report(inferred.id).reasons.includes('Requirement r unverified'));
});
test('snapshot includes security policy and excludes only runtime state', () => {
  const {root} = fixture(); const before = snapshot(root).fingerprint;
  writeFile(root,'.fehm/health.json','{"ignore":[]}');
  assert.notEqual(snapshot(root).fingerprint,before);
  const policyFingerprint = snapshot(root).fingerprint;
  writeFile(root,'.fehm/graph.json','{}');
  assert.equal(snapshot(root).fingerprint,policyFingerprint);
});
test('unit, integration and regression categories all need current real execution', async () => {
  const p = policy();
  p.checks = ['unit','integration','regression'].map(category => ({...p.checks[0]!,id:category,category:category as 'unit'|'integration'|'regression'}));
  p.requiredCategories = ['unit','integration','regression'];
  const {service,run} = fixture(p);
  await service.execute(run.id,'unit','green',true);
  assert.equal(service.report(run.id).readiness,'not_verified');
  await service.execute(run.id,'integration','green',true);
  await service.execute(run.id,'regression','green',true);
  assert.equal(service.report(run.id).readiness,'verified_required');
});
test('security findings require remediation and a fresh review, while previous assessments stay in history', async () => {
  const {root,service,run} = fixture(policy({security:true}));
  writeFile(root,'src/app.ts', 'import express from "express"; import {exec} from "child_process"; const app = express(); app.post("/run", (req,res) => { exec("ls " + req.body.dir); });');
  await service.execute(run.id,'unit','green',true);
  service.assessSecurity(run.id);
  assert.equal(service.report(run.id).readiness,'requires_human_review');
  writeFile(root,'src/app.ts','export const safe = true;');
  await service.execute(run.id,'unit','green',true);
  assert.equal(service.report(run.id).readiness,'not_verified');
  service.assessSecurity(run.id);
  assert.ok(service.report(run.id).readiness.startsWith('verified_'));
  assert.equal(service.load(run.id).securityHistory?.length,1);
  assert.ok(service.context(run.id,1000).text.length <= 1000);
});
