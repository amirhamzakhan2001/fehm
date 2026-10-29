import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { SkillRegistry, BUNDLED_CATALOG } from '../src/skill-registry.js';
import { routeSkills } from '../src/skill-router.js';
import { manageSkill, integrationPlatforms } from '../src/integrations.js';
import { buildAgentContext } from '../src/agent-context.js';
import { FehmEngine } from '../src/engine.js';
import { estimateTokens } from '../src/compression.js';
import { investigate } from '../src/debugging/investigate.js';
import { Guardrails, suggestedPolicy } from '../src/guardrails/workflow.js';
import { corpusCopy, makeRepo, tempDir, writeFile } from './helpers.js';

const ids = ['workflows/brainstorming', 'workflows/writing-plans', 'testing/test-driven-development', 'debugging/systematic-debugging', 'verification/verification-before-completion'];
const registry = SkillRegistry.open({ persist: false, force: true });
const hash = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');

test('Superpowers: existing IDs, complete declared resources, licenses and pinned artifact hashes', () => {
  for (const id of ids) {
    const record = registry.get(id)!;
    assert.equal(record.source, 'superpowers'); assert.equal(record.license, 'MIT');
    assert.equal(registry.all().filter(r => r.id === id).length, 1);
    const resources = registry.resourceFiles(id);
    assert.ok(resources.some(r => r.path === 'fehm-evidence.md'));
    assert.match(resources.find(r => r.path === 'LICENSE.txt')!.content.toString(), /Copyright \(c\) 2025 Jesse Vincent/);
    assert.ok(registry.load(id, 'full').text.length > 3000, 'preserve substantial workflow guidance');
  }
  const provenance = JSON.parse(readFileSync(join(BUNDLED_CATALOG, 'superpowers-provenance.json'), 'utf8'));
  assert.equal(provenance.commit, null);
  for (const file of provenance.files) assert.equal(hash(readFileSync(join(BUNDLED_CATALOG, file.path))), file.vendoredSha256, file.path);
  assert.ok(registry.get('workflows/feature-development'), 'existing non-Superpowers catalog remains available');
});

test('Superpowers routing: targeted workflows, bounded context, source opt-out and simple tasks', () => {
  const cases = [
    ['Plan a complex multi-step implementation from approved requirements for an API', 'workflows/plan'],
    ['Debug an intermittent authentication bug and trace the root cause of the failing test', 'debugging/systematic-debugging'],
    ['Implement retry behavior with test driven development and regression tests', 'testing/test-driven-development'],
  ];
  for (const [task, id] of cases) {
    const result = routeSkills(registry, task!, { budget: 2500 });
    assert.ok(result.selected.some(s => s.skillId === id), JSON.stringify(result.selected.map(s => s.skillId)));
    assert.ok(result.budget.usedTokens <= 2500);
    assert.equal(new Set(result.selected.map(s => s.skillId)).size, result.selected.length);
  }
  for (const task of ['Change the icon color to blue', 'Explain how the router works']) {
    const result = routeSkills(registry, task, { budget: 1000 });
    assert.ok(result.selected.filter(s => ids.includes(s.skillId)).length <= 1);
    assert.ok(result.budget.usedTokens <= 1000);
  }
  const planned = routeSkills(registry, 'Plan a complex feature from approved requirements', { include: ['workflows/writing-plans'], budget: 2500 });
  assert.ok(planned.selected.some(s => s.skillId === 'workflows/writing-plans'));
  const disabled = routeSkills(registry, 'Debug failing tests', { excludeSources: ['superpowers'], include: ids });
  assert.ok(disabled.selected.every(s => s.source.repository !== 'superpowers'));
  const engine = FehmEngine.open(corpusCopy(), { stateDirectory: tempDir() });
  const ctx = buildAgentContext(engine, 'Debug token authentication', { registry, totalBudget: 5000, codeBudget: 2000, skillBudget: 1500, taskBudget: 300, route: { include: ['debugging/systematic-debugging'] } });
  assert.ok(estimateTokens(ctx.markdown) <= 5000);
  assert.ok(ctx.code.recommendedNodes.length > 0);
  const empty = SkillRegistry.fromSources([{ type: 'directory', dir: join(tempDir(), 'absent'), options: { name: 'optional' } }]);
  assert.doesNotThrow(() => buildAgentContext(engine, 'Explain token authentication', { registry: empty }));
});

