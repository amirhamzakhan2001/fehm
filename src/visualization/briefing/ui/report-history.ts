import type { GitMemoryReport } from '../../../git-memory/types.js';
import { h } from '../../graph/ui/dom.js';

/** Load bounded history only on request; never block the onboarding report on Git. */
export function historySection(): HTMLElement {
  const results = h('div', { 'aria-live': 'polite' });
  const load = h('button', { type: 'button', onclick: async () => {
    load.disabled = true; results.textContent = 'Reading recent repository history…';
    try {
      const response = await fetch('/api/git-memory?limit=20');
      if (!response.ok) throw new Error('Repository history is unavailable. Open Git memory for diagnostics.');
      const report = await response.json() as GitMemoryReport;
      results.replaceChildren(h('p', {}, report.available ? `Recent history: ${report.coverage.indexed} indexed commits${report.shallow ? ' in a shallow clone' : ''}. This window does not establish the full project history.` : 'No Git history is available for this repository.'));
      for (const commit of report.commits.slice(0, 8)) {
        results.append(h('details', { class: 'history-entry' }, h('summary', {}, `${commit.at.slice(0, 10)} · ${commit.message.split('\n')[0]}`),
          h('p', {}, `${commit.id} · ${commit.author}`), h('p', {}, commit.message),
          h('ul', {}, ...commit.files.slice(0, 12).map(file => h('li', {}, h('a', { href: `/graph#node=${encodeURIComponent(`file:${file.path}`)}` }, file.path), ` · ${file.status}`))),
          h('p', { class: 'muted' }, 'File links open the current index; deleted or renamed files may no longer exist there.')));
      }
      if (report.churn.length) results.append(h('h3', {}, 'Frequently changed areas in this window'), h('ul', {}, ...report.churn.slice(0, 5).map(item => h('li', {}, `${item.path} · ${item.changes} changes`))));
      load.textContent = 'Refresh recent history';
    } catch (error) { results.textContent = (error as Error).message; load.textContent = 'Retry recent history'; }
    finally { load.disabled = false; }
  } }, 'Read recent history');
  return h('section', { class: 'sec', id: 'report-history' }, h('h2', {}, 'Git history & architectural evolution'),
    h('p', { class: 'lead' }, 'Review recent changes to understand which areas are evolving. Commit messages describe author intent; they are not proof that a release is deployed or an issue is resolved.'), load, results,
    h('p', {}, h('a', { href: '/git-memory' }, 'Investigate commits, revision comparisons & file history →'), ' · ', h('a', { href: '/drift' }, 'Inspect architecture drift →')));
}
