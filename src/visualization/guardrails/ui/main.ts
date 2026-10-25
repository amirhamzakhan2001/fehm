import type { Guardrails } from '../../../guardrails/workflow.js';
type Report = ReturnType<Guardrails['report']>;
const runs = document.querySelector<HTMLSelectElement>('#runs')!;
const status = document.querySelector<HTMLElement>('#status')!;
const container = document.querySelector<HTMLElement>('#report')!;
const download = document.querySelector<HTMLButtonElement>('#download')!;
let report: Report | undefined;
function section(title: string, value: unknown): void {
  const block = document.createElement('details'), heading = document.createElement('summary'), pre = document.createElement('pre');
  heading.textContent = title; pre.textContent = typeof value === 'string' ? value : JSON.stringify(value,null,2);
  block.append(heading,pre); container.append(block);
}
function table(title: string, headers: string[], rows: string[][]): void {
  const block = document.createElement('section'), heading = document.createElement('h2'), grid = document.createElement('table');
  heading.textContent = title;
  const head = grid.createTHead().insertRow();
  for (const label of headers) { const cell = document.createElement('th'); cell.textContent = label; cell.scope = 'col'; head.append(cell); }
  const body = grid.createTBody();
  for (const row of rows) { const tr = body.insertRow(); for (const value of row) tr.insertCell().textContent = value; }
  block.style.overflowX = 'auto'; block.append(heading,grid); container.append(block);
}
async function refresh(): Promise<void> {
  try {
    const history = await fetch('/api/guardrails').then(r => r.json()) as {id:string;task:string}[];
    const selected = runs.value; runs.replaceChildren(new Option('Select a run',''));
    for (const run of history) runs.add(new Option(run.task,run.id));
    runs.value = history.some(r => r.id === selected) ? selected : history[0]?.id ?? '';
    container.replaceChildren(); download.disabled = true; report = undefined;
    if (!runs.value) { status.textContent = 'No verification runs yet.'; return; }
    const response = await fetch(`/api/guardrails/report?id=${encodeURIComponent(runs.value)}`);
    if (!response.ok) throw new Error((await response.json() as {error:string}).error);
    report = await response.json() as Report; download.disabled = false;
    status.textContent = `${report.run.task}: ${report.readiness.replaceAll('_',' ')}`;
    section('Readiness and unresolved checks', report.reasons.length ? report.reasons : 'All configured required evidence is current.');
    table('Acceptance criteria', ['Requirement','Origin','Confirmation','Checks'], report.run.requirements.map(r => [r.text,r.origin,r.confirmed ? 'Confirmed' : 'Needs confirmation',r.checks.join(', ') || 'Unmapped']));
    table('Verification checks', ['Check','Category','Status','Duration'], report.checks.map(c => [c.id,c.category,c.status,c.evidence ? `${c.evidence.durationMs} ms` : 'Not run']));
    for (const check of report.checks) if (check.evidence) section(`${check.id} · ${check.evidence.phase} · execution output`,check.evidence.output || 'No captured output');
    section('TDD checkpoints and exceptions', {red:report.run.red,exception:report.run.exception});
    section('Security assessment', {current:report.securityCurrent,...report.run.security});
    section('Changed files and test review', {changed:report.changedFiles,review:report.testReviewPaths});
    section('Impact and suggested tests',report.impact);
    section('Git working-tree diff (bounded)',report.git);
    for (const node of report.impact.graphNodes.slice(0,12)) { const a = document.createElement('a'); a.href = node.href; a.textContent = `${node.name} · `; container.append(a); }
    section('Remediation attempts',report.run.attempts);
    table('Workflow timeline',['Time','Event','Detail'],report.run.timeline.map(e => [new Date(e.at).toLocaleString(),e.event,e.detail]));
    section('Frozen policy — edit task policy and start a new run to change',report.run.policy);
    section('Scope and limitations',report.limitations);
  } catch (error) { status.textContent = `Unable to load verification: ${String(error)}`; }
}
runs.addEventListener('change',() => void refresh());
document.querySelector('#refresh')!.addEventListener('click',() => void refresh());
download.addEventListener('click',() => {
  if (!report) return;
  const url = URL.createObjectURL(new Blob([JSON.stringify(report,null,2)],{type:'application/json'}));
  const a = document.createElement('a'); a.href = url; a.download = `fehm-verification-${report.run.id}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(url),1000);
});
void refresh();
