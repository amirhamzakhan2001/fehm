import { CHROME_CSS, featureNav } from "../features.js";
import { REPORT_CSS, REPORT_RESPONSIVE_CSS } from "../report-css.js";

/**
 * Static shell for the Feature 3.5 project-health page. A scrolling report:
 * overview → attention → tests → coverage → quality → dead code →
 * dependencies → reliability → implementation integrity → technical debt → build &
 * CI → trends → findings → analysis. All behaviour is in ui/main.ts.
 */
export const HEALTH_PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Project Health · fehm</title><link rel="icon" href="data:,">
<style>
${REPORT_CSS}
${CHROME_CSS}
${REPORT_RESPONSIVE_CSS}
@media(max-width:600px){
  .readiness-table{max-height:none;overflow:visible}
  .readiness-table table,.readiness-table tbody,.readiness-table tr,.readiness-table td{display:block;width:auto;min-width:0}
  .readiness-table thead{display:none}
  .readiness-table tr{padding:10px 0;border-bottom:1px solid var(--line,#28303e)}
  .readiness-table td{border:0;padding:4px 12px;white-space:normal}
  .readiness-table td:first-child{font-weight:600}
}
</style></head><body>
<header id="top">
  <span class="brand">FEHM</span><span class="sep">/</span><span class="page">Project health</span>
  <span id="project" class="project"></span>
  <span class="grow"></span>
  <span id="status" class="status" data-state="busy" role="status" aria-live="polite"><i></i><span>Loading…</span></span>
  <span class="chips" role="group" aria-label="Scope"><button id="scope-all" aria-pressed="true" title="Analyse the whole project">All files</button><button id="scope-changed" aria-pressed="false" title="Only findings in files changed since the last commit">Changed</button></span>
  <button id="refresh" title="Re-index incrementally and analyse again">⟳ Analyze again</button>
  <a class="nav" id="export" href="/api/health/report" download="project-health.json" title="Full report as JSON">Export</a>
  ${featureNav("health")}
</header>
<div class="wrap">
  <nav id="toc" aria-label="Sections"></nav>
  <main id="content" aria-live="polite"></main>
</div>
<div id="overlay"><div class="box"><h2 id="overlay-title">Analysing project health…</h2><p id="overlay-text">Tests, coverage, quality, dependencies and history, from the repository index. No model calls.</p><button id="overlay-action" hidden>Retry</button></div></div>
<div id="toast" role="status" aria-live="polite" hidden></div>
<script type="module" src="/health/assets/health/ui/main.js"></script>
</body></html>`;
