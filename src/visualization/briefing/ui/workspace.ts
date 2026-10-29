import type { ArchitectureSummary, ArchEvidence, PublishedView, ViewType } from "../../../architecture/types.js";
import { technologyNodes, type Technology } from "./technology.js";
import { exportDiagram } from "../../architecture/ui/export.js";
import { DiagramCanvas } from "../../architecture/ui/canvas.js";
import { h } from "../../graph/ui/dom.js";

async function get<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not load architecture (HTTP ${response.status}).`);
  return response.json() as Promise<T>;
}

const choices: [string, ViewType, string | undefined][] = [
  ["System context", "system", "context"], ["System components", "system", undefined],
  ["Component drill-down", "components", undefined], ["Runtime sequence", "runtime", undefined],
  ["Data flow", "dataflow", undefined], ["Workflow & failure paths", "workflow", undefined],
  ["Containers & deployment", "deployment", undefined], ["Dependencies", "dependencies", undefined],
  ["Entity lifecycle", "lifecycle", undefined], ["Security boundaries", "security", undefined], ["Architecture changes", "delta", undefined],
];

let workspaceSerial = 0;

/** Reuses Architecture's semantic model, validated layout and SVG camera. */
export function architectureWorkspace(initial: ViewType = "system"): { element: HTMLElement; open: (type: ViewType, focus?: string) => void; highlightTechnology: (technology: Technology) => Promise<void>; destroy: () => void } {
  const instance = ++workspaceSerial;
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("aria-label", "Interactive architecture diagram");
  svg.setAttribute("role", "group");
  svg.classList.add("briefing-diagram");
  const message = h("p", { class: "diagram-message", role: "status" }, "Loading architecture evidence…");
  const inspector = h("div", { class: "diagram-inspector", hidden: true, id: `map-details-${instance}`, "aria-live": "polite" }, "Select a node or connection to inspect its role and source evidence. Double-click a component to drill down.");
  const narrative = h("div", { class: "diagram-narrative" });
  const select = h("select", { "aria-label": "Diagram view" }, ...choices.map(([label], i) => h("option", { value: String(i) }, label)));
  let additional = false;
  function updateChoices(): void {
    for (const option of Array.from(select.options)) {
      const index = Number(option.value), candidate = choices[index]![1];
      option.hidden = !summary?.views.some(view => view.type === candidate && view.available) || (!additional && index > 4 && index !== selectedIndex);
      option.disabled = option.hidden;
    }
  }
  const focus = h("select", { "aria-label": "Diagram focus", hidden: true });
  const filter = h("select", { "aria-label": "Highlight diagram relationships" }, h("option", { value: "" }, "All relationships"));
  const zoom = h("span", { class: "muted" }, "100%");
  const button = (text: string, fn: () => void): HTMLButtonElement => h("button", { type: "button", onclick: fn }, text);
  const inspectToggle = button("Details ←", () => {
    inspector.hidden = !inspector.hidden;
    inspectToggle.setAttribute("aria-expanded", String(!inspector.hidden));
  });
  inspectToggle.setAttribute("aria-controls", `map-details-${instance}`);
  inspectToggle.setAttribute("aria-expanded", "false");
  function reveal(): void { inspector.hidden = false; inspectToggle.setAttribute("aria-expanded", "true"); }
  const search = h("input", { type: "search", placeholder: "Find a component or file…", "aria-label": "Search this diagram" });
  search.addEventListener("input", () => {
    const query = search.value.trim().toLowerCase();
    const nodes = new Set(published?.nodes.filter(n => [n.name, ...n.files, ...n.technologies].join(" ").toLowerCase().includes(query)).map(n => n.id));
    const edges = new Set(published?.relationships.filter(r => nodes.has(r.source) && nodes.has(r.target)).map(r => r.id));
    canvas.mark(null, query ? { nodes, edges } : null);
    search.setAttribute("title", `${nodes.size} matching elements in this view`);
  });
  const additionalToggle = button("More views", () => { additional = !additional; additionalToggle.textContent = additional ? "Fewer views" : "More views"; additionalToggle.setAttribute("aria-pressed", String(additional)); updateChoices(); });
  additionalToggle.setAttribute("aria-pressed", "false");
  const stage = h("div", { class: "diagram-stage" }, svg, message);
  const element = h("section", { id: `diagram-workspace-${instance}`, class: "diagram-workspace" });
  let summary: ArchitectureSummary | null = null;
  let published: PublishedView | null = null;
  let request = 0;
  let disposed = false;
  let selectedIndex = 0;
  const cache = new Map<string, PublishedView | { error: string }>();
  const sources = (evidence: ArchEvidence[]): HTMLElement => h("div", { class: "source-refs" }, ...evidence.slice(0, 8).map((e) =>
    h("a", { href: e.nodeId ? `/graph#node=${encodeURIComponent(e.nodeId)}` : `vscode://file/${encodeURI(`${summary?.repository.root ?? ""}/${e.path}`).replace(/^\//, "")}${e.line ? `:${e.line}` : ""}`, title: `${e.provenance}: ${e.detail ?? "source evidence"}` }, `${e.path}${e.line ? `:${e.line}` : ""}`)), !evidence.length ? h("span", { class: "muted" }, "No direct source location. This is a grouping or inferred step, not an observed runtime event.") : null);
  const canvas = new DiagramCanvas(svg, {
    selectNode(id) {
      const node = published?.nodes.find((n) => n.id === id);
      if (!node) return;
      reveal();
      canvas.mark({ kind: "node", id }, null);
      inspector.replaceChildren(h("h3", {}, node.name), h("p", {}, `${node.type} · ${node.role.confidence} evidence`), h("p", {}, (node.description ?? node.role.reasons.join(" ")) || "The index does not establish this component’s responsibility."), sources(node.evidence));
      if (node.technologies.length) inspector.append(h("p", {}, `Uses ${node.technologies.join(", ")}`));
      const connections = published?.relationships.filter(edge => edge.source === id || edge.target === id) ?? [];
      const dependencies = h("details", {}, h("summary", {}, `${connections.length} connections in this view`));
      for (const edge of connections.slice(0, 30)) {
        const other = edge.source === id ? edge.target : edge.source;
        const label = published?.nodes.find(candidate => candidate.id === other)?.name ?? other;
        dependencies.append(button(`${edge.source === id ? "→" : "←"} ${label} · ${edge.type}`, () => {
          canvas.mark({ kind: "edge", id: edge.id }, { nodes: new Set([edge.source, edge.target]), edges: new Set([edge.id]) });
          canvas.fitNodes(new Set([edge.source, edge.target]));
        }));
      }
      if (connections.length > 30) dependencies.append(h("p", {}, "Showing 30 connections. Use the full Architecture workspace for all relationships."));
      inspector.append(dependencies);
      if (node.children.length) inspector.append(button("Explore component", () => open(id === "context:system" ? "system" : "components", id === "context:system" ? undefined : id)));
      if (node.graphNodeId) inspector.append(h("a", { href: `/graph#node=${encodeURIComponent(node.graphNodeId)}` }, "Open in Graph →"));
    },
    selectEdge(id) {
      const edge = published?.relationships.find((r) => r.id === id);
      if (!edge) return;
      reveal();
      canvas.mark({ kind: "edge", id }, null);
      const name = (nodeId: string): string => published?.nodes.find((n) => n.id === nodeId)?.name ?? nodeId;
      inspector.replaceChildren(h("h3", {}, `${name(edge.source)} → ${name(edge.target)}`), h("p", {}, `${edge.type} · ${edge.confidence}. ${edge.label ?? ""}`), sources(edge.evidence));
    },
    open(id) { open(id === "context:system" ? "system" : "components", id === "context:system" ? undefined : id); },
    clear() { canvas.mark(null, null); },
    zoomed(scale) { zoom.textContent = `${Math.round(scale * 100)}%`; },
  }, { wheel: "modifier" });
  function exportSvg(): void { if (published) exportDiagram(svg, published); }
  const trail: { index: number; focus: string | undefined; camera: ReturnType<DiagramCanvas["viewport"]> }[] = [];
  let currentFocus: string | undefined;
  const back = button("← Back", () => {
    const previous = trail.pop(); if (!previous) return;
    void load(previous.index, previous.focus, false).then(() => { if (!disposed) canvas.restoreViewport(previous.camera); });
  });
  back.disabled = true;
  element.append(h("div", { class: "diagram-toolbar" }, back, select, additionalToggle, focus, search, filter,
    button("Zoom in", () => canvas.zoomBy(1.3)), button("Zoom out", () => canvas.zoomBy(1 / 1.3)), zoom,
    button("Fit", () => canvas.fit()), button("Reset", () => canvas.reset()), inspectToggle, button("Full screen", () => {
      if (document.fullscreenElement) void document.exitFullscreen();
      else void element.requestFullscreen().catch(() => { message.hidden = false; message.textContent = "Full screen is unavailable in this browser. Use the Architecture link for a larger workspace."; });
    }), button("Export SVG", exportSvg)), h("div", { class: "diagram-body" }, stage, inspector),
    h("div", { class: "diagram-legend" }, "Shapes identify roles · solid: indexed evidence · dashed: inferred relationships / external boundaries · drag to pan · Ctrl/⌘ + wheel to zoom"), narrative);
  async function load(index: number, explicitFocus?: string, remember = true): Promise<void> {
    if (published && remember) { trail.push({ index: selectedIndex, focus: currentFocus, camera: canvas.viewport() }); if (trail.length > 30) trail.shift(); }
    back.disabled = !trail.length;
    currentFocus = explicitFocus;
    search.value = "";
    selectedIndex = index; select.value = String(index);
    const token = ++request;
    published = null; svg.replaceChildren(); message.hidden = false; message.textContent = "Loading diagram…";
    inspector.replaceChildren(); narrative.replaceChildren(); filter.replaceChildren(h("option", { value: "" }, "All relationships")); focus.hidden = true;
    try {
      summary ??= await get<ArchitectureSummary>("/api/architecture");
      if (disposed || token !== request) return;
      updateChoices();
      const [, type, fixedFocus] = choices[index]!;
      const descriptor = summary.views.find((v) => v.type === type);
      if (!descriptor?.available) { message.textContent = descriptor?.reason ?? "No evidence for this view."; return; }
      const options = descriptor.options ?? [];
      focus.replaceChildren(...options.map((o) => h("option", { value: o.id }, o.label)));
      focus.hidden = !options.length;
      const target = explicitFocus ?? fixedFocus ?? options[0]?.id;
      currentFocus = target;
      if (target) focus.value = target;
      const key = `${type}:${target ?? ""}`;
      let result = cache.get(key);
      if (!result) { result = await get<PublishedView | { error: string }>(`/api/architecture/view?${new URLSearchParams({ type, ...(target ? { focus: target } : {}) })}`); cache.set(key, result); }
      if (disposed || token !== request) return;
      if ("error" in result) { message.textContent = result.error; return; }
      published = result;
      if (!result.layout) { message.textContent = "No validated layout is available. Open Architecture to inspect layout diagnostics. No unverified diagram is drawn here."; return; }
      message.hidden = true;
      canvas.render(result.layout, new Map(result.nodes.map((n) => [n.id, n])));
      filter.append(h("optgroup", { label: "Relationship types" }, ...[...new Set(result.relationships.map((r) => r.type))].sort().map((type) => h("option", { value: type }, type))),
        h("optgroup", { label: "Node roles" }, ...[...new Set(result.nodes.map((node) => node.type))].sort().map((type) => h("option", { value: `node:${type}` }, type))));
      const caveat = type === "runtime" ? "This sequence is reconstructed from static calls. Returns without source evidence are illustrative; authentication enforcement, actual timing, failure responses and production reachability are not proven." : type === "system" && fixedFocus === "context" ? "Connections describe indexed source, which can include examples and fixtures. They do not establish live production integrations." : type === "deployment" ? "Only discovered configuration is shown. This does not establish the live production topology." : "Source modules are logical components, not proof of independently deployed services. Imports express code dependencies, not network calls.";
      const explanation = h("details", {}, h("summary", {}, "How to read this view · evidence & limitations"), h("p", {}, caveat), ...result.notes.map(note => h("p", {}, note)));
      narrative.append(h("p", { class: "map-purpose" }, type === "system" ? "See the system’s boundaries and connections. Select a component to understand its role; open it to explore its implementation." : type === "runtime" ? "Follow an operation through the code. Select a step to locate its components and supporting source." : "Explore how these components relate. Select an element to inspect the source behind it."), explanation,
        h("a", { href: `/architecture#${new URLSearchParams({ view: type, ...(target ? { focus: target } : {}) })}` }, "Open full architecture workspace →"));
      if (type === "runtime" || type === "dataflow" || type === "workflow") {
        const details = h("details", { open: true }, h("summary", {}, "Follow this operation"));
        const steps = h("ol", { class: "workflow-narrative" });
        for (const rel of result.relationships) {
          const name = (id: string): string => result.nodes.find((n) => n.id === id)?.name ?? id;
          steps.append(h("li", {}, button(`${name(rel.source)} → ${name(rel.target)}: ${rel.label ?? rel.type}`, () => {
            canvas.mark({ kind: "edge", id: rel.id }, { nodes: new Set([rel.source, rel.target]), edges: new Set([rel.id]) });
            canvas.fitNodes(new Set([rel.source, rel.target])); reveal();
            inspector.replaceChildren(h("h3", {}, rel.label ?? rel.type), h("p", {}, `${name(rel.source)} → ${name(rel.target)} · ${rel.confidence}`), sources(rel.evidence));
          }), h("span", { class: "muted" }, `${rel.confidence}; ${rel.evidence.length ? "source-backed static relationship" : "no direct source evidence"}.`), sources(rel.evidence)));
        }
        details.append(steps); narrative.append(details);
      }
      inspector.textContent = "Select a node or relationship for its explanation and sources. Use Tab and arrow keys to move between nodes.";
    } catch (error) {
      if (disposed || token !== request) return;
      message.replaceChildren(h("span", {}, (error as Error).message), button("Retry diagram", () => void load(index, explicitFocus)));
    }
  }
  function open(type: ViewType, target?: string): void {
    const index = choices.findIndex(([, candidate, fixed]) => candidate === type && !fixed);
    void load(index < 0 ? 0 : index, target);
  }
  select.addEventListener("change", () => void load(Number(select.value)));
  focus.addEventListener("change", () => void load(selectedIndex, focus.value));
  filter.addEventListener("change", () => {
    const selectedNodes = new Set(published?.nodes.filter((node) => `node:${node.type}` === filter.value).map((node) => node.id) ?? []);
    const edges = published?.relationships.filter((r) => filter.value.startsWith("node:") ? selectedNodes.has(r.source) || selectedNodes.has(r.target) : r.type === filter.value) ?? [];
    canvas.mark(null, filter.value ? { nodes: new Set([...selectedNodes, ...edges.flatMap((r) => [r.source, r.target])]), edges: new Set(edges.map((r) => r.id)) } : null);
  });
  void load(initial === "system" ? 0 : Math.max(0, choices.findIndex(([, type]) => type === initial)));
  async function highlightTechnology(technology: Technology): Promise<void> {
    const pending = load(1);
    const token = request;
    await pending;
    if (!published || disposed || token !== request) return;
    const matches = technologyNodes(published.nodes, technology);
    const nodes = new Set(matches);
    const edges = new Set(published.relationships.filter(edge => nodes.has(edge.source) && nodes.has(edge.target)).map(edge => edge.id));
    canvas.mark(null, { nodes, edges });
    if (nodes.size) canvas.fitNodes(nodes);
    reveal();
    inspector.replaceChildren(h("h3", {}, technology.name), h("p", {}, technology.purpose),
      h("p", {}, `${technology.category === "Languages" ? "Indexed file extensions" : technology.basis === "declared" ? "Declared dependency" : "Indexed import evidence"} · ${matches.length} matching components. ${matches.length ? "Highlighted components contain indexed usage; connecting edges retain their original meaning." : "No component usage is established by this view. A declaration alone does not prove runtime use."}`),
      h("p", { class: "muted" }, technology.requirements?.length ? `Declared version requirements: ${[...new Set(technology.requirements)].join(", ")}. These are manifest constraints, not resolved installed versions.` : "No version requirement was extracted for this technology. Consult the linked configuration."),
      h("div", { class: "source-refs" }, ...technology.evidence.filter(e => e.path !== ".").map(e => h("a", { href: e.nodeId ? `/graph#node=${encodeURIComponent(e.nodeId)}` : `vscode://file/${encodeURI(`${summary?.repository.root ?? ""}/${e.path}`).replace(/^\//, "")}${e.line ? `:${e.line}` : ""}` }, `${e.path}${e.line ? `:${e.line}` : ""}`))));
  }
  return { element, open, highlightTechnology, destroy() { disposed = true; request++; canvas.destroy(); } };
}
