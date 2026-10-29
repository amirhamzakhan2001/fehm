import type { ContextPacket, ContextItem } from '../../../model.js';

export interface ReadingGroup { path: string; items: ContextItem[]; description: string }
/** Presentation of existing evidence, not a generated answer or inferred execution flow. */
export function readingGuide(packet: ContextPacket): { summary: string; groups: ReadingGroup[]; connections: string[]; caveats: string[] } {
  const grouped = new Map<string, ContextItem[]>();
  for (const item of packet.recommendedNodes) {
    const key = item.path ?? item.nodeId;
    const items = grouped.get(key) ?? [];
    items.push(item); grouped.set(key, items);
  }
  const groups = [...grouped].map(([path, items]) => {
    const descriptions = items.map(item => item.text.split('```')[0]!.replace(/^#+[^\n]*\n/g, '').trim()
      .replace(/^(?:Exported )?\w+ [^\n]*? defined in [^\n]*?:\d+\.\s*/i, '')
      .replace(/^File [^\n]*?\. Defines /, 'Defines '))
      .filter(text => text && !/^(?:Calls |Called by )/.test(text));
    const functions = items.filter(i => ['function','method'].includes(i.kind)).map(i => i.name);
    const types = items.filter(i => ['field','interface','type','class'].includes(i.kind)).map(i => i.name);
    const sections = items.filter(i => i.kind === 'section').map(i => i.name);
    const fallback = functions.length ? `Functions to inspect: ${functions.slice(0,3).join(', ')}. Follow their source and connections below.`
      : types.length ? `Data definitions to inspect: ${types.slice(0,3).join(', ')}. These describe structure; they do not establish runtime behavior.`
      : sections.length ? `Documentation to read: ${sections.slice(0,3).join('; ')}.`
      : `The index matched ${items.map(i => i.name).slice(0,3).join(', ')}. Inspect the source to decide how it relates to your question.`;
    return { path, items, description: descriptions[0] ?? fallback };
  });
  const verbs: Record<string, string> = { calls:'calls', references:'references', uses:'uses the type or symbol', imports:'imports', extends:'extends', implements:'implements', writes:'writes to', handles:'is linked by a handler relationship to', defines:'defines' };
  const connections = packet.relationships.map(r => `${r.sourceName} ${verbs[r.kind] ?? `has a ${r.kind} relationship with`} ${r.targetName}.${r.provenance === 'heuristic' ? ' This relationship is inferred.' : ''}`);
  const caveats = [...packet.unknowns];
  if (!packet.index.fresh) caveats.unshift('The repository has changed since indexing. Rescan before relying on these results.');
  if (packet.budget.truncated) caveats.push('Some evidence was shortened or omitted to fit your context budget. Open the source or increase the budget for more detail.');
  if (packet.quality.heuristicShare > 0) caveats.push('Some selected relationships come from pattern matching rather than compiler resolution.');
  caveats.push('These are search results and static relationships, not a verified explanation of runtime behavior. Related tests have not been run.');
  return { summary: groups.length ? `Found ${groups.length} relevant source or documentation locations for “${packet.query}”. Start with the files below, then follow the indexed connections.` : `No indexed code matched “${packet.query}”. Try a function name, a file path, or a more specific description.`, groups, connections: [...new Set(connections)], caveats: [...new Set(caveats)] };
}
