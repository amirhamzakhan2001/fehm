import { escape, assistants } from './content.mjs';
import { guideNavigation } from './guides.mjs';

function article(page) {
  const headings=[];
  const body=page.body.replace(/<h2>(.*?)<\/h2>/g,(_,text)=>{
    const label=text.replace(/<[^>]*>/g,'');
    const id=label.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
    headings.push([id,label]);
    return `<h2 id="${id}">${text}</h2>`;
  });
  const navigation=page.kind==='integration'?assistants.map(([id,name])=>[`/integrations/${id}/`,name]):guideNavigation.map(([id,name])=>[`/docs/${id}/`,name]);
  const section=page.kind==='integration'?'Integrations':'Documentation';
  return `<div class="docs-layout"><aside class="docs-sidebar"><a class="sidebar-title" href="${page.kind==='integration'?'/integrations/':'/docs/'}">${section}</a><nav aria-label="${section}">${navigation.map(([url,label])=>`<a href="${url}" ${page.path===url?'aria-current="page"':''}>${label}</a>`).join('')}</nav><a class="sidebar-bottom" href="/docs/troubleshooting/">Get help →</a></aside><article class="doc-article"><div class="breadcrumb"><a href="/docs/">Docs</a><span>/</span><span>${section}</span></div><header><h1>${page.title}</h1><p class="lead">${page.description}</p></header>${body}<div class="doc-next"><span>Continue exploring</span><a href="/docs/quickstart/">Quickstart →</a><a href="/docs/troubleshooting/">Troubleshooting →</a></div></article><aside class="on-this-page"><span>On this page</span><nav aria-label="On this page">${headings.map(([id,title])=>`<a href="#${id}">${title}</a>`).join('')}</nav></aside></div>`;
}
export function layout(page, config) {
  const title = `${page.title} — Fehm`;
  const canonical = new URL(page.path, config.siteUrl).href;
  const noindex = !config.indexable || page.path === '/404.html';
  const navigation = [['/features/','Product'],['/integrations/','Integrations'],['/docs/','Docs']];
  const schema={'@context':'https://schema.org','@type':page.kind==='docs'?'TechArticle':'WebPage',inLanguage:'en',name:page.title,description:page.description,url:canonical,isPartOf:{'@type':'WebSite',name:'Fehm',url:config.siteUrl}};
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#f5f8fc">
<title>${escape(title)}</title><meta name="description" content="${escape(page.description)}">${config.googleVerification ? `<meta name="google-site-verification" content="${escape(config.googleVerification)}">` : ''}<meta name="robots" content="${noindex ? 'noindex, nofollow' : 'index, follow'}">
<link rel="canonical" href="${escape(canonical)}"><link rel="icon" href="/favicon-aperture.svg" type="image/svg+xml"><link rel="apple-touch-icon" href="/apple-touch-icon-aperture.png"><link rel="preload" href="/fonts/manrope.woff" as="font" type="font/woff" crossorigin><link rel="stylesheet" href="/styles.css">
<meta property="og:type" content="website"><meta property="og:site_name" content="Fehm"><meta property="og:title" content="${escape(title)}"><meta property="og:description" content="${escape(page.description)}"><meta property="og:url" content="${escape(canonical)}"><meta property="og:image" content="${escape(new URL('/social-card.png',config.siteUrl).href)}"><meta property="og:image:alt" content="Fehm — Know the code. Understand the change."><meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${escape(title)}"><meta name="twitter:description" content="${escape(page.description)}"><meta name="twitter:image" content="${escape(new URL('/social-card.png',config.siteUrl).href)}"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">
<meta name="fehm-ga-id" content="${escape(config.gaId)}"><meta name="fehm-page-url" content="${escape(canonical)}">
<script type="application/ld+json">${JSON.stringify(schema).replace(/</g,'\\u003c')}</script>
<script src="/app.js" defer></script><script src="/motion.js" defer></script></head><body class="${page.path==='/'?'home-page':'inner-page'}">
<div class="site-art" aria-hidden="true"><div class="art-grid"></div><div class="art-orb art-orb-mint"></div><div class="art-orb art-orb-blue"></div><div class="art-orbit"></div></div>
<a class="skip" href="#main">Skip to content</a><header class="site-header"><div class="header-inner"><a class="brand" href="/" aria-label="Fehm home"><img src="/fehm-icon.svg" width="28" height="28" alt="">fehm</a><nav aria-label="Main navigation">${navigation.map(([url,label])=>`<a href="${url}" ${page.path.startsWith(url)?'aria-current="page"':''}>${label}</a>`).join('')}</nav><a class="header-cta" href="/getting-started/" data-event="install_guide_click">Get started <span aria-hidden="true">↗</span></a></div></header>
<main id="main" class="shell ${page.kind?'reading-shell':''}">${page.kind?article(page):page.body}</main>
${page.kind?'':`<section class="closing shell"><p class="eyebrow">SCAN · QUERY · REVIEW</p><h2>Start with <em>your repository.</em></h2><a class="button" href="/getting-started/" data-event="install_guide_click">Start with Fehm ↗</a></section>`}
<footer class="shell"><div class="footer-top"><div><a class="brand" href="/">fehm</a><p>Local codebase intelligence.</p></div><nav aria-label="Footer product"><span>Product</span><a href="/features/">Capabilities</a><a href="/integrations/">Integrations</a><a href="/releases/">What’s new</a></nav><nav aria-label="Footer resources"><span>Resources</span><a href="/docs/">Documentation</a><a href="/docs/quickstart/">Quickstart</a><a href="/docs/troubleshooting/">Help</a></nav><nav aria-label="Footer privacy"><span>Trust</span><a href="/docs/security/">Security</a><a href="/privacy/">Privacy</a></nav></div><div class="footer-bottom"><span>Fehm ${escape(config.version)} · MIT licensed</span><span>Runs locally. No account required.</span></div></footer>
<aside class="consent" id="consent" hidden aria-label="Optional website analytics"><div><strong>Optional analytics</strong><p>Allow Google Analytics to measure page views and guide navigation? Repository data is never collected here. <a href="/privacy/">Privacy details</a></p></div><div class="consent-actions"><button type="button" data-consent="denied">Reject</button><button type="button" data-consent="granted">Accept</button></div><p id="analytics-status" role="status"></p></aside></body></html>`;
}
