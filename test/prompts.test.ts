import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { FehmEngine } from '../src/engine.js';
import { buildPromptReport } from '../src/prompts/report.js';
import { improvePrompt, compareCandidate, estimateImpact } from '../src/prompts/optimization.js';
import { assertOutput, evaluatePrompt, suggestedCases, judgeCandidate } from '../src/prompts/evaluation.js';
import type { PromptCase } from '../src/prompts/types.js';
import { PromptService } from '../src/visualization/prompts/service.js';
import { startServer } from '../src/server.js';
import { makeRepo, tempDir } from './helpers.js';
const scan = (files: Record<string, string>) => { const root = makeRepo(files); const engine = FehmEngine.open(root, { stateDirectory: tempDir() }); return { root, engine, report: buildPromptReport({ engine }) }; };
const fixture = {
    'package.json': JSON.stringify({ name: 'prompt-fixture', dependencies: { openai: '1' } }),
    'src/instructions.ts': 'export const SYSTEM = "You are a classification component. Use only supplied evidence.";',
    'src/classify.ts': [
        'import OpenAI from "openai";',
        'import { SYSTEM } from "./instructions.js";',
        'const client = new OpenAI();',
        'export async function classify(email: string) {',
        ' const response = await client.chat.completions.create({ model: "test-model", messages: [',
        '  { role: "system", content: SYSTEM },',
        '  { role: "user", content: `Classify this email: ${email}` }',
        ' ] });',
        ' return JSON.parse(response.choices[0].message.content);',
        '}',
    ].join('\n'),
};
test('prompt inventory reconstructs imported behavioral instructions, variables and graph references', () => {
    const { report } = scan(fixture);
    const p = report.prompts.find(p => p.call.includes('completions'))!;
    assert.ok(p);
    assert.equal(p.behavioralInstruction, 'present');
    assert.equal(p.reconstruction, 'complete');
    assert.equal(p.provider, 'openai');
    assert.equal(p.model, 'test-model');
    assert.ok(p.text.includes('classification component'));
    assert.ok(p.fragments.some(f => f.path === 'src/instructions.ts'));
    assert.ok(p.variables.some(v => v.name === 'email'));
    assert.ok(p.functionId);
    assert.ok(p.dependencies.length);
    assert.equal(p.outputContract.format, 'json');
    assert.ok(p.findings.some(f => f.ruleId === 'PI007'));
    assert.ok(!p.findings.some(f => f.ruleId === 'PI012'));
    assert.equal(p.score.semantic, null);
    assert.equal(p.score.behavioral, null);
    assert.equal(p.tokens.total, null);
});
test('separate scopes, agent constructor instructions, dynamic config, comments and strings', () => {
    const { report } = scan({ 'app.ts': [
            'function a() { const prompt = "Translate the sentence to French."; return llm.invoke(prompt); }',
            'function b() { const prompt = "Extract customer email."; return llm.invoke(prompt); }',
            'const agent = create_agent({system_prompt:"You are an assistant. Never take actions without approval."});',
            'agent.run("Answer the user question.");',
            'const external = process.env.SYSTEM_PROMPT;',
            'client.responses.create({instructions:external,input:"Answer."});',
            '// client.responses.create({input:"not a prompt"});',
            'const source = "llm.invoke(abc)";',
        ].join('\n') });
    const calls = report.prompts.filter(p => p.call !== 'template');
    assert.equal(calls.length, 4);
    assert.equal(calls[0]!.text, 'Translate the sentence to French.');
    assert.equal(calls[1]!.text, 'Extract customer email.');
    assert.equal(calls[2]!.behavioralInstruction, 'present');
    assert.equal(calls[3]!.behavioralInstruction, 'unknown');
    assert.ok(!calls[3]!.findings.some(f => f.ruleId === 'PI012'));
});
test('Python f-strings, constants, concatenations, messages and agent configuration', () => {
    const { report } = scan({ 'app.py': [
            'BASE = "You are a classification component."',
            'def classify(email):',
            '    prompt = BASE + f"Classify email: {email}"',
            '    response = llm.invoke(prompt)',
            '    return json.loads(response)',
            '',
            'agent = create_agent(system_prompt=BASE)',
            'agent.run("Answer the question")',
            'client.messages.create(model="test-model", system=BASE, messages=[{"role":"user", "content":"Summarize the document."}])',
        ].join('\n') });
    const calls = report.prompts.filter(p => p.call !== 'template');
    assert.equal(calls.length, 3);
    assert.ok(calls[0]!.text.includes('classification component'));
    assert.ok(calls[0]!.variables.some(v => v.name === 'email'));
    assert.equal(calls[0]!.outputContract.format, 'json');
    assert.equal(calls[1]!.behavioralInstruction, 'present');
    assert.equal(calls[2]!.behavioralInstruction, 'present');
    assert.equal(calls[0]!.confidence, .65);
});
test('shared scanner discovers prompt files, JSON/YAML templates and respects ignore files', () => {
    const { report } = scan({ 'prompts/system.txt': 'You are a document summarizer. Use only supplied sources.', 'prompts/ignored.txt': 'Hidden instructions.', '.fehmignore': 'prompts/ignored.txt', 'config.json': '{"system_prompt":"You are a helpful assistant."}', 'config.yaml': 'user_prompt: |\n  Summarize {{document}}\n  Return a short answer.\n' });
    assert.ok(report.prompts.some(p => p.path === 'prompts/system.txt'));
    assert.ok(!report.prompts.some(p => p.path === 'prompts/ignored.txt'));
    assert.ok(report.prompts.some(p => p.path === 'config.json'));
    assert.ok(report.prompts.some(p => p.path === 'config.yaml' && p.variables.some(v => v.name === 'document')));
});
test('context-aware severity and provider-enforced JSON do not blindly require system prompts', () => {
    const { report } = scan({ 'app.ts': 'llm.invoke("Translate this sentence to French.");\nclient.responses.create({input:"Classify the request.",tools:[{name:"send_email"}],response_format:{type:"json_schema"}});' });
    const calls = report.prompts.filter(p => p.call !== 'template');
    assert.equal(calls[0]!.findings.find(f => f.ruleId === 'PI012')?.severity, 'info');
    assert.equal(calls[1]!.findings.find(f => f.ruleId === 'PI012')?.severity, 'high');
    assert.ok(!calls[1]!.findings.some(f => f.ruleId === 'PI007'));
    assert.equal(calls[1]!.outputContract.enforced, true);
});
test('secrets are redacted from prompt reports and candidates', () => {
    const secret = '-----BEGIN RSA PRIVATE KEY-----';
    const { report } = scan({ 'app.ts': `llm.invoke("Summarize using ${secret}");` });
    assert.ok(!JSON.stringify(report).includes(secret));
    assert.ok(!JSON.stringify(improvePrompt(report.prompts[0]!)).includes(secret));
    assert.equal(report.prompts[0]!.sourceSpan, undefined);
});
test('candidate preserves intent and placeholders, explains edits, and never invents schema fields', () => {
    const { report } = scan(fixture);
    const p = report.prompts.find(p => p.call.includes('completions'))!;
    const c = improvePrompt(p);
    assert.ok(c.text.startsWith(p.text));
    assert.ok(c.intent.variablesPreserved);
    assert.equal(c.status, 'needs-validation');
    assert.ok(c.changes.some(x => x.ruleId === 'PI007'));
    assert.ok(c.diff.includes('+Return valid JSON'));
    assert.ok(!c.text.includes('"confidence":'));
    assert.equal(c.patch, null);
    assert.ok(estimateImpact(c, 100000, 1).tokenChange > 0);
    assert.throws(() => estimateImpact(c, -1, 1));
});
test('single-expression candidate produces an applicable source diff', () => {
    const { engine, root } = scan({ 'app.ts': 'export function classify() { const result = llm.invoke("Classify the email."); return JSON.parse(result); }\n' });
    const service = new PromptService({ dryRun: true });
    const p = service.report(engine).prompts.find(p => p.call === 'llm.invoke')!;
    const c = service.candidate(engine, p.id, 'balanced');
    assert.ok(c.patch);
    const patch = join(root, 'candidate.patch');
    writeFileSync(patch, c.patch + '\n');
    execFileSync('git', ['apply', '--check', patch], { cwd: root });
});
test('assertions reject malformed JSON, invalid types and unsupported cases', async () => {
    assert.equal(assertOutput('{"a":2}', { type: 'json', required: { a: 'number' } }), true);
    assert.equal(assertOutput('{"a":null}', { type: 'json', required: { a: 'object' } }), false);
    assert.equal(assertOutput('```json\n{}\n```', { type: 'json' }), false);
    assert.equal(assertOutput('{}', { type: 'json', required: { toString: 'string' } }), false);
    const p = scan(fixture).report.prompts[0]!;
    await assert.rejects(() => evaluatePrompt(p.text, suggestedCases(p), async () => '', 'fake'), /Review/);
    await assert.rejects(() => evaluatePrompt('x', [{ id: 'x' } as PromptCase], async () => '', 'fake'), /Invalid/);
});
const suite: PromptCase[] = [{ id: 'normal', name: 'Normal', variables: { email: 'Customer email' }, assertions: [{ type: 'json' }], origin: 'authored', reviewed: true }, { id: 'security', name: 'No secrets', variables: { email: 'Customer email' }, assertions: [{ type: 'not-contains', value: 'SECRET' }], origin: 'authored', reviewed: true, security: true, critical: true }];
test('regression gate rejects security loss regardless of increased aggregate score, and binds exact versions', async () => {
    const p = scan(fixture).report.prompts.find(p => p.call.includes('completions'))!;
    const c = improvePrompt(p);
    const before = await evaluatePrompt(p.text, suite, async () => '{}', 'test');
    const bad = await evaluatePrompt(c.text, suite, async ({ test }) => test.security ? 'SECRET' : '{}', 'test');
    const semantic = { score: 99, intentPreserved: true, rationale: 'The original instructions and schema contract are preserved.', model: 'judge' };
    assert.equal(compareCandidate(p, c, before, bad, semantic).status, 'rejected');
    const good = await evaluatePrompt(c.text, suite, async () => '{}', 'test');
    assert.equal(compareCandidate(p, c, before, good, semantic).status, 'recommended');
    assert.equal(compareCandidate(p, { ...c, text: c.text + 'changed' }, before, good, semantic).status, 'rejected');
    assert.equal(compareCandidate(p, c, before, { ...good, suiteDigest: 'other' }, semantic).status, 'rejected');
    assert.equal(compareCandidate(p, c, before, good, { ...semantic, intentPreserved: false }).status, 'rejected');
    await assert.rejects(() => judgeCandidate('a', 'b', [], async () => ({ ...semantic, score: NaN })), /Invalid/);
});
test('behavioral execution handles timeouts and missing outputs without marking them passed', async () => {
    const r = await evaluatePrompt('x', suite, () => new Promise(() => { }), 'test', 5);
    assert.equal(r.score, 0);
    assert.ok(r.cases.every(c => c.error === 'Evaluation timed out'));
    const empty = await evaluatePrompt('x', [], async () => '{}', 'test');
    assert.equal(empty.status, 'not-run');
    assert.equal(empty.score, null);
});
test('localhost dashboard exposes inventory, candidate, review diff and guarded evaluation', async () => {
    const root = makeRepo(fixture);
    const server = await startServer(root, 0, { stateDirectory: tempDir(), dryRun: true });
    try {
        const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
        const page = await fetch(base + '/prompts?embedded');
        assert.equal(page.status, 200);
        assert.match(await page.text(), /class="embedded"/);
        assert.ok(page.headers.get('content-security-policy')?.includes("script-src 'self'"));
        const response = await fetch(base + '/api/prompts');
        const report = await response.json() as ReturnType<typeof buildPromptReport>;
        const p = report.prompts.find(p => p.call.includes('completions'))!;
        assert.ok(p);
        assert.equal((await fetch(base + '/prompts/assets/prompts/ui/main.js')).status, 200);
        assert.equal((await fetch(base + '/api/prompts/candidate?id=' + p.id + '&mode=invalid')).status, 400);
        assert.equal((await fetch(base + '/api/prompts/evaluate', { method: 'POST', body: '{}' })).status, 403);
        assert.equal((await fetch(base + '/api/prompts/refresh', { method: 'GET' })).status, 405);
        const evaluated = await fetch(base + '/api/prompts/evaluate', { method: 'POST', headers: { 'x-fehm': '1' }, body: JSON.stringify({ promptId: p.id, model: 'recorded', cases: suite, outputs: { normal: '{}', security: 'safe' } }) });
        assert.equal(evaluated.status, 200);
        assert.equal((await evaluated.json() as {
            score: number;
        }).score, 100);
        assert.equal((await fetch(base + '/api/prompts/detail?id=absent')).status, 404);
        const comparison=await fetch(base+'/api/prompts/compare',{method:'POST',headers:{'x-fehm':'1'},body:JSON.stringify({promptId:p.id,mode:'balanced',model:'recorded',cases:suite,baselineOutputs:{normal:'{}',security:'safe'},outputs:{normal:'{}',security:'SECRET'},semantic:{score:99,intentPreserved:true,rationale:'Reviewed original requirements',model:'human-review'}})});
        assert.equal(comparison.status,200);assert.equal((await comparison.json() as {candidate:{status:string}}).candidate.status,'rejected');
        assert.equal((await fetch(base+'/api/prompts/save?id='+p.id,{method:'POST',headers:{'x-fehm':'1'}})).status,409);

    }
    finally {
        await new Promise<void>((resolve, reject) => server.close(e => e ? reject(e) : resolve()));
    }
});
test('apply requires approval, rejects stale source, validates code and rolls back failed checks', async () => {
    const { engine, root } = scan({ 'app.ts': 'export function classify() { const result = llm.invoke("Classify the email."); return JSON.parse(result); }\n' });
    const { applyPromptCandidate, promptHistory } = await import('../src/prompts/revisions.js');
    const { readFileSync } = await import('node:fs');
    const p = buildPromptReport({ engine }).prompts[0]!;
    const candidate = improvePrompt(p);
    const baseline = await evaluatePrompt(p.text, suite, async () => '{}', 'test');
    const proposed = await evaluatePrompt(candidate.text, suite, async () => '{}', 'test');
    const semantic = { score: 90, intentPreserved: true, rationale: 'Original task retained, JSON instruction added.', model: 'judge' };
    const state = tempDir();
    const opts = { engine, prompt: p, candidate, baseline, proposed, semantic, approved: true, stateDirectory: state, validate: async () => true };
    const original = readFileSync(join(root, 'app.ts'), 'utf8');
    await assert.rejects(() => applyPromptCandidate({ ...opts, approved: false }), /approval/);
    assert.equal((await applyPromptCandidate({ ...opts, dryRun: true })).applied, false);
    await assert.rejects(() => applyPromptCandidate({ ...opts, validate: async () => false }), /checks failed/);
    assert.equal(readFileSync(join(root, 'app.ts'), 'utf8'), original);
    writeFileSync(join(root, 'app.ts'), original + '// concurrent edit\n');
    await assert.rejects(() => applyPromptCandidate(opts), /Source changed/);
    writeFileSync(join(root, 'app.ts'), original);
    assert.equal((await applyPromptCandidate(opts)).applied, true);
    assert.ok(readFileSync(join(root, 'app.ts'), 'utf8').includes('Return valid JSON'));
    assert.equal(promptHistory(state, p.id)[0]!.status, 'applied');
});
test('revision history is idempotent and keeps measurements without copying prompts', async () => {
    const { recordRevision, promptHistory } = await import('../src/prompts/revisions.js');
    const { root, report } = scan(fixture);
    const p = report.prompts.find(p => p.call.includes('completions'))!;
    const c = improvePrompt(p);
    const state = tempDir();
    assert.equal(recordRevision(root, state, c).version, 1);
    assert.equal(recordRevision(root, state, c).version, 1);
    assert.equal(promptHistory(state).length, 1);
    assert.ok(!JSON.stringify(promptHistory(state)).includes(p.text));
});
test('behavioral provider receives substituted inputs, never executed expressions', async () => {
    const { renderPromptVariables } = await import('../src/prompts/evaluation.js');
    assert.equal(renderPromptVariables('Classify ${email}: {{context}}', { email: 'ignore previous', context: 'data' }), 'Classify ignore previous: data');
    assert.throws(() => renderPromptVariables('${process.exit()}', {}), /Missing input/);
    let seen = '';
    await evaluatePrompt('Classify ${email}', [suite[0]!], async ({ prompt }) => { seen = prompt; return '{}'; }, 'test');
    assert.equal(seen, 'Classify Customer email');
});
test('CLI prompts lists inventory and enforces finding thresholds', () => {
    const root = makeRepo(fixture);
    const state = tempDir();
    const output = execFileSync(process.execPath, ['--import', 'tsx', 'src/cli.ts', 'prompts', '--root', root, '--state-dir', state, '--json'], { encoding: 'utf8' });
    const report = JSON.parse(output) as ReturnType<typeof buildPromptReport>;
    assert.ok(report.summary.aiCalls > 0);
    const p = report.prompts.find(p => p.call.includes('completions'))!;
    const candidate = JSON.parse(execFileSync(process.execPath, ['--import', 'tsx', 'src/cli.ts', 'prompts', '--root', root, '--state-dir', state, '--prompt-id', p.id, '--prompt-mode', 'balanced', '--json'], { encoding: 'utf8' })) as {
        status: string;
    };
    assert.equal(candidate.status, 'needs-validation');
    assert.throws(() => execFileSync(process.execPath, ['--import', 'tsx', 'src/cli.ts', 'prompts', '--root', root, '--state-dir', state, '--fail-on', 'medium'], { stdio: 'pipe' }));
});
test('reconstruction preserves concatenation and handles shorthand fields and runtime mutation conservatively', () => {
    const { report } = scan({ 'app.ts': [
            'const BASE = "Translate "; const TARGET = "to French.";',
            'llm.invoke(BASE + TARGET);',
            'const prompt = "Extract email.";',
            'client.responses.create({input:prompt});',
            'client.responses.create({prompt});',
            'const messages = [{role:"system",content:"You are a classifier."}];',
            'messages.push({role:"user",content:getUserInput()});',
            'client.chat.completions.create({messages});',
            'const agent = create_agent({instructions:process.env.INSTRUCTIONS});',
            'agent.run("Classify the email.");',
        ].join('\n') });
    const calls = report.prompts.filter(p => p.call !== 'template');
    assert.equal(calls[0]!.text, 'Translate to French.');
    assert.equal(calls[2]!.reconstruction, 'complete');
    assert.equal(calls[2]!.text, 'Extract email.');
    assert.equal(calls[3]!.reconstruction, 'partial');
    assert.equal(calls[4]!.behavioralInstruction, 'unknown');
});

