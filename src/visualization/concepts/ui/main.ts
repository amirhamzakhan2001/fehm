import type { ConceptCandidate, ConceptFinding, ConceptReport, DetectionGuidance } from '../../../concepts/types.js';
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, text = '', className = '') => { const e = document.createElement(tag); e.textContent = text; e.className = className; return e; };
const form = $<HTMLFormElement>('filters'), results = $('results'), detail = $('detail');
let serial = 0, detailSerial = 0, selectedId = '', page = 0;
let concepts: ConceptCandidate[] = [], report: ConceptReport | undefined;
import { conceptTier, tierNames, evidenceLabel, orderConcepts } from './ordering.js';
const params = () => new URLSearchParams([...new FormData(form).entries()].filter(([, v]) => String(v)).map(([k, v]) => [k, String(v)]));
async function api<T>(action: string, p = new URLSearchParams(), post = false): Promise<T> { const r = await fetch(`/api/concepts${action}?${p}`, post ? { method: 'POST', headers: { 'x-fehm': '1' } } : {}); const data = await r.json(); if (!r.ok)
    throw new Error(data.error ?? 'Request failed'); return data as T; }
function run(action: () => Promise<void>) { void action().catch(e => { $('status').textContent = e.message; $('status').className = 'error'; }); }
function button(text: string, action: () => Promise<void>) { const b = el('button', text); b.type = 'button'; b.onclick = () => run(action); return b; }
function link(text: string, url: string) { const a = el('a', text); a.href = url; return a; }
function disclosure(title: string, value: unknown) { const d = el('details'); d.append(el('summary', title), el('pre', JSON.stringify(value, null, 2))); return d; }
async function openConcept(id: string) {
    const token = ++detailSerial;
    selectedId = id;
    renderInventory();
    detail.replaceChildren(el('p', 'Loading concept…'));
    const p = new URLSearchParams({ id });
    const d = await api<{
        concept: ConceptCandidate;
        guidance: DetectionGuidance;
        findings?: ConceptFinding[];
        unverified?: {
            status: string;
            scope: string;
            reason: string;
        };
        neighborhood: {
            nodes: ConceptCandidate[];
            edges: unknown[];
            highlightIds?: string[];
        };
        tests?: {
            path: string;
            evidence: string;
        }[];
        components?: unknown[];
    }>(report ? '/detail' : '/knowledge', p);
    if (token !== detailSerial)
        return;
    const c = d.concept;
    detail.replaceChildren(el('h2', c.name), el('p', `${c.sectionName} · ${c.type}`, 'muted'), el('p', c.definition));
    const chips = el('div', '', 'chips');
    c.aliases.forEach(a => chips.append(el('span', a, 'chip')));
    detail.append(chips);
    if (d.unverified)
        detail.append(el('p', `${d.unverified.status} · ${d.unverified.scope}: ${d.unverified.reason}`, 'warning'));
    {
        const actions = el('div', '', 'actions');
        if (d.findings?.some(f => f.evidence.some(e => e.nodeId))) actions.append(link('Highlight in code graph', `/graph#concept=${encodeURIComponent(id)}`));
        actions.append(button('Related Git changes', async () => { const history = await api<unknown>('/history', p); if (token === detailSerial)
            detail.append(disclosure('File change history · association only', history)); }));
        actions.append(button('Export selected context', async () => { const data = await api<{
            serialized: string;
            bytes: number;
            tokens: number | null;
        }>('/context', new URLSearchParams({ q: c.name })); const blob = new Blob([data.serialized], { type: 'application/json' }), url = URL.createObjectURL(blob), a = link('download', url); a.download = 'fehm-concept-context.json'; a.click(); URL.revokeObjectURL(url); $('status').textContent = `Exported ${data.bytes} bytes · token count ${data.tokens ?? 'unavailable'}`; }));
        detail.append(actions, el('h3', 'Repository evidence'));
        if (!d.findings?.length)
            detail.append(el('p', report ? 'No supported evidence in the current indexed scope. This definition is reference knowledge only.' : 'Repository analysis is unavailable. This definition does not establish use in the project.'));
        for (const f of (d.findings ?? [])) {
            const box = el('article', '', 'evidence');
            box.append(el('strong', f.status.replaceAll('_', ' ')), el('span', ` · ${f.scope}`, 'chip'), el('p', f.rationale));
            for (const e of f.evidence) {
                const row = el('div', '', 'actions');
                row.append(button(`${e.path}:${e.line}`, async () => { const source = await api<{
                    start: number;
                    lines: string[];
                }>('/source', new URLSearchParams({ path: e.path, line: String(e.line) })); if (token === detailSerial)
                    box.append(el('pre', source.lines.map((s, i) => `${source.start + i}  ${s}`).join('\n'))); }));
                if (e.nodeId)
                    row.append(link('Function / callers / callees', `/graph#node=${encodeURIComponent(e.nodeId)}`));
                box.append(row, el('p', `${e.method} · ${e.provenance}`, 'muted'));
            }
            box.append(el('p', f.limitations.join(' '), 'muted'));
            detail.append(box);
        }
        detail.append(disclosure('Static test references', d.tests ?? []), disclosure('Architecture components', d.components ?? []), disclosure('Concept-to-code overlay evidence', d.neighborhood));
    }
    const related = el('div', '', 'flow');
    const ids = [...(c.parent ? [c.parent] : []), ...c.related].slice(0, 20);
    detail.append(el('h3', 'Related concepts · no implication'));
    for (const relatedId of ids)
        related.append(button(concepts.find(c => c.id === relatedId)?.name ?? relatedId, () => openConcept(relatedId)));
    detail.append(related, disclosure('Detection guidance and anti-signals', d.guidance), el('p', `Stable ID: ${c.id}`, 'muted'));
    const u = new URL(location.href);
    u.searchParams.set('id', id);
    history.replaceState(null, '', u);
    if (matchMedia('(max-width:850px)').matches) detail.scrollIntoView({block:'start'});
    detail.focus({preventScroll:true});
}

