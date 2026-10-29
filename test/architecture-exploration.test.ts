import assert from 'node:assert/strict';
import { test } from 'node:test';
import { focusNeighborhood } from '../src/visualization/architecture/ui/exploration.js';
import type { DiagramLayout } from '../src/architecture/types.js';

test('focus neighborhoods preserve direction and parallel relations, while bounding traversal through cycles', () => {
  const links = [['a','b'],['b','a'],['b','c'],['b','c'],['c','d'],['x','a'],['z','y']];
  const layout = { edges: links.map(([source,target],i) => ({id:String(i),source,target})) } as DiagramLayout;
  const one = focusNeighborhood(layout,'a',1);
  assert.deepEqual([...one.nodes].sort(),['a','b','x']);
  assert.deepEqual([...one.edges].sort(),['0','1','5']);
  const two = focusNeighborhood(layout,'a',2);
  assert.deepEqual([...two.nodes].sort(),['a','b','c','x']);
  assert.deepEqual([...two.edges].sort(),['0','1','2','3','5']);
  assert.equal(layout.edges[0]?.source,'a');
  assert.deepEqual([...focusNeighborhood(layout,'isolated',2).nodes],['isolated']);
  assert.equal(focusNeighborhood(layout,'isolated',2).edges.size,0);
});
