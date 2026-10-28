import { CHROME_CSS, featureNav } from "../features.js";
import { REPORT_CSS, REPORT_RESPONSIVE_CSS } from "../report-css.js";

/**
 * Static shell for the Feature 3.6 security-review page. A scrolling report:
 * posture → attack surface → data flow → secrets → dependencies → auth & API
 * → CI/CD → containers & Kubernetes → infrastructure → LLM, agents & MCP →
 * controls → frameworks → findings → trends → analysis. Behaviour is in
 * ui/main.ts.
 */
export const SECURITY_PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Security Review · fehm</title><link rel="icon" href="data:,">
<style>
${REPORT_CSS}
.p-critical-attention{color:var(--err)}.p-attention-required{color:var(--deg)}.p-review{color:var(--warn)}.p-no-high-severity-findings{color:var(--ok)}.p-unknown{color:var(--unknown)}
.domains{display:grid;gap:6px}
.domain{display:grid;grid-template-columns:150px minmax(0,1fr) auto;gap:10px;align-items:center;font-size:13px;padding:4px 0;border-bottom:1px solid var(--line)}
.domain:last-child{border-bottom:0}.domain .nm{color:var(--fg-2)}.domain .cnt{font-family:var(--mono);font-size:11.5px;white-space:nowrap;display:flex;gap:6px}.domain.na{opacity:.55}
.trace{display:grid;gap:0;margin:4px 0}
.trace .st{display:grid;grid-template-columns:92px minmax(0,1fr) auto;gap:8px;align-items:baseline;padding:6px 10px;border:1px solid var(--line-2);border-radius:6px;background:var(--bg);font-size:12.5px}
.trace .st .r{font-size:10px;letter-spacing:.1em;text-transform:uppercase;font-weight:650;color:var(--muted)}
.trace .st.source{border-color:color-mix(in srgb,var(--warn) 55%,var(--line-2))}.trace .st.source .r{color:var(--warn)}
.trace .st.sink{border-color:color-mix(in srgb,var(--err) 60%,var(--line-2))}.trace .st.sink .r{color:var(--err)}
.trace .st.sanitizer .r{color:var(--ok)}.trace .st .l{font-family:var(--mono);font-size:12px;word-break:break-word}.trace .st .w{font-family:var(--mono);font-size:11px;color:var(--muted);white-space:nowrap}
.trace .ar{padding:0 0 0 44px;color:var(--faint);line-height:1.2;font-size:13px}
.trace-note{font-size:12.5px;padding:6px 10px;border-radius:6px;margin-top:6px;border:1px dashed var(--line-2);color:var(--fg-2)}.trace-note.bad{border-color:color-mix(in srgb,var(--err) 50%,var(--line));color:var(--err)}
.c{display:inline-flex;min-width:22px;justify-content:center;font-family:var(--mono);font-size:12px;border-radius:4px;padding:0 4px}
.c.detected{color:var(--ok)}.c.not-detected{color:var(--err);background:color-mix(in srgb,var(--err) 10%,transparent)}.c.unknown{color:var(--unknown)}.c.not-applicable{color:var(--faint)}
.reach{display:inline-flex;gap:3px}.reach span{font-size:10px;font-family:var(--mono);padding:0 4px;border-radius:3px;border:1px solid var(--line-2);color:var(--faint)}.reach span.on{color:var(--fg);border-color:var(--accent)}
.ctl{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:10px}
.ctl .box{display:grid;gap:4px}.ctl .hd{display:flex;align-items:center;gap:8px;font-weight:560}.ctl .ic{font-family:var(--mono);width:18px;text-align:center}
.ctl .present .ic{color:var(--ok)}.ctl .partial .ic{color:var(--warn)}.ctl .missing .ic{color:var(--err)}.ctl .unknown .ic{color:var(--unknown)}.ctl .not-applicable{opacity:.6}
.fw{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:6px}
.fw .cat{display:grid;grid-template-columns:52px minmax(0,1fr) auto;gap:6px;align-items:center;padding:6px 10px;border:1px solid var(--line);border-radius:6px;background:var(--bg);font-size:12.5px}
.fw .cat .id{font-family:var(--mono);color:var(--muted);font-size:11.5px}.fw .cat.findings{border-color:color-mix(in srgb,var(--deg) 50%,var(--line))}.fw .cat.not-covered{opacity:.5;border-style:dashed}
.bars{display:grid;gap:8px}.bar{display:grid;grid-template-columns:minmax(0,1fr) 180px 64px;gap:10px;align-items:center;font-size:12.5px}.bar .v{font-family:var(--mono);text-align:right;font-size:12px}
.tabs{display:flex;gap:4px;flex-wrap:wrap;margin-bottom:10px}
${CHROME_CSS}
${REPORT_RESPONSIVE_CSS}
@media (max-width:560px){#top a.nav{display:none}#refresh{padding:3px 8px}.pill{letter-spacing:.06em;font-size:12px;white-space:normal}}
@media (max-width:900px){.domain{grid-template-columns:110px minmax(0,1fr)}.domain .cnt{grid-column:1/-1}.bar{grid-template-columns:minmax(0,1fr) 90px 52px}.trace .st{grid-template-columns:minmax(0,1fr)}.trace .ar{padding-left:12px}}
</style></head><body>
<header id="top">
  <span class="brand">FEHM</span><span class="sep">/</span><span class="page">Security review</span>
  <span id="project" class="project"></span>
  <span class="grow"></span>
  <span id="status" class="status" data-state="busy" role="status" aria-live="polite"><i></i><span>Loading…</span></span>
  <span class="chips" role="group" aria-label="Scope"><button id="scope-all" aria-pressed="true" title="Review the whole project">All files</button><button id="scope-changed" aria-pressed="false" title="Only findings in files changed since the last commit">Changed</button></span>
  <button id="refresh" title="Re-index incrementally and review again">⟳ Run scan</button>
  <a class="nav" href="/api/security/sarif" download="fehm-security.sarif" title="SARIF 2.1.0 for code scanning">SARIF</a>
  <a class="nav" href="/api/security/report" download="security-review.json" title="Full report as JSON">Export</a>
  ${featureNav("security")}
</header>
<div class="wrap">
  <nav id="toc" aria-label="Sections"></nav>
  <main id="content" aria-live="polite"></main>
</div>
<div id="overlay"><div class="box"><h2 id="overlay-title">Reviewing security…</h2><p id="overlay-text">Data flow, secrets, routes, pipelines, infrastructure and AI integrations, from the repository index. No model calls.</p><button id="overlay-action" hidden>Retry</button></div></div>
<div id="toast" role="status" aria-live="polite" hidden></div>
<script type="module" src="/security/assets/security/ui/main.js"></script>
</body></html>`;
