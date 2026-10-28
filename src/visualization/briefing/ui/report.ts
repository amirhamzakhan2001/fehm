import type { SectionId } from '../../../codebase-briefing/types.js';

/** Reading order, not page routes. Each analysis section appears exactly once. */
export const REPORT_STAGES: { id: string; title: string; introduction: string; sections: SectionId[] }[] = [
  { id: 'understand', title: 'Understand', introduction: 'Start with the product: what it does, who it serves, and the tools behind it.', sections: ['overview', 'features', 'technology'] },
  { id: 'explore', title: 'Explore', introduction: 'Build a picture of the system, then locate its components, public interfaces and data.', sections: ['architecture', 'components', 'entryPoints', 'api', 'database', 'integrations'] },
  { id: 'trace', title: 'Trace', introduction: 'Follow an operation from its entry point through calls, data access and failure paths.', sections: ['dataFlows', 'runtime'] },
  { id: 'evaluate', title: 'Evaluate', introduction: 'Understand how this project runs, how it is verified, and which operational risks need attention.', sections: ['infrastructure', 'security', 'testing', 'risks'] },
  { id: 'change', title: 'Change safely', introduction: 'Choose a starting point, inspect its dependencies, and identify the evidence and checks needed before changing it.', sections: ['dependencies', 'engineerMustKnow', 'cheatSheet'] },
];

export const REPORT_TITLES: Partial<Record<SectionId, string>> = {
  overview: 'Project introduction', features: 'Product behavior & requirements', technology: 'Technology stack',
  architecture: 'System at a glance', components: 'Codebase tour', entryPoints: 'Entry points & startup',
  api: 'APIs & contracts', database: 'Data architecture', integrations: 'External integrations',
  dataFlows: 'End-to-end operations', runtime: 'Runtime behavior & failures', infrastructure: 'Run & deploy the project',
  security: 'Security & trust boundaries', testing: 'Testing & engineering quality', risks: 'Engineering concerns',
  dependencies: 'Dependencies & change impact', engineerMustKnow: 'Developer learning path', cheatSheet: 'Engineering handover',
};