test('Superpowers install: all supported formats/scopes copy resources, preserve unrelated files and uninstall safely', async () => {
  for (const platform of Object.keys(integrationPlatforms)) for (const project of [false, true]) {
    const root = tempDir(); const options = { platform, project, cwd: root, home: root };
    for (const id of ids) {
      const result = await manageSkill(registry, id, 'install', options);
      const dir = dirname(result.path);
      for (const resource of registry.resourceFiles(id)) assert.deepEqual(readFileSync(join(dir, resource.path)), resource.content);
      assert.equal((await manageSkill(registry, id, 'install', options)).state, 'current');
      writeFileSync(join(dir, 'my-notes.md'), 'user owned');
      await manageSkill(registry, id, 'uninstall', options);
      assert.equal(existsSync(result.path), false);
      assert.equal(readFileSync(join(dir, 'my-notes.md'), 'utf8'), 'user owned');
      for (const resource of registry.resourceFiles(id)) assert.equal(existsSync(join(dir, resource.path)), false);
    }
  }
  await assert.rejects(manageSkill(registry, ids[0]!, 'install', { platform: 'unsupported' }), /Unknown platform/);
});

test('resource customization preflight, force backup, dry run, symlinks and invalid inventory', async () => {
  const root = tempDir(), id = ids[3]!;
  const options = { platform: 'codex', project: true, cwd: root };
  const initial = await manageSkill(registry, id, 'install', { ...options, dryRun: true });
  assert.equal(existsSync(initial.path), false);
  await manageSkill(registry, id, 'install', options);
  const dir = dirname(initial.path), resource = join(dir, 'root-cause-tracing.md');
  writeFileSync(resource, 'custom diagnostic instructions');
  assert.equal((await manageSkill(registry, id, 'status', options)).state, 'customized');
  await assert.rejects(manageSkill(registry, id, 'install', options), /Preserving customized/);
  await assert.rejects(manageSkill(registry, id, 'uninstall', options), /Preserving customized/);
  assert.ok(existsSync(initial.path), 'preflight prevents partial uninstall');
  await manageSkill(registry, id, 'install', { ...options, force: true });
  assert.ok(readdirSync(dir).some(p => p.endsWith('.bak')));
  rmSync(resource); symlinkSync(join(dir, 'LICENSE.txt'), resource);
  await assert.rejects(manageSkill(registry, id, 'status', options), /symlink/);
  rmSync(resource);
  writeFileSync(join(dir, '.fehm-resources.json'), JSON.stringify({ '../outside': 'a'.repeat(64) }));
  await assert.rejects(manageSkill(registry, id, 'uninstall', options), /invalid resource inventory/);
});

test('declared resource loader rejects missing, traversal, symlink and oversized resources without reading them', () => {
  const root = tempDir(), id = ids[3]!;
  cpSync(join(BUNDLED_CATALOG, id), join(root, id), { recursive: true });
  const manifest = JSON.parse(readFileSync(join(BUNDLED_CATALOG, 'manifest.json'), 'utf8'));
  manifest.skills = manifest.skills.filter((s: {id: string}) => s.id === id);
  const open = (resources: string[]) => {
    manifest.skills[0].resources = resources;
    writeFileSync(join(root, 'manifest.json'), JSON.stringify(manifest));
    return SkillRegistry.fromSources([{ type: 'catalog', dir: root }]);
  };
  assert.throws(() => open([id + '/../escape']).resourceFiles(id), /unsafe/);
  assert.throws(() => open([id + '/absent.md']).resourceFiles(id), /ENOENT/);
  symlinkSync(join(root, id, 'LICENSE.txt'), join(root, id, 'linked'));
  assert.throws(() => open([id + '/linked']).resourceFiles(id), /symlink/);
  writeFileSync(join(root, id, 'large'), Buffer.alloc(1024 * 1024 + 1));
  assert.throws(() => open([id + '/large']).resourceFiles(id), /size\/type limit/);
});

