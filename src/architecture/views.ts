import { escalate, layoutDiagram, type LayoutInput, type LayoutInputNode } from "./layout.js";
import { TAG, ROLE_LABEL } from "./labels.js";
import { aggregate, MAX_DEPENDENCY_MODULES } from "./model.js";
import { layoutSequence, type SequenceInput } from "./sequence-layout.js";
import { validateLayout } from "./validate.js";
import type { ArchitectureModel, ArchNode, ArchRelationship, DiagramLayout, PublishedView, QualityProfile, ValidationReport, ViewDescriptor, ViewType } from "./types.js";
import { dataflowAvailability, dataflowView } from "./view-dataflow.js";
import { deltaAvailability, deltaView } from "./view-delta.js";
import { deploymentAvailability, deploymentView } from "./view-deployment.js";
import type { Availability, ViewContext, ViewResult, ViewSpec } from "./view-kit.js";
import { lifecycleAvailability, lifecycleView } from "./view-lifecycle.js";
import { runtimeAvailability, runtimeView } from "./view-runtime.js";
import { securityAvailability, securityView } from "./view-security.js";
import { workflowAvailability, workflowView } from "./view-workflow.js";

/**
 * The ten architecture views, one page. Each is a lens on the same code
 * intelligence:
 *
 *   core        system · components · dependencies   (projections of the semantic model)
 *   behaviour   runtime · dataflow · workflow · lifecycle   (derived from calls, data signals, control flow, state assignments)
 *   operations  deployment · security · delta   (configuration, security signals, git history)
 *
 * A view is offered when the repository has the evidence it needs; otherwise
 * it is listed as unavailable with the reason. Every view goes through the
 * same layout → validation → repair → last-known-good pipeline.
 */

export type { ViewSpec, ViewContext };


export const MAX_REPAIR_ATTEMPTS = 5;

const plural = (n: number, w: string): string => `${n} ${n === 1 ? w : `${w}s`}`;

function subtitle(n: ArchNode): string | undefined {
  if (n.tier !== 1) return n.technologies.length && n.type !== "external-system" ? n.technologies[0] : undefined;
  if (n.type === "file") return n.symbols ? plural(n.symbols, "symbol") : undefined;
  const kids = n.level === 1 && n.children[0]?.startsWith("module:") ? plural(n.children.length, "module") : undefined;
  return [kids, plural(n.files.length, "file")].filter(Boolean).join(" · ");
}

function inputNode(n: ArchNode, band: LayoutInputNode["band"], context = false): LayoutInputNode {
  const out: LayoutInputNode = { id: n.id, type: n.type, name: n.name, tag: TAG[n.type], band };
  const sub = subtitle(n);
  if (sub) out.subtitle = sub;
  if (context) out.context = true;
  if (n.children.length && n.tier === 1 && n.type !== "file") out.expandable = true;
  return out;
}

interface Meta {
  title: string;
  question: string;
  group: ViewDescriptor["group"];
  availability: (ctx: ViewContext) => Availability;
  build: (ctx: ViewContext, focus?: string) => ViewResult;
}

const always = (ctx: ViewContext): Availability => (ctx.model.components.length ? { available: true } : { available: false, reason: "No source files were indexed." });

export const VIEWS: Record<ViewType, Meta> = {
  system: { title: "System", group: "core", question: "What are the major parts and what do they talk to?", availability: always, build: (ctx, f) => viewSpec(ctx.model, "system", f) },
  components: {
    title: "Components",
    group: "core",
    question: "What is inside a component?",
    availability: (ctx) => ({ ...always(ctx), ...(ctx.model.components.length ? { optionLabel: "Component", options: ctx.model.components.map((id) => ctx.byId.get(id)!).filter((c) => c.children.length).map((c) => ({ id: c.id, label: c.name, detail: `${c.files.length} files` })) } : {}) }),
    build: (ctx, f) => viewSpec(ctx.model, "components", f),
  },
  runtime: { title: "Runtime", group: "behaviour", question: "What happens, in order, when an entry point is invoked?", availability: runtimeAvailability, build: runtimeView },
  dataflow: { title: "Data flow", group: "behaviour", question: "Where does data enter, what handles it, and where is it stored?", availability: dataflowAvailability, build: dataflowView },
  workflow: { title: "Workflow", group: "behaviour", question: "What steps, decisions, loops and failure paths does a process have?", availability: workflowAvailability, build: workflowView },
  lifecycle: { title: "Lifecycle", group: "behaviour", question: "Which states does an entity move through, and what moves it?", availability: lifecycleAvailability, build: lifecycleView },
  deployment: { title: "Deployment", group: "operations", question: "Where does the code run, and what is exposed?", availability: deploymentAvailability, build: (ctx) => deploymentView(ctx) },
  security: { title: "Security", group: "operations", question: "Where are the trust boundaries, and what guards them?", availability: securityAvailability, build: (ctx) => securityView(ctx) },
  dependencies: {
    title: "Dependencies",
    group: "core",
    question: "How do modules depend on each other?",
    availability: (ctx) => (ctx.model.nodes.filter((n) => n.level === 3).length > 1 ? { available: true } : { available: false, reason: "Only one source module." }),
    build: (ctx, f) => viewSpec(ctx.model, "dependencies", f),
  },
  delta: { title: "Delta", group: "operations", question: "What changed in the architecture?", availability: deltaAvailability, build: deltaView },
};

