import type { BriefingItem, Claim, CodebaseBriefing, SectionId } from "../../../codebase-briefing/types.js";

export const REPORT_GROUPS: { id: string; title: string; sections: SectionId[] }[] = [
  { id: "overview", title: "Quick briefing", sections: ["overview"] },
  { id: "requirements", title: "Requirements & behavior", sections: ["features"] },
  { id: "architecture", title: "System architecture", sections: ["architecture", "components"] },
  { id: "runtime", title: "Runtime & data flows", sections: ["entryPoints", "dataFlows", "runtime"] },
  { id: "apis", title: "APIs & integrations", sections: ["api", "integrations"] },
  { id: "data", title: "Data & infrastructure", sections: ["database", "infrastructure", "technology"] },
  { id: "quality", title: "Testing & security", sections: ["testing", "security"] },
  { id: "assessment", title: "Engineering assessment", sections: ["dependencies", "risks", "engineerMustKnow"] },
  { id: "meeting", title: "Meeting briefing", sections: ["cheatSheet"] },
  { id: "evidence", title: "Evidence & unknowns", sections: [] },
];

export function basisLabel(claim: Claim): string {
  if (claim.state === "unknown") return "Unknown";
  if (claim.basis === "inferred") return "Inferred";
  if (claim.basis === "declared") return claim.evidence.some((e) => e.source === "documentation") ? "Documented" : "Declared configuration";
  return claim.evidence.some((e) => e.provenance === "heuristic") ? "Static pattern" : "Source verified";
}

export function itemsIn(b: CodebaseBriefing, id: SectionId): BriefingItem[] {
  return b.sections.find((s) => s.id === id)?.blocks.flatMap((block) => block.type === "list" ? block.items : block.type === "groups" ? block.groups.flatMap((g) => g.items) : []) ?? [];
}

export function meetingQuestions(b: CodebaseBriefing): { text: string; section: SectionId }[] {
  const priority: SectionId[] = ["overview", "infrastructure", "database", "security", "api", "testing", "architecture"];
  return [...b.unknowns].sort((a, c) => {
    const rank = (id: SectionId): number => { const i = priority.indexOf(id); return i < 0 ? priority.length : i; };
    return rank(a.section) - rank(c.section);
  }).filter((u, i, all) => all.findIndex((other) => other.text === u.text) === i).slice(0, 6).map((u) => ({
    text: `The repository analysis could not establish this: ${u.text} Which document, implementation or operational evidence should we consult?`, section: u.section,
  }));
}

export function readingOrder(b: CodebaseBriefing): { title: string; why: string; path: string; nodeId?: string }[] {
  const result: { title: string; why: string; path: string; nodeId?: string }[] = [];
  const seen = new Set<string>();
  const add = (path: string, title: string, why: string, nodeId?: string): void => {
    if (!path || path === "." || seen.has(path)) return;
    seen.add(path); result.push({ path, title, why, ...(nodeId ? { nodeId } : {}) });
  };
  for (const claim of b.sections.find((s) => s.id === "overview")?.claims ?? []) for (const e of claim.evidence) if (e.source === "documentation" || e.source === "manifest") add(e.path, e.path, "Start with the project's declared purpose and public entry points.", e.nodeId);
  for (const item of itemsIn(b, "entryPoints").slice(0, 3)) if (item.path) add(item.path, item.title, "Follow an indexed entry point into its implementation.", item.nodeId);
  const ranking = b.sections.find((s) => s.id === "components")?.blocks.find((block) => block.type === "ranking");
  for (const row of ranking?.rows.slice(0, 3) ?? []) if (row.path) add(row.path, row.name, row.why.join(" "), row.nodeId);
  return result.slice(0, 6);
}

export const QUALITY_TOPICS: { name: string; section: SectionId; match: RegExp; limitation: string }[] = [
  { name: "Performance & scalability", section: "runtime", match: /parallel|concurren|cache|worker|batch|stream|timeout/i, limitation: "Latency targets, load limits and scaling guarantees are not established by static analysis." },
  { name: "Reliability & recovery", section: "runtime", match: /retry|error|timeout|signal|shutdown|interval/i, limitation: "Availability objectives, recovery procedures and fault tolerance need operational evidence." },
  { name: "Security & privacy", section: "security", match: /auth|valid|secret|token|trust|input/i, limitation: "Detected checks do not prove enforcement, privacy compliance or absence of vulnerabilities." },
  { name: "Maintainability & testing", section: "testing", match: /test|reach|coverage|framework/i, limitation: "Static test reach is not executed coverage. This briefing does not run tests." },
  { name: "Durability & consistency", section: "database", match: /persist|database|write|transaction|storage/i, limitation: "Transaction guarantees, retention and backup policies are not established." },
  { name: "Observability & accessibility", section: "infrastructure", match: /monitor|logging|telemetry|accessib|wcag/i, limitation: "Operational monitoring and accessibility conformance require explicit documentation or execution evidence." },
];
