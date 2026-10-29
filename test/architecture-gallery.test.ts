import assert from 'node:assert/strict';
import { test } from 'node:test';
import { galleryEntries } from '../src/visualization/architecture/ui/catalog.js';
import { ArchitectureService } from '../src/visualization/architecture/service.js';
import { FehmEngine } from '../src/engine.js';
import { viewSpec } from '../src/architecture/views.js';
import { corpusCopy, makeRepo, tempDir } from './helpers.js';

test('gallery exposes only evidence-backed choices and preserves distinct context scope', () => {
  const service = new ArchitectureService({ dryRun: true });
  const engine = FehmEngine.open(corpusCopy(), { stateDirectory: tempDir() });
  const views = service.views(engine), entries = galleryEntries(views);
  assert.ok(entries.every(e => e.descriptor.available));
  assert.equal(entries.filter(e => e.descriptor.type === 'system').length, 2);
  assert.equal(entries.find(e => e.focus === 'context')?.title, 'System context');
  assert.ok(entries.find(e => e.descriptor.type === 'runtime')?.evidence.includes('not an observed'));
  for (const unavailable of views.filter(v => !v.available)) assert.ok(!entries.some(e => e.descriptor.type === unavailable.type));
  const empty = FehmEngine.open(makeRepo({ 'README.md': '# No source' }), { stateDirectory: tempDir() });
  assert.ok(!galleryEntries(service.views(empty)).some(e => e.descriptor.type === 'system'));
});

test('full dependency projection retains every module and relationship omitted by the default budget', () => {
  const files: Record<string,string> = {};
  for(let i=0;i<40;i++) files[`src/unit${i}/index.ts`] = `${i ? `import { f${i-1} } from '../unit${i-1}/index.js';` : ''}\nexport function f${i}() { return ${i ? `f${i-1}()` : '1'}; }`;
  const engine = FehmEngine.open(makeRepo(files), { stateDirectory: tempDir() });
  const service = new ArchitectureService({dryRun:true}), model = service.model(engine);
  const limited = viewSpec(model,'dependencies'), full = viewSpec(model,'dependencies','all');
  assert.ok(!('error' in limited)); assert.ok(!('error' in full));
  assert.ok(full.nodes.length > limited.nodes.length);
  assert.equal(full.nodes.length, model.nodes.filter(n=>n.level===3).length);
  const ids = new Set(full.nodes.map(n=>n.id));
  assert.equal(full.relationships.length, model.relationships.filter(r=>ids.has(r.source)&&ids.has(r.target)).length);
  assert.equal(full.focus,'all'); assert.equal(full.input.focus,'all');
  assert.match(limited.notes.join(' '), /relationships are hidden/);
  assert.equal(full.notes.length,0);
});
