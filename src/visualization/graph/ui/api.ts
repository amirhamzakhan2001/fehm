import type { GraphFreshness, GraphNodeDetail, GraphSearchHit, GraphStatus, GraphViewPayload } from "../model.js";

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init);
  if (!res.ok) {
    let detail = "";
    try {
      detail = ((await res.json()) as { error?: string }).error ?? "";
    } catch {
      // Non-JSON error body.
    }
    throw new Error(`${path} → HTTP ${res.status}${detail ? `: ${detail}` : ""}`);
  }
  return (await res.json()) as T;
}

export const api = {
  status: () => json<GraphStatus>("/api/graph/status"),
  graph: () => json<GraphViewPayload>("/api/graph"),
  refresh: () => json<GraphViewPayload>("/api/graph/refresh", { method: "POST" }),
  relayout: () => json<GraphViewPayload>("/api/graph/relayout", { method: "POST" }),
  freshness: () => json<GraphFreshness>("/api/graph/freshness"),
  search: (q: string, signal?: AbortSignal) => json<GraphSearchHit[]>(`/api/graph/search?q=${encodeURIComponent(q)}&limit=40`, signal ? { signal } : undefined),
  node: (id: string) => json<GraphNodeDetail>(`/api/graph/node?id=${encodeURIComponent(id)}`),
};
