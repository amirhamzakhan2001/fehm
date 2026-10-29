/**
 * The report-page stylesheet shared by Feature 3.5 (project health) and
 * Feature 3.6 (security review): tokens, header, TOC, cards, tables, finding
 * rows with evidence and source excerpts, charts. Pages add their own rules
 * after it.
 */
export const REPORT_CSS = `:root{--bg:#07090d;--canvas:#090c12;--panel:#0c0f16;--panel-2:#11151f;--panel-3:#161b28;--line:#1b2130;--line-2:#262e42;--fg:#d6dce8;--fg-2:#b3bdcf;--muted:#7b859c;--faint:#4b546a;--accent:#7aa2f7;--accent-2:#a9c1ff;--ok:#5fd4c0;--warn:#e0af68;--deg:#ff9e64;--err:#f7768e;--unknown:#8a93a8;--info:#7dcfff;--mono:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;--sans:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Helvetica,Arial,sans-serif;--radius:8px}
*{box-sizing:border-box}html{scroll-behavior:smooth;scroll-padding-top:56px}
body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.55 var(--sans)}
a{color:var(--accent);text-decoration:none}a:hover{text-decoration:underline}
button,select{font:inherit;color:inherit;background:var(--panel-2);border:1px solid var(--line-2);border-radius:6px;padding:3px 10px;cursor:pointer;white-space:nowrap}
button:hover{border-color:var(--accent)}button:disabled{opacity:.45;cursor:default;border-color:var(--line-2)}
button.primary{background:color-mix(in srgb,var(--accent) 22%,var(--panel-2));border-color:var(--accent);color:#fff}
button:focus-visible,input:focus-visible,select:focus-visible,a:focus-visible,summary:focus-visible,[tabindex]:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
code,.mono{font-family:var(--mono);font-size:12.5px}
#top{position:sticky;top:0;z-index:20;height:44px;display:flex;align-items:center;gap:10px;padding:0 16px;border-bottom:1px solid var(--line);background:color-mix(in srgb,var(--panel) 92%,transparent);backdrop-filter:blur(8px);min-width:0}
.brand{font-weight:700;letter-spacing:.14em;font-size:12px}.sep{color:var(--faint)}.page{color:var(--muted);text-transform:uppercase;letter-spacing:.08em;font-size:11px;white-space:nowrap}
.project{font-family:var(--mono);font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}.grow{flex:1}
.nav{font-size:12.5px;color:var(--muted)}.nav:hover{color:var(--fg);text-decoration:none}
.status{display:inline-flex;align-items:center;gap:6px;font-size:12px;color:var(--muted);white-space:nowrap}.status i{width:7px;height:7px;border-radius:50%;background:var(--faint)}
.status[data-state=ready] i{background:var(--ok)}.status[data-state=busy] i{background:var(--accent);animation:pulse 1s infinite alternate}.status[data-state=stale] i{background:var(--warn)}.status[data-state=error] i{background:var(--err)}
@keyframes pulse{to{opacity:.3}}
#refresh[data-stale]{border-color:var(--warn);color:var(--warn)}
.chips{display:inline-flex;gap:2px;background:var(--bg);border:1px solid var(--line-2);border-radius:8px;padding:2px;flex-wrap:wrap}
.chips button{border:0;background:none;padding:2px 9px;border-radius:6px;color:var(--muted);font-size:12.5px}.chips button[aria-pressed=true]{background:var(--panel-3);color:var(--fg)}
.chips button i{font-style:normal;font-family:var(--mono);font-size:11px;color:var(--faint);margin-left:4px}
.wrap{display:grid;grid-template-columns:200px minmax(0,1fr);gap:28px;max-width:1320px;margin:0 auto;padding:22px 20px 80px}
#toc{position:sticky;top:64px;align-self:start;max-height:calc(100vh - 84px);overflow:auto;font-size:13px}
#toc h3{margin:0 0 8px;font-size:10.5px;letter-spacing:.12em;text-transform:uppercase;color:var(--muted);font-weight:600}
#toc ol{list-style:none;margin:0;padding:0}#toc a{display:flex;align-items:center;gap:8px;padding:4px 8px;border-radius:5px;color:var(--fg-2)}
#toc a:hover{background:var(--panel-2);text-decoration:none}#toc a[aria-current=true]{background:var(--panel-3);color:#fff}
#toc .n{margin-left:auto;font-family:var(--mono);font-size:10.5px;color:var(--faint)}#toc .dot{width:7px;height:7px;border-radius:50%;flex:none}
main{min-width:0;display:grid;gap:16px}
.card{background:var(--panel);border:1px solid var(--line);border-radius:var(--radius);min-width:0}
section.sec{padding:16px 18px}
section.sec>header{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap;margin-bottom:12px}
section.sec h2{margin:0;font-size:16.5px;font-weight:620}.q{font-size:12.5px;color:var(--muted)}
section.sec h3{margin:14px 0 8px;font-size:13.5px;font-weight:600}
.eyebrow{font-size:10.5px;letter-spacing:.14em;text-transform:uppercase;color:var(--muted);font-weight:600}
#hero{padding:20px 22px;position:relative;overflow:hidden}
#hero h1{margin:4px 0 2px;font-size:25px;letter-spacing:-.01em;font-weight:650}
#hero .tagline{margin:0 0 14px;color:var(--fg-2)}
.verdict{display:flex;gap:16px;align-items:center;flex-wrap:wrap;margin:6px 0 14px}
.pill{display:inline-flex;align-items:center;gap:8px;font-size:13px;letter-spacing:.12em;font-weight:700;padding:6px 14px;border-radius:999px;border:1px solid;text-transform:uppercase}
.pill i{width:9px;height:9px;border-radius:50%;background:currentColor}
.s-healthy{color:var(--ok)}.s-attention{color:var(--warn)}.s-degraded{color:var(--deg)}.s-critical{color:var(--err)}.s-unknown{color:var(--unknown)}
.pill.s-unknown{border-style:dashed}
.reasons{margin:0;padding-left:18px;color:var(--fg-2);font-size:13px}
.meta{font-size:12px;color:var(--muted);display:flex;gap:10px;flex-wrap:wrap;align-items:center}
.dims{display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:10px;margin-top:6px}
.dim{border:1px solid var(--line-2);border-radius:8px;padding:10px 12px;background:var(--panel-2);text-align:left;display:grid;gap:3px;cursor:pointer;color:inherit;white-space:normal;border-top-width:3px}
.dim:hover{background:var(--panel-3)}
.dim .t{display:flex;align-items:center;gap:6px;font-size:12.5px;color:var(--fg-2)}.dim .t i{width:7px;height:7px;border-radius:50%;background:currentColor;flex:none}
.dim b{font-size:22px;font-weight:650;font-family:var(--mono);line-height:1.2}.dim .l{font-size:11.5px;color:var(--muted)}.dim .r{font-size:11.5px;color:var(--faint);overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}
.dim.s-healthy{border-top-color:var(--ok)}.dim.s-attention{border-top-color:var(--warn)}.dim.s-degraded{border-top-color:var(--deg)}.dim.s-critical{border-top-color:var(--err)}.dim.s-unknown{border-top-color:var(--line-2);border-top-style:dashed}
.dim b.none{color:var(--faint);font-size:16px}
.sevs{display:flex;gap:6px;flex-wrap:wrap;margin-top:12px}
.sev{font-size:12px;padding:3px 10px;border-radius:999px;border:1px solid var(--line-2);background:var(--panel-2);color:var(--fg-2);cursor:pointer}.sev b{font-family:var(--mono);margin-left:4px}
.sev.critical b,.sv.critical{color:var(--err)}.sev.high b,.sv.high{color:var(--deg)}.sev.medium b,.sv.medium{color:var(--warn)}.sev.low b,.sv.low{color:var(--info)}.sev.info b,.sv.info{color:var(--muted)}
.sv{font-size:10.5px;letter-spacing:.08em;font-weight:650;text-transform:uppercase;padding:1px 7px;border-radius:5px;border:1px solid currentColor;white-space:nowrap}
.cf{font-size:10.5px;padding:0 6px;border-radius:4px;border:1px solid var(--line-2);color:var(--fg-2);font-family:var(--mono);white-space:nowrap}
.cf.verified{color:var(--ok)}.cf.strong{color:var(--accent-2)}.cf.inferred{color:var(--warn);border-style:dashed}.cf.unknown{color:var(--unknown);border-style:dotted}
.box{border:1px solid var(--line);border-radius:8px;padding:12px 14px;background:var(--panel-2);min-width:0}
.box h3{margin:0 0 6px!important}
.grid2{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
.grid3{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}
.kv{display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:8px}
.kv div{border:1px solid var(--line);border-radius:6px;padding:8px 10px;background:var(--bg)}.kv b{display:block;font-family:var(--mono);font-size:18px;font-weight:620}.kv span{font-size:11.5px;color:var(--muted)}
.kv .bad b{color:var(--err)}.kv .warn b{color:var(--warn)}
.meter{height:8px;border-radius:5px;background:var(--line);overflow:hidden;display:flex}.meter i{display:block;height:100%}
.bar-ok{background:var(--ok)}.bar-strong{background:var(--accent)}.bar-warn{background:var(--warn)}.bar-deg{background:var(--deg)}.bar-err{background:var(--err)}.bar-none{background:var(--line-2)}
.legend{display:flex;gap:14px;flex-wrap:wrap;font-size:12px;color:var(--muted);margin-top:6px}.legend i{display:inline-block;width:9px;height:9px;border-radius:2px;margin-right:5px;vertical-align:-1px}
.note{font-size:12.5px;color:var(--muted)}
.banner{padding:10px 14px;border:1px dashed var(--line-2);border-radius:8px;color:var(--fg-2);font-size:13px}
.banner.warn{border-style:solid;border-color:color-mix(in srgb,var(--warn) 50%,var(--line));background:color-mix(in srgb,var(--warn) 7%,var(--panel))}
.unknown-card{padding:14px 16px;border:1px dashed var(--line-2);border-radius:8px;display:grid;gap:4px}.unknown-card b{letter-spacing:.12em;color:var(--unknown);font-size:12px}
/* tables */
.tscroll{overflow:auto;max-height:520px;border:1px solid var(--line);border-radius:6px}
table.t{width:100%;border-collapse:collapse;font-size:13px}
table.t th{position:sticky;top:0;background:var(--panel-2);text-align:left;font-weight:560;color:var(--muted);font-size:11.5px;letter-spacing:.04em;padding:7px 10px;border-bottom:1px solid var(--line-2);white-space:nowrap}
table.t td{padding:6px 10px;border-bottom:1px solid var(--line);vertical-align:top}table.t tr:last-child td{border-bottom:0}
table.t td.num{font-family:var(--mono);text-align:right;white-space:nowrap}table.t td.p{font-family:var(--mono);font-size:12px;word-break:break-all}
table.t tr.clickable{cursor:pointer}table.t tr.clickable:hover td{background:var(--panel-2)}
.tag{font-size:10.5px;padding:0 6px;border-radius:4px;background:var(--panel-3);color:var(--fg-2);border:1px solid var(--line-2);white-space:nowrap;font-family:var(--mono)}
.tag.ok{color:var(--ok)}.tag.bad{color:var(--err)}.tag.warn{color:var(--warn)}.tag.muted{color:var(--muted)}.tag.dashed{border-style:dashed}
/* paths */
.chain{display:flex;flex-wrap:wrap;align-items:center;gap:4px;font-family:var(--mono);font-size:11.5px}
.chain .n{padding:2px 7px;border:1px solid var(--line-2);border-radius:5px;background:var(--panel-2);cursor:pointer}.chain .n.none{border-color:var(--err);color:var(--err)}.chain .n.runtime,.chain .n.direct{border-color:color-mix(in srgb,var(--ok) 60%,var(--line-2));color:var(--ok)}.chain .n.transitive{border-style:dashed;color:var(--fg-2)}
.chain .arr{color:var(--faint)}
/* heat */
.heat{display:flex;flex-wrap:wrap;gap:3px;padding:8px;border:1px solid var(--line);border-radius:6px;background:var(--canvas);max-height:260px;overflow:auto}
.heat button{padding:0;border:0;border-radius:3px;min-width:10px;height:22px}
/* findings */
.filters{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:10px}
.filters input{flex:1;min-width:180px;background:var(--bg);border:1px solid var(--line-2);border-radius:6px;color:var(--fg);padding:5px 10px;font:inherit;font-size:13px}
.flist{display:grid;gap:6px}
details.f{border:1px solid var(--line);border-left:3px solid var(--line-2);border-radius:6px;background:var(--panel-2)}
details.f.critical{border-left-color:var(--err)}details.f.high{border-left-color:var(--deg)}details.f.medium{border-left-color:var(--warn)}details.f.low{border-left-color:var(--info)}details.f.info{border-left-color:var(--faint)}
details.f.reviewed-out{opacity:.6}
details.f>summary{list-style:none;cursor:pointer;padding:8px 12px;display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:2px 10px;align-items:center}
details.f>summary::-webkit-details-marker{display:none}details.f>summary:hover{background:var(--panel-3)}
details.f .tt{font-weight:540;word-break:break-word}details.f .fm{display:flex;gap:6px;align-items:center;font-size:11.5px;color:var(--muted);white-space:nowrap}
details.f .sub{grid-column:2/-1;font-size:12.5px;color:var(--muted);word-break:break-word}
details.f[open]{background:var(--panel)}details.f.flash{box-shadow:0 0 0 2px var(--accent)}
.fbody{padding:4px 14px 14px;display:grid;gap:12px;font-size:13px}
.fbody h4{margin:0 0 4px;font-size:10.5px;letter-spacing:.12em;text-transform:uppercase;color:var(--muted);font-weight:600}
.fbody p{margin:0;color:var(--fg-2)}
.ev{border:1px solid var(--line);border-radius:6px;overflow:hidden;background:var(--bg)}
.ev .row{display:flex;gap:8px;align-items:baseline;padding:4px 8px;flex-wrap:wrap;border-top:1px solid var(--line)}.ev .row:first-child{border-top:0}
.ev .p{font-family:var(--mono);font-size:11.5px;word-break:break-all;flex:1;min-width:0}.ev .d{flex-basis:100%;color:var(--fg-2);font-size:12px;word-break:break-word}
.act{font-size:11px;padding:0 7px;border-radius:4px;background:transparent;border:1px solid var(--line-2);color:var(--muted);white-space:nowrap}.act:hover{color:var(--fg);text-decoration:none}.act[aria-expanded=true]{color:var(--accent-2);border-color:var(--accent)}
pre.code{margin:0;padding:8px 0;background:var(--canvas);border-top:1px solid var(--line);font:11.5px/1.5 var(--mono);overflow:auto;max-height:280px;flex-basis:100%}
pre.code span{display:block;padding:0 10px;white-space:pre}pre.code span.f{background:color-mix(in srgb,var(--accent) 14%,transparent)}pre.code i{color:var(--faint);font-style:normal;display:inline-block;width:38px}
pre.out{margin:6px 0 0;padding:8px 10px;background:var(--canvas);border:1px solid var(--line);border-radius:6px;overflow:auto;max-height:300px;font:11.5px/1.5 var(--mono);color:var(--fg-2);white-space:pre-wrap;word-break:break-word}
.reviews{display:flex;gap:6px;flex-wrap:wrap;align-items:center}
ul.plain{margin:0;padding-left:18px;color:var(--fg-2)}ul.plain li{margin:2px 0}
.checklist{list-style:none;margin:6px 0 0;padding:0;display:grid;gap:2px;font-size:12.5px}.checklist li::before{display:inline-block;width:18px;font-weight:700}
.checklist li.pass::before{content:"✓";color:var(--ok)}.checklist li.fail::before{content:"✗";color:var(--warn)}
.more{font-size:12px;color:var(--muted);padding:2px 8px}
.emptyline{padding:12px;border:1px dashed var(--line-2);border-radius:6px;color:var(--muted);font-size:13px;text-align:center}
.disclaimer{padding:10px 14px;border:1px dashed var(--line-2);border-radius:8px;color:var(--fg-2);font-size:13px;margin-bottom:12px}
/* charts */
svg.quad{width:100%;height:auto;display:block;background:var(--canvas);border:1px solid var(--line);border-radius:6px}
svg.quad text{fill:var(--muted);font:11px var(--sans)}svg.quad .ql{fill:var(--faint);font-size:12px;letter-spacing:.1em;text-transform:uppercase}
svg.quad line.m{stroke:var(--line-2);stroke-dasharray:4 4}svg.quad circle{cursor:pointer}
.spark{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:10px}
.spark .box{display:grid;gap:4px}.spark svg{width:100%;height:46px;display:block}.spark polyline{fill:none;stroke:var(--accent);stroke-width:1.6}.spark circle{fill:var(--accent)}
.spark .v{font-family:var(--mono);font-size:18px}.spark .d{font-size:11.5px;color:var(--muted)}
.unknowns{margin:0;padding:10px 14px;border:1px dashed var(--line-2);border-radius:6px;color:var(--muted);font-size:12.5px;list-style:none;display:grid;gap:4px}
.unknowns li::before{content:"?";display:inline-block;width:16px;color:var(--unknown);font-weight:700}
.foot{margin-top:8px;font-size:12px;color:var(--faint);text-align:center;word-break:break-all}
#overlay{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;z-index:40;background:#07090dd8}#overlay[hidden]{display:none}
#overlay .box{max-width:460px;text-align:center;padding:24px;background:none;border:0}#overlay h2{font-size:16px;margin:0 0 8px}#overlay p{color:var(--muted)}
#toast{position:fixed;bottom:18px;left:50%;transform:translateX(-50%);z-index:50;background:var(--panel-3);border:1px solid var(--line-2);border-radius:8px;padding:8px 14px;font-size:13px;box-shadow:0 10px 30px #000a;max-width:90vw}#toast[hidden]{display:none}
`;

/** Breakpoints for the shared report layout; include after page-specific rules. */
export const REPORT_RESPONSIVE_CSS = `@media (max-width:1100px){.grid3{grid-template-columns:1fr 1fr}}
@media (max-width:900px){.wrap{grid-template-columns:1fr;padding:14px 16px 60px}#toc{position:static;max-height:none}#toc ol{display:flex;flex-wrap:wrap;gap:2px}#toc .n{display:none}.page,#scope-label{display:none}.grid2,.grid3{grid-template-columns:1fr}details.f>summary{grid-template-columns:auto minmax(0,1fr)}details.f .fm{grid-column:2;grid-row:2;white-space:normal;flex-wrap:wrap}details.f .sub{grid-row:3}}
@media (max-width:560px){#top{gap:6px;padding:0 10px}#top .chips{display:none}}
@media (prefers-reduced-motion:reduce){html{scroll-behavior:auto}*{transition:none!important;animation:none!important}}`;
