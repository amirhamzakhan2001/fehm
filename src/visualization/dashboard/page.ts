import { FEHM_FAVICON, FEHM_LOGO, FEHM_MARK } from "../brand.js";
import { FEATURES, HOME_ID, dashboardHref, type FeatureEntry } from "../features.js";

/**
 * The localhost dashboard (`/`): a persistent sidebar of every registered
 * feature, a home overview, and each feature page framed in place. The
 * markup is generated from `FEATURES`; behaviour lives in ui/main.ts.
 */

const stroke = (d: string): string =>
  `<svg class="ic" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;

const ICONS: Record<string, string> = {
  home: stroke(`<rect x="3.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.5"/>`),
  graph: stroke(`<circle cx="6" cy="6.5" r="2.3"/><circle cx="18" cy="8" r="2.3"/><circle cx="11" cy="18" r="2.3"/><path d="M8.2 7.2l7.5.6M7.3 8.5l2.7 7.3M16.6 9.9l-4.3 6.3"/>`),
  architecture: stroke(`<rect x="8" y="3" width="8" height="5" rx="1.2"/><rect x="3" y="16" width="7" height="5" rx="1.2"/><rect x="14" y="16" width="7" height="5" rx="1.2"/><path d="M12 8v4M6.5 16v-4h11v4"/>`),
  // Two stacked layers with a dashed dependency slipping past the lower one.
  drift: stroke(`<rect x="3.5" y="3.5" width="11" height="5" rx="1.2"/><rect x="3.5" y="15.5" width="11" height="5" rx="1.2"/><path d="M9 8.5v7"/><path d="M14.5 6h3.5v12h-3.5" stroke-dasharray="2 2.2"/><path d="M19.5 10.5l-1.5-1.5-1.5 1.5"/>`),
  // A pulse line through a shield-like frame: vital signs of the codebase.
  health: stroke(`<path d="M12 3.5l7.5 3v5.2c0 4.3-3.1 7.6-7.5 8.8-4.4-1.2-7.5-4.5-7.5-8.8V6.5z"/><path d="M6.5 12h2.8l1.4-3 2.2 6 1.5-3h3.1"/>`),
  // A shield with a keyhole.
  security: stroke(`<path d="M12 3.5l7.5 3v5.2c0 4.3-3.1 7.6-7.5 8.8-4.4-1.2-7.5-4.5-7.5-8.8V6.5z"/><circle cx="12" cy="11" r="1.8"/><path d="M12 12.8v3"/>`),
  explain: stroke(`<path d="M6 3.5h8.5L19 8v12.5H6z"/><path d="M14 3.5V8h5"/><path d="M9 12h7M9 15.5h7M9 19h4"/>`),
  engine: stroke(`<rect x="6" y="6" width="12" height="12" rx="2"/><rect x="9.5" y="9.5" width="5" height="5" rx="1"/><path d="M9 3v3M15 3v3M9 18v3M15 18v3M3 9h3M3 15h3M18 9h3M18 15h3"/>`),
  feature: stroke(`<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M8 12h8M12 8v8"/>`),
};

const icon = (key: string): string => ICONS[key] ?? ICONS.feature!;

const escapeHtml = (s: string): string => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" })[c]!);

function navItem(f: FeatureEntry): string {
  return `<a class="item" href="${dashboardHref(f.id)}" data-view="${f.id}" data-path="${escapeHtml(f.path)}" data-title="${escapeHtml(f.title)}" title="${escapeHtml(f.title)}">` +
    `${icon(f.icon)}<span class="t">${escapeHtml(f.title)}</span></a>`;
}

function card(f: FeatureEntry): string {
  return `<a class="card" href="${dashboardHref(f.id)}"><div class="card-top"><span class="card-ic">${icon(f.icon)}</span></div>` +
    `<h3>${escapeHtml(f.title)}</h3><p>${escapeHtml(f.summary)}</p><span class="open">Open <span aria-hidden="true">→</span></span></a>`;
}

const features = FEATURES.filter((f) => f.group === "feature");
const tools = FEATURES.filter((f) => f.group === "tool");

