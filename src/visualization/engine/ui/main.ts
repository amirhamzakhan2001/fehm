import type { EngineStatus } from "../../../engine.js";
import type { ContextPacket } from "../../../model.js";
import { $, fmt, h } from "../../graph/ui/dom.js";

/** Feature 1 debug page: index status, rescan, and an interactive context query. */

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init);
  if (!res.ok) throw new Error(`${path} → HTTP ${res.status}`);
  return (await res.json()) as T;
}

function renderStatus(s: EngineStatus): void {
  $("project").textContent = s.root;
  const cards: [string, number][] = [
    ["files", s.stats.files],
    ["nodes", s.stats.nodes],
    ["edges", s.stats.edges],
    ["unresolved", s.stats.unresolved],
    ["summaries fresh", s.summaries.fresh],
    ["summaries stale", s.summaries.stale],
  ];
  $("stats").replaceChildren(...cards.map(([k, v]) => h("div", { class: "stat" }, h("span", {}, k), h("b", {}, fmt.format(v)))));
  const y = s.sync;
  $("sync").textContent =
    `sync ${y.mode}${y.reason ? ` (${y.reason})` : ""} · analyzed ${y.analyzedFiles.length} · reused ${y.reusedFiles.length}` +
    ` · invalidated ${y.invalidatedFiles.length} · removed ${y.removedFiles.length} · ${y.durationMs}ms`;
}

async function load(init?: RequestInit, path = "/api/status"): Promise<void> {
  try {
    renderStatus(await json<EngineStatus>(path, init));
  } catch (error) {
    $("sync").textContent = (error as Error).message;
    $("sync").className = "err";
  }
}

$("rescan").addEventListener("click", () => void load({ method: "POST" }, "/api/rescan"));

$("query").addEventListener("submit", async (e) => {
  e.preventDefault();
  const params = new URLSearchParams(new FormData(e.target as HTMLFormElement) as unknown as Record<string, string>);
  try {
    const { packet, markdown } = await json<{ packet: ContextPacket; markdown: string }>(`/api/context?${params}`);
    const b = packet.budget;
    $("budget").textContent =
      `intent ${packet.intent} · ${b.usedTokens}/${b.maximumTokens} tokens (${b.estimator}) · remaining ${b.remainingTokens}` +
      ` · truncated ${b.truncated} · dropped ${b.dropped} · downgraded ${b.downgraded} · term coverage ${packet.quality.queryTermCoverage}`;
    $("nodes").replaceChildren(
      h("tr", {}, h("th", {}, "score"), h("th", {}, "detail"), h("th", {}, "tokens"), h("th", {}, "node")),
      ...packet.recommendedNodes.map((n) =>
        h("tr", {},
          h("td", { class: "n" }, n.score.toFixed(3)),
          h("td", {}, n.detail),
          h("td", { class: "n" }, String(n.tokens)),
          h("td", {}, `${n.kind} ${n.name}`, h("div", { class: "p" }, n.path ?? "")),
        ),
      ),
    );
    $("preview").textContent = markdown;
    $("preview").classList.remove("muted");
  } catch (error) {
    $("budget").textContent = (error as Error).message;
  }
});

void load();
