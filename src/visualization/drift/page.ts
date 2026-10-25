import { DIAGRAM_CSS } from "../architecture/diagram-css.js";
import { CHROME_CSS, featureNav } from "../features.js";

/**
 * Static shell for the Feature 3.4 page: Overview · Drift map · Findings ·
 * Patterns · History, one global filter bar and a right-side evidence drawer
 * that never navigates away. Language throughout is "observed vs common /
 * established", never "wrong vs correct". All behaviour is in ui/main.ts.
 */
export const DRIFT_PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Architecture Drift · fehm</title><link rel="icon" href="data:,">
<style>
:root{--bg:#07090d;--canvas:#090c12;--panel:#0c0f16;--panel-2:#11151f;--panel-3:#161b28;--line:#1b2130;--line-2:#262e42;--fg:#d6dce8;--fg-2:#b3bdcf;--muted:#7b859c;--faint:#4b546a;--accent:#7aa2f7;--accent-2:#a9c1ff;--ok:#5fd4c0;--likely:#e0af68;--unknown:#8a93a8;--err:#f7768e;--data:#bb9af7;--ext:#e0af68;--mono:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;--sans:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Helvetica,Arial,sans-serif;--radius:8px;
--a-critical:#f7768e;--a-high:#ff9e64;--a-moderate:#e0af68;--a-low:#7aa2f7;--a-informational:#7b859c}
*{box-sizing:border-box}html{scroll-behavior:smooth}
body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.5 var(--sans)}
a{color:var(--accent);text-decoration:none}a:hover{text-decoration:underline}
button,select,textarea{font:inherit;color:inherit;background:var(--panel-2);border:1px solid var(--line-2);border-radius:6px;padding:3px 10px}
button{cursor:pointer;white-space:nowrap}button:hover{border-color:var(--accent)}button:disabled{opacity:.45;cursor:default;border-color:var(--line-2)}
button.primary{background:color-mix(in srgb,var(--accent) 22%,var(--panel-2));border-color:var(--accent);color:#fff}
button:focus-visible,input:focus-visible,select:focus-visible,a:focus-visible,textarea:focus-visible,[tabindex]:focus-visible,summary:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
code,.mono{font-family:var(--mono);font-size:12.5px}
.muted{color:var(--muted)}.small{font-size:12px}
#top{position:sticky;top:0;z-index:30;height:44px;display:flex;align-items:center;gap:10px;padding:0 16px;border-bottom:1px solid var(--line);background:color-mix(in srgb,var(--panel) 94%,transparent);backdrop-filter:blur(8px);min-width:0}
.brand{font-weight:700;letter-spacing:.14em;font-size:12px}.sep{color:var(--faint)}.page{color:var(--muted);text-transform:uppercase;letter-spacing:.08em;font-size:11px;white-space:nowrap}
.project{font-family:var(--mono);font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}.grow{flex:1}
.nav{font-size:12.5px;color:var(--muted)}.nav:hover{color:var(--fg);text-decoration:none}
.status{display:inline-flex;align-items:center;gap:6px;font-size:12px;color:var(--muted);white-space:nowrap}.status i{width:7px;height:7px;border-radius:50%;background:var(--faint)}
.status[data-state=ready] i{background:var(--ok)}.status[data-state=busy] i{background:var(--accent);animation:pulse 1s infinite alternate}.status[data-state=stale] i{background:var(--likely)}.status[data-state=error] i{background:var(--err)}
@keyframes pulse{to{opacity:.3}}
#refresh[data-stale]{border-color:var(--likely);color:var(--likely)}
#search-wrap{position:relative;width:min(340px,32vw)}
#search{width:100%;background:var(--bg);border:1px solid var(--line-2);border-radius:6px;color:var(--fg);padding:5px 10px;font:inherit;font-size:13px}
#results{position:absolute;top:calc(100% + 4px);left:0;right:0;z-index:40;background:var(--panel-2);border:1px solid var(--line-2);border-radius:8px;box-shadow:0 14px 40px #000a;padding:4px;display:grid;max-height:65vh;overflow:auto}#results[hidden]{display:none}
#results h6{margin:6px 8px 2px;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:var(--muted)}
#results button{border:0;background:none;text-align:left;padding:5px 8px;border-radius:5px;display:grid;white-space:normal}#results button:hover{background:var(--panel-3)}
#results .p{font-family:var(--mono);font-size:11px;color:var(--faint)}
#ctx{display:flex;flex-wrap:wrap;gap:8px 16px;align-items:center;padding:8px 16px;border-bottom:1px solid var(--line);background:var(--panel);font-size:12.5px;color:var(--fg-2)}
#ctx b{color:var(--fg);font-weight:600}#ctx .bl{display:inline-flex;gap:6px;align-items:center;flex-wrap:wrap}
.chk{display:inline-flex;gap:4px;align-items:center;padding:1px 8px;border:1px solid var(--line-2);border-radius:999px;background:var(--panel-2);font-size:12px}.chk:hover{border-color:var(--accent)}.chk i{font-style:normal;color:var(--ok)}.chk.off i{color:var(--faint)}
#bar{position:sticky;top:44px;z-index:25;display:flex;flex-wrap:wrap;gap:8px 12px;align-items:center;padding:8px 16px;border-bottom:1px solid var(--line);background:color-mix(in srgb,var(--bg) 94%,transparent);backdrop-filter:blur(8px)}
#tabs{display:inline-flex;gap:2px;background:var(--panel);border:1px solid var(--line-2);border-radius:8px;padding:2px;flex-wrap:wrap}
#tabs button{border:0;background:none;padding:4px 12px;border-radius:6px;color:var(--muted);font-size:13px}#tabs button[aria-selected=true]{background:var(--panel-3);color:var(--fg)}
#tabs button i{font-style:normal;font-family:var(--mono);font-size:11px;color:var(--faint);margin-left:5px}
#filters{display:flex;gap:6px;flex-wrap:wrap;align-items:center;font-size:12.5px}#filters[hidden]{display:none}
#filters select{font-size:12.5px;padding:3px 6px;max-width:170px}#filters label{display:inline-flex;gap:5px;align-items:center;color:var(--muted)}
.wrap{max-width:1500px;margin:0 auto;padding:16px 16px 80px}
.tab[hidden]{display:none}
.card{background:var(--panel);border:1px solid var(--line);border-radius:var(--radius);min-width:0}
.sec{padding:14px 16px}.sec>header{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap;margin-bottom:10px}.sec h2{margin:0;font-size:15.5px;font-weight:620}.q{font-size:12.5px;color:var(--muted)}
.grid{display:grid;gap:14px}.cols-2{display:grid;grid-template-columns:minmax(0,1.2fr) minmax(0,1fr);gap:14px}
.eyebrow{font-size:10.5px;letter-spacing:.14em;text-transform:uppercase;color:var(--muted);font-weight:600}
h1{margin:2px 0 2px;font-size:23px;font-weight:650;letter-spacing:-.01em}.lead{margin:0;color:var(--fg-2)}
.stats{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:10px;margin-top:14px}
.stat{border:1px solid var(--line-2);border-radius:8px;padding:10px 12px;background:var(--panel-2);text-align:left;display:grid;gap:2px;white-space:normal}
.stat b{font-size:24px;font-weight:650;font-family:var(--mono);line-height:1.2}.stat span{font-size:12px;color:var(--muted)}
.stat.hi b{color:var(--a-high)}.stat.new b{color:var(--accent-2)}
.note{font-size:12.5px;color:var(--muted)}
dl.kv{margin:0;display:grid;grid-template-columns:minmax(110px,160px) 1fr;border:1px solid var(--line);border-radius:6px;overflow:hidden;font-size:13px}
dl.kv dt,dl.kv dd{margin:0;padding:6px 10px;border-bottom:1px solid var(--line)}dl.kv dt{color:var(--muted);background:var(--panel-2)}dl.kv>:nth-last-child(-n+2){border-bottom:0}
dl.kv details summary{cursor:pointer}dl.kv ul{margin:4px 0 0;padding-left:16px;color:var(--muted);font-size:12px}
.clusters{display:grid;gap:4px}.cl{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:2px 10px;align-items:center;padding:6px 10px;border:1px solid var(--line);border-radius:6px;background:var(--panel-2);text-align:left;white-space:normal}
.cl:hover{border-color:var(--accent)}.cl b{font-family:var(--mono)}.cl .c{grid-column:1/-1;font-size:11.5px;color:var(--muted)}
.cl[aria-pressed=true]{border-color:var(--accent);background:var(--panel-3)}
.att{display:inline-flex;align-items:center;gap:5px;font-size:10.5px;letter-spacing:.07em;font-weight:650;text-transform:uppercase;padding:1px 7px;border-radius:5px;border:1px solid;white-space:nowrap}
.att::before{content:"";width:7px;height:7px;border-radius:2px;background:currentColor}
.att.critical{color:var(--a-critical)}.att.high{color:var(--a-high)}.att.moderate{color:var(--a-moderate)}.att.low{color:var(--a-low)}.att.informational{color:var(--a-informational)}
.att.critical::before{transform:rotate(45deg)}.att.informational::before{border-radius:50%;background:none;border:1.5px solid currentColor}
.pill{font-size:10.5px;padding:1px 7px;border-radius:999px;background:var(--panel-3);color:var(--fg-2);border:1px solid var(--line-2);white-space:nowrap}
.pill.new{color:var(--accent-2);border-color:var(--accent)}.pill.undated{border-style:dashed;color:var(--muted)}.pill.resolved{color:var(--ok)}
.pill.conf-high{color:var(--fg)}.pill.conf-low{color:var(--muted);border-style:dashed}
.flist{display:grid;gap:6px}
.fc{border:1px solid var(--line);border-left:3px solid var(--line-2);border-radius:6px;background:var(--panel-2)}
.fc.critical{border-left-color:var(--a-critical)}.fc.high{border-left-color:var(--a-high)}.fc.moderate{border-left-color:var(--a-moderate)}.fc.low{border-left-color:var(--a-low)}.fc.informational{border-left-color:var(--a-informational);border-left-style:dashed}
.fc>button.head{all:unset;box-sizing:border-box;cursor:pointer;width:100%;padding:8px 12px;display:grid;grid-template-columns:minmax(0,1fr) auto;gap:3px 10px}
.fc>button.head:hover{background:var(--panel-3)}.fc>button.head:focus-visible{outline:2px solid var(--accent)}
.fc .t{font-weight:560;word-break:break-word}.fc .meta{display:flex;gap:5px;align-items:center;flex-wrap:wrap;justify-content:flex-end}
.fc .line{grid-column:1/-1;font-size:12.5px;color:var(--fg-2);word-break:break-word}.fc .line span{color:var(--muted)}
.fc.sel{box-shadow:0 0 0 2px var(--accent)}
.grp{margin:12px 0 6px;font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:var(--muted);font-weight:600;display:flex;gap:8px}.grp i{font-style:normal;font-family:var(--mono);color:var(--faint)}
.emptyline{padding:14px;border:1px dashed var(--line-2);border-radius:6px;color:var(--muted);font-size:13px;text-align:center}
.tscroll{overflow:auto;border:1px solid var(--line);border-radius:6px;max-height:70vh}
table.t{width:100%;border-collapse:collapse;font-size:13px}
table.t th{position:sticky;top:0;background:var(--panel-2);text-align:left;font-weight:560;color:var(--muted);font-size:11.5px;padding:7px 10px;border-bottom:1px solid var(--line-2);white-space:nowrap}
table.t td{padding:6px 10px;border-bottom:1px solid var(--line);vertical-align:top}table.t tr:last-child td{border-bottom:0}
table.t tr.clickable{cursor:pointer}table.t tr.clickable:hover td{background:var(--panel-2)}
.ok{color:var(--ok)}.no{color:var(--faint)}
.maplayout{display:grid;grid-template-columns:230px minmax(0,1fr) 320px;gap:12px;min-height:0}
.mapstage{position:relative;height:clamp(380px,64vh,720px);border:1px solid var(--line-2);border-radius:8px;background:var(--canvas);overflow:hidden}
.mapstage svg{width:100%;height:100%;display:block;cursor:grab;touch-action:none;user-select:none}
.mapstage .empty{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;padding:24px;text-align:center;color:var(--muted)}
.maptools{position:absolute;top:8px;right:8px;display:flex;gap:4px;z-index:2}.maptools button{padding:2px 9px;font-size:12px;background:var(--panel)}
.maplevel{position:absolute;top:8px;left:8px;z-index:2;display:inline-flex;gap:2px;background:var(--panel);border:1px solid var(--line-2);border-radius:7px;padding:2px}
.maplevel button{border:0;background:none;padding:2px 10px;font-size:12px;color:var(--muted)}.maplevel button[aria-pressed=true]{background:var(--panel-3);color:var(--fg)}
.maplegend{display:flex;gap:14px;flex-wrap:wrap;font-size:12px;color:var(--muted);margin-top:6px}.key{display:inline-flex;align-items:center;gap:5px}
.key line{stroke-width:2}.k-ok{stroke:#56627c}.k-hi{stroke:var(--err);stroke-width:3!important}.k-mod{stroke:var(--likely);stroke-dasharray:5 3}
.side{display:grid;gap:10px;align-content:start;max-height:clamp(380px,64vh,720px);overflow:auto}
${DIAGRAM_CSS}
.node.drifted .shape{stroke:var(--likely);stroke-width:2}.node.drifted.hot .shape{stroke:var(--err)}
.node .badge circle{fill:var(--likely)}.node.hot .badge circle{fill:var(--err)}.node .badge text{font-size:10px;font-weight:700;fill:#0b0e14}
svg .dim{opacity:.14}
.eo{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:10px}#dbody>*{min-width:0}
.eo>div{border:1px solid var(--line);border-radius:8px;padding:10px 12px;background:var(--bg);min-width:0}
.eo h4{margin:0 0 8px;font-size:10.5px;letter-spacing:.12em;text-transform:uppercase;font-weight:650}.eo .c h4{color:var(--ok)}.eo .o h4{color:var(--likely)}
.chain{display:flex;flex-direction:column;align-items:flex-start}.chain .n{padding:4px 10px;border:1px solid var(--line-2);border-radius:6px;background:var(--panel-2);font-size:12.5px;max-width:100%;overflow-wrap:anywhere}
.chain .n.dev{border-color:var(--likely);color:var(--likely)}.chain .arr{color:var(--faint);padding:1px 12px;font-size:12px}
.eo .txt{margin:8px 0 0;font-size:12.5px;color:var(--fg-2);overflow-wrap:anywhere}
.pgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(340px,1fr));gap:10px}
.pc{border:1px solid var(--line);border-radius:8px;background:var(--panel-2);padding:10px 12px;display:grid;gap:6px;align-content:start}
.pc.weak{opacity:.72}.pc h3{margin:0;font-size:13.5px;font-weight:600;display:flex;gap:8px;justify-content:space-between;align-items:baseline}
.pc .st{font-size:12.5px;color:var(--fg-2)}
.bars{display:grid;gap:3px}.bars .r{display:grid;grid-template-columns:minmax(0,1fr) 110px 44px;gap:8px;align-items:center;font-size:12px}
.bars .r .l{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--fg-2)}.bars .r .v{font-family:var(--mono);color:var(--muted);text-align:right}
.bars .track{height:8px;border-radius:4px;background:var(--line);overflow:hidden}.bars .track i{display:block;height:100%;border-radius:4px;background:var(--accent)}
.pc .acts{display:flex;gap:4px;flex-wrap:wrap}.pc .acts button{font-size:11.5px;padding:1px 8px}.pc .acts button[aria-pressed=true]{border-color:var(--accent);color:var(--accent-2)}
.chart svg{width:100%;height:190px;display:block}
.chart .bar{fill:var(--accent)}.chart .bar.cur{fill:var(--accent-2)}.chart g.col:hover .bar,.chart g.col:focus .bar{fill:#fff}.chart .axis{stroke:var(--line-2)}.chart text{fill:var(--muted);font-size:10.5px;font-family:var(--sans)}
.chart .hit{fill:transparent;cursor:pointer}.chart g.col:focus{outline:none}
#tip{position:fixed;z-index:60;pointer-events:none;background:var(--panel-3);border:1px solid var(--line-2);border-radius:6px;padding:6px 9px;font-size:12px;box-shadow:0 10px 30px #000a;max-width:320px}#tip[hidden]{display:none}
.timeline{display:grid;gap:4px}.tl{display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:2px 10px;padding:7px 10px;border:1px solid var(--line);border-radius:6px;background:var(--panel-2);align-items:baseline}
.tl .c{font-family:var(--mono);font-size:11.5px;color:var(--muted)}.tl .ch{grid-column:2/-1;display:flex;flex-direction:column;gap:2px;font-size:12.5px}
.tl .ch button{all:unset;cursor:pointer;color:var(--fg-2)}.tl .ch button:hover{color:var(--accent-2)}.tl .ch .add::before{content:"+ ";color:var(--a-high);font-family:var(--mono)}.tl .ch .res::before{content:"− ";color:var(--ok);font-family:var(--mono)}
.tl .flag{color:var(--likely);font-size:11.5px}
.progress{height:4px;background:var(--line);border-radius:2px;overflow:hidden;margin-top:8px}.progress i{display:block;height:100%;background:var(--accent)}
.disclaimer{padding:10px 12px;border:1px dashed var(--line-2);border-radius:8px;color:var(--fg-2);font-size:12.5px}.disclaimer b{color:var(--fg)}
.unknowns{margin:0;padding:10px 14px;border:1px dashed var(--line-2);border-radius:6px;color:var(--muted);font-size:12.5px;list-style:none;display:grid;gap:4px}
.unknowns li::before{content:"?";display:inline-block;width:16px;color:var(--unknown);font-weight:700}
#drawer{position:fixed;top:0;right:0;bottom:0;width:min(480px,100vw);z-index:50;background:var(--panel);border-left:1px solid var(--line-2);box-shadow:-20px 0 50px #0009;transform:translateX(100%);visibility:hidden;transition:transform .18s ease,visibility .18s;display:grid;grid-template-rows:auto minmax(0,1fr)}
#drawer.open{transform:none;visibility:visible}
#dhead{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:6px;padding:12px 14px;border-bottom:1px solid var(--line)}
#dhead h2{margin:0;font-size:15px;font-weight:620;word-break:break-word}#dhead .x{border:0;background:none;font-size:18px;color:var(--muted);padding:0 4px}
#dhead .chips{grid-column:1/-1;display:flex;gap:5px;flex-wrap:wrap}
#dbody{overflow:auto;padding:12px 14px 40px;display:grid;grid-template-columns:minmax(0,1fr);gap:14px;align-content:start}
#dbody h4{margin:0 0 5px;font-size:10.5px;letter-spacing:.12em;text-transform:uppercase;color:var(--muted);font-weight:600}
#dbody p{margin:0;color:var(--fg-2);font-size:13px}
.bases{list-style:none;margin:0;padding:0;display:grid;gap:4px}.bases li{display:grid;grid-template-columns:96px minmax(0,1fr);gap:8px;font-size:12.5px;color:var(--fg-2)}.bases .src{font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);padding-top:2px}
.ev{border:1px solid var(--line);border-radius:6px;overflow:hidden}.ev+.ev{margin-top:4px}.ev .row{display:flex;gap:6px;align-items:baseline;padding:5px 8px;flex-wrap:wrap}
.ev .p{font-family:var(--mono);font-size:11.5px;word-break:break-all;flex:1;min-width:0}.ev .d{flex-basis:100%;color:var(--muted);font-size:12px;word-break:break-word}
.act{font-size:11px;padding:0 7px;border-radius:4px;background:transparent;border:1px solid var(--line-2);color:var(--muted);white-space:nowrap}.act:hover{color:var(--fg);text-decoration:none}.act[aria-expanded=true]{color:var(--accent-2);border-color:var(--accent)}
pre.code{margin:0;padding:8px 0;background:var(--canvas);border-top:1px solid var(--line);font:11.5px/1.5 var(--mono);overflow:auto;max-height:280px}
pre.code span{display:block;padding:0 10px;white-space:pre}pre.code span.f{background:color-mix(in srgb,var(--accent) 14%,transparent)}pre.code span.plus{background:color-mix(in srgb,var(--ok) 10%,transparent)}pre.code span.minus{background:color-mix(in srgb,var(--err) 10%,transparent)}pre.code i{color:var(--faint);font-style:normal;display:inline-block;width:38px}
.suggest{border:1px dashed var(--line-2);border-radius:8px;padding:8px 10px}.suggest .lbl{font-size:10.5px;letter-spacing:.1em;text-transform:uppercase;color:var(--muted)}
.decide{display:grid;gap:6px;border:1px solid var(--line);border-radius:8px;padding:10px}.decide textarea{width:100%;min-height:54px;background:var(--bg);resize:vertical}.decide .row{display:flex;gap:6px;flex-wrap:wrap}
.dacts{display:flex;gap:6px;flex-wrap:wrap}
#overlay{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;z-index:70;background:#07090dd8}#overlay[hidden]{display:none}
#overlay .box{max-width:460px;text-align:center;padding:24px}#overlay h2{font-size:16px;margin:0 0 8px}#overlay p{color:var(--muted)}
#toast{position:fixed;bottom:18px;left:50%;transform:translateX(-50%);z-index:80;background:var(--panel-3);border:1px solid var(--line-2);border-radius:8px;padding:8px 14px;font-size:13px;box-shadow:0 10px 30px #000a}#toast[hidden]{display:none}
${CHROME_CSS}
@media (max-width:1200px){.maplayout{grid-template-columns:minmax(0,1fr) 300px}.maplayout>.clside{display:none}}
@media (max-width:980px){.cols-2,.maplayout,.eo{grid-template-columns:1fr}.stats{grid-template-columns:repeat(2,minmax(0,1fr))}.side{max-height:none}.page{display:none}#search-wrap{width:auto;flex:1}}
@media (max-width:620px){#top .fehm-nav,#export,#status span{display:none}.fc>button.head{grid-template-columns:1fr}.fc .meta{justify-content:flex-start}.bases li{grid-template-columns:1fr}}
@media (prefers-reduced-motion:reduce){html{scroll-behavior:auto}*{transition:none!important;animation:none!important}}
</style></head><body>
<header id="top">
  <span class="brand">FEHM</span><span class="sep">/</span><span class="page">Architecture drift</span>
  <span id="project" class="project"></span>
  <span class="grow"></span>
  <div id="search-wrap"><input id="search" type="search" placeholder="Search files, findings, patterns, commits  /" autocomplete="off" aria-label="Search" aria-controls="results"><div id="results" role="listbox" hidden></div></div>
  <span id="status" class="status" data-state="busy" role="status" aria-live="polite"><i></i><span>Loading…</span></span>
  <button id="refresh" title="Re-index incrementally and analyse again">⟳ Refresh</button>
  <a class="nav" id="export" href="/api/drift/report" download="architecture-drift.json" title="Full report as JSON">Export</a>
  ${featureNav("drift")}
</header>
<div id="ctx" aria-label="Project context and baselines"></div>
<div id="bar">
  <div id="tabs" role="tablist" aria-label="Views"></div>
  <div id="filters" aria-label="Filters"></div>
</div>
<div class="wrap">
  <section class="tab" id="tab-overview" role="tabpanel"></section>
  <section class="tab" id="tab-map" role="tabpanel" hidden></section>
  <section class="tab" id="tab-findings" role="tabpanel" hidden></section>
  <section class="tab" id="tab-patterns" role="tabpanel" hidden></section>
  <section class="tab" id="tab-history" role="tabpanel" hidden></section>
</div>
<aside id="drawer" aria-label="Finding details"><header id="dhead"></header><div id="dbody"></div></aside>
<div id="tip" role="tooltip" hidden></div>
<div id="overlay"><div class="box"><h2 id="overlay-title">Analysing architecture drift…</h2><p id="overlay-text">Mining the project's own conventions from Feature 1's index. No model calls.</p><button id="overlay-action" hidden>Retry</button></div></div>
<div id="toast" role="status" aria-live="polite" hidden></div>
<script type="module" src="/drift/assets/drift/ui/main.js"></script>
</body></html>`;
