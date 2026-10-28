import { changeSummary } from '../../shared/ui/assessment.js';
import type { MemorySnapshot, compareMemorySnapshots } from '../../../git-memory/snapshots.js';
import type { FileChange, GitMemoryReport, MemoryCommit, MemoryEvent } from '../../../git-memory/types.js';
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, text = '', className = '') => { const e = document.createElement(tag); e.textContent = text; e.className = className; return e; };
const results = $('results'), detail = $('detail'), form = $<HTMLFormElement>('filters');
let report: GitMemoryReport | undefined, tab = 'timeline', serial = 0, selectionSerial = 0, loadSerial = 0;
function graphLink(name: string, id: string) { const a = el('a', name); a.href = `/graph#node=${encodeURIComponent(id)}`; return a; }
function params() { return new URLSearchParams([...new FormData(form).entries()].filter(([, v]) => typeof v === 'string' && v.length).map(([k,v]) => [k, String(v)])); }
async function api<T>(action: string, p = params(), post = false): Promise<T> {
  const response = await fetch(`/api/git-memory${action}?${p}`, post ? { method: 'POST', headers: { 'x-fehm': '1' } } : {});
  if (!response.ok) { const data = await response.json() as { error: string }; throw new Error(data.error); }
  return response.json() as Promise<T>;
}
function run(fn: () => Promise<void>) { void fn().catch(e => { $('status').textContent = e.message; $('status').className = 'error'; }); }
function button(text: string, action: () => Promise<void>) { const b = el('button', text); b.type = 'button'; b.onclick = () => { b.disabled = true; b.setAttribute('aria-busy', 'true'); run(async () => { try { await action(); } finally { b.disabled = false; b.removeAttribute('aria-busy'); } }); }; return b; }
function json(value: unknown) { return el('pre', JSON.stringify(value, null, 2)); }
function events(items: MemoryEvent[]) {
  const box = el('div');
  for (const e of items) {
    const row = el('div', '', 'panel'); row.append(el('strong', `${e.type} · ${e.entity}`), el('p', `${e.path} · ${e.provenance} evidence`), el('p', e.evidence, 'muted'));
    if (e.before !== null || e.after !== null) row.append(el('pre', `${e.before ?? 'absent'} → ${e.after ?? 'absent'}`));
    box.append(row);
  }
  return box;
}
function snapshotView(s: MemorySnapshot) {
  const box = el('section'); box.append(el('h2', `Snapshot · ${s.commit.slice(0, 12)}`), el('p', `${s.at} · analyzed ${s.analyzedAt}`, 'muted'));
  const stats = el('div', '', 'stats');
  for (const [key, value] of Object.entries(s.metrics)) { const card = el('div', '', 'stat'); card.append(el('strong', value === null ? '—' : String(value)), el('span', key.replace(/([A-Z])/g, ' $1').toLowerCase())); stats.append(card); }
  box.append(stats, el('p', `${s.coverage.indexed} files indexed from ${s.coverage.materialized} materialized files · ${s.coverage.skipped.length} skipped`, 'muted'));
  box.append(el('h3', 'Architecture at this revision'));
  for (const n of s.architecture.filter(n => !['file', 'function', 'method'].includes(n.type)).slice(0, 40)) box.append(el('p', `${n.name} · ${n.type} · ${n.files.length} files`));
  box.append(el('h3', 'Prompt static scores'));
  for (const p of s.prompts) box.append(el('p', `${p.staticScore} · ${p.name} · ${p.path}:${p.line}`));
  if (!s.prompts.length) box.append(el('p', 'No prompts detected.'));
  for (const [name, findings] of [['Security', s.security], ['Architecture drift', s.drift], ['Health', s.health]] as const) {
    const section = el('details'); section.append(el('summary', `${name} · ${findings.length} findings`));
    findings.slice(0, 100).forEach(f => section.append(el('p', f.title))); box.append(section);
  }
  box.append(el('p', s.unknowns.slice(0, 5).join(' '), 'muted'));
  const evidence = el('details'); evidence.append(el('summary', 'Full snapshot evidence and relationships'), json(s)); box.append(evidence);
  return box;
}
function comparisonView(data: ReturnType<typeof compareMemorySnapshots>) {
  const box = el('section'); box.append(el('h2', 'Observed analyzer changes'), el('p', `${data.before.slice(0, 12)} → ${data.after.slice(0, 12)}`), el('p', data.caveat, 'muted'));
  for (const key of ['architecture', 'relationships', 'security', 'drift', 'health'] as const) {
    const d = data[key]; const group = el('details');
    group.append(el('summary', `${key} · ${d.appeared.length} appeared / ${d.noLongerDetected.length} no longer detected / ${d.modified.length} modified`), json(d)); box.append(group);
  }
  box.append(el('h3', 'Prompt static score changes'));
  for (const p of data.prompts) box.append(el('p', `${p.name}: ${p.before} → ${p.after}${p.staticRegression ? ' · static regression signal' : ''} · ${p.path}`));
  if (!data.prompts.length) box.append(el('p', 'No unambiguously matched changed prompts.'));
  const table = el('table'); const header = el('tr'); ['Metric', 'Before', 'After'].forEach(t => header.append(el('th', t))); table.append(header);
  for (const [key, value] of Object.entries(data.metrics)) { const row = el('tr'); [key, value.before ?? 'unknown', value.after ?? 'unknown'].forEach(v => row.append(el('td', String(v)))); table.append(row); }
  const scroll = el('div', '', 'scroll'); scroll.append(table); box.append(scroll);
  return box;
}
async function showCommit(c: MemoryCommit) {
  const selection = ++selectionSerial;
  const current = () => selection === selectionSerial;
  document.querySelectorAll<HTMLElement>('[data-commit]').forEach(e => e.setAttribute('aria-current', String(e.dataset.commit === c.id)));
  detail.dataset.commit = c.id;
  detail.replaceChildren(el('h2', c.message.split('\n')[0] ?? 'Commit'), el('p', `${c.id}\n${c.author} · ${c.at}`), el('p', changeSummary(c)), el('h3', 'Author’s stated intent'), el('pre', c.message), el('p', 'This is the recorded message, not an independently verified explanation of why the change was needed.', 'muted'), el('h3', 'Parent relationships'));
  for (const parent of c.parents) {
    const cached = report?.commits.find(x => x.id === parent);
    detail.append(cached ? button(`← ${parent.slice(0, 12)}`, () => showCommit(cached)) : el('p', `${parent.slice(0, 12)} · outside indexed window`));
  }
  if (!c.parents.length) detail.append(el('p', 'Root commit'));
  if (c.revertOf) detail.append(el('p', `Message declares revert of ${c.revertOf}`));
  for (const w of c.warnings) detail.append(el('p', w, 'warning'));
  const actions = el('div', '', 'toolbar');
  actions.append(button('Raw diff', async () => {
    const p = new URLSearchParams({ commit: c.id });
    const r = await fetch(`/api/git-memory/diff?${p}`); if (!r.ok) throw new Error('Diff unavailable');
    const text = await r.text(); if (!current()) return;
    detail.append(el('h3', 'Raw Git diff'), el('pre', text));
  }));
  actions.append(button('Analyze this revision', async () => {
    $('status').textContent = 'Analyzing committed state…';
    const snapshot = await api<MemorySnapshot>('/snapshot', new URLSearchParams({ ref: c.id }), true);
    if (!current()) return;
    detail.replaceChildren(button('Back to commit', () => showCommit(c)), snapshotView(snapshot)); $('status').textContent = 'Snapshot ready';
  }), button('Current graph references', async () => {
    const p = params(); p.set('id', c.id);
    const data = await api<{ currentGraphImpact: { nodes: {id: string; name: string; path: string}[]; dependents: string[]; interpretation: string } }>('/commit', p);
    if (!current()) return;
    const impact = data.currentGraphImpact;
    detail.append(el('h3', 'Affected code in the current checkout'), el('p', impact.interpretation, 'muted'));
    for (const n of impact.nodes) { const row = el('p'); row.append(graphLink(`${n.name} · ${n.path}`, n.id)); detail.append(row); }
    if (!impact.nodes.length) detail.append(el('p', 'No matching nodes in the current index; files may have moved or been deleted.'));
    detail.append(el('h3', 'Current dependents'));
    for (const id of impact.dependents) { const row = el('p'); row.append(graphLink(id, id)); detail.append(row); }
  }));
  detail.append(actions, el('h3', `${c.files.length} changed files`));
  for (const f of c.files) detail.append(button(`${f.status} ${f.oldPath ? `${f.oldPath} → ` : ''}${f.path}  +${f.additions ?? '?'}/−${f.deletions ?? '?'}`, async () => {
    const fileSelection = ++selectionSerial;
    const current = () => fileSelection === selectionSerial;
    const p = params(); p.set('path', f.path);
    const data = await api<{ commits: MemoryCommit[]; lineage: string[]; reason: string }>('/entity', p);
    if (!current()) return;
    detail.replaceChildren(button('Back to commit', () => showCommit(c)), el('h2', f.path), el('p', data.reason, 'muted'), el('p', `Lineage: ${data.lineage.join(' ← ')}`));
    for (const item of data.commits) detail.append(button(`${item.id.slice(0, 8)} ${item.message.split('\n')[0]}`, () => showCommit(item)));
    detail.append(button('Blame first 50 lines', async () => {
      const q = new URLSearchParams({ ref: c.id, path: f.path });
      const r = await fetch(`/api/git-memory/blame?${q}`); if (!r.ok) throw new Error('Blame unavailable for this file/range');
      const text = await r.text(); if (current()) detail.append(el('pre', text));
    }));
  }));
  const technical = el('details'); technical.append(el('summary', 'Inspect detected changes and their evidence'), el('p', 'Path-based categories are hints. They do not prove a security fix or architectural change.', 'muted'), events(c.events)); detail.append(technical);
}
async function timeline() {
  const token = ++serial;
  const data = await api<{ commits: MemoryCommit[] }>('/search');
  if (token !== serial) return;
  results.replaceChildren(el('h2', 'Change timeline'), el('p', `${data.commits.length} matching commits. Open a change to inspect its stated intent, affected files and actual diff. Categories are analysis hints, not verified milestones.`, 'muted'));
  if (!data.commits.length) results.append(el('p', 'No commits match these filters.'));
  for (const c of data.commits) {
    const row = el('article', '', 'event'); row.dataset.commit = c.id;
    row.append(el('p', `${c.at.slice(0, 10)} · ${c.author}`, 'muted'), button(c.message.split('\n')[0] || '(no commit message)', () => showCommit(c)), el('p', changeSummary(c)));
    const chips = el('div', '', 'chips');
    c.classifications.forEach(k => chips.append(el('span', k, 'chip'))); row.append(chips); results.append(row);
  }
}
function activity() {
  results.replaceChildren(el('h2', 'Change concentration'), el('p', 'Counts describe the selected revision’s indexed window. Activity is not a quality or developer score.', 'muted'));
  const table = el('table'); const head = el('tr'); ['File', 'Changes', 'Churn', 'Tests changed alongside'].forEach(s => head.append(el('th', s))); table.append(head);
  for (const c of report?.churn.slice(0, 40) ?? []) { const row = el('tr'); [c.path, String(c.changes), `+${c.additions}/−${c.deletions}`, String(c.testsTogether)].forEach(s => row.append(el('td', s))); table.append(row); }
  const scroll = el('div', '', 'scroll'); scroll.append(table); results.append(scroll, el('h2', 'Monthly category groups'));
  for (const c of report?.clusters ?? []) results.append(el('p', `${c.month} · ${c.category} · ${c.commits.length} commits / ${c.events} events`));
}
function comparison() {
  results.replaceChildren(el('h2', 'Compare committed states'), el('p', 'Choose two commits, branches or tags. Snapshot comparison runs FEHM’s static analyzers on both revisions.', 'muted'));
  const controls = el('div', '', 'toolbar'), from = el('input'), to = el('input'); from.value = 'HEAD~1'; to.value = params().get('ref') ?? 'HEAD';
  const a = el('label', 'Before revision'), b = el('label', 'After revision'); a.append(from); b.append(to);
  controls.append(a, b);
  for (const [title, action, post] of [['Compare changes','/compare',false], ['Compare analyzer snapshots','/snapshot-compare',true]] as const) controls.append(button(title, async () => {
    const selection = ++selectionSerial;
    $('status').textContent = post ? 'Analyzing both revisions…' : 'Comparing…';
    const data = await api<unknown>(action, new URLSearchParams({ from: from.value, to: to.value }), post);
    if (selection !== selectionSerial) return;
    const readable = el('div');
    if (!post) { const changes = data as {files: FileChange[]; interpretation: string}; readable.append(el('p', `${changes.files.length} file${changes.files.length === 1 ? '' : 's'} differ between the selected revisions.`), el('p', changes.interpretation, 'muted')); for (const f of changes.files) readable.append(el('p', `${f.status} ${f.oldPath ? f.oldPath + ' → ' : ''}${f.path} (+${f.additions ?? '?'}/−${f.deletions ?? '?'})`)); const evidence = el('details'); evidence.append(el('summary', 'Full comparison evidence'), json(data)); readable.append(evidence); }
    detail.replaceChildren(el('h2', title), post ? comparisonView(data as ReturnType<typeof compareMemorySnapshots>) : readable); $('status').textContent = 'Comparison ready';
  }));
  results.append(controls);
}
async function render() {
  document.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.tab === tab)));
  const link = $<HTMLAnchorElement>('export'); link.href = `/api/git-memory/context?${params()}`;
  if (tab === 'timeline') await timeline();
  else if (tab === 'activity') activity();
  else if (tab === 'compare') comparison();
  else { const token = ++serial; const observations = await api<unknown>('/observations'); if (token !== serial) return; results.replaceChildren(el('h2', 'Recorded measurements'), el('p', 'Observations retain their dirty-state and candidate status. They are separate from reconstructed committed snapshots.', 'muted'), json(observations)); }
}
async function load() {
  $('status').textContent = 'Indexing local history…'; $('status').className = '';
  const token = ++loadSerial;
  const next = await api<GitMemoryReport>('/report');
  if (token !== loadSerial) return;
  report = next;
  selectionSerial++;
  detail.replaceChildren(el('h2', 'Choose a change'), el('p', 'Select a timeline entry to inspect its evidence.'));
  const select = form.elements.namedItem('ref') as HTMLSelectElement;
  const value = select.value;
  select.replaceChildren(new Option('HEAD', 'HEAD'), ...report.refs.map(r => new Option(r.name.replace(/^refs\/(heads|tags|remotes)\//, ''), r.name)));
  select.value = value; if (!select.value) select.value = 'HEAD';
  const summary = $('summary'), stats = el('div', '', 'stats'); summary.replaceChildren();
  for (const [n, label] of [[report.totalCommits, 'Reachable commits'], [new Set(report.commits.map(c => c.email)).size, 'Contributors in window'], [report.refs.filter(r => r.name.startsWith('refs/heads/')).length, 'Local branches'], [report.commits.reduce((n,c) => n+c.events.length,0), 'Indexed events']] as const) { const card = el('div', '', 'stat'); card.append(el('strong', String(n)), el('span', label)); stats.append(card); }
  const counts = el('details'); counts.append(el('summary', 'History scope and counts'), stats);
  summary.append(el('h2', report.available ? 'What changed in this project?' : 'No repository history is available'), el('p', report.commits.length ? `The indexed window contains ${report.commits.length} commits. ${report.churn[0] && report.churn[0].changes > 1 ? `${report.churn[0].path} changed ${report.churn[0].changes} times in this window.` : `Latest recorded change: ${report.commits[0]!.message.split('\n')[0]}.`} Commit messages provide stated intent; undocumented motivations remain unknown.` : 'There are no commits in this window. Check the selected revision or create a commit to start a history.'), counts, el('p', `${report.branch ?? 'Detached / no branch'} · ${report.coverage.indexed} commits indexed · ${report.coverage.reused} reused${report.dirty ? ' · Working tree has uncommitted changes; history shows committed state' : ''}`, 'muted'));
  report.coverage.warnings.forEach(w => summary.append(el('p', w, 'warning')));
  $('status').textContent = report.available ? 'Local history ready' : 'No Git repository'; await render();
}
form.onsubmit = e => { e.preventDefault(); run(load); };
$('refresh').onclick = () => run(load);
document.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach(b => { b.onclick = () => { tab = b.dataset.tab!; serial++; selectionSerial++; run(render); }; });
const incoming = new URLSearchParams(location.search);
for (const key of ['path','query','category']) if (incoming.has(key)) (form.elements.namedItem(key) as HTMLInputElement).value = incoming.get(key)!;
run(load);
