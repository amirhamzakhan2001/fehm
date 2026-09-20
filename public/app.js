const state = { projects: [], projectId: null, overview: null, graph: null, systemMap: null, selected: null, scale: 1, offsetX: 0, offsetY: 0, drag: null, currentView: "graph", semanticTimer: null, viewEpoch: 0 };
const $ = (selector) => document.querySelector(selector);
const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
})[character]);

async function api(url, options) {
  const projectId = state.projectId;
  const epoch = state.viewEpoch;
  const scoped = state.projectId && url !== "/api/projects"
    ? `${url}${url.includes("?") ? "&" : "?"}project=${encodeURIComponent(state.projectId)}`
    : url;
  const send = () => {
    const headers = new Headers(options?.headers);
    const token = sessionStorage.getItem("fehm-auth-token");
    if (token) headers.set("authorization", `Bearer ${token}`);
    return fetch(scoped, { ...options, headers });
  };
  let response = await send();
  if (response.status === 401) {
    sessionStorage.removeItem("fehm-auth-token");
    const token = window.prompt("This fehm cockpit requires an access token.");
    if (token?.trim()) {
      sessionStorage.setItem("fehm-auth-token", token.trim());
      response = await send();
    }
  }
  const data = await response.json();
  if (projectId !== state.projectId || epoch !== state.viewEpoch) throw new DOMException("Superseded request", "AbortError");
  if (!response.ok) throw new Error(`${data.error || "Request failed"}${data.requestId ? ` (request ${data.requestId})` : ""}`);
  return data;
}

function metrics() {
  const stats = state.overview.stats;
  $("#metrics").innerHTML = `<span>Nodes <b>${stats.nodes}</b></span><span>Edges <b>${stats.edges}</b></span><span>Tests <b>${stats.tests}</b></span><span>Calls <b>${stats.calls}</b></span>`;
  const sync = state.overview.synchronization;
  const freshness = sync?.summaryFreshness.percent ?? 100;
  $("#sync-card").innerHTML = `<p class="eyebrow">Index freshness</p><strong class="${freshness === 100 ? "status-fresh" : "status-stale"}">${freshness}% fresh</strong><div>${esc(sync?.mode || "full")} sync · ${sync?.analyzedFiles.length ?? stats.files} analyzed</div><div>${sync?.reusedFiles.length ?? 0} files reused</div>`;
}

async function loadGraph(query = "") {
  const level = $("#level").value;
  state.graph = await api(`/api/graph?level=${level}${query ? `&q=${encodeURIComponent(query)}` : ""}`);
  layout();
  draw();
}

function layout() {
  const nodes = state.graph.nodes;
  const width = $("#graph-canvas").clientWidth;
  const height = $("#graph-canvas").clientHeight;
  nodes.forEach((node, index) => {
    const ring = Math.floor(Math.sqrt(index)) + 1;
    const angle = index * 2.399;
    node._x = width / 2 + Math.cos(angle) * ring * 42;
    node._y = height / 2 + Math.sin(angle) * ring * 30;
  });
}

function color(kind, nodeId) {
  const prophecy = state.systemMap?.prophecies.find((item) => item.node.id === nodeId);
  if (prophecy?.score >= 75) return "#ff6b6b";
  if (prophecy?.score >= 50) return "#ff9b62";
  if (prophecy?.score >= 25) return "#e9c46a";
  if (kind === "repository") return "#e9ff70";
  if (kind === "directory") return "#73d5e8";
  if (kind === "file") return "#a78bfa";
  if (kind === "package") return "#ff9b62";
  return "#d5dae0";
}

function draw() {
  const canvas = $("#graph-canvas");
  const density = devicePixelRatio || 1;
  const bounds = canvas.getBoundingClientRect();
  canvas.width = bounds.width * density;
  canvas.height = bounds.height * density;
  const context = canvas.getContext("2d");
  context.scale(density, density);
  context.translate(state.offsetX, state.offsetY);
  context.scale(state.scale, state.scale);
  const nodes = new Map(state.graph.nodes.map((node) => [node.id, node]));
  context.lineWidth = 1 / state.scale;
  context.strokeStyle = "#303740";
  state.graph.edges.forEach((edge) => {
    const source = nodes.get(edge.source);
    const target = nodes.get(edge.target);
    if (!source || !target) return;
    context.beginPath();
    context.moveTo(source._x, source._y);
    context.lineTo(target._x, target._y);
    context.stroke();
  });
  state.graph.nodes.forEach((node) => {
    context.beginPath();
    context.fillStyle = color(node.kind, node.id);
    context.arc(node._x, node._y, node === state.selected ? 8 : 5, 0, Math.PI * 2);
    context.fill();
    if (state.scale > 0.8) {
      context.fillStyle = "#aeb5be";
      context.font = `${11 / state.scale}px system-ui`;
      context.fillText(node.name, node._x + 10, node._y + 4);
    }
  });
}

function pick(event) {
  const canvas = $("#graph-canvas");
  const bounds = canvas.getBoundingClientRect();
  const x = (event.clientX - bounds.left - state.offsetX) / state.scale;
  const y = (event.clientY - bounds.top - state.offsetY) / state.scale;
  state.selected = state.graph.nodes.find((node) => Math.hypot(node._x - x, node._y - y) < 12 / state.scale) || null;
  details();
  draw();
}

function details() {
  const node = state.selected;
  if (!node) {
    $("#details").innerHTML = '<div class="empty-state"><span>◎</span><h3>Select a node</h3><p>Inspect its location, relationships, confidence, and truth level.</p></div>';
    return;
  }
  const edges = state.graph.edges.filter((edge) => edge.source === node.id || edge.target === node.id);
  $("#details").innerHTML = `<span class="badge">✓ FACT · AST</span><h3 class="detail-title">${esc(node.name)}</h3><p class="muted">${esc(node.summary || node.qualifiedName)}</p><div class="detail-list"><div class="detail-row"><small>Kind</small>${esc(node.kind)}</div><div class="detail-row"><small>Location</small>${esc(node.path || "Graph only")}${node.location ? `:${node.location.line}` : ""}</div><div class="detail-row"><small>Relationships</small>${edges.length} verified edges</div><div class="detail-row"><small>Summary freshness</small>${esc(node.summaryStatus || "not-generated")}</div><div class="detail-row"><small>Confidence</small>100% deterministic</div></div>`;
}

