import { mkdir, readFile, writeFile, cp, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { pages, escape } from '../src/content.mjs';
import { layout } from '../src/layout.mjs';

export const root = fileURLToPath(new URL('../',import.meta.url));
export function configuration(env = process.env) {
  const url = new URL(env.SITE_URL || 'http://localhost:4321');
  if (!['http:','https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('SITE_URL must be an HTTP(S) origin without credentials, paths, queries, or fragments.');
  const indexable = env.SITE_INDEXABLE === 'true';
  if (indexable && (url.protocol !== 'https:' || /^(localhost|127\.|\[::1\])/.test(url.hostname) || /\.(example|invalid|test)$/.test(url.hostname))) throw new Error('Indexable builds require a real public HTTPS SITE_URL.');
  const gaId = env.GA_MEASUREMENT_ID || '';
  if (gaId && !/^G-[A-Z0-9]{4,20}$/.test(gaId)) throw new Error('GA_MEASUREMENT_ID must be a GA4 G- identifier.');
  const googleVerification = env.GOOGLE_SITE_VERIFICATION || '';
  if (googleVerification && !/^[A-Za-z0-9_-]{10,200}$/.test(googleVerification)) throw new Error('Invalid Google site verification token.');
  return {siteUrl:url.origin+'/',indexable,gaId,googleVerification};
}
export async function build(env=process.env) {
  const config = configuration(env);
  config.version = JSON.parse(await readFile(path.join(root,'../package.json'),'utf8')).version;
  const output = path.join(root,'dist');
  await rm(output,{recursive:true,force:true});
  await mkdir(output,{recursive:true});
  await cp(path.join(root,'public'),output,{recursive:true});
  const content = pages(config.version);
  content.push({path:'/404.html',title:'Page not found',description:'This Fehm page could not be found. Return to the documentation or installation guide.',body:'<header class="page-intro"><p class="eyebrow">404 / PAGE NOT FOUND</p><h1>Page not found.</h1><p class="lead">The page may have moved. Start again with the <a href="/docs/">documentation</a> or <a href="/">home page</a>.</p></header>'});
  for (const page of content) {
    const file = path.join(output,page.path === '/404.html' ? '404.html' : page.path.slice(1)+'index.html');
    await mkdir(path.dirname(file),{recursive:true});
    await writeFile(file,layout(page,config));
  }
  const routes = content.filter(p=>p.path!=='/404.html');
  await writeFile(path.join(output,'sitemap.xml'),`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${routes.map(p=>`<url><loc>${escape(new URL(p.path,config.siteUrl).href)}</loc></url>`).join('')}</urlset>\n`);
  const llms = `# Fehm\n\n> Local codebase intelligence: source graphs, repository context, architecture drift and optional model-based code review.\n\nOrdinary scans and queries run locally. Provider review requires configuration and explicit invocation. Install a supplied platform wheel with uv; public package publication is pending.\n\n## Documentation\n\n${routes.filter(p => p.path.startsWith('/docs/')).map(p => `- [${p.title}](${new URL(p.path,config.siteUrl).href}): ${p.description}`).join('\n')}\n`;
  await writeFile(path.join(output,'llms.txt'),llms);
  await writeFile(path.join(output,'llm.txt'),llms); // Compatibility with the singular spelling.
  await writeFile(path.join(output,'robots.txt'),config.indexable?`User-agent: *\nAllow: /\nSitemap: ${new URL('/sitemap.xml',config.siteUrl).href}\n`:'User-agent: *\nDisallow: /\n');
  await writeFile(path.join(output,'_headers'),`/*\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: no-referrer\n  X-Frame-Options: DENY\n  Permissions-Policy: camera=(), microphone=(), geolocation=()\n  Content-Security-Policy: default-src 'self'; script-src 'self' https://www.googletagmanager.com; style-src 'self'; img-src 'self' data: https://*.google-analytics.com; connect-src 'self' https://*.google-analytics.com https://*.analytics.google.com https://www.googletagmanager.com; frame-ancestors 'none'; base-uri 'self'; form-action 'self'\n`);
  console.log(`Built ${content.length} pages · ${config.indexable?'indexable':'noindex preview'} · analytics ${config.gaId?'opt-in configured':'disabled'} · Fehm ${config.version}`);
  return {content,config,output};
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await build();
