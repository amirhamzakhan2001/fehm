import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FehmEngine } from '../src/engine.js';
import { buildCodebaseBriefing } from '../src/codebase-briefing/briefing.js';
import { ArchitectureService } from '../src/visualization/architecture/service.js';
import { technologies, technologyNodes } from '../src/visualization/briefing/ui/technology.js';
import { makeRepo, tempDir } from './helpers.js';

test('technology selection links indexed usage, never a shared manifest alone', () => {
  const engine = FehmEngine.open(makeRepo({
    'package.json': JSON.stringify({name:'technology-fixture', dependencies:{react:'^19.0.0',redis:'^5.0.0'}}),
    'src/ui/app.ts': "import React from 'react'; export const app = () => React.createElement('div');",
    'src/server/run.ts': 'export const start = () => 42;',
  }), { stateDirectory: tempDir() });
  const briefing = buildCodebaseBriefing(engine, { dryRun: true });
  const items = technologies(briefing);
  const react = items.find(item => item.name === 'React')!;
  const redis = items.find(item => item.name === 'Redis client')!;
  assert.ok(react); assert.ok(redis);
  assert.deepEqual(react.requirements, ["^19.0.0"]);
  assert.deepEqual(redis.requirements, ["^5.0.0"]);
  assert.equal(redis.basis, 'declared');
  const model = new ArchitectureService({dryRun:true}).model(engine);
  const nodes = model.nodes;
  assert.ok(technologyNodes(nodes, react).length > 0);
  assert.equal(technologyNodes(nodes, redis).length, 0);
  assert.ok(!technologyNodes(nodes, react).some(id => nodes.find(node => node.id === id)?.files.every(file => file === 'src/server/run.ts')));
});