function view(title, subtitle, content) {
  $("#graph-view").classList.remove("active");
  const panel = $("#panel-view");
  panel.classList.add("active");
  panel.innerHTML = `<div class="view-head"><div><p class="eyebrow">${esc(subtitle)}</p><h2>${esc(title)}</h2></div></div>${content}`;
}

async function selectProject(projectId, nextView = "graph") {
  state.viewEpoch += 1;
  state.projectId = projectId;
  state.selected = null;
  state.systemMap = null;
  $("#project-selector").value = projectId;
  state.overview = await api("/api/overview");
  $("#repo-name").textContent = state.overview.repository.name;
  $("#health").textContent = `Health ${state.overview.health.score}%`;
  metrics();
  history.pushState({}, "", `/projects/${encodeURIComponent(projectId)}`);
  await loadGraph();
  await switchView(nextView);
}

function projectsView() {
  view("Projects", "One local brain for every workspace", `<div class="cards">${state.projects.map((project) => `<article class="card actionable project-card" data-project="${esc(project.id)}"><div class="status-row"><span class="badge">${esc(project.architecture)}</span><strong>${project.health.score}%</strong></div><h3>${esc(project.name)}</h3><p class="muted">${project.stats.files.toLocaleString()} files · ${project.stats.symbols.toLocaleString()} symbols</p><p class="${project.health.warnings ? "status-stale" : "status-fresh"}">${project.health.warnings ? `${project.health.warnings} freshness warning(s)` : "Clean and synchronized"}</p></article>`).join("")}</div>`);
  document.querySelectorAll(".project-card").forEach((card) => { card.onclick = () => selectProject(card.dataset.project); });
}

async function architectureView() {
  view("Architecture", "LLM may propose · developer approves · deterministic engine enforces", '<div id="architecture-panel" class="cards"><div class="card">Reading architecture state…</div></div>');
  const [stateResult, timeline, adr] = await Promise.all([api("/api/architecture"), api("/api/timeline"), api("/api/adr-maintenance")]);
  const historyCards = `<div class="card"><span class="badge">GIT TIME MACHINE</span><h3>${timeline.snapshots.length} snapshots</h3><p class="muted">${timeline.snapshots.filter((item)=>item.source==="git-history").length} reconstructed from commits · ${timeline.events.length} structural changes</p></div><div class="card"><span class="badge">ADR MAINTENANCE</span><h3>${adr.drafts.length} draft decisions</h3><p class="muted">${adr.stale.length} accepted ADRs need review · ${adr.current.length} current</p></div>${timeline.events.slice(-6).reverse().map((item)=>`<div class="card"><span class="badge">${esc(item.kind)}</span><h3>${esc(item.detail)}</h3><p class="muted">${esc(item.at)}</p></div>`).join("")}`;
  const proposal = stateResult.proposal;
  const contract = stateResult.contract;
  if (contract) {
    $("#architecture-panel").innerHTML = `<div class="card"><span class="badge">APPROVED · FACT</span><h3>Versioned architecture contract</h3><p class="muted">Approved ${esc(contract.approval?.approvedAt || "by developer")}</p></div>${contract.layers.map((layer) => `<div class="card"><span class="badge">LAYER</span><h3>${esc(layer.name)}</h3><p>${esc((contract.intent || {})[layer.name] || "Declared project boundary")}</p><p class="muted">${layer.patterns.map(esc).join(" · ")}</p></div>`).join("")}${historyCards}`;
    return;
  }
  if (proposal) {
    $("#architecture-panel").innerHTML = `<div class="card"><span class="badge" style="color:var(--cyan)">INFERRED · ${proposal.confidence}%</span><h3>Review proposed contract</h3><p class="muted">${proposal.detectedTechnologies.map(esc).join(" · ")}</p><button id="approve-architecture" class="primary">Looks correct — approve baseline</button></div>${proposal.config.layers.map((layer) => `<div class="card"><span class="badge" style="color:var(--cyan)">PROPOSED</span><h3>${esc(layer.name)}</h3><p>${esc((proposal.config.intent || {})[layer.name] || "Inferred boundary")}</p><p class="muted">${layer.patterns.map(esc).join(" · ")}</p></div>`).join("")}${historyCards}`;
    $("#approve-architecture").onclick = async () => { await api("/api/architecture/approve", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }); await architectureView(); };
    return;
  }
  $("#architecture-panel").innerHTML = '<div class="card"><span class="badge" style="color:var(--cyan)">NOT CONFIGURED</span><h3>Discover the intended architecture</h3><p class="muted">fehm will infer upper-level boundaries from directories, packages, imports, frameworks, and tests. Nothing is enforced until you approve it.</p><button id="propose-architecture" class="primary">Analyze and propose contract</button></div>' + historyCards;
  $("#propose-architecture").onclick = async () => { await api("/api/architecture/propose", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }); await architectureView(); };
}

