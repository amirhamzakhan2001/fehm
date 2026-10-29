import type { DriftFinding } from '../../../drift/types.js';
import { h } from '../../graph/ui/dom.js';
export function findingClassification(f: DriftFinding): string {
  if (f.decision) return 'Intentional / reviewed exception';
  if (f.basis === 'explicit-rule' && f.confidence === 'high') return 'Confirmed configured-rule deviation';
  if (f.category === 'security-boundary' || f.confidence === 'low') return 'Needs investigation';
  return ['critical', 'high'].includes(f.attention) ? 'Potential architectural risk' : 'Improvement opportunity';
}
export function findingDomain(f: DriftFinding): string {
  if (f.category === 'security-boundary') return 'Authentication and security boundaries';
  if (f.category === 'database') return 'Database and data access';
  if (['api','dependency-injection','responsibility','layer'].includes(f.category)) return 'Application responsibilities and layers';
  if (['testing','error-handling','observability'].includes(f.category)) return 'Testing and resilience';
  if (['configuration','external-service','monorepo'].includes(f.category)) return 'Configuration and integrations';
  if (f.category === 'ai-associated') return 'AI-associated structural signals';
  return 'Dependencies and module boundaries';
}
export function comparisonModel(f: DriftFinding) {
  const expected = f.commonChain ?? [];
  const actual = f.observedChain ?? [];
  const edges = (labels: string[]) => labels.slice(1).map((to,i) => ({from:labels[i]!, to}));
  const key = (e: {from: string; to: string}) => JSON.stringify([e.from,e.to]);
  const expectedKeys = new Set(edges(expected).map(key)), actualKeys = new Set(edges(actual).map(key));
  return { expected, actual, comparable: expected.length > 0 && actual.length > 0,
    expectedEdges: edges(expected).map(e => ({...e, different: !actualKeys.has(key(e))})),
    actualEdges: edges(actual).map(e => ({...e, different: !expectedKeys.has(key(e))})) };
}
/** Role-level sequences already supplied by the detector; never invent absent nodes. */
export function comparisonView(f: DriftFinding, inspect: () => void): HTMLElement {
  const model = comparisonModel(f);
  const root = h('section', {class:'drift-comparison', 'aria-label':'Expected and actual architecture'});
  const selection = h('div', {class:'comparison-selection', 'aria-live':'polite'}, 'Select a role or relationship to inspect its meaning. Source references belong to this finding, not to an invented component.');
  let scale = 1;
  const planes: HTMLElement[] = [];
  const choose = (label: string, explanation: string) => {
    root.querySelectorAll<HTMLElement>('[data-role]').forEach(e => e.setAttribute('aria-pressed', String(e.dataset.role === label)));
    selection.replaceChildren(h('h3', {}, label), h('p', {}, explanation), h('p', {}, f.impact), h('button', {onclick:inspect}, 'Inspect finding source and evidence'));
  };
  const side = (expected: boolean) => {
    const labels = expected ? model.expected : model.actual;
    const edges = expected ? model.expectedEdges : model.actualEdges;
    const plane = h('div', {class:'comparison-plane'}); planes.push(plane);
    if (model.comparable) labels.forEach((label,i) => {
      plane.append(h('button', {class:'comparison-node', 'data-role':label, 'aria-pressed':'false', onclick:()=>choose(label, `${label} is a role in the ${expected ? 'reference convention' : 'detected sequence'}. ${expected ? f.baseline : f.observed}`)}, label));
      const edge = edges[i];
      if (edge) plane.append(h('button', {class:`comparison-edge${edge.different ? ' differs' : ''}`, 'aria-label':`${edge.from} to ${edge.to}`, 'data-role':`${edge.from} → ${edge.to}`, 'aria-pressed':'false', onclick:()=>choose(`${edge.from} → ${edge.to}`, edge.different ? `${expected ? 'This reference relationship is not in the detected sequence' : 'This detected relationship differs from the reference sequence'}. This comparison does not prove the role is absent elsewhere.` : 'This role-level relationship appears in both sequences.')}, '↓ ', edge.different ? (expected ? 'reference path' : 'different path') : 'shared path'));
    });
    else plane.append(h('p', {}, expected ? f.baseline : f.observed), h('p', {class:'note'}, 'Comparable relationship sequences are not available for this finding; no diagram has been invented.'), h('button', {onclick:inspect}, 'Inspect evidence'));
    return h('section', {class:'comparison-side'}, h('h3', {}, expected ? 'Expected architecture' : 'Actual architecture'), h('p', {class:'note'}, expected ? 'Reference practice; not a claim that these components exist.' : 'Detected role-level relationships, scoped to this finding.'), h('div', {class:'comparison-viewport',tabindex:'0','aria-label':expected ? 'Expected architecture viewport' : 'Actual architecture viewport'}, plane));
  };
  const resize = (next: number) => {scale=Math.max(.75, Math.min(1.5,next)); planes.forEach(p=>p.style.zoom=String(scale));};
  root.append(h('header', {}, h('h2', {}, f.title), h('p', {}, findingClassification(f)), h('p', {}, f.explanation)),
    h('div', {class:'dacts'}, h('button',{onclick:()=>resize(scale+.1)},'Zoom in'),h('button',{onclick:()=>resize(scale-.1)},'Zoom out'),h('button',{onclick:()=>resize(1)},'Reset view'),h('button',{onclick:()=>{resize(1);root.querySelectorAll('.comparison-viewport').forEach(e=>e.scrollTo(0,0));}},'Fit comparison')),
    h('div',{class:'comparison-pair'},side(true),side(false)),
    h('p',{class:'note'},'Solid roles: shared abstraction level. Dashed amber relationships: the two supplied sequences differ. Reference paths are recommendations or configured constraints, not proof that a layer is missing.'),selection);
  return root;
}
