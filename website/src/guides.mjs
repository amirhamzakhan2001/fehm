import { readFileSync } from 'node:fs';
import { code, escape } from './content.mjs';

export const guideCatalog = JSON.parse(readFileSync(new URL('./guide-catalog.json', import.meta.url), 'utf8'));
export const guideNavigation = guideCatalog.map(({id,title}) => [id,title]);

// Deliberately small renderer for the maintained guides: escaped prose, headings,
// fenced examples, inline code, local links and unordered lists. No raw HTML.
export function renderGuide(markdown) {
  const inline = text => escape(text).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\[([^\]]+)\]\(([a-z0-9-]+)\.md\)/g, (_,label,id) => {
    if (!guideCatalog.some(g => g.id === id)) throw new Error(`Unknown guide link ${id}`);
    return `<a href="/docs/${id}/">${label}</a>`;
  });
  const lines = markdown.split('\n');
  const html = [];
  let paragraph = [], list = [];
  const flush = () => {
    if (paragraph.length) html.push(`<p>${inline(paragraph.join(' '))}</p>`);
    if (list.length) html.push(`<ul>${list.map(item => `<li>${inline(item)}</li>`).join('')}</ul>`);
    paragraph = []; list = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith('# ')) { flush(); continue; } // Layout provides the article H1.
    if (line.startsWith('```')) {
      flush(); const body = []; let closed = false;
      while (++i < lines.length) { if (lines[i].startsWith('```')) { closed = true; break; } body.push(lines[i]); }
      if (!closed) throw new Error('Unclosed guide code fence');
      html.push(code(body.join('\n'))); continue;
    }
    if (!line.trim()) { flush(); continue; }
    const heading = /^(#{2,3}) (.+)$/.exec(line);
    if (heading) { flush(); html.push(`<h${heading[1].length}>${inline(heading[2])}</h${heading[1].length}>`); continue; }
    if (line.startsWith('- ')) { if (paragraph.length) flush(); list.push(line.slice(2)); continue; }
    if (list.length) flush();
    paragraph.push(line);
  }
  flush(); return html.join('\n');
}

export function guidePages() {
  return guideCatalog.map(({id,title,description}) => ({
    path: `/docs/${id}/`, kind: 'docs', title, description,
    body: renderGuide(readFileSync(new URL(`../../docs/guides/${id}.md`, import.meta.url), 'utf8')),
  }));
}