async function systemMapView() {
  view("AI-native system map", "DNA · prophecy · entry points · uncertainty", '<div id="system-map-panel" class="cards"><div class="card">Building evidence-backed system profile…</div></div>');
  state.systemMap = state.systemMap ?? await api("/api/system-map");
  const report = state.systemMap;
  const dna = report.dna;
  $("#system-map-panel").innerHTML = `<div class="card"><span class="badge">CODEBASE DNA</span><h3>${esc(dna.architectureStyle)}</h3><p class="muted">${dna.technologies.map(esc).join(" · ")}</p><div class="status-row"><span>AI readiness</span><strong>${dna.aiReadiness}%</strong></div><div class="meter"><span style="width:${dna.aiReadiness}%"></span></div></div><div class="card"><span class="badge">SYSTEM HEALTH</span><h3>${dna.technicalDebtPercent}% technical debt</h3><p class="muted">${esc(dna.complexity)} complexity · ${esc(dna.coupling)} coupling · ${dna.metrics.layers} layers</p></div><div class="card"><span class="badge">ENTRY POINTS</span><strong>${report.entryPoints.length}</strong><p class="muted">${report.entryPoints.slice(0,5).map((entry) => esc(entry.label)).join(" · ") || "None statically detected"}</p></div><div class="card"><span class="badge" style="color:var(--orange)">UNKNOWNS</span><strong>${report.unknowns.reduce((total,item)=>total+item.count,0)}</strong><p class="muted">Visible uncertainty instead of false confidence</p></div>${report.prophecies.slice(0,8).map((item) => `<div class="card"><div class="status-row"><span class="badge" style="color:${item.score>=75?'var(--red)':item.score>=50?'var(--orange)':'var(--cyan)'}">${item.level} · ${item.score}</span><span>${item.confidence}% confidence</span></div><h3>${esc(item.node.name)}</h3><p>${esc(item.prediction)}</p><div class="meter"><span style="width:${item.score}%;background:${item.score>=75?'var(--red)':item.score>=50?'var(--orange)':'var(--cyan)'}"></span></div></div>`).join("")}`;
  $("#system-map-panel").insertAdjacentHTML("beforeend", `<div class="card senior-card"><span class="badge">SENIOR ENGINEER BRIEFING · ${report.onboarding.confidence}%</span><h3>${esc(report.onboarding.title)}</h3><p>${esc(report.onboarding.summary)}</p><form id="explain-form" class="context-form"><input id="explain-query" placeholder="Explain a file or symbol"><button class="primary">Explain</button></form><div id="explanation-result"></div></div>${report.unknowns.map((item) => `<div class="card unknown-card"><div class="status-row"><span class="badge" style="color:var(--orange)">${item.severity}</span><strong>${item.count}</strong></div><h3>${esc(item.kind.replaceAll("-"," "))}</h3><p>${esc(item.detail)}</p><p class="muted">Confidence ${Math.round(item.confidence*100)}%${item.paths.length?` · ${item.paths.slice(0,4).map(esc).join(" · ")}`:""}</p></div>`).join("")}`);
  $("#explain-form").onsubmit = async (event) => { event.preventDefault(); const explanation = await api(`/api/explain?q=${encodeURIComponent($("#explain-query").value || "project")}`); $("#explanation-result").innerHTML = `<h3>${esc(explanation.title)}</h3><p>${esc(explanation.summary)}</p><p class="muted">${explanation.facts.map(esc).join(" · ")}</p>${explanation.risks.map((risk)=>`<p class="status-stale">⚠ ${esc(risk)}</p>`).join("")}`; };
  draw();
}

async function flowExplorerView() {
  state.systemMap = state.systemMap ?? await api("/api/system-map");
  const options = state.systemMap.entryPoints.map((entry) => `<option value="${esc(entry.label)}">${esc(entry.kind)} · ${esc(entry.label)}</option>`).join("");
  view("Execution-flow explorer", "Trace user actions and entry points through verified relationships", `<form id="flow-form" class="context-form"><select id="flow-query" aria-label="Entry point"><option value="">Choose an entry point or type below</option>${options}</select><input id="flow-custom" placeholder="Symbol, file, route, or action"><button class="primary">Trace flow</button></form><div id="flow-result"></div>`);
  $("#flow-form").onsubmit = async (event) => {
    event.preventDefault();
    const query = $("#flow-custom").value.trim() || $("#flow-query").value;
    if (!query) return;
    $("#flow-result").innerHTML = '<div class="card" style="margin-top:18px">Tracing verified execution relationships…</div>';
    const flow = await api(`/api/flow?q=${encodeURIComponent(query)}`);
    $("#flow-result").innerHTML = `<div class="card" style="margin-top:18px"><div class="status-row"><span class="badge">${flow.entryPoint?esc(flow.entryPoint.kind):"GRAPH MATCH"}</span><strong>${flow.confidence}%</strong></div><h3>${esc(flow.entryPoint?.label || flow.query)}</h3><div class="flow-list">${flow.steps.map((step) => `<div class="flow-step"><span>${step.order}</span><div><strong>${esc(step.node.qualifiedName)}</strong><small>${esc(step.via || "entry")} · ${Math.round(step.confidence*100)}% · ${esc(step.evidence)}</small></div></div>`).join("") || '<p class="muted">No trustworthy flow was found.</p>'}</div>${flow.unknowns.map((item)=>`<p class="status-stale">? ${esc(item)}</p>`).join("")}</div>`;
  };
}

async function relationshipsView() {
  view("Relationship explorer", "Callers · dependencies · what breaks", '<form id="relationship-form" class="context-form"><input id="relationship-query" placeholder="Function, class, file, or qualified symbol" required><select id="relationship-direction"><option value="both">Both directions</option><option value="callers">What breaks / callers</option><option value="dependencies">Dependencies</option></select><button class="primary">Explore</button></form><div id="relationship-results"></div>');
  $("#relationship-form").onsubmit = async (event) => {
    event.preventDefault();
    const query = $("#relationship-query").value.trim();
    $("#relationship-results").innerHTML = '<div class="card" style="margin-top:18px">Traversing verified relationships…</div>';
    const report = await api(`/api/relationships?q=${encodeURIComponent(query)}&direction=${encodeURIComponent($("#relationship-direction").value)}&depth=8`);
    $("#relationship-results").innerHTML = `<div class="card" style="margin-top:18px"><div class="status-row"><span class="badge">${esc(report.direction)}</span><strong>${report.related.length}</strong></div><h3>${esc(report.root?.qualifiedName || "No exact graph root")}</h3><p class="muted">Paths preserve every hop and edge confidence.${report.truncated ? " Result capped—refine the query." : ""}</p></div><div class="relationship-list">${report.related.map((item) => `<div class="card"><div class="status-row"><span class="badge">${item.distance} hop${item.distance === 1 ? "" : "s"} · ${esc(item.via)}</span><span>${Math.round(item.confidence * 100)}%</span></div><h3>${esc(item.node.qualifiedName)}</h3><p class="muted">${item.path.map(esc).join(" → ")}</p></div>`).join("") || '<div class="card">No relationship path was found.</div>'}</div>`;
  };
}

