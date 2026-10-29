import test from 'node:test';
import assert from 'node:assert/strict';
import { OntologyIndex } from '../src/concepts/catalog.js';
import { conceptTier, orderConcepts, evidenceLabel } from '../src/visualization/concepts/ui/ordering.js';
import { FEATURES } from '../src/visualization/features.js';
test('complete inventory uses familiar-first order without losing specialist concepts or aliases', () => {
 const index = OntologyIndex.open({memory:true});
 try {
  const all = index.all(), ordered = orderConcepts(all, []);
  assert.equal(all.length,index.summary().concepts);
  assert.ok(all.length>100);
  assert.equal(new Set(ordered.map(c=>c.id)).size,all.length);
  assert.equal(conceptTier(ordered[0]!),0);
  assert.equal(conceptTier(ordered.at(-1)!),2);
  const quantum = all.find(c=>c.name==='Quantum Computing')!;
  assert.ok(quantum);
  assert.equal(orderConcepts(all,[],'Quantum Computing')[0]!.id,quantum.id);
  assert.equal(evidenceLabel([]),'Reference only');
  assert.equal(FEATURES.filter(f=>['concepts','ontology'].includes(f.id)).length,1);
 } finally {index.close();}
});
