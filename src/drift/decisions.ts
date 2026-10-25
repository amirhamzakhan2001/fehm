import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { userInfo } from "node:os";
import { dirname, join } from "node:path";
import type { Decision, DecisionKind } from "./types.js";

/**
 * Developer decisions (spec §74, §75), in `.fehm/drift-decisions.json` at the
 * repository root, meant to be committed with the code so the whole team
 * shares them:
 *   - a finding marked intentional / accepted / dismissed is not reported
 *     again (it stays visible under "Decided");
 *   - a mined pattern can be approved (it becomes part of the project
 *     baseline, high confidence), rejected or ignored (it produces no findings).
 */

export const DECISIONS_FILE = ".fehm/drift-decisions.json";

export interface DecisionsFile {
  version: 1;
  findings: Record<string, Decision>;
  patterns: Record<string, { decision: "approved" | "rejected" | "ignored"; by: string; at: string }>;
}

const KINDS = new Set<DecisionKind>(["intentional", "accepted", "dismissed"]);
const PATTERN = new Set(["approved", "rejected", "ignored"]);

export function readDecisions(root: string): DecisionsFile {
  const path = join(root, DECISIONS_FILE);
  const empty: DecisionsFile = { version: 1, findings: {}, patterns: {} };
  if (!existsSync(path)) return empty;
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as Partial<DecisionsFile>;
    const findings: DecisionsFile["findings"] = {};
    for (const [id, d] of Object.entries(raw.findings ?? {})) if (d && KINDS.has(d.kind)) findings[id] = { kind: d.kind, reason: String(d.reason ?? ""), by: String(d.by ?? ""), at: String(d.at ?? ""), scope: String(d.scope ?? id) };
    const patterns: DecisionsFile["patterns"] = {};
    for (const [id, d] of Object.entries(raw.patterns ?? {})) if (d && PATTERN.has(d.decision)) patterns[id] = { decision: d.decision, by: String(d.by ?? ""), at: String(d.at ?? "") };
    return { version: 1, findings, patterns };
  } catch {
    // A malformed file is not trusted; decisions start empty and the page says nothing was decided.
    return empty;
  }
}

function writeDecisions(root: string, data: DecisionsFile): void {
  const path = join(root, DECISIONS_FILE);
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`);
  renameSync(tmp, path);
}

/** Who decided: git's user.name, else the OS user. */
export function actor(root: string): string {
  try {
    const name = execFileSync("git", ["-C", root, "config", "user.name"], { stdio: ["ignore", "pipe", "ignore"], timeout: 5000 }).toString().trim();
    if (name) return name;
  } catch {
    // no git
  }
  try {
    return userInfo().username;
  } catch {
    return "developer";
  }
}

export function decideFinding(root: string, id: string, kind: DecisionKind | null, reason = "", scope = id): Decision | undefined {
  const data = readDecisions(root);
  if (kind === null) delete data.findings[id];
  else data.findings[id] = { kind, reason: reason.slice(0, 500), by: actor(root), at: new Date().toISOString(), scope: scope.slice(0, 300) };
  writeDecisions(root, data);
  return data.findings[id];
}

export function decidePattern(root: string, id: string, decision: "approved" | "rejected" | "ignored" | null): void {
  const data = readDecisions(root);
  if (decision === null) delete data.patterns[id];
  else data.patterns[id] = { decision, by: actor(root), at: new Date().toISOString() };
  writeDecisions(root, data);
}

export function isDecisionKind(x: string): x is DecisionKind {
  return KINDS.has(x as DecisionKind);
}