function renderInventory() {
    const p = params(), q = (p.get('q') ?? '').trim().toLowerCase();
    const findings = (report?.findings ?? []).filter(f =>
        (!p.get('status') || f.status === p.get('status')) &&
        (!p.get('scope') || f.scope === p.get('scope')) &&
        (!p.get('path') || f.evidence.some(e => e.path.includes(p.get('path')!))));
    const grouped = new Map<string, ConceptFinding[]>();
    for (const f of findings) grouped.set(f.concept_id, [...(grouped.get(f.concept_id) ?? []), f]);
    const filtered = concepts.filter(c =>
        (!p.get('section') || c.section === p.get('section')) &&
        (!p.get('tier') || conceptTier(c) === Number(p.get('tier'))) &&
        ((p.get('view') === 'all' && !p.get('status') && !p.get('scope') && !p.get('path')) || grouped.has(c.id)) &&
        (!q || [c.name,c.definition,...c.aliases,...(grouped.get(c.id) ?? []).flatMap(f => f.evidence.map(e => e.path))].some(s => s.toLowerCase().includes(q))));
    const ordered = orderConcepts(filtered, findings, q), size = 30;
    page = Math.min(page, Math.max(0, Math.ceil(ordered.length / size)-1));
    results.replaceChildren();
    let tier = -1;
    for (const c of ordered.slice(page*size,(page+1)*size)) {
        const current = conceptTier(c);
        if (tier !== current) { results.append(el('h2',tierNames[current], 'tier')); tier = current; }
        const fs = grouped.get(c.id) ?? [], row = el('article', '', 'card');
        const select = button(c.name, () => openConcept(c.id));
        select.setAttribute('aria-pressed',String(selectedId === c.id));
        row.append(select, el('p', c.definition), el('p', evidenceLabel(fs) + ' · ' + c.sectionName, 'muted'));
        results.append(row);
    }
    if (!ordered.length) results.append(el('p','No matching concepts. Choose All concepts to explore definitions, or broaden your filters.'));
    const pager = el('div','','pager');
    const previous = button('Previous',async()=>{page--;renderInventory();});
    const more = button('Next',async()=>{page++;renderInventory();});
    previous.disabled = page === 0; more.disabled = (page+1)*size >= ordered.length;
    pager.append(previous,el('span',ordered.length ? `${page*size+1}–${Math.min((page+1)*size,ordered.length)} of ${ordered.length}` : '0 results'),more);
    results.append(pager);
}
async function load(refresh = false) {
    const token = ++serial;
    $('status').textContent = 'Analyzing repository evidence…';
    $('status').className = '';
    try {
        const d = await api<ConceptReport>(refresh ? '/refresh' : '/report', new URLSearchParams(), refresh);
        if (token !== serial) return;
        report = d;
        $('coverage').textContent = `${new Set(d.findings.map(f=>f.concept_id)).size} concepts with repository signals · ${concepts.length} definitions · ${d.coverage.files} indexed files. Static evidence does not verify runtime behavior.`;
        renderInventory();
        results.append(disclosure('Analysis limitations',d.coverage.limitations));
        $('status').textContent = 'Ready · local and offline';
        if (selectedId) await openConcept(selectedId);
    } catch(e) {
        if (token !== serial) return;
        $('status').textContent = 'Repository analysis unavailable. Definitions remain accessible. ' + (e as Error).message;
        $('status').className = 'error';
        (form.elements.namedItem('view') as HTMLSelectElement).value = 'all';
        renderInventory();
    }
}
form.onsubmit = e => { e.preventDefault(); page=0;renderInventory(); };
form.onchange = () => {page=0;renderInventory();};
let debounce: ReturnType<typeof setTimeout>;
form.oninput = e => {if (!(e.target instanceof HTMLInputElement)) return; clearTimeout(debounce);debounce=setTimeout(()=>{page=0;renderInventory();},150);};
document.getElementById('refresh')?.addEventListener('click', () => run(() => load(true)));
run(async () => {
    const data = await api<{concepts:ConceptCandidate[]}>('/inventory');
    concepts = data.concepts;
    const sections = form.elements.namedItem('section') as HTMLSelectElement;
    [...new Map(concepts.map(c=>[c.section,c.sectionName])).entries()].sort((a,b)=>a[1].localeCompare(b[1])).forEach(([id,name])=>sections.append(new Option(name,id)));
    const incoming = new URLSearchParams(location.search);
    if (location.pathname.startsWith('/ontology')) (form.elements.namedItem('view') as HTMLSelectElement).value = 'all';
    if (incoming.has('path')) (form.elements.namedItem('path') as HTMLInputElement).value = incoming.get('path')!;
    renderInventory();
    await load();
    if (incoming.get('id')) await openConcept(incoming.get('id')!);
});
