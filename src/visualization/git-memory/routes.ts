import { pageAsset } from '../graph/assets.js';
import { pageHeaders, renderPage, type ViewRoutes } from '../http.js';
import { stateDir } from '../../persistence.js';
import { readTrend } from '../../health/history.js';
import { promptHistory } from '../../prompts/revisions.js';
import { compareGitMemory, entityGitHistory, indexGitMemory, renderGitMemory, searchGitMemory } from '../../git-memory/history.js';
import { historyBlame, rawHistoryDiff } from '../../git-memory/git.js';
import { compareMemorySnapshots, historicalSnapshot } from '../../git-memory/snapshots.js';
import type { HistoryFilter, HistoryOptions } from '../../git-memory/types.js';
import { GIT_MEMORY_PAGE } from './page.js';

export function createGitMemoryRoutes(options: HistoryOptions = {}): ViewRoutes {
  return { handle(req, url, ctx, reply) {
    const path = url.pathname, p = url.searchParams;
    if (path === '/git-memory' || path === '/git-memory/') { reply(200, renderPage(GIT_MEMORY_PAGE, url), 'text/html; charset=utf-8', pageHeaders()); return true; }
    if (path.startsWith('/git-memory/assets/')) {
      const asset = pageAsset(path.slice('/git-memory/assets/'.length));
      reply(asset === undefined ? 404 : 200, asset ?? 'not found', 'text/javascript; charset=utf-8', pageHeaders()); return true;
    }
    if (path !== '/api/git-memory' && !path.startsWith('/api/git-memory/')) return false;
    const action = path.slice('/api/git-memory'.length) || '/report';
    const post = ['/refresh', '/snapshot', '/snapshot-compare'].includes(action);
    if (req.method !== (post ? 'POST' : 'GET')) { reply(405, { error: `${post ? 'POST' : 'GET'} required` }); return true; }
    if (post && req.headers['x-fehm'] !== '1') { reply(403, { error: 'missing x-fehm header' }); return true; }
    try {
      const root = ctx.engine().root;
      const opts: HistoryOptions = { ...options, ...(p.has('ref') ? { ref: p.get('ref')! } : {}), ...(p.has('limit') ? { limit: Number(p.get('limit')) } : {}) };
      const from = p.get('from') ?? 'HEAD~1', to = p.get('to') ?? 'HEAD';
      if (action === '/compare') reply(200, compareGitMemory(root, from, to));
      else if (action === '/diff') reply(200, rawHistoryDiff(root, from, to), 'text/plain; charset=utf-8');
      else if (action === '/blame') reply(200, historyBlame(root, p.get('ref') ?? 'HEAD', p.get('path') ?? '', Number(p.get('start') ?? 1), Number(p.get('end') ?? 50)), 'text/plain; charset=utf-8');
      else if (action === '/snapshot') reply(200, historicalSnapshot(root, p.get('ref') ?? 'HEAD', opts));
      else if (action === '/snapshot-compare') reply(200, compareMemorySnapshots(historicalSnapshot(root, from, opts), historicalSnapshot(root, to, opts)));
      else if (action === '/observations') {
        const state = stateDir(root, options.stateDirectory);
        reply(200, { health: readTrend(state), security: readTrend(state, 'security-history.json'), prompts: promptHistory(state), note: 'Recorded observations may include dirty working trees and un-applied prompt candidates; sourceCommit is context, not proof of committed state.' });
      } else if (['/report', '/refresh', '/search', '/entity', '/commit', '/context'].includes(action)) {
        const report = indexGitMemory(root, opts);
        const filter: HistoryFilter = Object.fromEntries(['query', 'path', 'entity', 'category', 'author', 'since', 'until'].filter(k => p.has(k)).map(k => [k, p.get(k)!]));
        if (action === '/search') reply(200, { commits: searchGitMemory(report, filter), coverage: report.coverage });
        else if (action === '/entity') reply(200, entityGitHistory(report, p.get('path') ?? '', p.get('entity') ?? undefined));
        else if (action === '/context') reply(200, renderGitMemory(report, filter, Number(p.get('budget') ?? 3000)), 'text/markdown; charset=utf-8');
        else if (action === '/commit') {
          const commit = report.commits.find(c => c.id === p.get('id'));
          if (!commit) reply(404, { error: 'Commit not in selected history window' });
          else {
            const engine = ctx.engine(), paths = new Set(commit.files.flatMap(f => [f.path, ...(f.oldPath ? [f.oldPath] : [])]));
            const nodes = engine.graph.nodes().filter(n => n.path && paths.has(n.path));
            const ids = new Set(nodes.map(n => n.id));
            const dependents = engine.graph.edges().filter(e => ids.has(e.target) && !ids.has(e.source) && ['calls', 'imports', 'uses', 'references'].includes(e.kind)).map(e => e.source);
            reply(200, { ...commit, currentGraphImpact: { nodes: nodes.map(n => ({ id: n.id, path: n.path, name: n.name })), dependents: [...new Set(dependents)], interpretation: 'Current working-tree graph references, not historical impact or runtime propagation' } });
          }
        } else reply(200, report);
      } else reply(404, { error: 'Unknown Git Memory endpoint' });
    } catch (error) { reply(400, { error: (error as Error).message.split('\n').slice(0, 2).join('\n') }); }
    return true;
  } };
}
