import { h } from '../../graph/ui/dom.js';
import type { PromptCandidate, PromptRecord, PromptReport } from '../../../prompts/types.js';
const content = document.getElementById('content')!;
const status = document.getElementById('status')!;
let report: PromptReport;
let selected: string | null = null;
let query = '';
let filter = 'all';
async function api<T>(url: string, body?: unknown): Promise<T> { const response = await fetch(url, body === undefined ? {} : { method: 'POST', headers: { 'x-fehm': '1', 'content-type': 'application/json' }, body: JSON.stringify(body) }); const data = await response.json() as T & {
    error?: string;
}; if (!response.ok)
    throw new Error(data.error ?? `Request failed (${response.status})`); return data; }
const pre = (text: string): HTMLElement => h('pre', {}, text);
const muted = (text: string): HTMLElement => h('p', { class: 'muted' }, text);
function download(name: string, text: string): void { const url = URL.createObjectURL(new Blob([text], { type: 'application/json' })); const a = h('a', { href: url, download: name }); a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
function findings(p: PromptRecord): HTMLElement { return h('div', {}, ...p.findings.map(f => h('div', { class: 'finding ' + f.severity }, h('strong', {}, `${f.ruleId} · ${f.title}`), muted(`${f.severity} · ${Math.round(f.detectionConfidence * 100)}% detection confidence · ${f.file}:${f.line}`), h('p', {}, f.message), h('p', {}, f.action), ...f.evidence.map(e => h('code', {}, `${e.path ?? ''}:${e.line ?? ''} ${e.detail}`))))); }
function draw(): void {
    const s = report.summary;
    const stats = [['AI calls', s.aiCalls], ['Prompts', s.prompts], ['Static score', s.averageScore ?? '—'], ['Missing instructions', s.missingInstructions], ['Unknown instructions', s.unknownInstructions], ['High / critical findings', s.critical]];
    content.replaceChildren(h('div', {}, h('h1', {}, 'Prompt intelligence'), muted(`${report.repository} · Code-aware analysis · No model calls during scanning`)), h('div', { class: 'stats' }, ...stats.map(([label, value]) => h('div', { class: 'card stat' }, h('strong', {}, String(value)), String(label)))));
    const search = h('input', { type: 'search', placeholder: 'Search prompt, file or model', 'aria-label': 'Search prompts' });
    search.value = query;
    const select = h('select', { 'aria-label': 'Filter prompts' }, ...['all', 'system', 'developer', 'user', 'agent', 'rag', 'extraction', 'classification', 'generation', 'low score', 'missing instructions', 'security', 'token heavy'].map(v => h('option', { value: v }, v)));
    select.value = filter;
    const inventory = h('section', { class: 'card detail' }, h('h2', {}, 'Prompt inventory'), h('div', { class: 'toolbar' }, search, select));
    const rows = h('div', { class: 'scroll' });
    const renderRows = (): void => {
        const ps = report.prompts.filter(p => (`${p.id} ${p.name} ${p.path} ${p.model ?? ''} ${p.text}`).toLowerCase().includes(query.toLowerCase()) && (filter === 'all' || filter === p.kind || p.fragments.some(f => f.role === filter) || filter === 'low score' && p.score.static < 70 || filter === 'missing instructions' && p.behavioralInstruction === 'not-detected' || filter === 'security' && p.findings.some(f => f.category === 'security') || filter === 'token heavy' && p.tokens.static > 2000));
        rows.replaceChildren(ps.length ? h('table', {}, h('thead', {}, h('tr', {}, ...['Prompt', 'Type / role', 'Location', 'Model', 'Static score', 'Findings'].map(t => h('th', {}, t)))), h('tbody', {}, ...ps.map(p => h('tr', {}, h('td', {}, h('button', { onclick: () => { selected = p.id; draw(); document.getElementById('detail')?.scrollIntoView({ behavior: 'smooth' }); } }, p.name), h('div', { class: 'muted' }, p.id)), h('td', {}, p.kind, h('div', { class: 'muted' }, [...new Set(p.fragments.map(f => f.role))].join(', '))), h('td', {}, `${p.path}:${p.line}`), h('td', {}, p.model ?? 'Unresolved'), h('td', {}, `${p.score.static} / 100`), h('td', {}, String(p.findings.length)))))) : muted(report.prompts.length ? 'No prompts match these filters.' : 'No prompts detected in supported indexed files. Check the coverage limitations below.'));
    };
    search.addEventListener('input', () => { query = search.value; renderRows(); });
    select.addEventListener('change', () => { filter = select.value; renderRows(); });
    renderRows();
    inventory.append(rows);
    content.append(inventory);
    if (selected) {
        const p = report.prompts.find(p => p.id === selected);
        if (p)
            content.append(detail(p));
    }
    const missing = report.prompts.filter(p => p.call !== 'template' && p.behavioralInstruction !== 'present');
    content.append(h('section', { class: 'card detail' }, h('h2', {}, 'Behavioral instruction coverage'), muted(`${s.behavioralInstructions} prompts include resolved behavioral instructions. ${s.missingInstructions} calls have none detected; ${s.unknownInstructions} remain unresolved.`), ...missing.map(p => h('p', {}, h('button', { onclick: () => { selected = p.id; draw(); } }, p.name), ` · ${p.kind} · ${p.behavioralInstruction} · ${p.path}:${p.line}`))));
    content.append(h('details', { class: 'card detail' }, h('summary', {}, 'Coverage and limitations'), pre(JSON.stringify(report.coverage, null, 2)), ...report.unknowns.map(muted)));
}
function detail(p: PromptRecord): HTMLElement {
    const root = h('section', { class: 'card detail', id: 'detail' }, h('h2', {}, `${p.name} · ${p.id}`), muted(`${p.path}:${p.line} · ${p.reconstruction} reconstruction · ${Math.round(p.confidence * 100)}% detection confidence`));
    const panel = h('div');
    const tabs = h('div', { class: 'tabs', 'role': 'group', 'aria-label': 'Prompt detail sections' });
    const views: Record<string, () => HTMLElement> = {
        Overview: () => h('div', {}, h('div', { class: 'dimensions' }, ...p.score.dimensions.map(d => h('div', { class: 'dimension' }, h('strong', {}, `${d.name}: ${d.score ?? 'Unknown'}`), ...(d.score === null ? [] : [h('progress', { max: '100', value: String(d.score), 'aria-label': d.name })]), muted(d.reason)))), muted('Static signal score only. Semantic and behavioral scores are not measured until evaluation runs.')),
        Prompt: () => h('div', {}, ...p.fragments.map(f => h('div', {}, h('h3', {}, `${f.role.toUpperCase()} · ${f.path}:${f.line}${f.resolved ? '' : ' · unresolved'}`), pre(f.text))), muted(`~${p.tokens.static} static tokens · ~${p.tokens.stablePrefix} stable prefix tokens. Dynamic tokens and total cost are unknown.`)),
        Context: () => h('div', {}, h('h3', {}, 'Inputs'), ...p.variables.map(v => h('p', {}, h('code', {}, v.name), ` ← ${v.origin} · trust ${v.trust}`)), h('h3', {}, 'Output contract'), pre(JSON.stringify(p.outputContract, null, 2)), muted('Graph links and source expressions are evidence; runtime data flow may be unresolved.')),
        Evaluation: () => evaluation(p),
        Findings: () => findings(p),
        Optimization: () => optimization(p),
        Dependencies: () => h('div', {}, h('div', { class: 'flow' }, h('span', {}, p.variables.length ? 'Dynamic input' : 'Static input'), h('b', {}, '→'), h('span', { class: p.behavioralInstruction === 'present' ? '' : 'missing' }, `Behavior: ${p.behavioralInstruction}`), h('b', {}, '→'), h('span', {}, `${p.provider} / ${p.model ?? 'unresolved model'}`), h('b', {}, '→'), h('span', {}, `${p.outputContract.format} output`)), h('h3', {}, 'Code graph references'), ...p.dependencies.map(d => h('p', {}, h('a', { href: `/graph#node=${encodeURIComponent(d.nodeId)}` }, d.nodeId), ` · ${d.relation}`)), h('h3', {}, 'Linked tests'), ...p.testFiles.map(t => h('p', {}, t)), ...p.securityFindingIds.map(id => h('p', {}, h('a', { href: '/#/security', target: '_top' }, id))), muted('No linked test is proof of prompt behavior coverage.')),
        History: () => { const panel = h('div', {}, muted('Loading saved revisions…')); void api<unknown[]>(`/api/prompts/history?id=${encodeURIComponent(p.id)}`).then(rows => panel.replaceChildren(muted('Saved revision references, scores, tokens and source commits. Git owns the full source history.'), rows.length ? pre(JSON.stringify(rows, null, 2)) : muted('No revisions saved yet. Generate a candidate and save its revision.'))).catch(e => panel.replaceChildren(muted(String(e)))); return panel; },
    };
    for (const [name, render] of Object.entries(views)) {
        const button = h('button', { 'aria-pressed': name === 'Overview' ? 'true' : 'false', onclick: () => { for (const b of tabs.querySelectorAll('button'))
                b.setAttribute('aria-pressed', String(b === button)); panel.replaceChildren(render()); } }, name);
        tabs.append(button);
    }
    panel.append(views.Overview!());
    root.append(tabs, panel);
    return root;
}
function optimization(p: PromptRecord): HTMLElement {
    const modes = ['balanced', 'quality', 'tokens', 'reliability', 'structured-output', 'security'];
    const select = h('select', { 'aria-label': 'Optimization mode' }, ...modes.map(m => h('option', { value: m }, m)));
    const output = h('div');
    const button = h('button', { class: 'primary', onclick: () => {
            button.disabled = true;
            output.replaceChildren(muted('Generating evidence-backed candidate…'));
            void api<PromptCandidate>(`/api/prompts/candidate?id=${encodeURIComponent(p.id)}&mode=${select.value}`).then(c => {
                output.replaceChildren(h('h3', {}, `${c.status} · static score ${p.score.static} → ${c.score.static} · token change ${c.tokenDelta >= 0 ? '+' : ''}${c.tokenDelta} (estimated)`), ...c.reasons.map(muted), h('div', { class: 'split' }, h('div', {}, h('h3', {}, 'Original'), pre(p.text)), h('div', {}, h('h3', {}, 'Candidate'), pre(c.text))), ...c.changes.map(change => h('div', { class: 'finding' }, h('strong', {}, change.ruleId), h('p', {}, change.reason), pre(change.addition))), h('details', {}, h('summary', {}, 'Review logical diff'), pre(c.diff || 'No change')), h('button', { onclick: () => download(`${c.id}.json`, JSON.stringify(c, null, 2)) }, 'Export candidate'));
                output.append(h('button', { onclick: () => { void api(`/api/prompts/save?id=${encodeURIComponent(p.id)}&mode=${select.value}`, {}).then(() => { status.textContent = 'Revision saved'; }).catch(e => { status.textContent = String(e); }); } }, 'Save revision'));
                if (c.patch)
                    output.append(h('p', {}, h('a', { href: `/api/prompts/patch?id=${encodeURIComponent(p.id)}&mode=${select.value}`, download: `${c.id}.patch` }, 'Download source patch for review')));
                else
                    output.append(muted('No unambiguous single editable source span was found. Review the logical diff and update the source manually.'));
                output.append(muted('Before applying: review intent and the source diff, evaluate both versions on the same cases, then run relevant code tests. Scanning and candidate generation never rewrite source.'));
            }).catch(e => output.replaceChildren(h('p', { class: 'error' }, String(e)))).finally(() => { button.disabled = false; });
        } }, 'Generate candidate');
    return h('div', {}, h('div', { class: 'toolbar' }, select, button), output);
}
function evaluation(p: PromptRecord): HTMLElement {
    const output = h('div');
    const textarea = h('textarea', { 'aria-label': 'Evaluation JSON', 'spellcheck': 'false' });
    const select = h('select', { 'aria-label': 'Evaluate version' }, h('option', { value: '' }, 'Original'), ...['balanced', 'quality', 'tokens', 'reliability', 'structured-output', 'security'].map(m => h('option', { value: m }, `${m} candidate`)));
    const load = h('button', { onclick: () => { void api<{
            cases: unknown[];
        }>(`/api/prompts/detail?id=${encodeURIComponent(p.id)}`).then(data => { textarea.value = JSON.stringify({ model: 'recorded-model-name', cases: data.cases, outputs: {} }, null, 2); }).catch(e => output.replaceChildren(muted(String(e)))); } }, 'Generate draft cases');
    const run = h('button', { onclick: () => { try {
            const data = JSON.parse(textarea.value) as object;
            run.disabled = true;
            void api('/api/prompts/evaluate', { ...data, promptId: p.id, ...(select.value ? { mode: select.value } : {}) }).then(r => { output.replaceChildren(pre(JSON.stringify(r, null, 2)), h('button', { onclick: () => download(`${p.id}-evaluation.json`, JSON.stringify(r, null, 2)) }, 'Export evaluation')); }).catch(e => output.replaceChildren(h('p', { class: 'error' }, String(e)))).finally(() => { run.disabled = false; });
        }
        catch (e) {
            output.replaceChildren(h('p', { class: 'error' }, String(e)));
        } } }, 'Evaluate recorded outputs');
    const compare = h('button', { onclick: () => { try {
            const data = JSON.parse(textarea.value) as object;
            if (!select.value)
                throw new Error('Choose a candidate mode to compare');
            compare.disabled = true;
            void api('/api/prompts/compare', { ...data, promptId: p.id, mode: select.value }).then(r => output.replaceChildren(pre(JSON.stringify(r, null, 2)), h('button', { onclick: () => download(`${p.id}-comparison.json`, JSON.stringify(r, null, 2)) }, 'Export comparison'))).catch(e => output.replaceChildren(h('p', { class: 'error' }, String(e)))).finally(() => { compare.disabled = false; });
        }
        catch (e) {
            output.replaceChildren(h('p', { class: 'error' }, String(e)));
        } } }, 'Compare against original');
    return h('div', {}, muted('No evaluations have run in this scan. Supply recorded model outputs to check exact matches, required JSON fields, or forbidden text. These checks do not verify that the outputs came from the stated model or prompt.'), muted('Draft cases are generated templates, not production tests. Replace placeholder inputs and assertions, then set reviewed to true. For live model evaluation and semantic judging, use the library provider interfaces.'), h('div', { class: 'toolbar' }, select, load, run, compare), muted('For comparison, add baselineOutputs and a semantic review: {score: 0–100, intentPreserved: true/false, rationale: "review evidence", model: "judge model or human reviewer"}. Candidate outputs go in outputs. A higher score never overrides a regression.'), textarea, output);
}
async function load(refresh = false): Promise<void> { status.textContent = 'Scanning…'; try {
    report = await api<PromptReport>(refresh ? '/api/prompts/refresh' : '/api/prompts', refresh ? {} : undefined);
    status.textContent = 'Ready · local analysis';
    draw();
}
catch (e) {
    status.textContent = 'Scan failed';
    content.replaceChildren(h('p', { class: 'error' }, String(e)), h('button', { onclick: () => void load() }, 'Retry'));
} }
document.getElementById('refresh')!.addEventListener('click', () => void load(true));
void load();
