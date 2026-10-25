import { CHROME_CSS, featureNav } from "../features.js";
import { DIAGRAM_CSS } from "./diagram-css.js";

/**
 * Static shell for the Feature 3.3 architecture page. Canvas first: the
 * diagram takes the space, detail lives in the inspector, and nothing is
 * drawn over the canvas. All behaviour is in ui/main.ts.
 */
export const ARCHITECTURE_PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Architecture · fehm</title><link rel="icon" href="data:,">
<style>
:root{--bg:#07090d;--canvas:#090c12;--panel:#0c0f16;--panel-2:#11151f;--panel-3:#161b28;--line:#1b2130;--line-2:#262e42;--fg:#d6dce8;--fg-2:#b3bdcf;--muted:#7b859c;--faint:#4b546a;--accent:#7aa2f7;--accent-2:#a9c1ff;--ok:#5fd4c0;--likely:#e0af68;--unknown:#8a93a8;--err:#f7768e;--data:#bb9af7;--ext:#e0af68;--mono:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;--sans:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Helvetica,Arial,sans-serif}
*{box-sizing:border-box}html,body{height:100%}
body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.5 var(--sans);display:grid;grid-template-rows:44px auto minmax(0,1fr) auto;overflow:hidden}
a{color:var(--accent);text-decoration:none}a:hover{text-decoration:underline}
button{font:inherit;color:inherit;background:var(--panel-2);border:1px solid var(--line-2);border-radius:6px;padding:3px 10px;cursor:pointer;white-space:nowrap}
button:hover{border-color:var(--accent)}button:disabled{opacity:.45;cursor:default;border-color:var(--line-2)}
button:focus-visible,input:focus-visible,a:focus-visible,[tabindex]:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
code,.mono{font-family:var(--mono);font-size:12px}
#top{display:flex;align-items:center;gap:10px;padding:0 16px;border-bottom:1px solid var(--line);background:var(--panel);min-width:0}
.brand{font-weight:700;letter-spacing:.14em;font-size:12px}.sep{color:var(--faint)}.page{color:var(--muted);text-transform:uppercase;letter-spacing:.08em;font-size:11px;white-space:nowrap}
.project{font-family:var(--mono);font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}
.grow{flex:1}
.nav{font-size:12.5px;color:var(--muted)}.nav:hover{color:var(--fg);text-decoration:none}
.status{display:inline-flex;align-items:center;gap:6px;font-size:12px;color:var(--muted);white-space:nowrap}.status i{width:7px;height:7px;border-radius:50%;background:var(--faint)}
.status[data-state=ready] i{background:var(--ok)}.status[data-state=busy] i{background:var(--accent);animation:pulse 1s infinite alternate}.status[data-state=stale] i{background:var(--likely)}.status[data-state=error] i{background:var(--err)}
@keyframes pulse{to{opacity:.3}}
#refresh[data-stale]{border-color:var(--likely);color:var(--likely)}
#search-wrap{position:relative;width:min(320px,34vw)}
#search{width:100%;background:var(--bg);border:1px solid var(--line-2);border-radius:6px;color:var(--fg);padding:5px 10px;font:inherit;font-size:13px}
#results{position:absolute;top:calc(100% + 4px);left:0;right:0;z-index:30;background:var(--panel-2);border:1px solid var(--line-2);border-radius:8px;box-shadow:0 14px 40px #000a;padding:4px;display:grid;max-height:60vh;overflow:auto}
#results[hidden]{display:none}
#results button{border:0;background:none;text-align:left;padding:6px 8px;border-radius:5px;display:grid;grid-template-columns:auto 1fr;gap:0 8px;align-items:baseline}
#results button:hover,#results button[aria-selected=true]{background:var(--panel-3)}
#results .k{font-size:10px;text-transform:uppercase;letter-spacing:.08em;color:var(--muted)}#results .p{grid-column:2;font-family:var(--mono);font-size:11px;color:var(--faint);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#bar{display:flex;align-items:center;gap:10px;padding:8px 16px;border-bottom:1px solid var(--line);background:var(--panel);flex-wrap:wrap;min-width:0}
#tabs{display:inline-flex;gap:2px;background:var(--bg);border:1px solid var(--line-2);border-radius:8px;padding:2px}
#tabs button{border:0;background:none;padding:4px 12px;border-radius:6px;color:var(--muted);font-size:13px}
#tabs button[aria-selected=true]{background:var(--panel-3);color:var(--fg)}
#tabs button:disabled{opacity:.38}#tabs .gsep{width:1px;background:var(--line-2);margin:4px 3px}
#option-wrap{display:inline-flex;align-items:center;gap:6px;font-size:12.5px;color:var(--muted);min-width:0}#option-wrap[hidden]{display:none}
#option{max-width:min(420px,40vw);background:var(--bg);color:var(--fg);border:1px solid var(--line-2);border-radius:6px;padding:3px 6px;font:inherit;font-size:12.5px}
#crumbs{display:flex;align-items:center;gap:4px;font-size:12.5px;color:var(--muted);min-width:0;overflow:hidden;white-space:nowrap}
#crumbs button{border:0;background:none;padding:2px 4px;color:var(--accent);font-size:12.5px}#crumbs span.cur{color:var(--fg);overflow:hidden;text-overflow:ellipsis}
#crumbs .div{color:var(--faint)}
.tools{display:inline-flex;gap:4px;align-items:center}.tools button{padding:3px 9px;font-size:12.5px}
#zoom{font-family:var(--mono);font-size:11.5px;color:var(--muted);min-width:42px;text-align:right}
#focusmode{display:inline-flex;gap:2px;align-items:center;font-size:12px;color:var(--muted)}#focusmode[hidden]{display:none}
#focusmode button{padding:2px 8px;font-size:12px}#focusmode button[aria-pressed=true]{border-color:var(--accent);color:var(--accent-2)}
#main{display:grid;grid-template-columns:minmax(0,1fr) 360px;min-height:0}
#stage{position:relative;min-width:0;min-height:0;background:var(--canvas);overflow:hidden}
#canvas{width:100%;height:100%;display:block;cursor:grab;touch-action:none;user-select:none}
#canvas.panning{cursor:grabbing}
#inspector{border-left:1px solid var(--line);background:var(--panel);overflow:auto;min-height:0}
#foot{display:flex;gap:14px;align-items:center;padding:5px 16px;border-top:1px solid var(--line);background:var(--panel);font-size:12px;color:var(--muted);min-width:0;flex-wrap:wrap}
#foot b{color:var(--fg-2);font-weight:560}#foot .note{color:var(--likely)}
.cov{display:inline-flex;gap:8px;align-items:center}.cov span{display:inline-flex;gap:4px;align-items:center}
/* message panel shown instead of a diagram */
#message{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;padding:24px}#message[hidden]{display:none}
#message .box{max-width:620px;background:var(--panel);border:1px solid var(--line-2);border-radius:10px;padding:18px 20px}
#message h2{margin:0 0 6px;font-size:16px}#message p{color:var(--muted);margin:0 0 10px}#message ul{margin:0 0 12px;padding-left:18px;font-size:12.5px;color:var(--fg-2)}#message code{color:var(--likely)}
#draftbar{position:absolute;left:0;right:0;top:0;padding:6px 12px;background:color-mix(in srgb,var(--err) 16%,var(--panel));border-bottom:1px solid var(--err);font-size:12.5px}#draftbar[hidden]{display:none}
/* diagram */
${DIAGRAM_CSS}
@media (prefers-reduced-motion:reduce){*{transition:none!important;animation:none!important}}
/* inspector */
.insp{padding:14px 16px 28px;display:grid;gap:14px;font-size:13px}
.insp h2{margin:0;font-size:16px;font-weight:620;word-break:break-word}.insp .eyebrow{font-size:10.5px;letter-spacing:.12em;text-transform:uppercase;color:var(--muted);font-weight:600}
.insp .head{display:grid;grid-template-columns:1fr auto;gap:2px 8px;align-items:start}.insp .head .x{border:0;background:none;color:var(--muted);font-size:16px;padding:0 4px}
.insp h3{margin:0 0 6px;font-size:10.5px;letter-spacing:.12em;text-transform:uppercase;color:var(--muted);font-weight:600;display:flex;justify-content:space-between;gap:8px}
.insp p{margin:0;color:var(--fg-2)}
.badge{display:inline-flex;align-items:center;gap:6px;font-size:11px;font-weight:650;letter-spacing:.08em;padding:2px 8px;border-radius:5px;border:1px solid;text-transform:uppercase}
.badge.verified{color:var(--ok);border-color:color-mix(in srgb,var(--ok) 45%,transparent)}.badge.strong{color:var(--ok);border-color:color-mix(in srgb,var(--ok) 30%,transparent);border-style:dashed}
.badge.inferred{color:var(--likely);border-color:color-mix(in srgb,var(--likely) 45%,transparent)}.badge.unknown{color:var(--unknown);border-color:var(--line-2);border-style:dashed}
.reasons{margin:6px 0 0;padding-left:16px;color:var(--muted);font-size:12.5px}
.stats{display:flex;gap:14px;flex-wrap:wrap;font-size:12.5px;color:var(--muted)}.stats b{color:var(--fg);font-family:var(--mono);font-weight:560}
.actions{display:flex;gap:6px;flex-wrap:wrap}.actions a,.actions button{font-size:12.5px;padding:3px 10px;border:1px solid var(--line-2);border-radius:6px;background:var(--panel-2);color:var(--fg)}.actions a:hover{text-decoration:none;border-color:var(--accent)}
ul.rel{list-style:none;margin:0;padding:0;display:grid;gap:2px}ul.rel li{display:flex;align-items:baseline;gap:8px;padding:4px 6px;border-radius:5px}ul.rel li:hover{background:var(--panel-2)}
ul.rel button.name{border:0;background:none;padding:0;color:var(--fg);text-align:left;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis}ul.rel button.name:hover{color:var(--accent-2)}
ul.rel .t{font-size:11px;color:var(--muted);font-family:var(--mono)}.pill{font-size:10.5px;padding:0 6px;border-radius:4px;background:var(--panel-3);color:var(--fg-2);border:1px solid var(--line-2);white-space:nowrap;font-family:var(--mono)}
.ev{border:1px solid var(--line);border-radius:6px;overflow:hidden}.ev+.ev{margin-top:4px}
.ev .row{display:flex;gap:8px;align-items:baseline;padding:5px 8px;flex-wrap:wrap}.ev .row .p{font-family:var(--mono);font-size:11.5px;word-break:break-all;flex:1;min-width:0}.ev .row .d{flex-basis:100%;color:var(--muted);font-size:12px;word-break:break-word}
.ev .act{font-size:11px;padding:0 7px;border-radius:4px;background:transparent;color:var(--muted)}
pre.code{margin:0;padding:8px 0;background:var(--bg);border-top:1px solid var(--line);font:11.5px/1.5 var(--mono);overflow:auto;max-height:280px}
pre.code span{display:block;padding:0 10px;white-space:pre}pre.code span.f{background:color-mix(in srgb,var(--accent) 14%,transparent)}pre.code i{color:var(--faint);font-style:normal;display:inline-block;width:38px}
.legend{display:grid;gap:6px;font-size:12.5px;color:var(--fg-2)}.legend .li{display:flex;gap:10px;align-items:center}.legend svg{flex:none}
.muted{color:var(--muted)}.small{font-size:12px}
${CHROME_CSS}
@media (max-width:980px){#main{grid-template-columns:1fr;grid-template-rows:minmax(0,1fr) minmax(0,42%)}#inspector{border-left:0;border-top:1px solid var(--line)}.page{display:none}#search-wrap{width:auto;flex:1}}
@media (max-width:620px){#main{grid-template-rows:minmax(0,1fr) auto}#inspector{max-height:46vh}#inspector:not(.open){max-height:40px;overflow:hidden}.tools .opt{display:none}}
</style></head><body>
<header id="top">
  <span class="brand">FEHM</span><span class="sep">/</span><span class="page">Architecture</span>
  <span id="project" class="project"></span>
  <span class="grow"></span>
  <div id="search-wrap" role="combobox" aria-expanded="false" aria-owns="results" aria-haspopup="listbox">
    <input id="search" type="search" placeholder="Find component, module, file or symbol  /" autocomplete="off" aria-label="Search the architecture" aria-controls="results">
    <div id="results" role="listbox" hidden></div>
  </div>
  <span id="status" class="status" data-state="busy" role="status" aria-live="polite"><i></i><span>Loading…</span></span>
  <button id="refresh" title="Re-index incrementally and rebuild the architecture">⟳ Refresh</button>
  ${featureNav("architecture")}
</header>
<div id="bar">
  <div id="tabs" role="tablist" aria-label="Architecture views"></div>
  <label id="option-wrap" hidden><span id="option-label"></span><select id="option"></select></label>
  <nav id="crumbs" aria-label="Drill-down path"></nav>
  <span class="grow"></span>
  <span id="focusmode" hidden role="group" aria-label="Highlight around the selection"><span>Highlight</span>
    <button data-mode="up" aria-pressed="false" title="What leads to the selection">Upstream</button><button data-mode="down" aria-pressed="false" title="What the selection leads to">Downstream</button><button data-mode="both" aria-pressed="false">Both</button>
  </span>
  <span class="tools"><button id="zoom-out" title="Zoom out (−)" aria-label="Zoom out">−</button><span id="zoom">100%</span><button id="zoom-in" title="Zoom in (+)" aria-label="Zoom in">+</button><button id="fit" title="Fit to view (F)">Fit</button><button id="reset" class="opt" title="Actual size (0)">1:1</button></span>
</div>
<div id="main">
  <div id="stage">
    <svg id="canvas" role="application" aria-roledescription="architecture diagram" aria-label="Architecture diagram" xmlns="http://www.w3.org/2000/svg"></svg>
    <div id="draftbar" hidden role="alert"></div>
    <div id="message" hidden></div>
  </div>
  <aside id="inspector" aria-label="Inspector" aria-live="polite"></aside>
</div>
<footer id="foot" aria-live="polite"></footer>
<script type="module" src="/architecture/assets/architecture/ui/main.js"></script>
</body></html>`;
