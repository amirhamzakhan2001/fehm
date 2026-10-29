import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FehmEngine } from '../src/engine.js';
import { LexicalIndex } from '../src/lexical-index.js';
import { readingGuide } from '../src/visualization/engine/ui/reading-guide.js';
import { makeRepo, writeFile } from './helpers.js';

test('authorization retrieval does not conflate authorship and authority', () => {
  const index = new LexicalIndex();
  for (const [id,text] of [['author','commit author authors authorship'],['authority','authority notice authoritative'],['access','authorization authorize authorized authorizing authz']]) index.add({id:id!,fields:[{text:text!,weight:1}]});
  assert.deepEqual(index.search('authorization',10).map(x=>x.id),['access']);
  assert.deepEqual(index.search('authorizing',10).map(x=>x.id),['access']);
});
test('reading guide groups source, describes only indexed relationships and retains caveats', () => {
  const root=makeRepo({'access.ts':'/** Check whether the role allows deleting a project. */\nexport function authorize(role: string) { return role === "admin"; }\nexport function remove(role: string) { return authorize(role); }'});
  const engine=FehmEngine.open(root,{dryRun:true});
  const p=engine.context('authorize',{budget:4000});
  const guide=readingGuide(p);
  assert.equal(guide.groups.length,1);
  assert.match(guide.summary,/authorize/);
  assert.ok(guide.connections.some(x=>x.includes('calls')));
  assert.ok(guide.caveats.some(x=>x.includes('not a verified explanation')));
  p.budget.truncated=true;
  assert.ok(readingGuide(p).caveats.some(x=>x.includes('shortened or omitted')));
  writeFile(root,'access.ts','export function authorize() { return false; }');
  const stale=engine.context('authorize');
  assert.equal(stale.index.fresh,false);
  assert.ok(readingGuide(stale).caveats.some(x=>x.includes('Rescan')));
});
test('empty context gives an actionable empty state rather than an explanation', () => {
  const engine=FehmEngine.open(makeRepo({}),{dryRun:true});
  const guide=readingGuide(engine.context('authorization'));
  assert.match(guide.summary,/No indexed code matched/);
  assert.equal(guide.groups.length,0);
});