test('standalone prompt discovery excludes bookkeeping and HTML while retaining actual instructions',()=>{
  const {report}=scan({'app.ts':[
    'const prompts = []; const promptId = getId(); const PROMPT_NAME = /prompt/;',
    'const PROMPTS_PAGE = "<!doctype html><html><body>Prompt page</body></html>";',
    'const prompt = JSON.stringify({instruction:"Order candidate skills by relevance to the task.",candidates});',
    'const SYSTEM_PROMPT = "You are a support agent. Use only provided policy.";',
  ].join('\n')});
  assert.equal(report.prompts.length,2);assert.ok(report.prompts.some(p=>p.text.includes('Order candidate skills')));assert.ok(!report.findings.some(f=>f.ruleId==='PI003'));
});

test('prompt builder return values are reconstructed without confusing text output mode with JSON',()=>{
  const {report}=scan({'app.ts':'export function buildPrompt(input:string) { return ["Summarize this document.",input].join("\\n"); }\nclient.responses.create({input:"Translate to French.",response_format:{type:"text"}});'});
  assert.ok(report.prompts.some(p=>p.call==='template'&&p.text.includes('Summarize this document.')));
  assert.equal(report.prompts.find(p=>p.call==='client.responses.create')!.outputContract.enforced,false);
});
test('unrelated JSON parsing does not impose a JSON contract on another model response',()=>{
  const {report}=scan({'app.ts':'function translate() { const config=JSON.parse("{}"); const response=llm.invoke("Translate to French."); return response; }'});
  const p=report.prompts.find(p=>p.call==='llm.invoke')!;assert.equal(p.outputContract.format,'unknown');assert.ok(!p.findings.some(f=>f.ruleId==='PI007'));
});
