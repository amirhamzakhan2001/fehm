import type { ConceptCandidate, ConceptFinding, ConceptReport, DetectionGuidance } from '../../../concepts/types.js';
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, text = '', className = '') => { const e = document.createElement(tag); e.textContent = text; e.className = className; return e; };
const catalog = document.body.dataset.mode === 'catalog', form = $<HTMLFormElement>('filters'), results = $('results'), detail = $('detail');
let serial = 0, detailSerial = 0;
const params = () => new URLSearchParams([...new FormData(form).entries()].filter(([, v]) => String(v)).map(([k, v]) => [k, String(v)]));
async function api<T>(action: string, p = new URLSearchParams(), post = false): Promise<T> { const r = await fetch(`/api/concepts${action}?${p}`, post ? { method: 'POST', headers: { 'x-fehm': '1' } } : {}); const data = await r.json(); if (!r.ok)
    throw new Error(data.error ?? 'Request failed'); return data as T; }
function run(action: () => Promise<void>) { void action().catch(e => { $('status').textContent = e.message; $('status').className = 'error'; }); }
function button(text: string, action: () => Promise<void>) { const b = el('button', text); b.type = 'button'; b.onclick = () => run(action); return b; }
function link(text: string, url: string) { const a = el('a', text); a.href = url; return a; }
function disclosure(title: string, value: unknown) { const d = el('details'); d.append(el('summary', title), el('pre', JSON.stringify(value, null, 2))); return d; }
async function openConcept(id: string) {
    const token = ++detailSerial;
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
    }>(catalog ? '/knowledge' : '/detail', p);
    if (token !== detailSerial)
        return;
    const c = d.concept;
    detail.replaceChildren(el('h2', c.name), el('p', `${c.sectionName} · ${c.type}`, 'muted'), el('p', c.definition));
    const chips = el('div', '', 'chips');
    c.aliases.forEach(a => chips.append(el('span', a, 'chip')));
    detail.append(chips);
    if (d.unverified)
        detail.append(el('p', `${d.unverified.status} · ${d.unverified.scope}: ${d.unverified.reason}`, 'warning'));
    if (catalog)
        detail.append(el('p', 'Catalog knowledge only. No repository implementation is implied.', 'muted'), link('Inspect repository evidence', `/concepts?id=${encodeURIComponent(id)}`));
    else {
        const actions = el('div', '', 'actions');
        actions.append(link('Highlight in code graph', `/graph#concept=${encodeURIComponent(id)}`), link('Architecture', '/architecture'), link('Security', '/security'), link('Prompt intelligence', '/prompts'));
        actions.append(button('Related Git changes', async () => { const history = await api<unknown>('/history', p); if (token === detailSerial)
            detail.append(disclosure('File change history · association only', history)); }));
        actions.append(button('Export selected context', async () => { const data = await api<{
            serialized: string;
            bytes: number;
            tokens: number | null;
        }>('/context', new URLSearchParams({ q: c.name })); const blob = new Blob([data.serialized], { type: 'application/json' }), url = URL.createObjectURL(blob), a = link('download', url); a.download = 'fehm-concept-context.json'; a.click(); URL.revokeObjectURL(url); $('status').textContent = `Exported ${data.bytes} bytes · token count ${data.tokens ?? 'unavailable'}`; }));
        detail.append(actions, el('h3', 'Repository evidence'));
        if (!d.findings?.length)
            detail.append(el('p', 'No supported evidence in the current indexed scope.'));
        for (const f of (d.findings ?? []).slice(0, 60)) {
            const box = el('article', '', 'evidence');
            box.append(el('strong', f.status), el('span', ` · ${f.scope}`, 'chip'), el('p', f.rationale));
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
        related.append(button(relatedId, () => openConcept(relatedId)));
    detail.append(related, disclosure('Detection guidance and anti-signals', d.guidance), el('p', `Stable ID: ${c.id}`, 'muted'));
    const u = new URL(location.href);
    u.searchParams.set('id', id);
    history.replaceState(null, '', u);
}
async function load(refresh = false) {
    const token = ++serial;
    $('status').textContent = catalog ? 'Searching local catalog…' : 'Analyzing indexed evidence…';
    $('status').className = '';
    const p = params();
    p.set('limit', '60');
    results.replaceChildren();
    if (catalog) {
        const d = await api<{
            ambiguous: boolean;
            total: number;
            candidates: ConceptCandidate[];
        }>('/lookup', p);
        if (token !== serial)
            return;
        $('coverage').textContent = `${d.total} matching catalog entries${d.ambiguous ? ' · Ambiguous term: multiple reviewed meanings. Select one.' : ''}`;
        for (const c of d.candidates) {
            const card = el('article', '', 'card');
            card.append(button(c.name, () => openConcept(c.id)), el('p', `${c.sectionName} · ${c.type}`, 'muted'), el('p', c.definition));
            results.append(card);
        }
    }
    else {
        const d = await api<ConceptReport & {
            concepts: ConceptCandidate[];
            resolution: {
                ambiguous: boolean;
            } | null;
        }>(refresh ? '/refresh' : '/report', p, refresh);
        if (token !== serial)
            return;
        const grouped = new Map<string, ConceptFinding[]>();
        d.findings.forEach(f => grouped.set(f.concept_id, [...(grouped.get(f.concept_id) ?? []), f]));
        const supported = d.findings.filter(f => ['explicitly_observed', 'structurally_supported'].includes(f.status) && f.scope !== 'documented_claim');
        const values = [[d.concepts.length, 'Concept candidates'], [new Set(supported.map(f => f.concept_id)).size, 'Direct / structural evidence'], [d.findings.filter(f => ['weakly_indicated', 'contextually_inferred'].includes(f.status)).length, 'Findings needing review'], ['—', 'Runtime verification unavailable']] as const;
        $('stats').replaceChildren(...values.map(([n, label]) => { const card = el('div', '', 'stat'); card.append(el('strong', String(n)), el('span', label)); return card; }));
        $('coverage').textContent = `${d.coverage.files} indexed files · ${d.coverage.analyzed} analyzed / ${d.coverage.reused} reused · revision ${d.repositoryRevision?.slice(0, 10) ?? 'uncommitted'}${d.dirty ? ' + working tree changes' : ''}. Missing evidence is not absence.${d.resolution?.ambiguous ? ' Query is ambiguous; multiple meanings are shown.' : ''}`;
        for (const c of d.concepts.slice(0, 100)) {
            const findings = grouped.get(c.id) ?? [], card = el('article', '', 'card');
            card.append(button(c.name, () => openConcept(c.id)), el('p', `${c.sectionName} · ${c.type}`, 'muted'));
            const chips = el('div', '', 'chips');
            if (!findings.length)
                chips.append(el('span', 'not_verifiable · no supported evidence', 'chip'));
            [...new Set(findings.map(f => `${f.status} · ${f.scope}`))].forEach(s => chips.append(el('span', s, 'chip')));
            card.append(chips, el('p', `${findings.length} evidence records · ${[...new Set(findings.flatMap(f => f.evidence.map(e => e.path)))].slice(0, 2).join(', ')}`, 'muted'));
            results.append(card);
        }
        results.append(disclosure('Analysis coverage and limitations', d.coverage.limitations));
    }
    if (!results.children.length)
        results.append(el('p', 'No matches. Explore the ontology or broaden your filters.'));
    $('status').textContent = 'Ready · local and offline';
}
form.onsubmit = e => { e.preventDefault(); run(() => load()); };
document.getElementById('refresh')?.addEventListener('click', () => run(() => load(true)));
run(async () => {
    const summary = await api<{
        concepts: number;
        sections: {
            id: string;
            name: string;
        }[];
        types: string[];
        ambiguities: unknown[];
        version: string;
    }>('/catalog');
    const sections = form.elements.namedItem('section') as HTMLSelectElement;
    summary.sections.forEach(s => sections.append(new Option(s.name, s.id)));
    const types = form.elements.namedItem('type') as HTMLSelectElement;
    summary.types.forEach(t => types.append(new Option(t, t)));
    if (catalog)
        for (const [n, label] of [[summary.concepts, 'Concept entries'], [summary.sections.length, 'Domains'], [summary.ambiguities.length, 'Ambiguous terms'], [summary.version, 'Catalog version']]) {
            const card = el('div', '', 'stat');
            card.append(el('strong', String(n)), el('span', String(label)));
            $('stats').append(card);
        }
    const incoming = new URLSearchParams(location.search);
    if (incoming.has('path') && !catalog)
        (form.elements.namedItem('path') as HTMLInputElement).value = incoming.get('path')!;
    await load();
    if (incoming.get('id'))
        await openConcept(incoming.get('id')!);
});