async function healthView() {
  view("Unified project health", "Architecture · security · coverage · maintainability · operability", '<div id="health-panel" class="cards"><div class="card">Building the cross-system health report…</div></div>');
  const [report, detection] = await Promise.all([api("/api/health"), api("/api/detection")]);
  $("#health").textContent = `Health ${report.score}%`;
  $("#health-panel").innerHTML = `<div class="card health-hero"><span class="badge">${esc(report.status)}</span><strong>${report.score}/100</strong><p class="muted">${report.evidence.measuredDimensions} measured dimensions · ${report.evidence.unavailableDimensions} unavailable and excluded from the score.</p></div>${Object.entries(report.dimensions).map(([name, item]) => { const score = item.score; return `<div class="card"><div class="status-row"><span class="badge">${esc(name)}</span><strong>${score === null ? "N/A" : score}</strong></div><div class="meter"><span style="width:${score ?? 0}%;background:${score === null ? "var(--muted)" : score >= 80 ? "var(--accent)" : score >= 55 ? "var(--cyan)" : "var(--orange)"}"></span></div><p class="muted">${esc(item.detail)} · ${esc(item.basis)}</p></div>`; }).join("")}<div class="card"><span class="badge">Detected stack</span><h3>${detection.languages.map(esc).join(" · ") || "Unknown"}</h3><p class="muted">${[...detection.frameworks, ...detection.databases, ...detection.testing, ...detection.infrastructure].map(esc).join(" · ") || "No framework metadata detected"}</p></div><div class="card"><span class="badge">Priorities</span>${report.priorities.map((item) => `<p>${esc(item)}</p>`).join("")}</div>`;
}

async function universalSearch(query) {
  if (!query) return switchView("graph");
  view("Search everything", "Code · relationships · APIs · tests · security · runtime · infrastructure", '<div id="universal-results" class="cards"><div class="card">Searching all intelligence layers…</div></div>');
  const hits = await api(`/api/search?q=${encodeURIComponent(query)}&limit=80`);
  $("#universal-results").innerHTML = hits.map((item) => `<div class="card"><div class="status-row"><span class="badge">${esc(item.kind)}</span><strong>${item.score}</strong></div><h3>${esc(item.title)}</h3><p>${esc(item.detail)}</p>${item.path ? `<p class="muted">${esc(item.path)}</p>` : ""}</div>`).join("") || '<div class="card">No matches across code or project intelligence.</div>';
}

const promptMetricLabels = {
  instructionClarity: "Instruction clarity", consistency: "Consistency", completeness: "Completeness", hierarchy: "Hierarchy",
  outputReliability: "Output reliability", security: "Security", injectionResistance: "Injection resistance",
  leakageResistance: "Leakage resistance", toolAlignment: "Tool alignment", edgeCaseHandling: "Edge-case handling",
};

function renderPromptReport(payload) {
  const report = payload.report;
  const score = report.scorecard.overall;
  const metricCards = Object.entries(report.scorecard.metrics).map(([key, value]) => `<div class="prompt-metric"><span>${esc(promptMetricLabels[key] || key)}</span><strong>${value}</strong><div class="meter"><span style="width:${value}%;background:${value>=80?'var(--accent)':value>=60?'var(--cyan)':'var(--orange)'}"></span></div></div>`).join("");
  const structure = report.structure.map((item) => `<div class="structure-row"><span class="structure-state ${item.status}">${item.status === "present" ? "✓" : item.status === "partial" ? "!" : "×"}</span><div><strong>${esc(item.label)}</strong><small>${esc(item.status === "present" ? item.evidence[0] || "Explicit instruction detected" : item.recommendation)}</small></div></div>`).join("");
  const findings = report.findings.map((item) => `<div class="card prompt-finding ${item.severity}"><div class="status-row"><span class="badge">${esc(item.category)}</span><span>${Math.round(item.confidence*100)}% confidence</span></div><h3>${esc(item.title)}</h3><p>${esc(item.detail)}</p><p class="muted">${esc(item.recommendation)}</p>${item.targetNode?`<code>${esc(item.targetNode.qualifiedName)}</code>`:""}</div>`).join("");
  const dependencies = report.dependencies.length ? report.dependencies.map((item) => `<div class="dependency-row"><span class="structure-state ${item.status === "matched" ? "present" : "missing"}">${item.status === "matched" ? "✓" : item.status === "risky" ? "!" : "×"}</span><div><strong>${esc(item.reference)}</strong><small>${esc(item.status)}${item.targetNode?` → ${esc(item.targetNode.qualifiedName)}`:" → no indexed contract"}</small></div></div>`).join("") : '<p class="muted">No explicit tool references detected.</p>';
  const cases = report.evaluationSuite.map((item) => `<details class="eval-case"><summary><span class="badge">${esc(item.category)}</span>${esc(item.id)}</summary><p><strong>Input:</strong> ${esc(item.input)}</p><p><strong>Expected:</strong> ${esc(item.expectedBehavior)}</p><small>${esc(item.rationale)}</small></details>`).join("");
  const diff = payload.diff ? `<section class="prompt-section"><div class="status-row"><div><p class="eyebrow">Prompt diff intelligence</p><h3>${payload.diff.beforeScore} → ${payload.diff.afterScore} <span class="${payload.diff.scoreDelta>=0?'status-fresh':'status-stale'}">(${payload.diff.scoreDelta>=0?'+':''}${payload.diff.scoreDelta})</span></h3></div><span class="badge">${payload.diff.passed?'PASS':'REGRESSION'}</span></div>${payload.diff.changes.map((item)=>`<div class="diff-row"><span>${esc(item.impact)}</span><div><strong>${esc(item.area)}</strong><small>${esc(item.consequence)}</small></div></div>`).join("")}${payload.diff.regressions.map((item)=>`<p class="status-stale">↓ ${esc(item)}</p>`).join("")}</section>` : "";
  return `<div class="prompt-report"><section class="prompt-score"><div class="score-ring" style="--score:${score}"><div><strong>${score}</strong><span>/ 100</span></div></div><div><p class="eyebrow">System prompt score</p><h3>${report.summary.highSeverityFindings} high-severity finding${report.summary.highSeverityFindings===1?'':'s'}</h3><p class="muted">${report.summary.instructions} instructions · ${report.summary.generatedTests} generated tests · ${report.scorecard.confidence}% confidence</p></div></section><section class="prompt-metrics">${metricCards}</section>${diff}<div class="prompt-columns"><section class="prompt-section"><p class="eyebrow">Prompt structure</p><h3>Instruction anatomy</h3>${structure}</section><section class="prompt-section"><p class="eyebrow">Prompt dependency graph</p><h3>Instructions → tools → code</h3>${dependencies}</section></div><section class="prompt-section"><div class="status-row"><div><p class="eyebrow">Engineering findings</p><h3>Why this prompt can fail</h3></div><strong>${report.findings.length}</strong></div><div class="cards">${findings || '<p class="muted">No deterministic findings.</p>'}</div></section><section class="prompt-section"><div class="status-row"><div><p class="eyebrow">Evaluation suite</p><h3>Editable behavioral scenarios</h3></div><strong>${report.evaluationSuite.length}</strong></div><div class="eval-list">${cases}</div></section></div>`;
}

