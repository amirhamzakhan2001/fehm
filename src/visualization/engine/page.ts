import { CHROME_CSS, featureNav } from "../features.js";

/** Static shell for the Feature 1 context-engine debug page. All behaviour lives in ui/main.ts. */
export const ENGINE_PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Context Engine · fehm</title><link rel="icon" href="data:,">
<style>
:root{--bg:#07090d;--panel:#0c0f16;--panel-2:#11151f;--line:#1b2130;--line-2:#262e42;--fg:#d6dce8;--fg-2:#b3bdcf;--muted:#7b859c;--faint:#4b546a;--accent:#7aa2f7;--ok:#5fd4c0;--warn:#e0af68;--err:#f7768e;--mono:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.55 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif}
a{color:var(--accent)}
button,input,select{font:inherit;color:inherit;background:var(--panel-2);border:1px solid var(--line-2);border-radius:6px;padding:5px 10px}
button{cursor:pointer}button:hover{border-color:var(--accent)}
button:focus-visible,input:focus-visible,select:focus-visible,a:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
#top{position:sticky;top:0;z-index:5;height:44px;display:flex;align-items:center;gap:10px;padding:0 16px;border-bottom:1px solid var(--line);background:var(--panel)}
.brand{font-weight:700;letter-spacing:.14em;font-size:12px}.sep{color:var(--faint)}.page{color:var(--muted);text-transform:uppercase;letter-spacing:.08em;font-size:11px;white-space:nowrap}
.project{font-family:var(--mono);font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}.grow{flex:1}
.nav{font-size:12.5px;color:var(--muted);text-decoration:none}.nav:hover{color:var(--fg)}
main{max-width:1100px;margin:0 auto;padding:22px 16px 60px}
h2{font-size:10.5px;margin:26px 0 10px;color:var(--muted);text-transform:uppercase;letter-spacing:.12em;font-weight:600}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:8px}
.stat{background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:10px 12px}.stat span{color:var(--muted);font-size:12px}.stat b{display:block;font:600 20px/1.3 var(--mono)}
.row{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-top:10px}
form{display:flex;gap:8px;flex-wrap:wrap}input[name=q]{flex:1;min-width:220px}input[name=budget]{width:100px}
table{width:100%;border-collapse:collapse;font-size:13px}td,th{text-align:left;padding:5px 8px;border-bottom:1px solid var(--line);vertical-align:top}th{color:var(--muted);font-weight:500}
td.n{font-family:var(--mono);white-space:nowrap}.p{font-family:var(--mono);font-size:11.5px;color:var(--muted)}
pre{background:var(--panel);border:1px solid var(--line);padding:12px 14px;border-radius:8px;overflow:auto;white-space:pre-wrap;font:12px/1.5 var(--mono);color:var(--fg-2)}
.muted{color:var(--muted)}.err{color:var(--err)}
.guide-card{padding:16px;margin:12px 0;border:1px solid var(--line);border-radius:8px;background:var(--panel)}
h1{font-size:24px;margin-bottom:6px}h3{font-size:16px;margin:0 0 8px}summary{cursor:pointer;padding:10px 0}details{margin:12px 0}li{margin:7px 0}p,a,code{overflow-wrap:anywhere}pre{max-height:420px}#guide h2{font-size:16px;text-transform:none;letter-spacing:0;color:var(--fg)}.diagnostics{overflow-x:auto}.guide-card .p{margin-bottom:10px}label{display:flex;gap:6px;align-items:center}#query>input{min-width:0;width:100%;flex-basis:100%}[hidden]{display:none!important}
${CHROME_CSS}
</style></head><body>
<header id="top">
  <span class="brand">FEHM</span><span class="sep">/</span><span class="page">Context engine</span>
  <span id="project" class="project"></span>
  <span class="grow"></span>
  ${featureNav("engine")}
</header>
<main>
  <h1>Find your way through the code</h1>
  <p class="muted">Ask a question to get a reading guide with source locations and indexed connections. Built locally, without an LLM.</p>
  <form id="query">
    <input name="q" placeholder="e.g. how does authorization work" required aria-label="Your question">
    <label>Context size <input name="budget" type="number" value="4000" min="50" max="50000" aria-label="Token budget"></label>
    <select name="intent" aria-label="Task"><option value="">Detect task automatically</option><option value="locate">Find code</option><option value="explain">Understand code</option><option value="change">Plan a change</option><option value="debug">Investigate a failure</option><option value="test">Find tests</option><option value="architecture">Explore architecture</option></select>
    <button id="build" type="submit">Find relevant code</button>
  </form>
  <p class="muted" id="budget" role="status" aria-live="polite">Enter a question to begin. Context size limits the exported text, not paid LLM usage.</p>
  <div id="guide"></div>
  <details id="export-panel" hidden><summary>Context for an AI assistant</summary>
    <p class="muted">This is the compact evidence packet. Your assistant can inspect the original files for more detail.</p>
    <button id="copy" type="button">Copy context</button> <button id="download" type="button">Download Markdown</button>
    <p id="copy-status" role="status"></p><pre id="preview"></pre>
  </details>
  <details id="retrieval-panel" hidden><summary>Search diagnostics</summary><p id="diagnostics" class="muted"></p><div class="diagnostics"><table id="nodes"></table></div></details>
  <details><summary>Repository index details</summary>
    <div class="grid" id="stats"></div>
    <div class="row"><button id="rescan" type="button">Rescan repository</button><span class="muted" id="sync" role="status" aria-live="polite"></span></div>
  </details>
</main>
<script type="module" src="/engine/assets/engine/ui/main.js"></script>
</body></html>`;