/** Availability, choices and wording of all ten views, in page order. A view that fails to assess is unavailable, never an error. */
export function describeViews(ctx: ViewContext): ViewDescriptor[] {
  return (Object.keys(VIEWS) as ViewType[]).map((type) => {
    const m = VIEWS[type];
    let a: Availability;
    try {
      a = m.availability(ctx);
    } catch (e) {
      a = { available: false, reason: `Could not assess: ${(e as Error).message}` };
    }
    return { type, title: m.title, question: m.question, group: m.group, available: a.available, ...(a.reason ? { reason: a.reason } : {}), ...(a.optionLabel ? { optionLabel: a.optionLabel } : {}), ...(a.options ? { options: a.options } : {}) };
  });
}

export function buildView(ctx: ViewContext, view: ViewType, focus?: string): ViewResult {
  const m = VIEWS[view];
  if (!m) return { error: `unknown view ${view}` };
  try {
    return m.build(ctx, focus);
  } catch (e) {
    return { error: `${m.title} view failed: ${(e as Error).message}` };
  }
}

/** The structural views: pure projections of the semantic model. */
export function viewSpec(model: ArchitectureModel, view: ViewType, focus?: string): ViewResult {
  const byId = new Map(model.nodes.map((n) => [n.id, n]));
  const within = (ids: Set<string>): ArchRelationship[] => model.relationships.filter((r) => ids.has(r.source) && ids.has(r.target));

  if (view === "system") {
    const nodes = [...model.components.map((id) => byId.get(id)!), ...model.nodes.filter((n) => n.tier !== 1)];
    const ids = new Set(nodes.map((n) => n.id));
    const rels = within(ids);
    // Externals nothing in this view reaches are omitted, not drawn floating.
    const used = new Set(rels.flatMap((r) => [r.source, r.target]));
    const shown = nodes.filter((n) => n.tier === 1 || used.has(n.id));
    const input: LayoutInput = {
      view,
      nodes: shown.map((n) => inputNode(n, n.tier === 0 ? "top" : n.tier === 3 ? "bottom" : "middle")),
      edges: rels.map((r) => ({ id: r.id, source: r.source, target: r.target, weight: r.weight, type: r.type, confidence: r.confidence, ...(r.label ? { label: r.label } : {}) })),
      boundaries: [{ id: "boundary:system", title: model.repository.name, members: model.components }],
    };
    return { view, title: "System architecture", nodes: shown, relationships: rels, input, path: [{ id: "system", name: model.repository.name }], notes: [] };
  }

  if (view === "components") {
    const target = byId.get(focus ?? "") ?? byId.get(model.components[0] ?? "");
    if (!target) return { error: "no components" };
    if (!target.children.length || target.tier !== 1 || target.type === "file") return { error: `${target.id} has nothing to drill into` };
    const members = target.children.map((id) => byId.get(id)).filter((n): n is ArchNode => Boolean(n));
    const memberIds = new Set(members.map((m) => m.id));
    // Files → the member that holds them; everything else → its component, as context.
    const memberOf = new Map<string, string>();
    for (const m of members) for (const f of m.files) memberOf.set(f, m.id);
    const componentOf = new Map<string, string>();
    for (const id of model.components) for (const f of byId.get(id)!.files) componentOf.set(f, id);
    const keyOf = (f: string): string | undefined => memberOf.get(f) ?? (componentOf.get(f) !== target.id ? componentOf.get(f) : undefined);
    const rels = aggregate(model.codeLinks, model.externalLinks, keyOf, (id) => byId.has(id)).filter((r) => memberIds.has(r.source) || memberIds.has(r.target));
    const context = new Map<string, "top" | "bottom">();
    for (const r of rels) {
      if (memberIds.has(r.source) && !memberIds.has(r.target)) context.set(r.target, context.get(r.target) === "top" ? "top" : "bottom");
      if (memberIds.has(r.target) && !memberIds.has(r.source)) context.set(r.source, "top");
    }
    const ctxNodes = [...context.keys()].sort().map((id) => byId.get(id)!);
    const band = (n: ArchNode): "top" | "bottom" => (n.tier === 0 ? "top" : n.tier === 3 ? "bottom" : context.get(n.id)!);
    const input: LayoutInput = {
      view,
      focus: target.id,
      nodes: [...members.map((m) => inputNode(m, "middle")), ...ctxNodes.map((n) => inputNode(n, band(n), true))],
      edges: rels.map((r) => ({ id: r.id, source: r.source, target: r.target, weight: r.weight, type: r.type, confidence: r.confidence, ...(r.label ? { label: r.label } : {}) })),
      boundaries: [{ id: `boundary:${target.id}`, title: target.name, members: [...memberIds] }],
    };
    const path = [{ id: "system", name: model.repository.name }, ...ancestors(target, byId).map((n) => ({ id: n.id, name: n.name }))];
    const notes = ctxNodes.some((n) => n.tier === 1) ? ["Components outside this one are shown as context: above if they use it, below if it uses them."] : [];
    return { view, focus: target.id, title: target.name, nodes: [...members, ...ctxNodes], relationships: rels, input, path, notes };
  }

  // dependencies
  const modules = model.nodes.filter((n) => n.level === 3);
  const rels = within(new Set(modules.map((m) => m.id)));
  const weight = new Map<string, number>();
  for (const r of rels) {
    weight.set(r.source, (weight.get(r.source) ?? 0) + 1);
    weight.set(r.target, (weight.get(r.target) ?? 0) + 2);
  }
  const kept = [...modules].sort((a, b) => (weight.get(b.id) ?? 0) - (weight.get(a.id) ?? 0) || b.files.length - a.files.length || (a.id < b.id ? -1 : 1)).slice(0, MAX_DEPENDENCY_MODULES);
  const keptIds = new Set(kept.map((m) => m.id));
  const shownRels = rels.filter((r) => keptIds.has(r.source) && keptIds.has(r.target));
  const notes = modules.length > kept.length ? [`${modules.length - kept.length} of ${modules.length} modules with the fewest dependencies are hidden; drill into a component to see them.`] : [];
  const input: LayoutInput = {
    view: "dependencies",
    nodes: kept.map((m) => inputNode(m, "middle")),
    edges: shownRels.map((r) => ({ id: r.id, source: r.source, target: r.target, weight: r.weight, type: r.type, confidence: r.confidence })),
    boundaries: [],
  };
  return { view, title: "Module dependencies", nodes: kept, relationships: shownRels, input, path: [{ id: "system", name: model.repository.name }], notes };
}

