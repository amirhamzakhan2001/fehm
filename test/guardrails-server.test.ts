import assert from 'node:assert/strict';
import { test } from 'node:test';
import type {AddressInfo} from 'node:net';
import { startServer } from '../src/server.js';
import { Guardrails } from '../src/guardrails/workflow.js';
import { makeRepo } from './helpers.js';
test('guardrails dashboard serves history, revision-specific report and UI; execution stays CLI-only',async () => {
  const root = makeRepo({'src/a.ts':'export const a = 1;'});
  const service = new Guardrails(root);
  const run = service.start('Review change',[],{checks:[],requiredCategories:['unit'],security:true,tdd:true,maxAttempts:1,timeoutMs:1000,execution:'host-approved'});
  const server = await startServer(root,0,{dryRun:true});
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const page = await fetch(`${url}/guardrails?embedded`);
    assert.equal(page.status,200); assert.match(await page.text(),/Engineering Guardrails/);
    assert.match(page.headers.get('content-security-policy') ?? '',/script-src 'self'/);
    const asset = await fetch(`${url}/guardrails/assets/guardrails/ui/main.js`);
    assert.equal(asset.status,200); assert.doesNotMatch(await asset.text(),/from ['"]node:/);
    const history = await fetch(`${url}/api/guardrails`).then(r => r.json()) as {id:string}[];
    assert.equal(history[0]?.id,run.id);
    const report = await fetch(`${url}/api/guardrails/report?id=${run.id}`).then(r => r.json()) as {readiness:string};
    assert.equal(report.readiness,'not_verified');
    assert.equal((await fetch(`${url}/api/guardrails`,{method:'POST'})).status,405);
    assert.equal((await fetch(`${url}/api/guardrails/report?id=../../secret`)).status,400);
    assert.equal((await fetch(`${url}/guardrails/assets/guardrails/routes.js`)).status,404);
  } finally { await new Promise<void>((resolve,reject) => server.close(e => e ? reject(e) : resolve())); }
});
