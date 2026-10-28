import assert from 'node:assert/strict';
import { test } from 'node:test';
import { comparisonModel, findingClassification } from '../src/visualization/drift/ui/comparison.js';
import { analyzeDrift } from '../src/drift/drift.js';
import { FehmEngine } from '../src/engine.js';
import { makeRepo, tempDir } from './helpers.js';
import { shopFiles } from './fixtures/drift-shop.js';
import { industryFor } from '../src/drift/knowledge.js';
const scan = (files: Record<string,string>) => analyzeDrift({engine:FehmEngine.open(makeRepo(files),{stateDirectory:tempDir()})}).report;
test('comparison uses actual detector sequences and never invents missing architecture', () => {
 const f = scan(shopFiles()).findings.find(f=>f.id==='src/controllers/payments.controller.ts|store:database')!;
 assert.ok(f); const model=comparisonModel(f);
 assert.deepEqual(model.expected,['Controller','Service','Repository','Database']);
 assert.deepEqual(model.actual,['Controller','Database']);
 assert.equal(model.actualEdges[0]!.different,true);
 assert.equal(comparisonModel({...f,commonChain:undefined}).comparable,false);
 assert.equal(findingClassification(f),'Potential architectural risk');
 assert.equal(findingClassification({...f,basis:'explicit-rule',confidence:'high'}),'Confirmed configured-rule deviation');
 assert.equal(findingClassification({...f,category:'security-boundary'}),'Needs investigation');
});
test('auth convention does not claim an exposed endpoint and lint is not architecture drift', () => {
 const r=scan(shopFiles()); const f=r.findings.find(f=>f.id==='src/controllers/reports.controller.ts|auth')!;
 assert.ok(f); assert.match(f.explanation,/Global middleware/); assert.match(f.observed,/No authentication signal was resolved/);
 assert.ok(!r.findings.some(f=>f.category==='naming'||f.category==='ai-associated'));
});
test('transitive authentication references are considered without proving runtime enforcement', () => {
 const files=shopFiles();
 files['src/controllers/reports.controller.ts'] = 'import { gate } from "../lib/gate"; export function reportsRoutes(app: any) { app.get("/reports", gate, () => []); }';
 files['src/lib/gate.ts']='export { gate } from "./policy";';
 files['src/lib/policy.ts']='export function gate() { return requireAuth(); }';
 assert.ok(!scan(files).findings.some(f=>f.id==='src/controllers/reports.controller.ts|auth'));
});
test('a static site does not receive backend or database obligations', () => {
 const r=scan({'index.html':'<h1>Hello</h1>','app.js':'document.title = "Hello";'});
 assert.ok(!r.findings.some(f=>['database','security-boundary','layer'].includes(f.category)));
 assert.equal(r.areas?.find(a=>a.name==='Database and persistence')?.status,'insufficient-evidence');
});

test('monorepo packaging alone does not imply backend layer or authentication obligations', () => {
 assert.ok(!industryFor('monorepo',['library']).some(p=>['IND-AUTH','IND-THIN-HANDLERS','IND-DELEGATE'].includes(p.id)));
});
