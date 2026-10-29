import type { FehmEngine } from '../engine.js';
import { matchesAny } from '../drift/contract.js';
import type { Finding } from '../findings/model.js';
import { makeFinding } from './rules.js';
import type { ReadinessProfile, WebAssessment } from './readiness.js';

// Conservative lexical inspection of complete literal HTML documents, not JSX or framework templates.
// Preserve offsets when removing inert comments and script contents.
const blank = (s: string): string => s.replace(/[^\n]/g, ' ');
function attrs(tag: string): Map<string, string> {
  const out = new Map<string, string>();
  const body = tag.replace(/^<\/?[\w:-]+/, '').replace(/\/?\s*>$/, '');
  for (const m of body.matchAll(/([^\s=<>/'"]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) out.set(m[1]!.toLowerCase(), m[2] ?? m[3] ?? m[4] ?? '');
  return out;
}
export function analyzeWebDelivery(engine: FehmEngine, profiles: ReadinessProfile[], skip: (path: string) => boolean): { findings: Finding[]; report: WebAssessment } {
  const findings: Finding[] = [];
  const report: WebAssessment = { documents: 0, publicDocuments: 0, excluded: 0, limitations: [
    'Only complete indexed literal HTML documents are checked; templates, generated metadata and rendered routes need browser verification.',
    'HTTP status, direct routes, console errors, loading/error states, layout, accessibility behavior, cache isolation and bundle performance have not been tested.',
    'Sitemap discovery, canonical correctness, social-sharing intent and structured-data eligibility require route and deployment context; file absence is not treated as a defect.',
  ] };
  let omittedFindings = 0;
  const titles = new Map<string, { path: string; line: number }[]>();
  const add = (rule: string, path: string, line: number, title: string, detail: string, action: string, absence = false): void => {
    if (findings.length >= 500) { omittedFindings++; return; }
    findings.push(makeFinding(`web/${rule}`, { id: `web:${rule}:${path}:${line}`, title, message: detail, file: path, line, confidence: 'inferred', why: 'A source-level delivery concern may affect users or discovery when this document is served unchanged.', action, evidence: [{ type: absence ? 'absence' : 'pattern', path, line, detail }], verification: ['Inspect the served response and rendered page for this route; confirm the intended audience and framework behavior.'], missing: ['Runtime response and rendered-page verification have not run.'] }));
  };
  for (const path of [...engine.fileHashes().keys()].sort()) {
    if (!/\.html?$/i.test(path) || skip(path)) continue;
    const raw = engine.sourceLines(path)?.join('\n');
    if (!raw) continue;
    if (report.documents >= 200 || raw.length > 256_000 || /\{\{|<%|\{%/.test(raw)) { report.excluded++; continue; }
    const clean = raw.replace(/<!--[\s\S]*?-->/g, blank).replace(/<(script|style|textarea|template)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, blank);
    if (!/<html\b/i.test(clean) || !/<\/head\s*>/i.test(clean) || !/<\/html\s*>/i.test(clean)) { report.excluded++; continue; }
    report.documents++;
    const selected = profiles.filter(p => matchesAny(path, p.include));
    const audience = selected.length === 1 ? selected[0]!.audience : 'unknown';
    if (selected.length > 1) report.limitations.push(`${path}: overlapping audience profiles; SEO checks skipped.`);
    if (audience === 'public') report.publicDocuments++;
    const starts = [0];
    for (let i = 0; i < clean.length; i++) if (clean[i] === '\n') starts.push(i + 1);
    const line = (offset: number): number => {
      let lo = 0, hi = starts.length;
      while (lo + 1 < hi) { const mid = (lo + hi) >>> 1; if (starts[mid]! <= offset) lo = mid; else hi = mid; }
      return lo + 1;
    };
    const tags = [...clean.matchAll(/<[a-z][\w:-]*\b(?:"[^"]*"|'[^']*'|[^'">])*>/gi)].map(m => ({ name: /^<([\w:-]+)/.exec(m[0])![1]!.toLowerCase(), attrs: attrs(m[0]), line: line(m.index!), offset: m.index! }));
    const headEnd = clean.search(/<\/head\s*>/i);
    const metas = tags.filter(t => t.name === 'meta' && t.offset < headEnd);
    const meta = (name: string) => metas.filter(t => t.attrs.get('name')?.toLowerCase() === name);
    if (!meta('viewport').some(t => t.attrs.get('content')?.trim())) add('viewport', path, 1, 'Viewport configuration not detected', 'No nonempty viewport metadata in this HTML head.', 'Check mobile viewport behavior and add suitable viewport metadata where needed.', true);
    for (const t of tags.filter(t => t.name === 'img' && !t.attrs.has('alt'))) add('image-alt', path, t.line, 'Image has no alt attribute', 'An img element has no alt attribute; meaningful and decorative images need different alternatives.', 'Provide meaningful alternative text, or alt="" when the image is decorative.', true);
    if (audience !== 'public') continue;
    const titleMatches = [...clean.slice(0, headEnd).matchAll(/<title\b[^>]*>([\s\S]*?)<\/title\s*>/gi)];
    const title = titleMatches[0]?.[1]?.trim().replace(/\s+/g, ' ') ?? '';
    if (!title || titleMatches.length !== 1 || /^(?:app|home|untitled|vite(?: \+ react)?|react app)$/i.test(title)) add('title', path, titleMatches[0] ? line(titleMatches[0].index!) : 1, 'Review public-page title', 'The static document has an absent, generic or competing title.', 'Provide a descriptive title and verify framework-generated metadata.', !title);
    if (title) {
      const key = `${profiles.indexOf(selected[0]!)}:${title.toLowerCase()}`;
      const list = titles.get(key) ?? [];
      list.push({ path, line: line(titleMatches[0]!.index!) }); titles.set(key, list);
    }
    if (!meta('description').some(t => t.attrs.get('content')?.trim())) add('description', path, 1, 'Public-page description not detected', 'No nonempty meta description found in the HTML head.', 'Consider a description for this public page and inspect generated metadata.', true);
    for (const t of metas.filter(t => /^(?:robots|googlebot)$/i.test(t.attrs.get('name') ?? '') && /(?:^|[\s,])(?:noindex|none)(?:$|[\s,])/i.test(t.attrs.get('content') ?? ''))) add('noindex', path, t.line, 'Public page requests exclusion from search', 'A robots directive contains noindex or none in a document configured as public.', 'Confirm whether exclusion is intentional before changing the directive.');
    const canonical = tags.filter(t => t.name === 'link' && t.offset < headEnd && /(?:^|\s)canonical(?:$|\s)/i.test(t.attrs.get('rel') ?? ''));
    if (canonical.length > 1 || canonical.some(t => !t.attrs.get('href')?.trim())) add('canonical', path, canonical[0]!.line, 'Review competing or empty canonicals', 'Multiple canonical elements or an empty canonical target were detected.', 'Verify a single intended canonical target against the deployed URL.');
  }
  for (const pages of titles.values()) if (pages.length > 1) for (const p of pages) add('duplicate-title', p.path, p.line, 'Title repeated across public HTML documents', `The same title appears in ${pages.length} documents in this audience profile; distinct served routes are not established.`, 'Check whether these documents represent distinct public pages and require distinct titles.');
  if (!profiles.length) report.limitations.push('Audience is unknown. Configure readiness profiles in .fehm/health.json to enable public-site SEO checks.');
  if (report.excluded) report.limitations.push(`${report.excluded} HTML inputs excluded (templates, fragments or limits: 200 documents, 256 KB each).`);
  if (omittedFindings) report.limitations.push(`${omittedFindings} additional source concerns omitted after the 500-finding limit; this report is partial.`);
  return { findings, report };
}