function renderPromptHistories(histories) {
  return histories.length ? histories.map((history) => { const latest = history.versions.at(-1); const executions = history.versions.reduce((total, version) => total + (version.executions?.length ?? 0), 0); const failures = history.versions.reduce((total, version) => total + (version.executions ?? []).reduce((sum, execution) => sum + execution.failures.length, 0), 0); return `<button class="history-row" data-prompt-name="${esc(history.name)}"><span><strong>${esc(history.name)}</strong><small>${history.versions.length} version${history.versions.length===1?'':'s'} · ${executions} model run${executions===1?'':'s'}${failures?` · ${failures} failure${failures===1?'':'s'}`:''}</small></span><b>${latest?.scorecard.overall ?? 0}</b></button>`; }).join("") : '<p class="muted">No prompt versions saved yet.</p>';
}

async function promptLabView() {
  view("System Prompt Lab", "Evaluate instructions against behavior, security, tools, and code", `<div class="prompt-workspace"><form id="prompt-form" class="prompt-editor card"><div class="status-row"><span class="badge">LOCAL-FIRST EVALUATION</span><span class="muted">No model key required</span></div><div class="prompt-identity"><label>Name<input id="prompt-name" value="system-prompt" required></label><label>Change reason<input id="prompt-reason" placeholder="Why this version changed"></label></div><label class="editor-label">System prompt<textarea id="prompt-source" required placeholder="You are a customer-support agent. Use the search tool to cite sources…"></textarea></label><details class="previous-prompt"><summary>Compare with a previous prompt</summary><textarea id="previous-prompt" placeholder="Paste the previous version to detect semantic regressions…"></textarea></details><div class="prompt-actions"><button class="primary" type="submit">Analyze prompt</button><button id="save-prompt" type="button">Save version</button><span>Structure · conflicts · security · tool contracts</span></div></form><aside class="prompt-preview card"><p class="eyebrow">Prompt evolution</p><h3>Saved prompt histories</h3><div id="prompt-histories"><p class="muted">Loading local versions…</p></div></aside></div><div id="prompt-results"><div class="prompt-empty card"><span>◫</span><h3>10-dimensional prompt scorecard</h3><p class="muted">Analyze a prompt to connect its instructions to repository capabilities, expose failure modes, and generate a behavioral evaluation suite.</p></div></div>`);
  const refreshHistory = async () => { $("#prompt-histories").innerHTML = renderPromptHistories(await api("/api/prompt/history")); };
  await refreshHistory();
  $("#prompt-form").onsubmit = async (event) => {
    event.preventDefault();
    $("#prompt-results").innerHTML = '<div class="card">Evaluating prompt structure, security boundaries, and code contracts…</div>';
    try {
      const payload = await api("/api/prompt/analyze", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ prompt: $("#prompt-source").value, previousPrompt: $("#previous-prompt").value }) });
      $("#prompt-results").innerHTML = renderPromptReport(payload);
    } catch (error) { $("#prompt-results").innerHTML = `<div class="card status-stale">${esc(error.message)}</div>`; }
  };
  $("#save-prompt").onclick = async () => {
    const prompt = $("#prompt-source").value.trim();
    if (!prompt) return $("#prompt-source").focus();
    await api("/api/prompt/save", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: $("#prompt-name").value, reason: $("#prompt-reason").value, prompt }) });
    await refreshHistory();
    $("#prompt-form").requestSubmit();
  };
}

async function advancedIntelligenceView() {
  view("Advanced intelligence", "Dependencies · dead code · bugs · mutations · agents · evaluations", '<div id="advanced-panel" class="cards"><div class="card">Building advanced intelligence reports…</div></div>');
  const optional = (url) => api(url).catch((error) => ({ unavailable: true, error: error.message }));
  const [dependencies, deadCode, bugs, mutation, agents, evaluations, crossRepository] = await Promise.all([
    api("/api/dependency-risk"), api("/api/dead-code"), api("/api/bug-history"), optional("/api/mutation-testing"), api("/api/agent/analytics"), api("/api/ai-evaluations"),
    state.projects.length > 1 ? optional("/api/cross-repository") : Promise.resolve({ unavailable: true, error: "Configure at least two projects for cross-repository analysis." }),
  ]);
  const mutationSummary = mutation.unavailable ? `<strong>N/A</strong><p class="muted">${esc(mutation.error)}</p>` : `<strong>${mutation.score}%</strong><p class="muted">${mutation.killed} killed · ${mutation.survived} survived · ${mutation.unexecuted.length} queued</p>`;
  $("#advanced-panel").innerHTML = `
    <div class="card"><span class="badge">DEPENDENCIES</span><strong>${dependencies.summary.total}</strong><p class="muted">${dependencies.summary.highRisk + dependencies.summary.criticalRisk} high/critical · ${dependencies.summary.undeclared} undeclared · ${dependencies.summary.unused} unused</p></div>
    <div class="card"><span class="badge">DEAD CODE</span><strong>${deadCode.findings.length}</strong><p class="muted">${deadCode.summary.unreachableFiles} unreachable files · ${deadCode.summary.unusedExports} unused exports · ${deadCode.summary.highConfidence} high-confidence</p></div>
    <div class="card"><span class="badge">BUG HISTORY</span><strong>${bugs.historyAvailable ? bugs.summary.bugFixCommits : "N/A"}</strong><p class="muted">${bugs.historyAvailable ? `${bugs.summary.affectedFiles} affected files · ${bugs.summary.highRiskHotspots} hotspots` : esc(bugs.error || "Git history unavailable")}</p></div>
    <div class="card"><span class="badge">MUTATION TESTING</span>${mutationSummary}<button id="run-mutations" class="primary">Run 10 mutants</button></div>
    <div class="card"><span class="badge">AGENT RELIABILITY</span><strong>${agents.summary.runs || "N/A"}</strong><p class="muted">${agents.summary.runs ? `${agents.summary.successRate}% success · ${agents.summary.openMistakes} open mistakes` : "No recorded agent runs"}</p></div>
    <div class="card"><span class="badge">AI EVALUATIONS</span><strong>${evaluations.summary.cases || "N/A"}</strong><p class="muted">${evaluations.summary.cases ? `${evaluations.summary.passRate}% pass · ${evaluations.summary.regressions} regressions` : "No recorded evaluation cases"}</p></div>
    <div class="card"><span class="badge">CROSS REPOSITORY</span><strong>${crossRepository.unavailable ? "N/A" : crossRepository.summary.repositories}</strong><p class="muted">${crossRepository.unavailable ? esc(crossRepository.error) : `${crossRepository.summary.packageDependencies} package links · ${crossRepository.summary.apiConnections} API links · ${crossRepository.summary.conflicts} conflicts`}</p></div>
    <div class="card senior-card"><span class="badge">CLAIM VERIFIER</span><h3>Check AI statements against the graph</h3><form id="claim-form" class="context-form"><textarea id="claim-source" rows="5" placeholder="One concrete file, symbol, relationship, or API claim per line" required></textarea><button class="primary">Verify claims</button></form><div id="claim-results"></div></div>
    ${dependencies.dependencies.filter((item) => item.riskScore >= 25).slice(0, 8).map((item) => `<div class="card"><span class="badge">${esc(item.severity)} · ${item.riskScore}</span><h3>${esc(item.name)}</h3><p>${item.reasons.map(esc).join(" · ")}</p></div>`).join("")}
    ${deadCode.findings.slice(0, 8).map((item) => `<div class="card"><span class="badge">${esc(item.kind)} · ${Math.round(item.confidence * 100)}%</span><h3>${esc(item.node.qualifiedName)}</h3><p>${item.reasons.map(esc).join(" · ")}</p></div>`).join("")}`;
  $("#run-mutations").onclick = async () => {
    $("#run-mutations").disabled = true; $("#run-mutations").textContent = "Running…";
    try { await api("/api/mutation-testing", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ limit: 10 }) }); await advancedIntelligenceView(); }
    catch (error) { $("#run-mutations").textContent = error.message; }
  };
  $("#claim-form").onsubmit = async (event) => {
    event.preventDefault(); const claims = $("#claim-source").value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
    const report = await api("/api/hallucination-verify", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ claims }) });
    $("#claim-results").innerHTML = report.claims.map((item) => `<p><span class="badge">${esc(item.status)} · ${item.confidence}%</span> ${esc(item.statement)}<br><small class="muted">${esc(item.evidence.join(" · "))}</small></p>`).join("");
  };
}

