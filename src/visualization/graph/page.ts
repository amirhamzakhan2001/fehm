import { CHROME_CSS, featureNav } from "../features.js";
import { IMPORT_MAP } from "./assets.js";

/** Static shell for the Feature 3.1 graph page. All behaviour lives in ui/*.ts. */
export const GRAPH_PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Codebase Graph · fehm</title><link rel="icon" href="data:,">
<style>
:root{--bg:#06080c;--panel:#0b0e15;--panel-2:#10141d;--line:#1a2030;--line-2:#252d40;--fg:#d4dbe8;--muted:#76819a;--faint:#4a5368;--accent:#7aa2f7;--ok:#5fd4c0;--warn:#e0af68;--err:#f7768e;--mono:ui-monospace,SFMono-Regular,Menlo,monospace}
*{box-sizing:border-box}html,body{height:100%}
body{margin:0;background:var(--bg);color:var(--fg);font:13px/1.45 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;overflow:hidden;display:flex;flex-direction:column}
button{font:inherit;color:inherit;background:var(--panel-2);border:1px solid var(--line-2);border-radius:5px;padding:3px 9px;cursor:pointer}
button:hover{border-color:var(--accent)}button:focus-visible,input:focus-visible,a:focus-visible,[tabindex]:focus-visible{outline:2px solid var(--accent);outline-offset:1px}
a{color:var(--accent)}
#top{height:40px;flex:none;display:flex;align-items:center;gap:10px;padding:0 12px;border-bottom:1px solid var(--line);background:var(--panel)}
.brand{font-weight:700;letter-spacing:.14em;font-size:12px}.sep{color:var(--faint)}.page{color:var(--muted);text-transform:uppercase;letter-spacing:.08em;font-size:11px}
.project{font-family:var(--mono);font-size:12px;color:var(--fg);padding-left:6px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}
.grow{flex:1}
.status{display:inline-flex;align-items:center;gap:6px;font-size:12px;color:var(--muted);white-space:nowrap}.status i{width:7px;height:7px;border-radius:50%;background:var(--faint)}
.status[data-state=ready] i{background:var(--ok)}.status[data-state=busy] i{background:var(--accent);animation:pulse 1s infinite alternate}.status[data-state=stale] i{background:var(--warn)}.status[data-state=error] i{background:var(--err)}
@keyframes pulse{to{opacity:.3}}
#refresh[data-stale]{border-color:var(--warn);color:var(--warn)}
.nav{font-size:12px;text-decoration:none;color:var(--muted)}.nav+.nav{margin-left:10px}.nav:hover{color:var(--fg)}
#toggle-side{padding:2px 7px}
#shell{flex:1;display:flex;min-height:0;position:relative}
#side{width:304px;flex:none;display:flex;flex-direction:column;border-right:1px solid var(--line);background:var(--panel);min-height:0}
#side section{padding:10px 10px;border-bottom:1px solid var(--line)}
#side h3{margin:0 0 6px;font-size:10.5px;font-weight:600;letter-spacing:.1em;text-transform:uppercase;color:var(--muted);display:flex;align-items:center;justify-content:space-between}
#side h3 button{font-size:10px;padding:0 6px;letter-spacing:0;text-transform:none;color:var(--muted)}
.search{padding:10px 12px;border-bottom:1px solid var(--line);position:relative}
#search{width:100%;background:var(--bg);border:1px solid var(--line-2);border-radius:5px;color:var(--fg);padding:6px 8px;font:inherit}
#results{position:absolute;left:12px;right:-240px;top:40px;z-index:20;max-height:60vh;overflow:auto;background:var(--panel-2);border:1px solid var(--line-2);border-radius:6px;box-shadow:0 12px 40px #000a;padding:4px}
.result{display:grid;grid-template-columns:14px 1fr;gap:2px 8px;padding:5px 8px;border-radius:4px;cursor:pointer;align-items:center}
.result[aria-selected=true],.result:hover{background:#1b2233}.result .p{grid-column:2;font-family:var(--mono);font-size:11px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.result.outside{opacity:.55}.results-note{padding:6px 8px;color:var(--muted);font-size:12px}
.filters{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:1px 6px}
.filter{position:relative;display:flex;align-items:center;gap:5px;min-width:0;padding:3px 3px;border-radius:4px;cursor:pointer;user-select:none;font-size:11.5px}
.filter:hover{background:var(--panel-2)}.filter:focus-within{outline:1px solid var(--accent);outline-offset:-1px}
.filter input{position:absolute;opacity:0;width:1px;height:1px;margin:0;pointer-events:none}
.filter .name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.filter .n{flex:none;font-family:var(--mono);font-size:10.5px;color:var(--muted)}
.filter.off .name,.filter.off .n{color:var(--faint)}
.filter.off .sw.node{background:transparent;box-shadow:inset 0 0 0 1.5px var(--c)}.filter.off .sw.edge{opacity:.35}
.sw{width:10px;height:10px;flex:none;display:inline-block}.sw.node{width:8px;height:8px;margin:0 1px;border-radius:50%;background:var(--c);box-shadow:0 0 6px 2px color-mix(in srgb,var(--c) 55%,transparent)}
.sw.edge{height:2px;border-radius:1px}
.side-scroll{flex:1;min-height:0;overflow-y:auto;overscroll-behavior:contain}
.tree-section{min-height:160px}
#tree{font-size:12px}
.row{display:flex;align-items:center;gap:4px;padding:1px 4px;border-radius:3px;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.row:hover{background:var(--panel-2)}.row[aria-selected=true]{background:#1c2740;color:#fff}
.row .tw{width:12px;flex:none;color:var(--muted);text-align:center}.row .nm{overflow:hidden;text-overflow:ellipsis}
.row.file .nm{color:#b7c3d7}.row.dir .nm{color:var(--accent)}
#side-stats{padding:8px 12px;font-size:11.5px;color:var(--muted);display:grid;grid-template-columns:1fr 1fr;gap:2px 10px;border-top:1px solid var(--line)}
#side-stats b{color:var(--fg);font-weight:500;font-family:var(--mono)}#side-stats .full{grid-column:1/-1}
#side-stats button{font-size:11px;padding:1px 6px;margin-top:4px}
#stage{flex:1;position:relative;min-width:0;overflow:hidden;background:radial-gradient(ellipse at 50% 45%,#0b1020 0%,#06080c 70%)}
#gl,#labels{position:absolute;inset:0;width:100%;height:100%;display:block}
#gl{touch-action:none;cursor:grab}#gl.dragging{cursor:grabbing}#gl.pointing{cursor:pointer}
#labels{pointer-events:none}
#tooltip{position:absolute;pointer-events:none;z-index:5;background:#0d111bf2;border:1px solid var(--line-2);border-radius:6px;padding:6px 9px;max-width:340px;font-size:12px;box-shadow:0 8px 24px #0008}
#tooltip .k{color:var(--muted);font-size:10.5px;text-transform:uppercase;letter-spacing:.08em}#tooltip .p{font-family:var(--mono);font-size:11px;color:var(--muted);word-break:break-all}#tooltip .c{color:var(--muted);font-size:11px;margin-top:2px}
#controls{position:absolute;right:12px;bottom:12px;display:flex;flex-direction:column;gap:4px;z-index:4}
#controls button{width:32px;height:30px;padding:0;background:#0d111be6}#controls button[aria-pressed=false]{color:var(--faint)}
#hud{position:absolute;left:12px;bottom:10px;font-size:11px;color:var(--muted);font-family:var(--mono);pointer-events:none;z-index:4}
#notice{position:absolute;top:12px;left:50%;transform:translateX(-50%);z-index:6;background:#0d111bf2;border:1px solid var(--line-2);border-radius:6px;padding:6px 12px;font-size:12px;color:var(--fg);max-width:80%}
#overlay{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;z-index:8;background:#06080cd0}
#overlay[hidden]{display:none}
#overlay .panel{max-width:420px;text-align:center;padding:24px}
#overlay h2{font-size:16px;margin:0 0 8px;font-weight:600}#overlay p{color:var(--muted);margin:0 0 14px}
#overlay pre{text-align:left;font-size:11px;white-space:pre-wrap;color:var(--muted);max-height:30vh;overflow:auto}
#overlay-action{background:var(--accent);color:#06080c;border:0;padding:6px 14px;font-weight:600}
#inspector{width:320px;flex:none;border-left:1px solid var(--line);background:var(--panel);overflow:auto;padding:14px 14px 24px}
#inspector .hd{display:flex;align-items:flex-start;gap:8px}#inspector h2{margin:0;font-size:15px;font-weight:600;word-break:break-word;flex:1}
#inspector .x{padding:0 7px;color:var(--muted)}
.badge{display:inline-flex;align-items:center;gap:6px;font-size:10.5px;letter-spacing:.1em;text-transform:uppercase;color:var(--muted);margin:4px 0 8px}
.loc{font-family:var(--mono);font-size:11.5px;color:#b7c3d7;word-break:break-all}
.actions{display:flex;gap:6px;flex-wrap:wrap;margin:10px 0}.actions a,.actions button{font-size:12px}
.actions a{border:1px solid var(--line-2);border-radius:5px;padding:3px 9px;text-decoration:none;background:var(--panel-2)}
#inspector h4{margin:14px 0 6px;font-size:10.5px;letter-spacing:.1em;text-transform:uppercase;color:var(--muted);font-weight:600}
.rel{border-top:1px solid var(--line)}.rel summary{display:flex;justify-content:space-between;padding:4px 2px;cursor:pointer;list-style:none}.rel summary::-webkit-details-marker{display:none}
.rel summary .n{font-family:var(--mono);color:var(--muted)}.rel ul{list-style:none;margin:0 0 6px;padding:0}
.rel li{padding:2px 4px 2px 10px;cursor:pointer;border-radius:3px;display:flex;gap:6px;align-items:baseline}.rel li:hover{background:var(--panel-2)}.rel li .p{font-family:var(--mono);font-size:10.5px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.summary{color:#c0c9d8;margin:0}.sig{font-family:var(--mono);font-size:11px;background:var(--bg);border:1px solid var(--line);border-radius:5px;padding:8px;white-space:pre-wrap;word-break:break-word;margin:0}
.meta{font-size:11.5px;color:var(--muted)}
body.fullscreen #top,body.fullscreen #side,body.fullscreen #inspector{display:none}
body.side-closed #side{display:none}
${CHROME_CSS}
@media (max-width:760px){
  #side{position:absolute;inset:0 auto 0 0;z-index:10;width:min(300px,86vw);box-shadow:8px 0 30px #000a}
  #inspector{position:absolute;left:0;right:0;bottom:0;width:auto;max-height:52%;z-index:9;border-left:0;border-top:1px solid var(--line-2)}
  #results{right:0}.page,.nav{display:none}
}
@media (prefers-reduced-motion:reduce){.status[data-state=busy] i{animation:none}}
</style></head><body>
<header id="top">
  <button id="toggle-side" title="Toggle panel" aria-label="Toggle panel">☰</button>
  <span class="brand">FEHM</span><span class="sep">/</span><span class="page">Codebase graph</span>
  <span id="project" class="project"></span>
  <span class="grow"></span>
  <span id="status" class="status" data-state="busy" role="status" aria-live="polite"><i></i><span>Loading…</span></span>
  <button id="refresh" title="Refresh from the index">⟳ Refresh</button>
  ${featureNav("graph")}
</header>
<div id="shell">
  <aside id="side" aria-label="Graph controls">
    <div class="search"><input id="search" type="search" placeholder="Search entities…   /" autocomplete="off" spellcheck="false" aria-label="Search entities" aria-controls="results"><div id="results" role="listbox" hidden></div></div>
    <div class="side-scroll">
      <section><h3>Node types <button id="nodes-all" type="button">all</button></h3><div id="node-filters" class="filters"></div></section>
      <section><h3>Relationships <button id="edges-all" type="button">all</button></h3><div id="edge-filters" class="filters"></div></section>
      <section class="tree-section"><h3>Project</h3><div id="tree" role="tree" aria-label="Project tree"></div></section>
    </div>
    <footer id="side-stats"></footer>
  </aside>
  <main id="stage">
    <canvas id="gl" aria-label="Codebase graph canvas" tabindex="0"></canvas><canvas id="labels" aria-hidden="true"></canvas>
    <div id="tooltip" hidden></div>
    <div id="notice" role="status" hidden></div>
    <div id="controls">
      <button id="zoom-in" title="Zoom in (+)" aria-label="Zoom in">+</button>
      <button id="zoom-out" title="Zoom out (−)" aria-label="Zoom out">−</button>
      <button id="fit" title="Fit to view (F)" aria-label="Fit to view">⤢</button>
      <button id="labels-toggle" title="Labels (L)" aria-label="Toggle labels" aria-pressed="true">Aa</button>
      <button id="fullscreen" title="Focus mode — hide panels (Shift+F)" aria-label="Toggle focus mode" aria-pressed="false">⛶</button>
    </div>
    <div id="hud"></div>
    <div id="overlay"><div class="panel"><h2 id="overlay-title">Loading graph…</h2><p id="overlay-text"></p><button id="overlay-action" hidden></button><details id="overlay-details" hidden><summary>Details</summary><pre></pre></details></div></div>
  </main>
  <aside id="inspector" aria-label="Inspector" hidden></aside>
</div>
<script type="importmap">${IMPORT_MAP}</script>
<script type="module" src="/graph/assets/ui/main.js"></script>
</body></html>`;
