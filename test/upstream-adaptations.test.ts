import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createConfig } from '../src/config.js';
import { buildIndex } from '../src/indexer.js';
import { captureIndexedSource, reviewSourceFreshness } from '../src/review-freshness.js';
import { rankContextMemory, codeReviewGuidance } from '../src/upstream-adaptations.js';
import { tokenize, retrieveContext } from '../src/context.js';
import type { MemoryRecord } from '../src/model.js';
import { reviewPlan, runOpenCodeReview } from '../src/open-code-review.js';

test('acronym identifiers are searchable as words without breaking existing OAuth tokens', async () => {
  assert.deepEqual(tokenize('HTTPServer XMLParser OAuth2'), ['http','server','xml','parser','oauth2']);
  const root = await mkdtemp(path.join(tmpdir(),'fehm-upstream-'));
  try {
    await writeFile(path.join(root,'server.ts'),'export function HTTPServer() { return 1; }\nexport function unrelated() { return 2; }');
    const graph = await buildIndex(createConfig(root));
    const hits = await retrieveContext(graph,'http server');
    assert.equal(hits[0]?.node.name,'HTTPServer');
    const before = await captureIndexedSource(graph);
    assert.equal(before.matchesIndex,true);
    assert.equal(reviewSourceFreshness(before,await captureIndexedSource(graph)).state,'unchanged');
    await writeFile(path.join(root,'server.ts'),'export function HTTPServer() { return 3; }');
    const after = await captureIndexedSource(graph);
    assert.equal(reviewSourceFreshness(before,after).state,'changed');
    assert.equal(reviewSourceFreshness(after,after).state,'index-stale');
    await rm(path.join(root,'server.ts'));
    assert.equal(reviewSourceFreshness(before,await captureIndexedSource(graph)).state,'uncaptured');
  } finally { await rm(root,{recursive:true,force:true}); }
});

test('memory ranking uses whole words and retains source confidence and stable ties', () => {
  const entry = (title:string):MemoryRecord => ({id:title,kind:'decision',title,content:'',path:'decisions.md',line:1,source:'documentation',confidence:0.8});
  const original = [entry('good practices'),entry('Go services'),entry('refund policy'),entry('other')];
  const before=JSON.stringify(original);
  assert.deepEqual(rankContextMemory(original,'refund', ['go']).map(x=>x.title), ['refund policy','Go services','good practices','other']);
  assert.deepEqual(rankContextMemory(original,'unmatched',[]),original);
  assert.equal(JSON.stringify(original),before);
});

test('review profile is explicit and passed as guidance without installing agent instructions', async () => {
  assert.equal(reviewPlan([]).profile,undefined);
  assert.throws(()=>reviewPlan(['--profile','unknown']));
  assert.throws(()=>reviewPlan(['--scan','--profile','code-review']));
  const root=await mkdtemp(path.join(tmpdir(),'fehm-profile-'));
  try {
    const fixture=path.join(root,'engine.cjs');
    await writeFile(fixture,"const fs=require('fs');const a=process.argv;process.stdout.write(fs.readFileSync(a[a.indexOf('--background-file')+1],'utf8'));");
    const plan={...reviewPlan(['--repo',root,'--profile','code-review','--allow-provider']),executable:process.execPath,args:[fixture]};
    assert.equal(await runOpenCodeReview(plan),codeReviewGuidance);
    assert.match(codeReviewGuidance,/Do not invent findings/);
  } finally { await rm(root,{recursive:true,force:true}); }
});
