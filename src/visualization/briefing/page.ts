import { DIAGRAM_CSS } from "../architecture/diagram-css.js";
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
/* Documentation layout: explanations stay visible; evidence is progressively disclosed. */
:root{--muted:#99a4b9;--faint:#78849b}
.wrap{max-width:1320px;grid-template-columns:218px minmax(0,1fr);gap:48px;padding-top:32px}
#hero{padding:0 0 24px;border:0;border-radius:0;background:none;border-bottom:1px solid var(--line)}
#hero::before{display:none}#hero h1{font-size:32px;letter-spacing:-.035em;margin:6px 0 10px}
#hero .tagline{max-width:65ch;font-size:15px;line-height:1.7}.analysis-time{color:var(--muted);font-size:12px;margin:10px 0}
#hero .badges{gap:12px;margin-top:12px}.badge{border:0;background:none;padding:0;font-size:12px}.badge.ok{color:var(--fg-2)}
.chips{margin:12px 0}.chip{border-radius:4px;font-size:11px}
section.sec{margin-top:34px;padding:0 0 28px;border-bottom:1px solid var(--line)}
section.executive{padding:24px 26px;background:var(--panel);border:1px solid var(--line-2);border-left:3px solid var(--accent);border-radius:8px;margin-top:24px}
.section-heading{display:flex;align-items:start;justify-content:space-between;gap:16px;margin-bottom:18px}
section.sec .section-heading h2{font-size:21px;letter-spacing:-.02em;margin:4px 0 0}.q{font-size:12px;color:var(--muted)}
.state{font-size:10px;text-transform:none;letter-spacing:.01em;font-weight:500;margin-top:5px}
.body{padding:0;gap:16px}.lead{max-width:75ch;line-height:1.85;font-size:15px;color:var(--fg-2);overflow-wrap:anywhere}
.executive .lead:first-child{font-size:18px;color:var(--fg);line-height:1.75}
code{padding:2px 5px;background:var(--panel-3);border-radius:4px;color:var(--accent-2);overflow-wrap:anywhere}
.supporting{min-width:0}.supporting>summary{cursor:pointer;font-size:13px;color:var(--accent-2);padding:10px 0;min-height:40px}
.supporting[open]>summary{margin-bottom:12px}.supporting-body{display:grid;grid-template-columns:minmax(0,1fr);gap:24px}.supporting-body>*,.body>*{min-width:0}dl.facts dd{flex-wrap:wrap;overflow-wrap:anywhere}.supporting .supporting{padding:0 12px;border:1px solid var(--line);border-radius:6px}
.body h4{font-size:12px;letter-spacing:.03em;color:var(--fg-2);text-transform:none;margin-bottom:12px}
.items>li{padding:12px 0;border-bottom:1px solid var(--line);gap:10px}.items>li:hover{background:none}.items .detail{line-height:1.75;font-size:13px;margin-top:5px;color:var(--fg-2)}
.acts{opacity:1;flex-wrap:wrap}.lead .acts{display:inline-flex;vertical-align:middle;margin-left:6px}.act{min-height:28px;display:inline-flex;align-items:center;padding:3px 7px;color:var(--muted)}
.items .acts{max-width:100%}.flow-note{font-size:13px;color:var(--muted);max-width:70ch;line-height:1.7}.flowbox{padding:16px}.flow{gap:8px}.flow .step{padding:10px 12px}
.group+.group{margin-top:24px}.group h4 .note{white-space:normal;overflow-wrap:anywhere}
.rrow{background:none;padding:14px 0;border:0;border-bottom:1px solid var(--line)}.rrow .ms{opacity:.8}
#ask{margin-top:24px;background:none;border:0;border-bottom:1px solid var(--line);padding:0 0 24px}#ask input{padding:11px 12px}#ask .hint{font-size:12px}
#toc li a{padding:7px 9px;font-size:12px}#toc .n{display:none}#toc .dot{width:5px;height:5px}#toc .tools{flex-wrap:wrap}
.panel{margin-left:0;max-width:100%}.panel table{font-size:12px}.refresh-error{padding:16px;border:1px solid var(--err);border-radius:6px;margin-bottom:20px}.refresh-error p{margin-top:0;overflow-wrap:anywhere}
button:disabled{opacity:.5;cursor:wait}.skip-link{position:fixed;top:-100px;left:12px;z-index:60;background:var(--panel);padding:10px}.skip-link:focus{top:6px}
@media(max-width:900px){.wrap{gap:24px}#toc ol{max-height:155px;overflow:auto}#toc>div>p{display:none}.section-heading{flex-wrap:wrap;gap:6px}#hero h1{font-size:28px}}
@media(max-width:560px){#top{padding:0 10px;gap:7px}.project{display:none}.wrap{padding:18px 14px 48px}section.executive{padding:18px 16px}.section-heading h2{font-size:19px}.items>li{display:block}.items .acts{margin-top:8px}.items .pill{display:inline-block;margin-top:6px}.rrow{grid-template-columns:20px minmax(0,1fr)}.rrow>span:last-of-type{grid-column:2;flex-wrap:wrap}.risk{grid-template-columns:1fr}.risk .why{grid-column:1}.risk .acts{grid-column:1}.flow .step{max-width:100%}#hero .badges{align-items:start}.badge{white-space:normal;flex-wrap:wrap}.panel td{display:block}#ask form{flex-wrap:wrap}#ask input{flex-basis:70%}}
${DIAGRAM_CSS}
/* Onboarding report and the shared architecture workspace. */
:root{--sans:ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;--canvas:#0a0d14;--data:#82c6b3;--ext:#b6a4df}
[hidden]{display:none!important}.wrap{max-width:1600px;grid-template-columns:205px minmax(0,1fr);gap:28px;padding:20px 24px 60px}
#hero.compact-hero{display:flex;align-items:center;flex-wrap:wrap;gap:8px 24px;padding:0 0 16px}#hero h1{font-size:24px;margin:2px 0}#hero .analysis-time{margin-left:auto;font-size:11px}#hero .supporting{font-size:12px}#hero #stale{flex-basis:100%;margin:0}
#toc{top:65px}#toc li a{padding:10px 8px;gap:10px}#toc li a[aria-current=true]{background:var(--panel-3);color:var(--accent-2)}.nav-number{font:11px var(--mono);color:var(--muted)}.nav-hint{font-size:12px;color:var(--muted);border-top:1px solid var(--line);margin-top:20px;padding-top:16px;line-height:1.8}
.quick-grid{display:grid;grid-template-columns:minmax(260px,.85fr) minmax(0,1.4fr);gap:24px;margin-top:20px;align-items:start}.quick-copy h2{font-size:18px;margin:0 0 12px}.quick-copy .lead{font-size:14px;line-height:1.75;margin:0 0 12px}.quick-copy .lead:first-of-type{font-size:17px;color:var(--fg)}.quick-context{color:var(--fg-2);font-size:13px;line-height:1.7}.quick-copy .chips{margin:14px 0}.quick-meeting{border-top:1px solid var(--line);border-bottom:1px solid var(--line);padding:12px 0;margin-top:20px}.quick-meeting h3{font-size:15px;margin:0 0 6px}.quick-meeting p{font-size:13px;line-height:1.7;margin:6px 0;max-width:105ch}
section.sec{margin-top:24px}section.sec h3{margin:20px 0 10px;font-size:16px}.sec .lead{font-size:14px}.sec .body .lead .acts{font-size:11px}.acts .act{border:0;padding:0 3px;color:var(--accent);min-height:24px;font-size:11px;text-decoration:underline;text-underline-offset:3px}.source-refs{display:flex;flex-wrap:wrap;gap:6px 12px;font-size:12px;overflow-wrap:anywhere;margin-top:8px}.source-refs a{font-family:var(--mono)}
.diagram-workspace{border:1px solid var(--line-2);border-radius:8px;overflow:hidden;background:var(--canvas);min-width:0}.diagram-toolbar{display:flex;align-items:center;flex-wrap:wrap;gap:6px;padding:10px;border-bottom:1px solid var(--line)}select{font:inherit;color:var(--fg);background:var(--panel-2);border:1px solid var(--line-2);border-radius:5px;padding:6px;max-width:100%;min-width:0}.diagram-toolbar select{font-size:12px;max-width:230px}.diagram-toolbar button{font-size:11px;padding:5px 7px}.diagram-toolbar .muted{font-size:11px}.diagram-stage{height:350px;position:relative;overflow:hidden}.briefing-diagram{display:block;width:100%;height:100%;touch-action:none}.diagram-message{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:12px;text-align:center;margin:0;padding:32px;background:var(--canvas);color:var(--fg-2);font-size:13px;line-height:1.8}.diagram-legend{font-size:10px;color:var(--muted);padding:8px 12px;border-top:1px solid var(--line)}.diagram-inspector{padding:12px;font-size:13px;border-top:1px solid var(--line);overflow-wrap:anywhere;max-height:280px;overflow:auto}.diagram-inspector:empty{display:none}.diagram-inspector h3{margin:0;font-size:15px}.diagram-inspector p{margin:6px 0}.diagram-inspector button,.diagram-inspector>a{margin:8px 12px 0 0}.diagram-narrative{font-size:12px;color:var(--muted);padding:0 12px;line-height:1.7}.diagram-narrative:empty{display:none}.diagram-narrative details{margin:10px 0}.workflow-narrative{padding-left:22px;max-height:300px;overflow:auto}.workflow-narrative li{padding:8px 0}.diagram-workspace:fullscreen{display:flex;flex-direction:column;border:0;border-radius:0;padding:12px;overflow:auto}.diagram-workspace:fullscreen .diagram-stage{flex:1;min-height:50vh}#deep-diagram{margin-top:20px}#deep-diagram .diagram-stage{height:480px}
.requirement-topic{padding:14px 0;border-bottom:1px solid var(--line);max-width:85ch}.requirement-topic h4{margin:0;font-size:14px}.requirement-topic p{font-size:14px;line-height:1.8}.requirement-topic .acts{display:inline-flex;margin-left:8px}.basis-label{font-size:11px;color:var(--likely)}.reading-order,.meeting-questions{padding-left:22px;max-width:90ch}.reading-order li,.meeting-questions li{padding:8px 0;line-height:1.75}.reading-order p{margin:6px 0;color:var(--fg-2)}
.reference-controls{display:flex;gap:8px;flex-wrap:wrap}.reference-controls input{flex:1;min-width:180px;font:inherit;color:var(--fg);background:var(--panel);border:1px solid var(--line-2);border-radius:6px;padding:10px}.endpoint-results{overflow:auto}.endpoint-table{border-collapse:collapse;width:100%;font-size:13px}.endpoint-table th{text-align:left;color:var(--muted);font-weight:500}.endpoint-table td,.endpoint-table th{padding:10px;border-bottom:1px solid var(--line);vertical-align:top;overflow-wrap:anywhere}.endpoint-table button{text-align:left;white-space:normal;font:12px var(--mono);color:var(--accent-2);background:none;border:0;padding:0}.endpoint-detail:not(:empty){padding:18px;background:var(--panel);border:1px solid var(--line-2);border-radius:6px;margin-top:16px;overflow-wrap:anywhere}.endpoint-detail .acts{margin:12px 0;gap:12px}.endpoint-detail .acts+.panel{margin:12px 0}.endpoint-detail p{line-height:1.8}
@media(max-width:1100px){.quick-grid{grid-template-columns:1fr}.quick-copy{display:block;max-width:90ch}.diagram-stage{height:380px}}
@media(max-width:900px){.wrap{grid-template-columns:1fr;padding:14px;gap:14px}#toc ol{max-height:none;display:flex;flex-wrap:nowrap;overflow:auto}#toc li{flex:none}#toc li a{white-space:nowrap}#toc h3,#toc .nav-hint{display:none}.quick-grid{margin-top:16px}#hero .analysis-time{margin-left:0}#deep-diagram .diagram-stage{height:420px}.diagram-toolbar select{max-width:100%}.endpoint-table td{min-width:150px}.nav-number{display:none}}
${CHROME_CSS}
@media (max-width:900px){.wrap{grid-template-columns:1fr;padding:14px 16px 60px}#toc{position:static;max-height:none}#toc ol{display:flex;flex-wrap:wrap;gap:2px}#toc .n{display:none}.page,.nav.opt{display:none}dl.facts{grid-template-columns:1fr}dl.facts dt{border-bottom:0;padding-bottom:0;background:none}}
@media (prefers-reduced-motion:reduce){html{scroll-behavior:auto}.status[data-state=busy] i{animation:none}}
@media(max-width:900px){#toc ol{flex-wrap:nowrap;max-height:none}#toc li a{white-space:nowrap}#toc li{flex-shrink:0}}
.edge:focus-visible path.line{stroke:var(--accent-2);stroke-width:3}

/* Unified understanding workspace */
.wrap{display:flex;flex-direction:column;max-width:1480px;gap:20px;padding:16px 28px 60px}#content{min-width:0}
#toc{position:relative;top:auto;max-height:none;overflow:visible;z-index:5;width:100%;border-bottom:1px solid var(--line);padding-bottom:8px}
.workspace-tabs{display:flex;align-items:center;gap:6px;flex-wrap:wrap}.workspace-tabs>a,.reference-menu>summary{display:block;padding:8px 13px;color:var(--fg-2);border-radius:6px;font-size:13px;cursor:pointer}.workspace-tabs>a[aria-current=true]{color:var(--accent-2);background:var(--panel-3)}.workspace-tabs>a:hover{background:var(--panel-2);text-decoration:none}.reference-menu{position:relative;margin-left:auto}.reference-menu>div{position:absolute;right:0;top:40px;min-width:245px;background:var(--panel);padding:8px;border:1px solid var(--line-2);border-radius:8px;box-shadow:0 10px 35px #0008}.reference-menu a{display:block;padding:9px;border-radius:4px}.reference-menu a[aria-current=true]{background:var(--panel-3)}
.quick-grid{grid-template-columns:minmax(0,1fr);gap:16px;margin-top:14px}.quick-copy{max-width:none;display:grid;grid-template-columns:1.4fr 1fr;gap:8px 36px;align-items:start}.quick-copy h2{grid-column:1/-1;font-size:13px;color:var(--muted);margin:0}.quick-copy>.lead{margin:0;max-width:75ch}.quick-copy>.lead:first-of-type{font-size:21px;line-height:1.55;color:var(--fg)}.quick-copy>a{font-size:13px}.quick-copy .supporting{margin:0}.quick-meeting{margin-top:24px}
.technology-stack{padding:12px 0;border-top:1px solid var(--line)}.technology-heading{display:flex;align-items:center;justify-content:space-between;gap:12px}.technology-heading h2{font-size:13px;margin:0;color:var(--fg-2)}.technology-heading input,.diagram-toolbar input{font:inherit;font-size:12px;background:var(--panel);color:var(--fg);border:1px solid var(--line-2);padding:7px 10px;border-radius:6px;min-width:0;max-width:230px}.technology-list{display:flex;gap:12px 20px;flex-wrap:wrap;margin-top:10px}.technology-group{display:flex;align-items:center;flex-wrap:wrap;gap:6px}.technology-category{font-size:10px;color:var(--muted);margin-right:4px}.technology-item{display:flex;align-items:center;gap:7px;padding:6px 9px;background:transparent;font-size:12px;transition:background .15s}.technology-item:hover,.technology-item[aria-pressed=true]{background:var(--panel-3);border-color:var(--accent)}.technology-item img{object-fit:contain}.technology-fallback{display:grid;place-items:center;width:22px;height:22px;font:12px var(--mono);color:var(--accent-2)}
.diagram-workspace{position:relative}.diagram-stage,#deep-diagram .diagram-stage{height:clamp(370px,54vh,640px)}.diagram-toolbar{gap:6px;padding:9px}.diagram-inspector{position:absolute;right:0;top:58px;bottom:30px;width:min(340px,85%);max-height:none;background:var(--panel);border:1px solid var(--line-2);border-right:0;box-shadow:-12px 0 35px #0004;z-index:3;padding:18px}.diagram-inspector h3{font-size:18px}.diagram-inspector p{line-height:1.7}.diagram-narrative{padding:10px 14px}.diagram-narrative .map-purpose{margin:0;color:var(--fg-2)}.diagram-narrative>a{font-size:12px}.diagram-legend{font-size:11px}.workflow-narrative button{text-align:left;white-space:normal;line-height:1.6;color:var(--accent-2)}.workflow-narrative .source-refs{margin-left:8px}
@media(max-width:760px){.wrap{padding:12px 14px 40px;gap:14px}.quick-copy{grid-template-columns:1fr;gap:12px}.quick-copy>.lead:first-of-type{font-size:18px}.workspace-tabs{gap:2px}.workspace-tabs>a,.reference-menu>summary{font-size:12px;padding:7px}.reference-menu{margin-left:0}.reference-menu>div{left:0;right:auto}.technology-heading input{max-width:165px}.technology-list{gap:10px}.technology-category{flex-basis:100%}.diagram-toolbar input{max-width:100%;width:100%}.diagram-inspector{top:140px}.diagram-stage,#deep-diagram .diagram-stage{height:390px}#hero.compact-hero{padding-bottom:10px}}
@media(prefers-reduced-motion:reduce){.technology-item{transition:none}}

#hero.compact-hero{padding-bottom:8px;min-height:36px}#hero.compact-hero .eyebrow{display:none}#hero.compact-hero h1{font-size:18px}.quick-copy h2{display:none}.quick-grid{margin-top:10px}.technology-item img{background:#edf0f6;border-radius:3px;padding:2px}.diagram-inspector details button{display:block;white-space:normal;text-align:left;margin:6px 0;width:100%}

.diagram-body{position:relative}.diagram-body .diagram-inspector{top:0;bottom:0}.diagram-stage,#deep-diagram .diagram-stage{height:clamp(340px,44vh,540px)}
@media(max-width:760px){.diagram-stage,#deep-diagram .diagram-stage{height:390px}}

/* A continuous onboarding report, with local anchor navigation. */
.wrap{max-width:1280px;padding:0 30px 60px;gap:0}#toc{position:sticky;top:44px;z-index:12;margin:0;padding:10px 0;background:var(--bg);border-bottom:1px solid var(--line);max-height:none;overflow:visible}
.report-navigation{display:flex;align-items:center;justify-content:space-between;gap:10px}.stage-links{display:flex;align-items:center;gap:4px;min-width:0}.stage-links a{display:flex;gap:7px;align-items:center;padding:9px 10px;border-radius:5px;color:var(--fg-2);font-size:12px;white-space:nowrap}.stage-links a span{color:var(--muted);font:10px var(--mono)}.stage-links a[aria-current=location]{color:var(--accent-2);background:var(--panel-3)}.report-navigation select{max-width:210px;font-size:12px}
.report-stage{padding:30px 0 14px;border-bottom:1px solid var(--line);scroll-margin-top:115px}.stage-heading{display:grid;grid-template-columns:auto 1fr;gap:2px 16px;align-items:center;margin-bottom:24px}.stage-number{font:10px var(--mono);letter-spacing:.1em;color:var(--accent)}.stage-heading h2{font-size:23px;margin:0;font-weight:600}.stage-heading p{grid-column:2;margin:0;color:var(--muted);font-size:13px;max-width:75ch}
.report-stage>.sec{margin-top:32px;padding:0 0 24px;border:0;border-radius:0;background:none}.report-stage>.sec+.sec{border-top:1px solid var(--line);padding-top:28px}.report-stage .section-heading h2{font-size:20px}.report-stage .section-heading .q{display:none}.report-stage .state{font-size:10px;padding:2px 6px;border:0;background:var(--panel-2)}.report-stage .lead{font-size:14px;max-width:85ch;line-height:1.85}
.project-introduction h1{font-size:32px;margin:6px 0 14px;letter-spacing:-.025em}.project-introduction>.lead{font-size:21px;max-width:70ch;line-height:1.65}.project-introduction .items{padding-left:0}.project-introduction{margin-bottom:20px}.report-stage .supporting{margin-top:12px}.report-stage section[id],#system-map,#operation-map,#report-history,#unknown-all{scroll-margin-top:125px}.report-stage:focus,section[id]:focus,#system-map:focus,#operation-map:focus{outline:none}
.technology-stack{border:0;margin-top:0;padding:6px 0}.technology-heading h2{display:none}.history-entry{margin:12px 0;padding:10px 0;border-bottom:1px solid var(--line)}.history-entry summary{cursor:pointer;color:var(--accent-2)}.history-entry p{overflow-wrap:anywhere}
#system-map,#operation-map{margin-top:18px}.diagram-stage{height:clamp(340px,48vh,560px)}.report-stage .sec .body{gap:10px}.report-stage #unknown-all{background:none;border:0;padding:0}
@media(max-width:1000px){.report-navigation{flex-wrap:wrap;gap:4px}.report-navigation select{max-width:100%;width:100%}.stage-links{width:100%;overflow-x:auto}.stage-links a{flex:none}.report-stage,.report-stage section[id],#system-map,#operation-map{scroll-margin-top:165px}}
@media(max-width:600px){.wrap{padding:0 14px 40px}.stage-links a{padding:8px;font-size:12px}.stage-links a span{display:none}.stage-heading{grid-template-columns:1fr;gap:5px}.stage-heading p{grid-column:1}.report-stage{padding-top:24px}.project-introduction h1{font-size:27px}.project-introduction>.lead{font-size:18px}.stage-heading h2{font-size:21px}.section-heading{align-items:start}.report-navigation select{padding:5px}}
.capability-summary{padding-left:20px;max-width:90ch}.capability-summary li{padding:6px 0;line-height:1.8}.capability-summary .acts{display:inline-flex;margin-left:8px}.project-introduction>.lead:not(:first-of-type){font-size:15px;color:var(--fg-2)}
</style></head><body>
<a class="skip-link" href="#content">Skip to briefing</a>
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
  <main id="content" tabindex="-1" aria-live="polite"></main>
</div>
<div id="overlay"><div class="box"><h2 id="overlay-title">Building briefing…</h2><p id="overlay-text">Preparing a briefing from the repository index. Large projects may take a moment.</p><button id="overlay-action" hidden>Retry</button></div></div>
<script type="module" src="/explain/assets/briefing/ui/main.js"></script>
</body></html>`;
