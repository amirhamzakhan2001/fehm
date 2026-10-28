import type { ConceptCandidate, ConceptFinding } from '../../../concepts/types.js';
// Editorial learning order, not measured popularity or evidence confidence.
const everyday = new Set(['api','api design','rest','http','authentication','authorization','database','sql','data model','data flow','entry point','module boundary','function','class','interface','dependency injection','dependency chain','call chain','execution path','error handling','logging','unit testing','integration testing','test coverage','caching','configuration','validation','input validation','version control','continuous integration','continuous delivery','client-server architecture','monolithic architecture','microservices','frontend','backend','middleware','routing','encapsulation','abstraction','separation of concerns','coupling','cohesion','technical debt','code review','refactoring','dead code','circular dependency','environment variables','exception handling']);
export function conceptTier(c: ConceptCandidate): number {
    if ([c.name, ...c.aliases].some(n => everyday.has(n.toLowerCase()))) return 0;
    if (/Practical Code Structure|Execution Vocabulary|Dependency and Coupling|API and Integration|Quality and Testing|Architecture Assessment|Data Engineering Vocabulary|Security Assessment|Operational Vocabulary|Incident and Observability/i.test(c.sectionName)) return 1;
    return 2;
}
export const tierNames = ['Everyday engineering', 'Working with systems', 'Specialized concepts'];
export function evidenceLabel(findings: ConceptFinding[]): string {
    if (findings.some(f => f.scope !== 'documented_claim' && ['explicitly_observed', 'structurally_supported'].includes(f.status))) return 'Source evidence';
    return findings.length ? 'Signals to review' : 'Reference only';
}
export function orderConcepts(concepts: ConceptCandidate[], findings: ConceptFinding[], query = ''): ConceptCandidate[] {
    const supported = new Set(findings.filter(f => f.scope !== 'documented_claim' && ['explicitly_observed', 'structurally_supported'].includes(f.status)).map(f => f.concept_id));
    const exact = (c: ConceptCandidate) => Number(!!query && [c.name, ...c.aliases].some(n => n.toLowerCase() === query.toLowerCase().trim()));
    return [...concepts].sort((a,b) => exact(b)-exact(a) || conceptTier(a)-conceptTier(b) || Number(supported.has(b.id))-Number(supported.has(a.id)) || a.name.localeCompare(b.name));
}
