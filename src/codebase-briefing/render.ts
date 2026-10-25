import { estimateTokens, TOKEN_ESTIMATOR } from "../compression.js";
import type { Block, BriefingItem, BriefingSection, Claim, CodebaseBriefing, SectionId } from "./types.js";

export type BriefingDepth = "minimal" | "standard" | "deep";

/** Budgets, not guarantees: sections are added in relevance order until the budget is spent. */
export const DEPTH_BUDGET: Record<BriefingDepth, number> = { minimal: 1500, standard: 6000, deep: 20000 };
const MINIMAL: SectionId[] = ["overview", "architecture", "entryPoints", "cheatSheet"];
const LIST_CAP: Record<BriefingDepth, number> = { minimal: 5, standard: 10, deep: 40 };

export interface RenderOptions {
  depth?: BriefingDepth;
  sections?: SectionId[];
  tokenBudget?: number;
}

const STATE = { confirmed: "CONFIRMED", likely: "LIKELY", unknown: "UNKNOWN" } as const;

/**
 * Markdown briefing for the CLI, export and agents. Uses Feature 1's token
 * estimator; the briefing is bounded by the budget and says what it left out.
 */
export function renderBriefing(b: CodebaseBriefing, options: RenderOptions = {}): { text: string; tokens: number; omitted: SectionId[]; estimator: string } {
  const depth = options.depth ?? "standard";
  const budget = options.tokenBudget ?? DEPTH_BUDGET[depth];
  const wanted = options.sections?.length ? options.sections : depth === "minimal" ? MINIMAL : b.sections.map((s) => s.id);
  const byId = new Map(b.sections.map((s) => [s.id, s]));
  // Overview and cheat sheet always lead; the rest follow archetype relevance.
  const ordered = wanted
    .map((id) => byId.get(id))
    .filter((s): s is BriefingSection => Boolean(s))
    .sort((x, y) => rankOf(x) - rankOf(y) || y.priority - x.priority);
  const header = [
    `# ${b.headline.name} — Codebase briefing`,
    "",
    `${b.headline.tagline}`,
    "",
    `${b.headline.tags.join(" · ")}`,
    `Evidence: ${Math.round(b.metrics.confirmedShare * 100)}% of ${b.metrics.claims} claims confirmed · ${b.metrics.unknowns} unknowns · ${b.metrics.files} files indexed · mode ${b.mode}`,
    b.freshness.fresh ? "" : `\n> ⚠ The working tree changed since indexing (${b.freshness.changed.added.length + b.freshness.changed.modified.length + b.freshness.changed.deleted.length} files). Stale sections: ${b.freshness.affectedSections.join(", ")}. Run \`fehm scan\` to refresh.`,
    "",
  ].join("\n");
  let text = header;
  let tokens = estimateTokens(text);
  const omitted: SectionId[] = [];
  for (const s of ordered) {
    const part = renderSection(s, depth);
    const t = estimateTokens(part);
    if (tokens + t > budget) {
      // Fall back to the one-line summary before dropping the section entirely.
      const brief = `\n## ${s.title} — ${STATE[s.state]}\n${s.summary}\n`;
      const bt = estimateTokens(brief);
      if (tokens + bt <= budget) {
        text += brief;
        tokens += bt;
      } else omitted.push(s.id);
      continue;
    }
    text += part;
    tokens += t;
  }
  if (!options.sections?.length && depth !== "minimal" && b.unknowns.length) {
    const u = `\n## What Fehm could not determine\n${b.unknowns.slice(0, LIST_CAP[depth]).map((x) => `- ${x.text}`).join("\n")}\n`;
    if (tokens + estimateTokens(u) <= budget) (text += u), (tokens += estimateTokens(u));
  }
  if (omitted.length) text += `\n_Omitted to fit ${budget} tokens: ${omitted.join(", ")}. Use --depth deep or --sections._\n`;
  return { text, tokens: estimateTokens(text), omitted, estimator: TOKEN_ESTIMATOR };
}

function rankOf(s: BriefingSection): number {
  return s.id === "overview" ? 0 : s.id === "cheatSheet" ? 1 : s.id === "architecture" ? 2 : s.id === "entryPoints" ? 3 : 10;
}

function renderSection(s: BriefingSection, depth: BriefingDepth): string {
  const claims = new Map(s.claims.map((c) => [c.id, c]));
  const cap = LIST_CAP[depth];
  const out: string[] = ["", `## ${s.title} — ${STATE[s.state]}${s.stale ? " (stale)" : ""}`, `_${s.question}_ ${s.summary}`, ""];
  for (const block of s.blocks) out.push(...renderBlock(block, claims, depth, cap), "");
  if (s.unknowns.length && depth !== "minimal") out.push(`Unknown: ${s.unknowns.join(" ")}`, "");
  return out.join("\n").replace(/\n{3,}/g, "\n\n");
}

function cite(id: string | undefined, claims: Map<string, Claim>, depth: BriefingDepth): string {
  if (!id || depth !== "deep") return "";
  const c = claims.get(id);
  if (!c) return "";
  const where = c.evidence.slice(0, 3).map((e) => `${e.path}${e.line ? `:${e.line}` : ""}`).join(", ");
  return ` [${c.state}${where ? `: ${where}` : ""}]`;
}

function item(i: BriefingItem, claims: Map<string, Claim>, depth: BriefingDepth): string {
  return `${i.title}${i.detail ? ` — ${i.detail}` : ""}${cite(i.claim, claims, depth)}`;
}

function renderBlock(b: Block, claims: Map<string, Claim>, depth: BriefingDepth, cap: number): string[] {
  switch (b.type) {
    case "text":
      return [b.text + cite(b.claim, claims, depth)];
    case "facts":
      return b.rows.map((r) => `- **${r.label}:** ${r.value}${cite(r.claim, claims, depth)}`);
    case "list": {
      const lines = b.items.slice(0, cap).map((i, n) => `${b.ordered ? `${n + 1}.` : "-"} ${item(i, claims, depth)}`);
      if (b.items.length > cap) lines.push(`- … ${b.items.length - cap} more`);
      return [...(b.title ? [`**${b.title}**`] : []), ...(lines.length ? lines : [b.empty ?? "None."])];
    }
    case "groups": {
      const lines: string[] = b.title ? [`**${b.title}**`] : [];
      if (!b.groups.length) lines.push(b.empty ?? "None.");
      for (const g of b.groups) {
        lines.push(`**${g.title}**${g.note ? ` (${g.note})` : ""}`);
        for (const i of g.items.slice(0, cap)) lines.push(`- ${item(i, claims, depth)}`);
        if (g.items.length > cap) lines.push(`- … ${g.items.length - cap} more`);
      }
      return lines;
    }
    case "flow":
      return [`**${b.title}**: ${b.steps.map((s) => s.name).join(" → ")}${cite(b.claim, claims, depth)}`];
    case "diagram":
      return depth === "minimal" && b.lines.length > 12 ? [] : [...(b.title ? [`**${b.title}**`] : []), "```", ...b.lines, "```"];
    case "ranking":
      return [...(b.title ? [`**${b.title}**`] : []), ...b.rows.slice(0, cap).map((r, n) => `${n + 1}. ${r.name} — ${r.why.join("; ")}${cite(r.claim, claims, depth)}`)];
    case "risks":
      return b.items.length ? b.items.slice(0, cap).map((r) => `- [${r.severity.toUpperCase()}] ${r.title} — ${r.why}${cite(r.claim, claims, depth)}`) : [b.empty ?? "None."];
  }
}
