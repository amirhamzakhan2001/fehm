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
${CHROME_CSS}
</style></head><body>
<header id="top">
  <span class="brand">FEHM</span><span class="sep">/</span><span class="page">Context engine</span>
  <span id="project" class="project"></span>
  <span class="grow"></span>
  ${featureNav("engine")}
</header>
<main>
  <h2>Index</h2>
  <div class="grid" id="stats"></div>
  <div class="row"><button id="rescan" type="button">⟳ Rescan</button><span class="muted" id="sync" role="status" aria-live="polite"></span></div>
  <h2>Context query</h2>
  <form id="query">
    <input name="q" placeholder="e.g. how does authentication work" required aria-label="Query">
    <input name="budget" type="number" value="4000" min="50" aria-label="Token budget">
    <select name="intent" aria-label="Intent"><option value="">auto intent</option><option>locate</option><option>explain</option><option>change</option><option>debug</option><option>test</option><option>architecture</option></select>
    <button>Build</button>
  </form>
  <p class="muted" id="budget"></p>
  <table id="nodes"></table>
  <h2>Preview</h2>
  <pre id="preview" class="muted">No query yet.</pre>
</main>
<script type="module" src="/engine/assets/engine/ui/main.js"></script>
</body></html>`;
