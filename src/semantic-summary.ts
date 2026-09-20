import { readFile } from "node:fs/promises";
import path from "node:path";
import type { CodeGraph, GraphNode, PromptProviderConfig, SemanticSummaryResult } from "./model.js";
import { callPromptModel } from "./prompt-runtime.js";

function sourceExcerpt(content: string, node: GraphNode): string {
  if (!node.location) return content.slice(0, 6_000);
  const lines = content.split(/\r?\n/);
  return lines.slice(Math.max(0, node.location.line - 1), Math.min(lines.length, node.location.endLine ?? node.location.line + 40)).join("\n").slice(0, 6_000);
}

function deterministicSemanticSummary(graph: CodeGraph, node: GraphNode, source: string): string {
  const outgoing = graph.edges.filter((edge) => edge.source === node.id);
  const nodes = new Map(graph.nodes.map((item) => [item.id, item]));
  const called = outgoing.filter((edge) => edge.kind === "calls").map((edge) => nodes.get(edge.target)?.name).filter(Boolean).slice(0, 5);
  const used = outgoing.filter((edge) => edge.kind === "uses" || edge.kind === "references").map((edge) => nodes.get(edge.target)?.name).filter(Boolean).slice(0, 5);
  const behaviors: string[] = [];
  if (/\b(?:readFile|access|stat|readdir)\b/.test(source)) behaviors.push("reads filesystem state");
  if (/\b(?:writeFile|rename|mkdir|unlink)\b/.test(source)) behaviors.push("persists filesystem changes");
  if (/\bfetch\s*\(|\baxios\b/.test(source)) behaviors.push("communicates with an HTTP service");
  if (/\b(?:execFile|spawn)\b/.test(source)) behaviors.push("runs a bounded external command");
  if (/\bthrow\s+new\b|\bcatch\s*\(/.test(source)) behaviors.push("handles explicit failure paths");
  const role = node.kind === "file" ? `Module ${node.qualifiedName}` : `${node.exported ? "Exported " : ""}${node.kind} ${node.qualifiedName}`;
  const relations = [called.length ? `calls ${called.join(", ")}` : "", used.length ? `uses ${used.join(", ")}` : "", ...behaviors].filter(Boolean);
  return `${role} ${relations.length ? relations.join("; ") : "encapsulates its indexed source behavior"}.`;
}

export async function refreshSemanticSummaries(
  graph: CodeGraph,
  options: { provider?: PromptProviderConfig; nodeIds?: string[]; limit?: number } = {},
): Promise<SemanticSummaryResult> {
  const selected = new Set(options.nodeIds ?? []);
  const candidates = graph.nodes.filter((node) =>
    ["file", "class", "interface", "function", "method"].includes(node.kind)
    && (!selected.size || selected.has(node.id)),
  ).slice(0, Math.max(1, options.limit ?? graph.nodes.length));
  const cache = new Map<string, string>();
  const failed: SemanticSummaryResult["failed"] = [];
  let updated = 0;
  for (const node of candidates) {
    if (!node.path) continue;
    let content = cache.get(node.path);
    if (content === undefined) {
      try { content = await readFile(path.join(graph.repository.root, node.path), "utf8"); } catch (error) {
        failed.push({ nodeId: node.id, error: error instanceof Error ? error.message : String(error) });
        continue;
      }
      cache.set(node.path, content);
    }
    const excerpt = sourceExcerpt(content, node);
    try {
      const summary = options.provider
        ? (await callPromptModel(
          options.provider,
          "Summarize the supplied code in one precise sentence. State responsibility, important side effects, and major collaborators. Return only the sentence. Do not invent behavior.",
          `Symbol: ${node.qualifiedName}\nKind: ${node.kind}\n\n${excerpt}`,
        )).trim().replace(/\s+/g, " ").slice(0, 600)
        : deterministicSemanticSummary(graph, node, excerpt);
      node.summary = summary;
      node.summarySource = "semantic";
      node.summaryStatus = "fresh";
      updated += 1;
    } catch (error) {
      node.summaryStatus = "failed";
      failed.push({ nodeId: node.id, error: error instanceof Error ? error.message : String(error) });
    }
  }
  if (graph.synchronization) {
    const summarized = graph.nodes.filter((node) => ["file", "class", "interface", "function", "method"].includes(node.kind));
    graph.synchronization.summaryFreshness = {
      fresh: summarized.filter((node) => node.summaryStatus === "fresh").length,
      stale: summarized.filter((node) => node.summaryStatus === "stale").length,
      notGenerated: summarized.filter((node) => node.summaryStatus === "not-generated").length,
      failed: summarized.filter((node) => node.summaryStatus === "failed").length,
      percent: summarized.length ? Math.round(summarized.filter((node) => node.summaryStatus === "fresh").length / summarized.length * 1_000) / 10 : 100,
    };
  }
  return { generatedAt: new Date().toISOString(), ...(options.provider ? { model: options.provider.model } : {}), updated, failed, graph };
}