async function practicesView() {
  view("Engineering practices & drift", "Project rules and evidence across the engineering lifecycle", '<div id="practices-panel" class="cards"><div class="card">Checking engineering evidence…</div></div>');
  const report = await api("/api/practices");
  $("#practices-panel").innerHTML = `<div class="card senior-card"><span class="badge">${esc(report.policySource)} POLICY · ${esc(report.profile)}</span><h3>${report.summary.detected} detected signals · ${report.summary.review} need review</h3><p>${esc(report.note)}</p><p>Required gaps: ${esc(report.blockers.join(", ") || "none")}</p></div>
    <div class="card senior-card"><span class="badge">DRIFT · ${esc(report.drift.status)}</span><p>${esc(report.drift.detail)}</p><p>Regressed: ${esc(report.drift.regressed.join(", ") || "none")}</p><p>Improved: ${esc(report.drift.improved.join(", ") || "none")}</p><p class="muted">Review project policy with <code>fehm practices propose</code>, edit the proposal, then explicitly approve with <code>fehm practices approve</code>. Save reviewed evidence with <code>fehm practices baseline</code>.</p></div>
    ${report.findings.map((item) => `<article class="card"><span class="badge">${esc(item.domain)} · ${esc(item.status)} · ${esc(item.mode)}</span><h3>${esc(item.title)}</h3><p>${esc(item.recommendation)}</p><p class="muted">${esc(item.evidence.map((evidence) => `${evidence.path}:${evidence.line} (${evidence.check})`).join(" · ") || item.exception || "No supporting signal found")}</p>${item.missing.length ? `<p>Review: ${esc(item.missing.join(", "))}</p>` : ""}<a href="${esc(item.reference)}" target="_blank" rel="noopener noreferrer">Practice reference</a></article>`).join("")}`;
}

async function readinessView() {
  view("Project readiness", "Architecture intent · capabilities · production hardening · connectivity", '<div id="readiness-panel" class="cards"><div class="card">Auditing repository evidence…</div></div>');
  const [architecture, capabilities, production, connectivity, onboarding] = await Promise.all([
    api("/api/architecture-audit"), api("/api/capabilities"), api("/api/production-audit"), api("/api/connectivity"), api("/api/onboarding"),
  ]);
  const architectureCards = architecture.questions.map((item) => `<div class="card"><div class="status-row"><span class="badge">${esc(item.status)}</span><strong>${esc(item.name)}</strong></div><p>${esc(item.summary)}</p><p class="muted">${esc((item.evidence.length ? item.evidence : [item.recommendation || "No explicit evidence found"]).join(" · "))}</p></div>`).join("");
  const capabilityCards = capabilities.capabilities.map((item) => `<div class="card"><span class="badge">${esc(item.status)}</span><h3>${esc(item.name)}</h3><p>${esc(item.summary)}</p><p class="muted">${esc(item.evidence.slice(0, 3).join(" · ") || "No repository signal; may be unnecessary for this project")}</p></div>`).join("");
  $("#readiness-panel").innerHTML = `
    <div class="card health-hero"><span class="badge">ARCHITECTURE INTENT</span><strong>${architecture.score}/100</strong><p class="muted">${esc(architecture.status)} · ${esc(architecture.contractSource)} contract source</p></div>
    <div class="card health-hero"><span class="badge">PRODUCTION HARDENING</span><strong>${production.score}/100</strong><p class="muted">${esc(production.risk)} rushed-production risk; not an AI-authorship claim</p></div>
    <div class="card"><span class="badge">CAPABILITIES</span><strong>${capabilities.detected}</strong><p class="muted">${capabilities.partial} partial · ${capabilities.notDetected} not detected and not automatically required</p></div>
    <div class="card"><span class="badge">GRAPH CONNECTIVITY</span><strong>${connectivity.largestComponentPercent}%</strong><p class="muted">${connectivity.components} components · ${connectivity.isolatedNodes} isolated nodes · no fabricated edges</p></div>
    <div class="card senior-card"><span class="badge">NEWCOMER BRIEFING</span><h3>Agent-ready codebase guide</h3><p>${esc(onboarding.markdown.slice(0, 420))}…</p><p class="muted">Generate the durable file with <code>fehm onboarding</code>; export linked notes with <code>fehm export-obsidian</code>.</p></div>
    ${architectureCards}
    <div class="card senior-card"><span class="badge">PROJECT-SPECIFIC SKILLS</span><h3>Use only what this architecture needs</h3><p>${esc(capabilities.note)}</p></div>
    ${capabilityCards}`;
}