export const DASHBOARD_PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Dashboard · fehm</title><link rel="icon" type="image/svg+xml" href="${FEHM_FAVICON}">
<style>
:root{--bg:#07090d;--panel:#0b0e15;--panel-2:#11151f;--panel-3:#161b28;--line:#1a2030;--line-2:#262e42;--fg:#d6dce8;--fg-2:#b3bdcf;--muted:#7b859c;--faint:#4b546a;--accent:#7aa2f7;--accent-2:#a9c1ff;--ok:#5fd4c0;--warn:#e0af68;--err:#f7768e;--mono:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;--rail:236px}
*{box-sizing:border-box}html,body{height:100%}
body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.5 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;display:grid;grid-template-columns:var(--rail) minmax(0,1fr);overflow:hidden}
body.collapsed{--rail:60px}
a{color:inherit;text-decoration:none}
button{font:inherit;color:inherit;background:var(--panel-2);border:1px solid var(--line-2);border-radius:6px;padding:4px 10px;cursor:pointer;white-space:nowrap}
button:hover{border-color:var(--accent)}
a:focus-visible,button:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.mono{font-family:var(--mono)}
/* ——— Sidebar ——— */
#rail{display:flex;flex-direction:column;min-height:0;background:var(--panel);border-right:1px solid var(--line);overflow:hidden}
.rail-head{height:52px;flex:none;display:flex;align-items:center;gap:10px;padding:0 14px 0 16px;border-bottom:1px solid var(--line)}
.home-link{display:flex;align-items:center;border-radius:6px}
.fehm-logo{height:24px;width:auto;display:block}.fehm-mark{height:26px;width:26px;display:none}
#collapse{margin-left:auto;padding:2px 7px;color:var(--muted);background:none;border-color:transparent}#collapse:hover{border-color:var(--line-2);color:var(--fg)}
.proj{padding:12px 16px;border-bottom:1px solid var(--line);min-width:0}
.eyebrow{font-size:10.5px;letter-spacing:.14em;text-transform:uppercase;color:var(--muted);font-weight:600}
#project-name{display:block;font-weight:600;font-size:13.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-top:2px}
nav{flex:1;overflow:auto;padding:10px 8px;display:flex;flex-direction:column;gap:2px}
.group{font-size:10.5px;letter-spacing:.14em;text-transform:uppercase;color:var(--faint);font-weight:600;padding:14px 10px 6px}
.item{display:flex;align-items:center;gap:10px;padding:7px 10px;border-radius:7px;color:var(--fg-2);position:relative;white-space:nowrap}
.item:hover{background:var(--panel-2);color:var(--fg)}
.item[aria-current=page]{background:var(--panel-3);color:#fff}
.item[aria-current=page]::before{content:"";position:absolute;left:-8px;top:8px;bottom:8px;width:3px;border-radius:0 3px 3px 0;background:var(--accent)}
.item .ic{flex:none;color:var(--muted)}.item[aria-current=page] .ic{color:var(--accent)}
.item .t{overflow:hidden;text-overflow:ellipsis;flex:1}
#index-status{flex:none;display:flex;align-items:center;gap:8px;padding:12px 16px;border-top:1px solid var(--line);font-size:12px;color:var(--muted);min-width:0}
#index-status span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dot{width:8px;height:8px;border-radius:50%;flex:none;background:var(--faint)}
[data-state=ready] .dot{background:var(--ok)}[data-state=busy] .dot{background:var(--accent);animation:pulse 1s infinite alternate}[data-state=stale] .dot{background:var(--warn)}[data-state=error] .dot{background:var(--err)}
@keyframes pulse{to{opacity:.3}}
body.collapsed .fehm-logo,body.collapsed .proj,body.collapsed .item .t,body.collapsed .group,body.collapsed #index-status span{display:none}
body.collapsed .rail-head{padding:0;flex-direction:column;justify-content:center;gap:4px;height:64px}body.collapsed #collapse{margin:0;transform:scaleX(-1)}body.collapsed .fehm-mark{display:block}
body.collapsed .item{justify-content:center;padding:9px 0}body.collapsed nav{padding-top:12px}body.collapsed #index-status{justify-content:center;padding:14px 0}
/* ——— Views ——— */
#views{position:relative;min-width:0;min-height:0}
.view{position:absolute;inset:0}.view[hidden]{display:none}
.frame iframe{width:100%;height:100%;border:0;display:block;background:var(--bg)}
.loading{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;gap:10px;color:var(--muted);background:var(--bg)}
.loading[hidden]{display:none}
.loading::before{content:"";width:14px;height:14px;border-radius:50%;border:2px solid var(--line-2);border-top-color:var(--accent);animation:spin .8s linear infinite}
@keyframes spin{to{transform:rotate(1turn)}}
/* ——— Home ——— */
#view-home{overflow:auto}
.home{max-width:1080px;margin:0 auto;padding:36px 28px 64px}
.hero{position:relative;padding:26px 28px;border:1px solid var(--line);border-radius:12px;background:var(--panel);overflow:hidden}
.hero::before{content:"";position:absolute;right:-120px;top:-160px;width:460px;height:460px;background:radial-gradient(circle,color-mix(in srgb,var(--accent) 20%,transparent),transparent 65%);pointer-events:none}
.hero h1{margin:6px 0 2px;font-size:28px;font-weight:650;letter-spacing:-.01em;word-break:break-word}
#home-root{color:var(--muted);font-size:12.5px;word-break:break-all}
.hero-row{position:relative;display:flex;flex-wrap:wrap;align-items:center;gap:10px;margin-top:16px}
.pill{display:inline-flex;align-items:center;gap:7px;font-size:12.5px;padding:3px 11px;border-radius:999px;border:1px solid var(--line-2);background:var(--panel-2)}
.pill[data-state=stale]{color:var(--warn);border-color:color-mix(in srgb,var(--warn) 50%,var(--line-2))}
.pill[data-state=error]{color:var(--err)}
#home-sync{font-size:12.5px;color:var(--muted)}
#rescan{margin-left:auto}
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin-top:14px}
.stat{border:1px solid var(--line);border-radius:10px;background:var(--panel);padding:12px 16px}
.stat span{font-size:12px;color:var(--muted)}.stat b{display:block;font:600 22px/1.3 var(--mono);margin-top:2px}
h2{font-size:10.5px;letter-spacing:.14em;text-transform:uppercase;color:var(--muted);font-weight:600;margin:34px 0 12px}
.cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:12px}
.card{display:flex;flex-direction:column;gap:6px;padding:18px 18px 16px;border:1px solid var(--line);border-radius:12px;background:var(--panel);transition:border-color .15s,background .15s,transform .15s}
.card:hover{border-color:color-mix(in srgb,var(--accent) 55%,var(--line-2));background:var(--panel-2);transform:translateY(-1px)}
.card-top{display:flex;align-items:center;justify-content:space-between}
.card-ic{width:36px;height:36px;border-radius:9px;display:flex;align-items:center;justify-content:center;color:var(--accent);background:color-mix(in srgb,var(--accent) 12%,var(--panel-2));border:1px solid color-mix(in srgb,var(--accent) 25%,var(--line-2))}
.card h3{margin:6px 0 0;font-size:16px;font-weight:600}
.card p{margin:0;color:var(--fg-2);font-size:13.5px;flex:1}
.open{margin-top:6px;font-size:12.5px;color:var(--accent)}
.foot{margin-top:40px;font-size:12px;color:var(--faint)}
/* ——— Small screens: the sidebar becomes a top bar ——— */
@media (max-width:760px){
  body,body.collapsed{grid-template-columns:1fr;grid-template-rows:auto minmax(0,1fr)}
  #rail{flex-direction:row;align-items:center;border-right:0;border-bottom:1px solid var(--line)}
  .rail-head,body.collapsed .rail-head{height:48px;border:0;flex-direction:row;padding:0 10px 0 14px}
  #collapse,.proj,.group,#index-status span{display:none}
  nav{flex-direction:row;padding:6px;overflow-x:auto;align-items:center}
  .item[aria-current=page]::before{display:none}
  #index-status{border:0;padding:0 14px}
  .home{padding:20px 16px 48px}.hero{padding:20px}
}
@media (prefers-reduced-motion:reduce){.dot,.loading::before{animation:none}.card{transition:none}}
</style></head><body>
<aside id="rail" aria-label="Fehm">
  <div class="rail-head"><a class="home-link" href="${dashboardHref(HOME_ID)}" title="Fehm — overview">${FEHM_LOGO}${FEHM_MARK}</a><button id="collapse" type="button" aria-label="Collapse sidebar" aria-expanded="true" title="Collapse sidebar">«</button></div>
  <div class="proj"><span class="eyebrow">Project</span><b id="project-name">…</b></div>
  <nav aria-label="Dashboard">
    <a class="item" href="${dashboardHref(HOME_ID)}" data-view="${HOME_ID}" data-title="Overview" title="Overview">${icon("home")}<span class="t">Overview</span></a>
    ${features.length ? `<div class="group">Features</div>${features.map(navItem).join("")}` : ""}
    ${tools.length ? `<div class="group">Tools</div>${tools.map(navItem).join("")}` : ""}
  </nav>
  <footer id="index-status" data-state="busy" role="status" aria-live="polite"><i class="dot"></i><span>Loading index…</span></footer>
</aside>
<main id="views">
  <section class="view" id="view-home" data-view="${HOME_ID}" aria-label="Overview">
    <div class="home">
      <header class="hero">
        <div class="eyebrow">Codebase</div>
        <h1 id="home-name">Loading…</h1>
        <div id="home-root" class="mono"></div>
        <div class="hero-row"><span id="home-fresh" class="pill" data-state="busy"><i class="dot"></i><span>Checking index…</span></span><span id="home-sync"></span><button id="rescan" type="button" title="Re-index incrementally">⟳ Rescan index</button></div>
      </header>
      <div class="stats" id="home-stats"></div>
      ${features.length ? `<h2>Features</h2><div class="cards">${features.map(card).join("")}</div>` : ""}
      ${tools.length ? `<h2>Tools</h2><div class="cards">${tools.map(card).join("")}</div>` : ""}
      <p class="foot">Everything runs locally from the Fehm index. Nothing on this page leaves localhost.</p>
    </div>
  </section>
</main>
<script type="module" src="/dashboard/assets/dashboard/ui/main.js"></script>
</body></html>`;