function ancestors(n: ArchNode, byId: Map<string, ArchNode>): ArchNode[] {
  const out: ArchNode[] = [];
  for (let cur: ArchNode | undefined = n; cur; cur = cur.parent ? byId.get(cur.parent) : undefined) out.unshift(cur);
  return out;
}

// ─── publish: layout → validate → repair → last known good ─────────

export interface Candidate {
  layout: DiagramLayout;
  report: ValidationReport;
  attempts: number;
}

/** Lay out and validate, loosening spacing on failure. Never drops nodes, edges or labels to pass. */
export function layoutWithRepair(input: LayoutInput | SequenceInput, profile: QualityProfile = "showcase", maxAttempts = MAX_REPAIR_ATTEMPTS): Candidate {
  let best: Candidate | undefined;
  for (let a = 0; a < maxAttempts; a += 1) {
    const layout = "kind" in input && input.kind === "sequence" ? layoutSequence(input, escalate(a)) : layoutDiagram(input as LayoutInput, escalate(a));
    const report = validateLayout(layout, profile);
    const cand = { layout, report, attempts: a + 1 };
    if (report.valid) return cand;
    if (!best || errors(report) < errors(best.report)) best = cand;
  }
  return { ...best!, attempts: maxAttempts };
}

const errors = (r: ValidationReport): number => r.diagnostics.filter((d) => d.severity === "error").length;

/**
 * The last-known-good rule: a candidate that failed validation never replaces
 * a verified layout. With no verified layout at all, nothing is published;
 * the failed draft is attached only so the page can show it on request.
 */
export function publish(spec: ViewSpec, candidate: Candidate, lastKnownGood: DiagramLayout | undefined): PublishedView {
  const base = { view: spec.view, title: spec.title, nodes: spec.nodes, relationships: spec.relationships, path: spec.path, notes: [...spec.notes], ...(spec.focus ? { focus: spec.focus } : {}) };
  if (candidate.report.valid) return { ...base, layout: candidate.layout, validation: { ...candidate.report, attempts: candidate.attempts, source: "fresh" } };
  if (lastKnownGood) {
    return {
      ...base,
      layout: lastKnownGood,
      validation: { ...candidate.report, attempts: candidate.attempts, source: "last-known-good" },
      notes: [...base.notes, "The latest layout failed validation; showing the last verified layout of this view, which may predate recent changes."],
    };
  }
  return { ...base, layout: null, validation: { ...candidate.report, attempts: candidate.attempts, source: "unverified", draft: candidate.layout } };
}

export { ROLE_LABEL, TAG };