async function switchView(name) {
  state.viewEpoch += 1;
  state.currentView = name;
  document.querySelectorAll("#nav button").forEach((button) => button.classList.toggle("active", button.dataset.view === name));
  if (name === "graph") {
    $("#panel-view").classList.remove("active");
    $("#graph-view").classList.add("active");
    return;
  }

  const stats = state.overview.stats;
  if (name === "projects") {
    projectsView();
  } else if (name === "system-map") {
    await systemMapView();
  } else if (name === "flows") {
    await flowExplorerView();
  } else if (name === "relationships") {
    await relationshipsView();
  } else if (name === "health") {
    await healthView();
  } else if (name === "practices") {
    await practicesView();
  } else if (name === "readiness") {
    await readinessView();
  } else if (name === "intelligence") {
    await advancedIntelligenceView();
  } else if (name === "architecture") {
    await architectureView();
  } else if (name === "code") {
    const files = (await api("/api/graph?level=files")).nodes.filter((node) => node.kind === "file");
    view("Code", "Indexed source inventory", `<div class="cards">${files.slice(0, 80).map((node) => `<div class="card"><div class="status-row"><span class="badge">FACT · ${esc(node.language || "source")}</span><span class="${node.summaryStatus === "fresh" ? "status-fresh" : "status-stale"}">${esc(node.summaryStatus || "not-generated")}</span></div><h3>${esc(node.path || node.name)}</h3><p class="muted">${esc(node.summary || "Parser-indexed file")}</p></div>`).join("")}</div>`);
  } else if (name === "tests") {
    view("Tests", "Selection and coverage intelligence", '<div id="async-panel" class="cards"><div class="card">Mapping tests to production symbols…</div></div>');
    const [coverage, quality] = await Promise.all([api("/api/coverage"), api("/api/test-quality")]);
    $("#async-panel").innerHTML = `<div class="card"><span class="badge">TEST QUALITY</span><strong>${quality.score}/100</strong><p class="muted">Assertions ${quality.dimensions.assertions} · isolation ${quality.dimensions.isolation} · reliability ${quality.dimensions.reliability}</p></div><div class="card"><span class="badge">${coverage.available ? "MEASURED" : "STATIC TEST GRAPH"}</span><strong>${coverage.overall.functions}%</strong><p class="muted">Function coverage · ${coverage.confidence}% confidence</p></div><div class="card"><span class="badge" style="color:var(--orange)">GAPS</span><strong>${coverage.criticalGaps.length}</strong><p class="muted">Critical exported or high fan-in symbols without a reachable test</p></div>${quality.files.slice(0,12).map((item)=>`<div class="card"><span class="badge">${item.score}/100</span><h3>${esc(item.path)}</h3><p>${item.tests} tests · ${item.assertions} assertions</p><p class="muted">${[...item.strengths,...item.weaknesses].map(esc).join(" · ")}</p></div>`).join("")}${coverage.criticalGaps.slice(0,12).map((item) => `<div class="card"><h3>${esc(item.node.qualifiedName)}</h3><p>${esc(item.reason)}</p><p class="muted">${esc(item.node.path || "graph symbol")}</p></div>`).join("")}`;
  } else if (name === "security") {
    view("Security", "Evidence-backed scanner", '<div id="async-panel" class="cards"><div class="card">Loading verification…</div></div>');
    const [report, flows] = await Promise.all([api("/api/verification"), api("/api/security-graph")]);
    $("#async-panel").innerHTML = `<div class="card"><span class="badge">FACT · ${report.security.status}</span><h3>${report.security.findings.length} findings</h3><p class="muted">${report.security.filesScanned} source files scanned</p></div><div class="card"><span class="badge">SECURITY GRAPH</span><h3>${flows.paths.length} traced paths</h3><p class="muted">${flows.summary.sources} sources · ${flows.summary.sinks} sinks · ${flows.summary.riskyPaths} high-risk unsanitized</p></div>${flows.paths.slice(0,16).map((flow)=>`<div class="card"><span class="badge">${esc(flow.severity)} · ${flow.sanitized?'sanitized':'unsanitized'}</span><h3>${esc(flow.steps.join(" → "))}</h3><p class="muted">${esc(flow.source.path)}:${flow.source.line} · ${Math.round(flow.confidence*100)}% confidence</p></div>`).join("")}${report.security.findings.map((finding) => `<div class="card"><h3>${esc(finding.title)}</h3><p>${esc(finding.path)}:${finding.line}</p><p class="muted">${esc(finding.detail)}</p></div>`).join("")}`;
  } else if (name === "git") {
    view("Git & memory", "Historical context", '<div id="async-panel" class="cards"><div class="card">Loading intelligence…</div></div>');
    const [report, timeline, team] = await Promise.all([api("/api/intelligence"), api("/api/timeline"), api("/api/team")]);
    $("#async-panel").innerHTML = `<div class="card"><span class="badge">FACT</span><strong>${report.history.commits}</strong><p class="muted">Commits analyzed</p></div><div class="card"><span class="badge">BLAME</span><strong>${team.blameAvailable?'LINE-LEVEL':'COMMIT FALLBACK'}</strong><p class="muted">${team.pullRequests.length} pull-request or merge records</p></div><div class="card"><span class="badge">TIMELINE</span><strong>${timeline.snapshots.length}</strong><p class="muted">Architecture snapshots · ${timeline.events.length} structural events</p></div><div class="card"><span class="badge">OWNERSHIP</span><strong>${team.authors.length}</strong><p class="muted">Contributors · ${team.sharedKnowledgeRisks.length} bus-factor risks</p></div>${team.pullRequests.slice(0,8).map((item)=>`<div class="card"><span class="badge">PR ${item.number?`#${item.number}`:'MERGE'}</span><h3>${esc(item.subject)}</h3><p class="muted">${esc(item.author)} · ${esc(item.date)} · ${item.files.length} files</p></div>`).join("")}${timeline.events.slice(-12).reverse().map((item) => `<div class="card"><span class="badge">${esc(item.kind)}</span><h3>${esc(item.detail)}</h3><p class="muted">${esc(item.at)}</p></div>`).join("")}${team.sharedKnowledgeRisks.slice(0,12).map((item) => `<div class="card"><span class="badge" style="color:var(--orange)">KNOWLEDGE RISK</span><h3>${esc(item.path)}</h3><p>${esc(item.reason)}</p></div>`).join("")}`;
  } else if (name === "context") {
    contextView();
  } else if (name === "prompt-lab") {
    await promptLabView();
  } else {
    view("Change impact", "Understand before you edit", `<div class="cards"><div class="card"><span class="badge" style="color:var(--cyan)">INFERRED</span><h3>Pre-flight from the CLI</h3><p class="muted">Project a Git diff through ${stats.edges} verified relationships to find affected files, tests, routes, and risk.</p><code>fehm preflight</code></div></div>`);
  }
}

