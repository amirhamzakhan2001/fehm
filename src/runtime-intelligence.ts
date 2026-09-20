import { readFile } from "node:fs/promises";
import path from "node:path";
import type { CodeGraph, GraphNode, RuntimePerformanceReport, RuntimeSpanRecord } from "./model.js";
import { atomicWriteJson } from "./persistence.js";

type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as UnknownRecord : {};
}

function scalarAttributes(value: unknown): Record<string, string | number | boolean> {
  if (Array.isArray(value)) {
    return Object.fromEntries(value.flatMap((item) => {
      const entry = record(item);
      const key = typeof entry.key === "string" ? entry.key : undefined;
      const raw = record(entry.value);
      const resolved = raw.stringValue ?? raw.intValue ?? raw.doubleValue ?? raw.boolValue;
      return key && ["string", "number", "boolean"].includes(typeof resolved) ? [[key, resolved as string | number | boolean]] : [];
    }));
  }
  return Object.fromEntries(Object.entries(record(value)).filter(([, item]) => ["string", "number", "boolean"].includes(typeof item))) as Record<string, string | number | boolean>;
}

function nodeForSpan(graph: CodeGraph, name: string, attributes: Record<string, string | number | boolean>): GraphNode | undefined {
  const candidates = [name, attributes["code.function"], attributes["code.namespace"], attributes["http.route"], attributes["rpc.method"]]
    .filter((item): item is string => typeof item === "string")
    .flatMap((item) => item.toLowerCase().split(/[^a-z0-9_$]+/).filter((token) => token.length >= 3));
  return graph.nodes
    .filter((node) => !["repository", "directory"].includes(node.kind))
    .map((node) => ({ node, score: candidates.reduce((total, token) => total + (node.qualifiedName.toLowerCase().includes(token) ? token.length : 0), 0) }))
    .sort((a, b) => b.score - a.score)[0]?.score ? graph.nodes
      .filter((node) => !["repository", "directory"].includes(node.kind))
      .map((node) => ({ node, score: candidates.reduce((total, token) => total + (node.qualifiedName.toLowerCase().includes(token) ? token.length : 0), 0) }))
      .sort((a, b) => b.score - a.score)[0]?.node : undefined;
}

function otelSpans(input: UnknownRecord, graph: CodeGraph): RuntimeSpanRecord[] {
  const resourceSpans = Array.isArray(input.resourceSpans) ? input.resourceSpans : [];
  const rawSpans = resourceSpans.flatMap((resource) => {
    const scopes = record(resource).scopeSpans ?? record(resource).instrumentationLibrarySpans;
    return Array.isArray(scopes) ? scopes.flatMap((scope) => Array.isArray(record(scope).spans) ? record(scope).spans as unknown[] : []) : [];
  });
  return rawSpans.flatMap((value) => {
    const span = record(value);
    if (typeof span.name !== "string") return [];
    const start = Number(span.startTimeUnixNano ?? 0);
    const end = Number(span.endTimeUnixNano ?? 0);
    const durationMs = start && end ? Math.max(0, (end - start) / 1_000_000) : Number(span.durationMs ?? 0);
    const attributes = scalarAttributes(span.attributes);
    const statusCode = String(record(span.status).code ?? "").toUpperCase();
    const status = statusCode.includes("ERROR") || statusCode === "2" ? "error" as const : statusCode ? "ok" as const : "unknown" as const;
    const node = nodeForSpan(graph, span.name, attributes);
    return [{ name: span.name, durationMs, status, source: "opentelemetry" as const, ...(node ? { node } : {}), attributes }];
  });
}

function chromeSpans(input: UnknownRecord, graph: CodeGraph): RuntimeSpanRecord[] {
  const events = Array.isArray(input.traceEvents) ? input.traceEvents : [];
  return events.flatMap((value) => {
    const event = record(value);
    if (event.ph !== "X" || typeof event.name !== "string") return [];
    const attributes = scalarAttributes(event.args);
    const node = nodeForSpan(graph, event.name, attributes);
    return [{ name: event.name, durationMs: Number(event.dur ?? 0) / 1_000, status: "unknown" as const, source: "chrome-trace" as const, ...(node ? { node } : {}), attributes }];
  });
}

function genericSpans(input: unknown, graph: CodeGraph): RuntimeSpanRecord[] {
  const values = Array.isArray(input) ? input : Array.isArray(record(input).spans) ? record(input).spans as unknown[] : [];
  return values.flatMap((value) => {
    const span = record(value);
    if (typeof span.name !== "string" || typeof span.durationMs !== "number") return [];
    const attributes = scalarAttributes(span.attributes);
    const node = nodeForSpan(graph, span.name, attributes);
    return [{ name: span.name, durationMs: span.durationMs, status: span.error === true || span.status === "error" ? "error" as const : "ok" as const, source: "generic" as const, ...(node ? { node } : {}), attributes }];
  });
}

export async function analyzeRuntimeTrace(graph: CodeGraph, tracePath: string): Promise<RuntimePerformanceReport> {
  const source = path.resolve(tracePath);
  const input = JSON.parse(await readFile(source, "utf8")) as unknown;
  const root = record(input);
  const spans = root.resourceSpans ? otelSpans(root, graph) : root.traceEvents ? chromeSpans(root, graph) : genericSpans(input, graph);
  const groups = new Map<string, RuntimeSpanRecord[]>();
  for (const span of spans) groups.set(span.node?.id ?? span.name, [...(groups.get(span.node?.id ?? span.name) ?? []), span]);
  const bottlenecks = [...groups.values()].map((items) => {
    const totalMs = items.reduce((sum, item) => sum + item.durationMs, 0);
    const node = items.find((item) => item.node)?.node;
    return {
      name: node?.qualifiedName ?? (items[0]?.name ?? "unknown"),
      totalMs: Math.round(totalMs * 100) / 100,
      averageMs: Math.round(totalMs / Math.max(1, items.length) * 100) / 100,
      maximumMs: Math.round(Math.max(...items.map((item) => item.durationMs)) * 100) / 100,
      calls: items.length,
      errors: items.filter((item) => item.status === "error").length,
      ...(node ? { node } : {}),
    };
  }).sort((a, b) => b.totalMs - a.totalMs).slice(0, 100);
  const mapped = spans.filter((span) => span.node).length;
  const report = { source, spans, bottlenecks, unmappedSpans: spans.length - mapped, confidence: spans.length ? Math.round(55 + mapped / spans.length * 43) : 0 };
  await atomicWriteJson(path.join(graph.repository.root, ".fehm", "runtime", "latest.json"), report);
  return report;
}
