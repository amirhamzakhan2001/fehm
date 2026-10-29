import { ROLE_LABEL } from "./model.js";
import type { ArchitectureSummary, PublishedView } from "./types.js";

/** Plain-text rendering of one architecture view for `fehm architecture`. */
export function renderArchitectureText(summary: ArchitectureSummary, view: PublishedView): string {
  const byId = new Map(view.nodes.map((n) => [n.id, n]));
  const cov = summary.coverage;
  const total = cov.verified + cov.strong + cov.inferred + cov.unknown || 1;
  const pct = (v: number): string => `${Math.round((v / total) * 100)}%`;
  const lines = [
    `${view.title} — ${summary.repository.name}  (fingerprint ${summary.fingerprint.slice(0, 8)})`,
    `evidence: verified ${pct(cov.verified)} · strong ${pct(cov.strong)} · inferred ${pct(cov.inferred)} · unknown ${pct(cov.unknown)}`,
    "",
  ];
  const width = Math.max(10, ...view.nodes.map((n) => n.name.length));
  for (const n of [...view.nodes].sort((a, b) => a.tier - b.tier || (a.name < b.name ? -1 : 1))) {
    lines.push(`  ${n.name.padEnd(width)}  ${ROLE_LABEL[n.type].padEnd(18)} ${n.role.confidence.padEnd(9)} ${n.files.length ? `${n.files.length} ${n.files.length === 1 ? "file" : "files"}` : ""}`);
  }
  lines.push("", "Relationships (strongest first):");
  for (const r of [...view.relationships].sort((a, b) => b.weight - a.weight).slice(0, 30)) {
    lines.push(`  ${byId.get(r.source)?.name ?? r.source} → ${byId.get(r.target)?.name ?? r.target}  ${r.label ?? r.type} ×${r.weight} (${r.confidence})`);
  }
  if (view.relationships.length > 30) lines.push(`  … ${view.relationships.length - 30} more`);
  const v = view.validation;
  const errors = v.diagnostics.filter((d) => d.severity === "error");
  lines.push("", `Layout: ${v.source === "fresh" ? "verified" : v.source === "last-known-good" ? "last verified (latest candidate failed)" : "NOT verified"} (${v.profile}, ${v.attempts} attempt${v.attempts === 1 ? "" : "s"})`);
  for (const d of errors.slice(0, 10)) lines.push(`  ✗ ${d.code}: ${d.message}`);
  for (const n of view.notes) lines.push(`  note: ${n}`);
  if (summary.unknowns.length) lines.push("", "Not determined:", ...summary.unknowns.map((u) => `  ? ${u}`));
  return lines.join("\n");
}
