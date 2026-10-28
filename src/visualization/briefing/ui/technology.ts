import type { CodebaseBriefing, BriefingEvidence } from '../../../codebase-briefing/types.js';
import type { ArchNode } from '../../../architecture/types.js';
import { h } from '../../graph/ui/dom.js';
import { TECHNOLOGY_ICONS } from './technology-icons.js';

export interface Technology { name: string; category: string; purpose: string; basis: string; requirements?: string[]; evidence: BriefingEvidence[] }
export function technologies(briefing: CodebaseBriefing): Technology[] {
  const section = briefing.sections.find(s => s.id === 'technology');
  const dependencies = section?.blocks.flatMap(block => block.type === 'groups' ? block.groups.flatMap(group => group.items.map(item => {
    const claim = section.claims.find(c => c.id === item.claim);
    const requirements = section.blocks.flatMap(block => block.type === 'facts' ? block.rows : []).filter(row => row.label === `${item.title} requirement`);
    const declarations = requirements.flatMap(row => section.claims.find(claim => claim.id === row.claim)?.evidence ?? []);
    return { requirements: requirements.map(row => row.value), name: item.title, category: group.title, purpose: item.detail ?? '', basis: claim?.basis ?? 'unknown', evidence: [...(claim?.evidence ?? []), ...declarations] };
  })) : []) ?? [];
  const languageRow = section?.blocks.flatMap(block => block.type === 'facts' ? block.rows : []).find(row => row.label === 'Languages');
  const languageClaim = section?.claims.find(claim => claim.id === languageRow?.claim);
  const languages = (languageRow?.value ?? '').split(', ').flatMap(value => {
    const match = /^(.+) \(\d+ files\)$/.exec(value);
    return match ? [{ name: match[1]!, category: 'Languages', purpose: `Indexed source language: ${value}. Detected from file extensions.`, basis: 'observed', requirements: dependencies.find(item => item.name === match[1])?.requirements ?? [], evidence: [...(languageClaim?.evidence ?? []), ...(dependencies.find(item => item.name === match[1])?.evidence ?? [])] }] : [];
  });
  return [...languages, ...dependencies.filter(item => !languages.some(language => language.name === item.name))];
}
/** Only indexed import locations or the architecture model's import labels establish usage. */
export function technologyNodes(nodes: ArchNode[], technology: Technology): string[] {
  const files = new Set(technology.evidence.filter(e => e.source === 'index' && e.path !== '.').map(e => e.path));
  const extensions: Record<string, string[]> = { TypeScript: ['.ts', '.tsx', '.mts', '.cts'], JavaScript: ['.js', '.jsx', '.mjs', '.cjs'], Python: ['.py'], Go: ['.go'], Rust: ['.rs'], Java: ['.java'], Ruby: ['.rb'], PHP: ['.php'] };
  return nodes.filter(node => (technology.category === 'Languages' && node.files.some(file => extensions[technology.name]?.some(extension => file.endsWith(extension)))) || node.technologies.some(name => name.toLowerCase() === technology.name.toLowerCase()) || node.files.some(file => files.has(file))).map(node => node.id);
}
const aliases: Record<string, string> = { 'node.js': 'nodejs', 'three.js': 'threejs', 'postgres': 'postgresql', 'redis client': 'redis', 'ioredis': 'redis' };
export function technologyStack(briefing: CodebaseBriefing, select: (tech: Technology) => void): HTMLElement {
  const items = technologies(briefing);
  const list = h('div', { class: 'technology-list' });
  const search = h('input', { type: 'search', placeholder: 'Find a technology…', 'aria-label': 'Find a technology' });
  let selected = '';
  function render(): void {
    const found = items.filter(item => `${item.name} ${item.category}`.toLowerCase().includes(search.value.toLowerCase()));
    list.replaceChildren(...[...new Set(found.map(item => item.category))].map(category => h('div', { class: 'technology-group' }, h('span', { class: 'technology-category' }, category), ...found.filter(item => item.category === category).map(item => {
      const key = item.name.toLowerCase();
      const icon = TECHNOLOGY_ICONS[aliases[key] ?? key];
      return h('button', { type: 'button', class: 'technology-item', 'aria-pressed': String(selected === item.name), onclick: () => { selected = item.name; render(); list.querySelector<HTMLButtonElement>('[aria-pressed="true"]')?.focus({ preventScroll: true }); select(item); } }, icon ? h('img', { src: `data:image/svg+xml,${encodeURIComponent(icon)}`, alt: '', width: '22', height: '22' }) : h('span', { class: 'technology-fallback', 'aria-hidden': 'true' }, '<>'), h('span', {}, item.name));
    }))));
    if (!found.length) list.append(h('p', { class: 'muted' }, items.length ? 'No matching detected technologies.' : 'No recognized technology dependencies in the available index.'));
  }
  search.addEventListener('input', render); render();
  return h('section', { class: 'technology-stack', 'aria-label': 'Interactive technology stack' }, h('div', { class: 'technology-heading' }, h('h2', {}, 'Built with'), search), list);
}
