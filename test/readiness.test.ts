import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FehmEngine } from '../src/engine.js';
import { analyzeWebDelivery } from '../src/health/web-delivery.js';
import { engineeringReadiness } from '../src/health/readiness.js';
import { parseHealthConfig } from '../src/health/config.js';
import { buildHealthReport, renderHealthText } from '../src/health/health.js';
import { makeRepo } from './helpers.js';

const doc = (head = '', body = '') => `<!doctype html><html><head>${head}</head><body>${body}</body></html>`;
function scan(files: Record<string, string>, audience: 'public' | 'private' | 'local' | 'unknown' = 'public') {
  const root = makeRepo(files);
  const engine = FehmEngine.open(root, { dryRun: true });
  return analyzeWebDelivery(engine, [{ include: ['**/*.html'], audience }], () => false);
}
test('public HTML finds actionable source concerns and preserves line evidence', () => {
  const r = scan({'index.html': doc('<title>Home</title>\n<meta name="robots" content="noindex">', '\n<img src="hero.png">')});
  for (const rule of ['title','noindex','viewport','description','image-alt']) assert.ok(r.findings.some(f => f.ruleId === `web/${rule}`), rule);
  assert.equal(r.report.publicDocuments, 1);
  assert.equal(r.findings.find(f => f.ruleId === 'web/noindex')!.line, 2);
  assert.ok(r.findings.every(f => f.confidence === 'inferred' && f.verification.length && f.evidence.length));
});
test('private, local and unknown HTML are not penalized for intentional noindex or missing SEO', () => {
  for (const audience of ['private','local','unknown'] as const) {
    const r = scan({'index.html': doc('<meta name="robots" content="noindex"><meta name="viewport" content="width=device-width">', '<img alt=""><h1>A</h1><h1>B</h1>')}, audience);
    assert.equal(r.findings.length, 0);
    assert.equal(r.report.publicDocuments, 0);
  }
});
test('inert comments/scripts and decorative alt do not trigger false positives', () => {
  const r = scan({'index.html': doc('<title>Engineering guide</title><meta name="description" content="A guide"><meta name="viewport" content="width=device-width"><!-- <meta name="robots" content="noindex"> -->', '<script>const html = `<img src="bad"><meta name="robots" content="noindex">`;</script><img src="icon" alt=""><h1>A</h1><h1>B</h1>')});
  assert.equal(r.findings.length, 0);
});
test('templates and fragments are excluded rather than declared broken', () => {
  const r = scan({'template.html': doc('<title>{{ title }}</title>'), 'fragment.html': '<img src="image">'});
  assert.equal(r.report.documents, 0);
  assert.equal(r.report.excluded, 2);
  assert.equal(r.findings.length, 0);
});
test('duplicate titles scoped to configured public documents; canonical absence is not a defect', () => {
  const r = scan({'a.html': doc('<title>Guide</title>'), 'b.html': doc('<title>Guide</title>')});
  assert.equal(r.findings.filter(f => f.ruleId === 'web/duplicate-title').length, 2);
  assert.equal(r.findings.filter(f => f.ruleId === 'web/canonical').length, 0);
});
test('overlapping profiles leave SEO applicability unknown', () => {
  const root = makeRepo({'a.html': doc('<meta name="robots" content="noindex">')});
  const r = analyzeWebDelivery(FehmEngine.open(root, {dryRun:true}), [{include:['**/*.html'],audience:'public'}, {include:['**/*.html'],audience:'private'}], () => false);
  assert.equal(r.report.publicDocuments, 0);
  assert.ok(r.report.limitations.some(x => x.includes('overlapping')));
  assert.ok(!r.findings.some(f => f.ruleId === 'web/noindex'));
});
test('configuration validates audience and rooted profiles without executing anything', () => {
  assert.equal(parseHealthConfig({readiness:{profiles:[{include:['site/**'],audience:'public'}]}}).ok, true);
  for (const readiness of [{profiles:[{include:['../**'],audience:'public'}]}, {profiles:[{include:['**'],audience:'engineer'}]}, {profiles:null}]) assert.equal(parseHealthConfig({readiness}).ok, false);
});
test('passing and stale checks are distinct and never classify authorship or complete readiness', () => {
  const base = { id:'test',kind:'test' as const,label:'test',argv:['node','--test'],cwd:'',display:'node --test',source:{path:'package.json'} };
  const last = { checkId:'test',command:'node --test',status:'passed' as const,durationMs:1,at:'2026-10-28',fingerprint:'x',output:'',stale:false };
  for (const stale of [false,true]) {
    const r = engineeringReadiness([], {packageManagers:[],systems:[],checks:[{...base,last:{...last,stale}}]}, {documents:0,publicDocuments:0,excluded:0,limitations:[]});
    assert.equal(r.verification[0]!.status, stale ? 'stale' : 'passed');
    assert.equal(r.authorship,'unknown');
    assert.equal(r.status,'evidence-incomplete');
  }
});
test('Health JSON and text expose readiness, review state, web findings and implementation integrity', () => {
  const root = makeRepo({'.fehm/health.json':JSON.stringify({readiness:{profiles:[{include:['**/*.html'],audience:'public'}]}}), 'index.html':doc('<meta name="robots" content="noindex">')});
  const report = buildHealthReport({engine:FehmEngine.open(root,{dryRun:true}),dryRun:true});
  assert.equal(report.readiness.status,'risks-detected');
  assert.equal(report.readiness.authorship,'unknown');
  assert.ok(report.findings.some(f => f.ruleId === 'web/noindex'));
  assert.equal(report.dimensions.find(d => d.id === 'ai-code')!.title,'Implementation integrity');
  assert.match(renderHealthText(report), /Engineering readiness:/);
  const reviewed = report.findings.map(f => ({...f,review:{status:'accepted-risk' as const,at:'now'}}));
  assert.equal(engineeringReadiness(reviewed,report.build,report.webDelivery).status,'evidence-incomplete');
});

test('web findings are bounded and omitted concerns remain visible', () => {
  const r = scan({'index.html':doc('<title>Test guide</title>', '<img src="x">'.repeat(800))});
  assert.equal(r.findings.length,500);
  assert.ok(r.report.limitations.some(x => x.includes('500-finding limit')));
});
test('style and template text cannot masquerade as active markup', () => {
  const r = scan({'index.html':doc('<meta name="viewport" content="width=device-width"><style>body:after{content:"<img>"}</style>', '<template><img></template>')},'private');
  assert.equal(r.findings.length,0);
});
