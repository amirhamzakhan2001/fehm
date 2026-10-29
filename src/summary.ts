import type { CodeGraph } from "./graph.js";
import type { EdgeKind, GraphNode } from "./model.js";

const MAX_NAMES = 5;

function names(graph: CodeGraph, ids: string[]): string {
  const unique = [...new Set(ids)];
  const shown = unique.slice(0, MAX_NAMES).map((id) => graph.node(id)?.name ?? id);
  return unique.length > MAX_NAMES ? `${shown.join(", ")} (+${unique.length - MAX_NAMES} more)` : shown.join(", ");
}

function related(graph: CodeGraph, node: GraphNode, kind: EdgeKind, direction: "out" | "in"): string[] {
  return graph.edgesOf(node.id, direction, [kind]).map((e) => (direction === "out" ? e.target : e.source));
}

/**
 * One-to-three sentence structural description. No LLM; derived only from the
 * graph, so it is always available and always current with the index.
 */
export function deterministicSummary(graph: CodeGraph, node: GraphNode): string {
  const parts: string[] = [];
  const where = node.location ? `${node.path}:${node.location.line}` : node.path ?? "";
  const exported = node.exported ? "exported " : "";
  if (node.kind === "file") {
    const defined = related(graph, node, "defines", "out");
    const imports = related(graph, node, "imports", "out");
    const importedBy = related(graph, node, "imports", "in");
    parts.push(`${node.isTest ? "Test file" : "File"} ${node.path} (${node.language ?? "unknown"}).`);
    if (defined.length) parts.push(`Defines ${names(graph, defined)}.`);
    if (imports.length) parts.push(`Imports ${names(graph, imports)}.`);
    if (importedBy.length) parts.push(`Imported by ${names(graph, importedBy)}.`);
    return parts.join(" ");
  }
  if (node.kind === "directory" || node.kind === "repository") {
    const children = related(graph, node, "contains", "out");
    return `${node.kind === "repository" ? "Repository" : "Directory"} ${node.path} containing ${names(graph, children)}.`;
  }
  if (node.kind === "package") {
    const importers = related(graph, node, "imports", "in");
    return `External package ${node.name}${importers.length ? `, imported by ${names(graph, importers)}` : ""}.`;
  }
  parts.push(`${cap(exported + node.kind)} ${node.name} defined in ${where}.`);
  if (node.doc) parts.push(node.doc);
  const calls = related(graph, node, "calls", "out");
  const callers = related(graph, node, "calls", "in");
  const bases = [...related(graph, node, "extends", "out"), ...related(graph, node, "implements", "out")];
  if (bases.length) parts.push(`Extends/implements ${names(graph, bases)}.`);
  if (calls.length) parts.push(`Calls ${names(graph, calls)}.`);
  if (callers.length) parts.push(`Called by ${names(graph, callers)}.`);
  if (node.evidence.provenance === "heuristic") parts.push("(pattern-extracted; relationships are heuristic)");
  return parts.join(" ");
}

function cap(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