test('workflow evidence uses existing discovery, investigation and approved ledger; recommendations do not pass checks', async () => {
  const root = makeRepo({ 'package.json': JSON.stringify({ scripts: { test: 'node --test test.mjs' } }), 'implementation.mjs': 'export const answer = 1;\n' });
  assert.ok(suggestedPolicy(root).checks.length > 0);
  const service = new Guardrails(root);
  const run = service.start('Return two', [{ id: 'answer', text: 'returns two', origin: 'user', confirmed: true, checks: ['unit'] }], {
    checks: [{ id: 'unit', category: 'unit', argv: [process.execPath, '--test', '--test-reporter=tap', 'test.mjs'], cwd: '.', required: true }], requiredCategories: ['unit'], tdd: true, security: false, maxAttempts: 2, timeoutMs: 5000, execution: 'host-approved',
  });
  assert.equal(service.report(run.id).readiness, 'not_verified');
  writeFile(root, 'test.mjs', "import {test} from 'node:test'; import assert from 'node:assert/strict'; import {answer} from './implementation.mjs'; test('returns two',()=>assert.equal(answer,2));\n");
  assert.equal((await service.execute(run.id, 'unit', 'red', false, 'returns two')).evidence.at(-1)?.status, 'blocked');
  const red = await service.execute(run.id, 'unit', 'red', true, 'returns two');
  assert.equal(red.evidence.at(-1)?.status, 'failed'); assert.equal(red.evidence.at(-1)?.validRed, true);
  const investigation = investigate(FehmEngine.open(root, { dryRun: true }), { text: 'AssertionError: expected 2 but received 1', location: { path: 'implementation.mjs', line: 1 } });
  assert.ok(investigation.evidence.length > 0);
  writeFile(root, 'implementation.mjs', 'export const answer = 2;\n');
  assert.equal((await service.execute(run.id, 'unit', 'green', true)).evidence.at(-1)?.status, 'passed');
  assert.equal(service.report(run.id).readiness, 'verified_required');
});


test('CLI exclusions and resource reads use the public commands', () => {
  const run = (...args: string[]) => spawnSync(process.execPath, ['--import', 'tsx', 'src/cli.ts', ...args, '--state-dir', tempDir(), '--json'], { encoding: 'utf8' });
  const disabled = run('skills', 'route', 'Debug authentication bug', '--no-repo', '--exclude-source', 'superpowers', '--skill', ids[3]!);
  assert.equal(disabled.status, 0, disabled.stderr);
  assert.ok(JSON.parse(disabled.stdout).selected.every((s: {source: {repository: string}}) => s.source.repository !== 'superpowers'));
  const resource = run('skills', 'resource', ids[3]!, 'root-cause-tracing.md');
  assert.equal(resource.status, 0, resource.stderr);
  assert.equal(JSON.parse(resource.stdout).text, registry.resourceFiles(ids[3]!).find(r => r.path === 'root-cause-tracing.md')!.content.toString());
  const invalid = run('skills', 'resource', ids[3]!, '../manifest.json');
  assert.notEqual(invalid.status, 0);
});

test('resource upgrade removes only obsolete managed files, and preserves newly colliding user files', async () => {
  const id = ids[3]!, options = { platform: 'generic', project: true, cwd: tempDir() };
  const first = await manageSkill(registry, id, 'install', options);
  const dir = dirname(first.path), catalog = tempDir();
  cpSync(join(BUNDLED_CATALOG, id), join(catalog, id), { recursive: true });
  const manifest = JSON.parse(readFileSync(join(BUNDLED_CATALOG, 'manifest.json'), 'utf8'));
  manifest.skills = manifest.skills.filter((s: {id: string}) => s.id === id);
  manifest.skills[0].resources = manifest.skills[0].resources.filter((s: string) => !s.endsWith('condition-based-waiting-example.ts'));
  manifest.skills[0].resources.push(id + '/new-reference.md');
  writeFileSync(join(catalog, id, 'new-reference.md'), 'new packaged reference');
  writeFileSync(join(catalog, 'manifest.json'), JSON.stringify(manifest));
  const updated = SkillRegistry.fromSources([{ type: 'catalog', dir: catalog }]);
  writeFileSync(join(dir, 'new-reference.md'), 'existing user file');
  // The fixture lacks the license directory; permit its unknown license for this lifecycle test only.
  await assert.rejects(manageSkill(updated, id, 'install', { ...options, allowUnknownLicense: true }), /Preserving customized/);
  assert.ok(existsSync(join(dir, 'condition-based-waiting-example.ts')), 'nothing removed on failed preflight');
  rmSync(join(dir, 'new-reference.md'));
  await manageSkill(updated, id, 'install', { ...options, allowUnknownLicense: true });
  assert.equal(existsSync(join(dir, 'condition-based-waiting-example.ts')), false);
  assert.equal(readFileSync(join(dir, 'new-reference.md'), 'utf8'), 'new packaged reference');
});
