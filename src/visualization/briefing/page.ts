import { CHROME_CSS, featureNav } from "../features.js";

/** Static shell for the Feature 3.2 briefing page. All behaviour lives in ui/main.ts. */
export const BRIEFING_PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Explain Codebase · fehm</title><link rel="icon" href="data:,">
<style>
:root{--bg:#07090d;--panel:#0c0f16;--panel-2:#11151f;--panel-3:#161b28;--line:#1b2130;--line-2:#262e42;--fg:#d6dce8;--fg-2:#b3bdcf;--muted:#7b859c;--faint:#4b546a;--accent:#7aa2f7;--accent-2:#a9c1ff;--ok:#5fd4c0;--likely:#e0af68;--unknown:#8a93a8;--err:#f7768e;--high:#f7768e;--medium:#e0af68;--low:#7aa2f7;--mono:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;--radius:8px}
*{box-sizing:border-box}html{scroll-behavior:smooth;scroll-padding-top:56px}
body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.55 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif}
a{color:var(--accent);text-decoration:none}a:hover{text-decoration:underline}
button{font:inherit;color:inherit;background:var(--panel-2);border:1px solid var(--line-2);border-radius:6px;padding:3px 10px;cursor:pointer;white-space:nowrap}
button:hover{border-color:var(--accent)}button:focus-visible,input:focus-visible,a:focus-visible,summary:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
code,.mono{font-family:var(--mono);font-size:12.5px}
#top{position:sticky;top:0;z-index:20;height:44px;display:flex;align-items:center;gap:10px;padding:0 16px;border-bottom:1px solid var(--line);background:color-mix(in srgb,var(--panel) 92%,transparent);backdrop-filter:blur(8px)}
.brand{font-weight:700;letter-spacing:.14em;font-size:12px}.sep{color:var(--faint)}.page{color:var(--muted);text-transform:uppercase;letter-spacing:.08em;font-size:11px;white-space:nowrap}
.project{font-family:var(--mono);font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}
.grow{flex:1}
.status{display:inline-flex;align-items:center;gap:6px;font-size:12px;color:var(--muted);white-space:nowrap}.status i{width:7px;height:7px;border-radius:50%;background:var(--faint)}
.status[data-state=ready] i{background:var(--ok)}.status[data-state=busy] i{background:var(--accent);animation:pulse 1s infinite alternate}.status[data-state=stale] i{background:var(--likely)}.status[data-state=error] i{background:var(--err)}
@keyframes pulse{to{opacity:.3}}
.nav{font-size:12.5px;color:var(--muted)}.nav:hover{color:var(--fg);text-decoration:none}
details.menu{position:relative}details.menu>summary{list-style:none;cursor:pointer;border:1px solid var(--line-2);border-radius:6px;padding:3px 10px;background:var(--panel-2);font-size:13px}details.menu>summary::-webkit-details-marker{display:none}
details.menu[open]>div{position:absolute;right:0;top:calc(100% + 6px);background:var(--panel-2);border:1px solid var(--line-2);border-radius:8px;padding:4px;min-width:190px;box-shadow:0 14px 40px #000a;display:grid}
details.menu[open]>div button{border:0;background:none;text-align:left;padding:6px 10px;border-radius:5px}details.menu[open]>div button:hover{background:var(--panel-3)}
#refresh[data-stale]{border-color:var(--likely);color:var(--likely)}
.wrap{display:grid;grid-template-columns:232px minmax(0,1fr);gap:28px;max-width:1240px;margin:0 auto;padding:22px 20px 80px}
#toc{position:sticky;top:64px;align-self:start;max-height:calc(100vh - 84px);overflow:auto;font-size:13px}
#toc h3{margin:0 0 8px;font-size:10.5px;letter-spacing:.12em;text-transform:uppercase;color:var(--muted);font-weight:600}
#toc ol{list-style:none;margin:0;padding:0}#toc li a{display:flex;align-items:center;gap:8px;padding:4px 8px;border-radius:5px;color:var(--fg-2)}
#toc li a:hover{background:var(--panel-2);text-decoration:none}#toc li a[aria-current=true]{background:var(--panel-3);color:#fff}
#toc .n{margin-left:auto;font-family:var(--mono);font-size:10.5px;color:var(--faint)}
#toc .tools{display:flex;gap:6px;margin:12px 0 0}#toc .tools button{font-size:11.5px;padding:2px 8px;color:var(--muted)}
.dot{width:8px;height:8px;border-radius:50%;flex:none;background:var(--unknown)}.dot.confirmed{background:var(--ok)}.dot.likely{background:var(--likely)}.dot.unknown{background:transparent;border:1.5px solid var(--unknown)}
.dot.stale{box-shadow:0 0 0 2px color-mix(in srgb,var(--likely) 45%,transparent)}
main{min-width:0}
.card{background:var(--panel);border:1px solid var(--line);border-radius:var(--radius)}
#hero{padding:22px 24px 20px;position:relative;overflow:hidden}
#hero::before{content:"";position:absolute;inset:-40% -10% auto auto;width:420px;height:420px;background:radial-gradient(circle,color-mix(in srgb,var(--accent) 18%,transparent),transparent 65%);pointer-events:none}
.eyebrow{font-size:10.5px;letter-spacing:.14em;text-transform:uppercase;color:var(--muted);font-weight:600}
#hero h1{margin:6px 0 4px;font-size:26px;letter-spacing:-.01em;font-weight:650}
#hero .tagline{margin:0 0 12px;color:var(--fg-2);font-size:15.5px;max-width:760px}
.chips{display:flex;flex-wrap:wrap;gap:6px}.chip{font-size:12px;padding:2px 9px;border-radius:999px;background:var(--panel-3);border:1px solid var(--line-2);color:var(--fg-2)}
.badges{display:flex;flex-wrap:wrap;gap:8px;margin-top:16px;align-items:center}
.badge{display:inline-flex;align-items:center;gap:6px;font-size:12px;padding:3px 10px;border-radius:6px;border:1px solid var(--line-2);background:var(--panel-2)}
.badge b{font-family:var(--mono);font-weight:600}
.badge.ok{border-color:color-mix(in srgb,var(--ok) 45%,var(--line-2))}.badge.warn{border-color:color-mix(in srgb,var(--likely) 55%,var(--line-2));color:var(--likely)}
.meter{width:64px;height:5px;border-radius:3px;background:var(--line-2);overflow:hidden;display:inline-block}.meter i{display:block;height:100%;background:var(--ok)}
#stale{margin-top:14px;padding:10px 14px;border:1px solid color-mix(in srgb,var(--likely) 50%,var(--line));background:color-mix(in srgb,var(--likely) 8%,var(--panel));border-radius:var(--radius);color:var(--fg);font-size:13px;display:flex;gap:12px;align-items:center;flex-wrap:wrap}
#stale b{color:var(--likely)}#stale .files{font-family:var(--mono);font-size:11.5px;color:var(--muted);flex-basis:100%}
#ask{margin-top:14px;padding:14px 16px}
#ask form{display:flex;gap:8px}#ask input{flex:1;min-width:0;background:var(--bg);border:1px solid var(--line-2);border-radius:6px;color:var(--fg);padding:8px 10px;font:inherit}
#ask .hint{font-size:12px;color:var(--muted);margin:6px 0 0}
#answers{margin-top:10px;display:grid;gap:6px}#answers:empty{display:none}
.answer{padding:8px 10px;border:1px solid var(--line);border-radius:6px;background:var(--panel-2)}.answer .t{display:flex;gap:8px;align-items:baseline;flex-wrap:wrap}.answer .k{font-size:10.5px;text-transform:uppercase;letter-spacing:.08em;color:var(--muted)}
.answer p{margin:4px 0 0;color:var(--fg-2);font-size:13px}
section.sec{margin-top:14px}
section.sec>details>summary{list-style:none;cursor:pointer;padding:14px 18px;display:grid;grid-template-columns:1fr auto;gap:2px 12px;align-items:start}
section.sec>details>summary::-webkit-details-marker{display:none}
section.sec>details>summary:hover{background:var(--panel-2);border-radius:var(--radius)}
section.sec h2{margin:0;font-size:16.5px;font-weight:620;display:flex;align-items:center;gap:10px}
section.sec h2 .chev{color:var(--faint);font-size:12px;transition:transform .15s;display:inline-block;width:12px}
section.sec details[open] h2 .chev{transform:rotate(90deg)}
.q{font-size:12px;color:var(--muted)}section.sec>details>summary>div:first-child{grid-column:1;grid-row:1;min-width:0}.sum{grid-column:1/-1;color:var(--fg-2);font-size:13.5px;margin-top:4px}
.state{font-size:10.5px;letter-spacing:.1em;font-weight:650;padding:2px 8px;border-radius:5px;border:1px solid;white-space:nowrap}
.state.confirmed{color:var(--ok);border-color:color-mix(in srgb,var(--ok) 45%,transparent);background:color-mix(in srgb,var(--ok) 8%,transparent)}
.state.likely{color:var(--likely);border-color:color-mix(in srgb,var(--likely) 45%,transparent);background:color-mix(in srgb,var(--likely) 8%,transparent)}
.state.unknown{color:var(--unknown);border-color:var(--line-2);border-style:dashed}
.state.stale{color:var(--likely);border-color:var(--likely);border-style:dotted}
.meta{display:flex;gap:6px;align-items:center;justify-content:flex-end;grid-column:2;grid-row:1}.conf{font-family:var(--mono);font-size:11.5px;color:var(--muted)}
.body{padding:2px 18px 18px;display:grid;gap:14px}
.body h4{margin:0 0 6px;font-size:10.5px;letter-spacing:.12em;text-transform:uppercase;color:var(--muted);font-weight:600;display:flex;gap:8px;align-items:baseline}
.body h4 .note{font-family:var(--mono);letter-spacing:0;text-transform:none;font-weight:400;color:var(--faint);font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.lead{margin:0;font-size:15px;color:var(--fg)}
dl.facts{margin:0;display:grid;grid-template-columns:minmax(120px,190px) 1fr;border:1px solid var(--line);border-radius:6px;overflow:hidden}
dl.facts dt,dl.facts dd{margin:0;padding:7px 12px;border-bottom:1px solid var(--line)}dl.facts dt{color:var(--muted);font-size:12.5px;background:var(--panel-2)}
dl.facts dd{display:flex;gap:8px;align-items:baseline;justify-content:space-between}
dl.facts>:nth-last-child(-n+2){border-bottom:0}
ul.items,ol.items{list-style:none;margin:0;padding:0;display:grid;gap:2px}
ol.items{counter-reset:n}ol.items>li{counter-increment:n}ol.items>li::before{content:counter(n);font-family:var(--mono);font-size:11px;color:var(--accent);width:18px;flex:none;padding-top:2px}
.items>li{display:flex;flex-wrap:wrap;gap:8px;align-items:flex-start;padding:5px 8px;border-radius:5px}.items>li>.panel{flex-basis:100%;margin-left:0}.risk>.panel,.rrow>.panel{grid-column:1/-1;margin-left:0}.items>li:hover{background:var(--panel-2)}
.items .main{flex:1;min-width:0}.items .title{font-weight:520;word-break:break-word}.items .title.path{font-family:var(--mono);font-size:12.5px;font-weight:500}
.items .detail{color:var(--muted);font-size:12.5px;word-break:break-word}
.pill{font-size:10.5px;padding:0 6px;border-radius:4px;background:var(--panel-3);color:var(--fg-2);border:1px solid var(--line-2);white-space:nowrap;font-family:var(--mono);align-self:center}
.pill.post,.pill.put,.pill.delete,.pill.patch{color:var(--likely)}.pill.get{color:var(--ok)}.pill.secret{color:var(--err)}.pill.declared{color:var(--muted);border-style:dashed}.pill.hotspot{color:var(--err)}
.acts{display:flex;gap:4px;flex:none;opacity:.55;transition:opacity .12s}.items>li:hover .acts,.acts:focus-within,dl.facts dd:hover .acts{opacity:1}
.act{font-size:11px;padding:1px 7px;border-radius:4px;background:transparent;border:1px solid var(--line-2);color:var(--muted);white-space:nowrap}
.act:hover{color:var(--fg)}.act[aria-expanded=true]{color:var(--accent-2);border-color:var(--accent)}
.group+.group{margin-top:10px}.more{font-size:12px;color:var(--accent);background:none;border:0;padding:4px 8px}
.flow{display:flex;flex-wrap:wrap;align-items:center;gap:6px}.flow .step{display:inline-flex;flex-direction:column;padding:5px 10px;border:1px solid var(--line-2);border-radius:6px;background:var(--panel-2);max-width:260px}
.flow .step.entry{border-color:color-mix(in srgb,var(--accent) 55%,var(--line-2));background:color-mix(in srgb,var(--accent) 10%,var(--panel-2))}.flow .step.data{border-style:dashed}
.flow .step .nm{font-family:var(--mono);font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.flow .step .ly{font-size:10.5px;color:var(--muted)}
.flow .step.heuristic{border-style:dotted}.flow .arrow{color:var(--faint)}a.step:hover{border-color:var(--accent);text-decoration:none}
.flowbox{border:1px solid var(--line);border-radius:6px;padding:10px 12px}.flowbox h5{margin:0 0 8px;font-size:13px;font-weight:560;display:flex;justify-content:space-between;gap:8px}
pre.diagram{margin:0;padding:12px 14px;background:var(--bg);border:1px solid var(--line);border-radius:6px;overflow:auto;font:12px/1.5 var(--mono);color:var(--fg-2)}
.rank{display:grid;gap:6px}.rrow{display:grid;grid-template-columns:22px 1fr auto;gap:4px 10px;padding:8px 10px;border:1px solid var(--line);border-radius:6px;background:var(--panel-2)}
.rrow .no{font-family:var(--mono);color:var(--accent);font-size:12px;padding-top:1px}.rrow .nm{font-family:var(--mono);font-size:12.5px;word-break:break-all}
.rrow ul{grid-column:2/-1;margin:2px 0 0;padding-left:16px;color:var(--muted);font-size:12.5px}.rrow .ms{grid-column:2/-1;display:flex;flex-wrap:wrap;gap:4px}
.bar{width:90px;height:6px;border-radius:3px;background:var(--line-2);overflow:hidden;align-self:center}.bar i{display:block;height:100%;background:linear-gradient(90deg,var(--accent),var(--accent-2))}
.risk{display:grid;grid-template-columns:78px 1fr auto;gap:2px 10px;padding:8px 10px;border-left:3px solid var(--line-2);background:var(--panel-2);border-radius:0 6px 6px 0}
.risk+.risk{margin-top:6px}.risk.high{border-left-color:var(--high)}.risk.medium{border-left-color:var(--medium)}.risk.low{border-left-color:var(--low)}.risk.unknown{border-left-color:var(--unknown);border-left-style:dashed}
.sev{font-size:10.5px;letter-spacing:.1em;font-weight:650;text-transform:uppercase;padding-top:2px}.risk.high .sev{color:var(--high)}.risk.medium .sev{color:var(--medium)}.risk.low .sev{color:var(--low)}.risk.unknown .sev{color:var(--unknown)}
.risk .why{grid-column:2/-1;color:var(--muted);font-size:12.5px}
.unknowns{margin:0;padding:10px 14px;border:1px dashed var(--line-2);border-radius:6px;color:var(--muted);font-size:12.5px;list-style:none;display:grid;gap:4px}
.unknowns li::before{content:"?";display:inline-block;width:16px;color:var(--unknown);font-weight:700}
.links{display:flex;gap:10px;flex-wrap:wrap;font-size:12.5px}
.panel{margin:4px 0 2px 26px;max-height:420px;overflow:auto;padding:10px 12px;border:1px solid var(--line-2);border-radius:6px;background:var(--bg);font-size:12.5px}
.panel .ctext{margin:0 0 6px;color:var(--fg)}.panel .row{display:flex;gap:8px;flex-wrap:wrap;align-items:center;color:var(--muted);margin-bottom:6px}
.panel table{width:100%;border-collapse:collapse}.panel td{padding:3px 6px 3px 0;border-top:1px solid var(--line);vertical-align:top}.panel td.p{font-family:var(--mono);word-break:break-all}
.panel .stale-tag{color:var(--likely);font-size:11px}.panel .note{color:var(--muted);font-style:italic;margin:6px 0 0}
.tree{list-style:none;margin:0;padding-left:14px;border-left:1px solid var(--line-2)}.tree li{padding:1px 0}.tree .nm{font-family:var(--mono);font-size:12px}.tree .p{color:var(--faint);font-family:var(--mono);font-size:11px;margin-left:6px}
.tree .rep{color:var(--faint)}
section[data-cheat]{border-color:color-mix(in srgb,var(--accent) 40%,var(--line))}
#unknown-all{margin-top:14px;padding:16px 18px}#unknown-all h2{margin:0 0 4px;font-size:16px}
.muted{color:var(--muted)}.foot{margin-top:24px;font-size:12px;color:var(--faint);text-align:center}
#overlay{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;z-index:40;background:#07090dd8}#overlay[hidden]{display:none}
#overlay .box{max-width:460px;text-align:center;padding:24px}#overlay h2{font-size:16px;margin:0 0 8px}#overlay p{color:var(--muted)}
${CHROME_CSS}
@media (max-width:900px){.wrap{grid-template-columns:1fr;padding:14px 16px 60px}#toc{position:static;max-height:none}#toc ol{display:flex;flex-wrap:wrap;gap:2px}#toc .n{display:none}.page,.nav.opt{display:none}dl.facts{grid-template-columns:1fr}dl.facts dt{border-bottom:0;padding-bottom:0;background:none}}
@media (prefers-reduced-motion:reduce){html{scroll-behavior:auto}.status[data-state=busy] i{animation:none}}
</style></head><body>
<header id="top">
  <span class="brand">FEHM</span><span class="sep">/</span><span class="page">Explain codebase</span>
  <span id="project" class="project"></span>
  <span class="grow"></span>
  <span id="status" class="status" data-state="busy" role="status" aria-live="polite"><i></i><span>Loading…</span></span>
  <button id="refresh" title="Re-index incrementally and rebuild affected sections">⟳ Refresh</button>
  <details class="menu" id="export"><summary>Export</summary><div>
    <button data-export="minimal">Markdown — minimal</button><button data-export="standard">Markdown — standard</button><button data-export="deep">Markdown — deep (with evidence)</button><button data-export="json">Briefing JSON</button>
  </div></details>
  ${featureNav("explain")}
</header>
<div class="wrap">
  <nav id="toc" aria-label="Briefing sections"></nav>
  <main id="content" aria-live="polite"></main>
</div>
<div id="overlay"><div class="box"><h2 id="overlay-title">Building briefing…</h2><p id="overlay-text">Reading Feature 1's index. No model calls.</p><button id="overlay-action" hidden>Retry</button></div></div>
<script type="module" src="/explain/assets/briefing/ui/main.js"></script>
</body></html>`;
