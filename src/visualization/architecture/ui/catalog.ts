import type { ViewDescriptor, ViewType } from '../../../architecture/types.js';

/** Presentation metadata only; availability and scopes always come from the analysis API. */
export const FAMILIES: Record<ViewType, { family: string; scope: string; evidence: string }> = {
  system: { family: 'System architecture', scope: 'Repository boundary and major subsystems', evidence: 'Source structure, detected entry points and integration signals; not deployed topology.' },
  components: { family: 'System architecture', scope: 'One component and its immediate dependencies', evidence: 'Indexed files and resolved relationships. Folder-based responsibilities may be inferred.' },
  dependencies: { family: 'System architecture', scope: 'Source modules', evidence: 'Static dependencies; these do not imply network traffic.' },
  runtime: { family: 'Runtime and behavior', scope: 'One entry point', evidence: 'Static call sequence, not an observed runtime trace.' },
  workflow: { family: 'Runtime and behavior', scope: 'One process', evidence: 'Source control flow; dynamic dispatch and execution may differ.' },
  lifecycle: { family: 'Runtime and behavior', scope: 'One state-bearing entity', evidence: 'Detected state assignments and transitions; coverage may be partial.' },
  dataflow: { family: 'Data architecture', scope: 'Inputs, processing and storage signals', evidence: 'Source reads and writes; not a relational schema or cardinality model.' },
  deployment: { family: 'Infrastructure and deployment', scope: 'Declared execution units', evidence: 'Repository configuration, not confirmation of live infrastructure.' },
  security: { family: 'Security and reliability', scope: 'Detected trust boundaries', evidence: 'Source and configuration signals; not a security certification.' },
  delta: { family: 'Architecture evolution', scope: 'Selected available revision', evidence: 'Structural comparison with local Git history.' },
};

export interface GalleryEntry { descriptor: ViewDescriptor; focus?: string; title: string; family: string; scope: string; evidence: string }
export function galleryEntries(views: ViewDescriptor[]): GalleryEntry[] {
  const entries: GalleryEntry[] = [];
  for (const descriptor of views.filter(v => v.available)) {
    const meta = FAMILIES[descriptor.type];
    if (descriptor.type === 'system') entries.push({ descriptor, ...meta, focus: 'context', title: 'System context', scope: 'Repository as one system, with detected actors and integrations' });
    entries.push({ descriptor, ...meta, title: descriptor.type === 'system' ? 'Subsystems' : descriptor.type === 'runtime' ? 'Sequence' : descriptor.title });
  }
  return entries;
}

export type DiagramCategory = 'A' | 'B' | 'C' | 'D';
export const CATEGORIES: { id: DiagramCategory; title: string; description: string }[] = [
  { id: 'A', title: 'Core architecture', description: 'Context, subsystems, components, sequences, data flow and workflows.' },
  { id: 'B', title: 'Project-dependent', description: 'Dependencies, deployment, state transitions and security where evidence exists.' },
  { id: 'C', title: 'Specialized', description: 'AI/ML, RAG, agents, event processing, data pipelines and frontend architecture.' },
  { id: 'D', title: 'Cross-cutting', description: 'Architecture evolution and revision comparisons.' },
];
export const CATEGORY_OF: Record<ViewType, DiagramCategory> = {
  system: 'A', components: 'A', runtime: 'A', dataflow: 'A', workflow: 'A',
  dependencies: 'B', deployment: 'B', lifecycle: 'B', security: 'B', delta: 'D',
};
export const CATEGORY_GAPS: Record<DiagramCategory, string> = {
  A: 'Dedicated schema/ER, API topology and C4 container/code projections are not implemented yet.',
  B: 'Pattern classification, CI/CD pipelines, testing architecture and domain-model diagrams are not implemented yet. Lifecycle views are partial state extraction; security views do not establish complete OAuth/OIDC protocols.',
  C: 'Dedicated specialized diagram generators are not implemented yet. Existing sequence and data-flow views can expose relevant source relationships, but are not substitutes for verified RAG, agent, ML, event or frontend architecture models.',
  D: 'Dedicated observability, resilience and concurrency projections are not implemented yet.',
};