function contextView() {
  view("AI Context Simulator", "See exactly what an agent receives", '<form id="context-form" class="context-form"><input id="task" placeholder="e.g. Add Stripe refunds" required><input id="budget" type="number" value="4000" min="128" max="50000" aria-label="Token budget"><button class="primary">Simulate context</button></form><div id="simulation"></div>');
  $("#context-form").onsubmit = async (event) => {
    event.preventDefault();
    $("#simulation").innerHTML = '<div class="card" style="margin-top:18px">Building the smallest trustworthy context…</div>';
    try {
      const result = await api("/api/context", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query: $("#task").value, budget: Number($("#budget").value) }) });
      const simulation = result.simulation;
      const packet = result.packet;
      $("#simulation").innerHTML = `<div class="sim-grid"><div class="card"><p class="eyebrow">Before optimization</p><strong>${simulation.beforeTokens.toLocaleString()}</strong><p class="muted">estimated tokens</p></div><div class="card"><p class="eyebrow">Agent receives</p><strong>${simulation.afterTokens.toLocaleString()}</strong><p class="muted">within hard budget</p></div><div class="card"><p class="eyebrow">Reduction</p><strong>${simulation.reductionPercent}%</strong><div class="meter"><span style="width:${simulation.reductionPercent}%"></span></div></div></div><div class="cards" style="margin-top:14px"><div class="card file-list"><h3>Selected context</h3>${simulation.selectedFiles.map((file) => `<div>✓ ${esc(file)}</div>`).join("") || '<p class="muted">No source excerpt fit the budget.</p>'}</div><div class="card"><h3>Why these files</h3>${packet.recommendedNodes.slice(0, 8).map((hit) => `<p><span class="badge">${hit.scores.final.toFixed(2)}</span> ${esc(hit.node.qualifiedName)}</p>`).join("")}<p class="muted">${simulation.excludedFiles} unrelated files excluded · quality ${packet.quality.score}/100</p></div></div>`;
    } catch (error) {
      $("#simulation").innerHTML = `<div class="card" style="margin-top:18px">${esc(error.message)}</div>`;
    }
  };
}

async function init() {
  const listing = await api("/api/projects");
  state.projects = listing.projects;
  const routeId = /^\/projects\/([^/]+)/.exec(location.pathname)?.[1];
  state.projectId = state.projects.some((project) => project.id === routeId) ? routeId : state.projects[0]?.id;
  if (!state.projectId) throw new Error("No indexed projects are configured");
  $("#project-selector").innerHTML = state.projects.map((project) => `<option value="${esc(project.id)}">${esc(project.name)}</option>`).join("");
  $("#project-selector").value = state.projectId;
  state.overview = await api("/api/overview");
  $("#repo-name").textContent = state.overview.repository.name;
  $("#health").textContent = `Health ${state.overview.health.score}%`;
  metrics();
  await loadGraph();
  document.querySelectorAll("#nav button").forEach((button) => { button.onclick = () => switchView(button.dataset.view); });
  $("#project-selector").onchange = (event) => selectProject(event.target.value);
  $("#level").onchange = () => loadGraph();
  $("#reset").onclick = () => { state.scale = 1; state.offsetX = 0; state.offsetY = 0; loadGraph(); };
  let timer;
  $("#search").oninput = (event) => { clearTimeout(timer); timer = setTimeout(() => universalSearch(event.target.value.trim()), 350); };
  const canvas = $("#graph-canvas");
  canvas.onclick = pick;
  canvas.onwheel = (event) => {
    event.preventDefault();
    state.scale = Math.max(0.35, Math.min(3, state.scale * (event.deltaY > 0 ? 0.9 : 1.1)));
    draw();
    const semanticLevel = state.scale < 0.55 ? "system" : state.scale < 0.95 ? "modules" : state.scale < 1.55 ? "files" : "symbols";
    if ($("#level").value !== semanticLevel) {
      clearTimeout(state.semanticTimer);
      state.semanticTimer = setTimeout(async () => { $("#level").value = semanticLevel; await loadGraph(); }, 180);
    }
  };
  canvas.onpointerdown = (event) => { state.drag = { x: event.clientX, y: event.clientY, offsetX: state.offsetX, offsetY: state.offsetY }; };
  canvas.onpointermove = (event) => { if (!state.drag) return; state.offsetX = state.drag.offsetX + event.clientX - state.drag.x; state.offsetY = state.drag.offsetY + event.clientY - state.drag.y; draw(); };
  canvas.onpointerup = () => { state.drag = null; };
  new ResizeObserver(() => { layout(); draw(); }).observe(canvas);
  if (!routeId) await switchView("projects");
  setInterval(async () => {
    try {
      state.overview = await api("/api/overview");
      $("#health").textContent = `Health ${state.overview.health.score}%`;
      metrics();
    } catch { /* keep the last trustworthy snapshot visible */ }
  }, 4_000);
}

function showRequestError(error) {
  if (error?.name === "AbortError") return;
  $("#health").textContent = "Request failed";
  view("Unable to load this view", "Check the local service and try again", `<div class="card" role="alert"><p>${esc(error?.message || "Request failed")}</p><button id="retry-view" class="primary">Retry</button></div>`);
  $("#retry-view").onclick = () => location.reload();
}
window.addEventListener("unhandledrejection", (event) => { event.preventDefault(); showRequestError(event.reason); });
init().catch(showRequestError);
