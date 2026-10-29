import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { FehmEngine } from '../src/engine.js';
import { buildPromptReport } from '../src/prompts/report.js';
import { editPromptCandidate } from '../src/prompts/optimization.js';
import { saveProposal, savedProposals } from '../src/prompts/proposals.js';
import { decideFinding, decidePattern, readDecisions } from '../src/drift/decisions.js';
import { HealthService } from '../src/visualization/health/service.js';
import { makeRepo, tempDir } from './helpers.js';

test('inventory retains test, unresolved, same-line, shared and structured definitions', () => {
  const root = makeRepo({
    'package.json': '{"name":"audit-fixture"}',
    'src/shared.ts': 'export const SYSTEM = "You are a helpful reviewer. Use evidence from the supplied code.";',
    'src/main.ts': 'import {SYSTEM} from "./shared.js"; const prompt = runtimeConfig(); client.chat.completions.create({messages:[{role:"system",content:SYSTEM}]}); client.chat.completions.create({messages:[{role:"user",content:"Explain the supplied code carefully."}]});',
    'test/prompts.test.ts': 'const SYSTEM_PROMPT = "You are a test assistant. Return only the supplied evidence.";',
    'config.json': '{"a":{"role":"system","content":"You are a careful assistant."},"b":{"template":"Summarize the supplied material."}}',
    'guide.txt': 'You are a careful code reviewer. Explain the supplied source using only evidence.',
    'ordinary.txt': 'This is an ordinary document describing a local folder.',
  });
  const engine = FehmEngine.open(root, { stateDirectory: tempDir() });
  const r = buildPromptReport({ engine });
  assert.equal(new Set(r.prompts.map(p => p.id)).size, r.prompts.length);
  assert.equal(r.prompts.filter(p => p.call.includes('completions')).length, 2);
  assert.ok(r.prompts.some(p => p.environment === 'test'));
  assert.ok(r.prompts.some(p => p.name === 'prompt' && p.reconstruction === 'partial'));
  assert.equal(r.prompts.filter(p => p.path === 'config.json').length, 2);
  assert.ok(r.prompts.some(p => p.path === 'guide.txt'));
  assert.ok(!r.prompts.some(p => p.path === 'ordinary.txt'));
  assert.ok(r.prompts.some(p => p.call.includes('completions') && p.referenceIds?.length));
  assert.deepEqual(buildPromptReport({ engine }).prompts.map(p => p.id), r.prompts.map(p => p.id));
});

test('edited proposals persist separately, preserve placeholders and reject stale or sensitive saves', () => {
  const source = 'const SYSTEM_PROMPT = "You are a reviewer. Explain {input} using supplied evidence.";';
  const root = makeRepo({ 'main.ts': source });
  const engine = FehmEngine.open(root, { stateDirectory: tempDir() });
  const p = buildPromptReport({ engine }).prompts[0]!;
  const state = tempDir();
  const candidate = editPromptCandidate(p, p.text + '\nKeep the response concise.', 'quality', source);
  saveProposal(state, p, candidate); saveProposal(state, p, candidate);
  assert.equal(savedProposals(state, p).length, 1);
  assert.equal(savedProposals(state, p)[0]!.text, candidate.text);
  assert.equal(readFileSync(join(root, 'main.ts'), 'utf8'), source);
  assert.equal(editPromptCandidate(p, p.text.replace('{input}', 'input'), 'quality', source).status, 'rejected');
  assert.throws(() => saveProposal(state, { ...p, text: 'changed' }, candidate), /Stale/);
  writeFileSync(join(state, 'prompt-proposals.json'), '{broken');
  assert.throws(() => saveProposal(state, p, candidate), /repair/);
  assert.equal(readFileSync(join(state, 'prompt-proposals.json'), 'utf8'), '{broken');
});

test('malformed drift decisions remain intact and explicitly block further writes', () => {
  const root = makeRepo({ '.fehm/drift-decisions.json': '{broken' });
  assert.ok(readDecisions(root).issues?.length);
  assert.throws(() => decideFinding(root, 'finding', 'accepted'), /repair/);
  assert.throws(() => decidePattern(root, 'pattern', 'approved'), /repair/);
  assert.equal(readFileSync(join(root, '.fehm/drift-decisions.json'), 'utf8'), '{broken');
});

test('health cache observes coverage creation, replacement and deletion without reindexing', () => {
  const root = makeRepo({ 'package.json': '{"name":"coverage-fixture"}', 'src/math.ts': 'export const add = (a: number, b: number) => a + b;' });
  const engine = FehmEngine.open(root, { stateDirectory: tempDir() });
  const service = new HealthService({ stateDirectory: tempDir(), dryRun: true });
  const before = service.report(engine);
  mkdirSync(join(root, 'coverage'));
  const path = join(root, 'coverage/lcov.info');
  writeFileSync(path, 'SF:src/math.ts\nDA:1,1\nLF:1\nLH:1\nend_of_record\n');
  const after = service.report(engine);
  assert.notEqual(after.coverage.runtime, before.coverage.runtime);
  assert.ok(after.coverage.runtime?.artifacts.length);
  writeFileSync(path, 'SF:src/math.ts\nDA:1,0\nDA:2,0\nLF:2\nLH:0\nend_of_record\n');
  const changed = service.report(engine);
  assert.notDeepEqual(changed.coverage.runtime, after.coverage.runtime);
  unlinkSync(path);
  assert.deepEqual(service.report(engine).coverage.runtime, before.coverage.runtime);
});
