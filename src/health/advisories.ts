import { createHash } from "node:crypto";
import { join } from "node:path";
import type { Finding, Severity } from "../findings/model.js";
import { readJson, writeJsonAtomic } from "../persistence.js";
import { makeFinding } from "./rules.js";
import type { Advisory, Component, DependencyReport, Ecosystem } from "./types.js";

/**
 * Known vulnerabilities from OSV.dev. This is the one part of Feature 3.5
 * that uses the network, so it runs only when asked (`fehm health
 * --advisories`, or the page's "Check advisories" button). Results are cached
 * in the state directory with the component set they were computed for; when
 * the lockfile changes they are shown as stale, not silently reused.
 */

export const ADVISORY_FILE = "health-advisories.json";
const OSV = "https://api.osv.dev/v1";
const OSV_ECOSYSTEM: Record<Ecosystem, string> = { npm: "npm", pypi: "PyPI", cargo: "crates.io", golang: "Go", maven: "Maven" };
const MAX_DETAILS = 300;

export type Fetcher = (url: string, init?: { method?: string; body?: string; headers?: Record<string, string> }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

interface AdvisoryCache {
  version: 1;
  checkedAt: string;
  componentsHash: string;
  items: Advisory[];
}

export function componentsHash(components: Component[]): string {
  return createHash("sha256")
    .update(components.filter((c) => c.version).map((c) => `${c.ecosystem}:${c.name}@${c.version}`).sort().join("\n"))
    .digest("hex")
    .slice(0, 16);
}

export function readAdvisories(stateDirectory: string, components: Component[]): DependencyReport["advisories"] | undefined {
  const r = readJson<AdvisoryCache>(join(stateDirectory, ADVISORY_FILE));
  if (!r.ok || r.value?.version !== 1 || !Array.isArray(r.value.items)) return undefined;
  const stale = r.value.componentsHash !== componentsHash(components);
  return { status: stale ? "stale" : "checked", checkedAt: r.value.checkedAt, source: "OSV.dev", ...(stale ? { reason: "The dependency set changed after this check; run it again." } : {}), items: r.value.items };
}

/** Query OSV for every versioned component, then fetch details (severity) for each advisory found. */
export async function checkAdvisories(stateDirectory: string | undefined, components: Component[], fetcher: Fetcher = fetch as unknown as Fetcher): Promise<DependencyReport["advisories"]> {
  const queryable = components.filter((c) => c.version && /\d/.test(c.version));
  const hits = new Map<string, Component[]>();
  try {
    for (let i = 0; i < queryable.length; i += 1000) {
      const batch = queryable.slice(i, i + 1000);
      const res = await fetcher(`${OSV}/querybatch`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ queries: batch.map((c) => ({ package: { name: c.name, ecosystem: OSV_ECOSYSTEM[c.ecosystem] }, version: c.version.replace(/^v(?=\d)/, "") })) }) });
      if (!res.ok) throw new Error(`OSV querybatch returned HTTP ${res.status}`);
      const body = (await res.json()) as { results?: { vulns?: { id: string }[] }[] };
      (body.results ?? []).forEach((r, j) => {
        for (const v of r.vulns ?? []) hits.set(v.id, [...(hits.get(v.id) ?? []), batch[j]!]);
      });
    }
    const items: Advisory[] = [];
    for (const [id, affected] of [...hits].slice(0, MAX_DETAILS)) {
      const res = await fetcher(`${OSV}/vulns/${encodeURIComponent(id)}`);
      const v = res.ok ? ((await res.json()) as OsvVuln) : undefined;
      for (const c of affected) items.push({ id, aliases: v?.aliases ?? [], summary: (v?.summary ?? v?.details ?? "").slice(0, 300), severity: v ? severityOf(v) : "unknown", package: c.name, version: c.version, ecosystem: c.ecosystem });
    }
    items.sort((a, b) => sevRank(a.severity) - sevRank(b.severity) || a.package.localeCompare(b.package));
    const result: DependencyReport["advisories"] = { status: "checked", checkedAt: new Date().toISOString(), source: "OSV.dev", items };
    if (stateDirectory) writeJsonAtomic(join(stateDirectory, ADVISORY_FILE), { version: 1, checkedAt: result.checkedAt!, componentsHash: componentsHash(components), items } satisfies AdvisoryCache);
    return result;
  } catch (e) {
    return { status: "error", reason: `Advisory check failed: ${(e as Error).message}`, items: [] };
  }
}

interface OsvVuln {
  id: string;
  summary?: string;
  details?: string;
  aliases?: string[];
  severity?: { type: string; score: string }[];
  database_specific?: { severity?: string };
  affected?: { ecosystem_specific?: { severity?: string }; database_specific?: { severity?: string } }[];
}

const sevRank = (s: Severity | "unknown"): number => (s === "unknown" ? 5 : ["critical", "high", "medium", "low", "info"].indexOf(s));

function severityOf(v: OsvVuln): Severity | "unknown" {
  const label = v.database_specific?.severity ?? v.affected?.find((a) => a.database_specific?.severity || a.ecosystem_specific?.severity)?.database_specific?.severity;
  if (label) {
    const l = label.toUpperCase();
    if (l === "CRITICAL") return "critical";
    if (l === "HIGH") return "high";
    if (l === "MODERATE" || l === "MEDIUM") return "medium";
    if (l === "LOW") return "low";
  }
  const vector = v.severity?.find((s) => s.type === "CVSS_V3" || s.type === "CVSS_V31")?.score;
  const score = vector ? cvss3(vector) : undefined;
  if (score === undefined) return "unknown";
  return score >= 9 ? "critical" : score >= 7 ? "high" : score >= 4 ? "medium" : score > 0 ? "low" : "info";
}

/** CVSS v3.x base score from a vector string (FIRST specification, section 7.1). */
export function cvss3(vector: string): number | undefined {
  const m = Object.fromEntries(vector.split("/").slice(1).map((p) => p.split(":") as [string, string]));
  const W: Record<string, Record<string, number>> = {
    AV: { N: 0.85, A: 0.62, L: 0.55, P: 0.2 },
    AC: { L: 0.77, H: 0.44 },
    UI: { N: 0.85, R: 0.62 },
    C: { H: 0.56, L: 0.22, N: 0 },
    I: { H: 0.56, L: 0.22, N: 0 },
    A: { H: 0.56, L: 0.22, N: 0 },
  };
  const changed = m.S === "C";
  const pr = { N: 0.85, L: changed ? 0.68 : 0.62, H: changed ? 0.5 : 0.27 }[m.PR as "N" | "L" | "H"];
  const get = (k: string): number | undefined => W[k]![m[k] as string];
  const [av, ac, ui, c, i, a] = ["AV", "AC", "UI", "C", "I", "A"].map(get);
  if ([av, ac, ui, c, i, a, pr].some((x) => x === undefined) || (m.S !== "U" && m.S !== "C")) return undefined;
  const iss = 1 - (1 - c!) * (1 - i!) * (1 - a!);
  const impact = changed ? 7.52 * (iss - 0.029) - 3.25 * (iss - 0.02) ** 15 : 6.42 * iss;
  const exploit = 8.22 * av! * ac! * pr! * ui!;
  if (impact <= 0) return 0;
  const roundup = (x: number): number => {
    const n = Math.round(x * 100000);
    return n % 10000 === 0 ? n / 100000 : (Math.floor(n / 10000) + 1) / 10;
  };
  return roundup(Math.min(changed ? 1.08 * (impact + exploit) : impact + exploit, 10));
}

export function advisoryFindings(adv: DependencyReport["advisories"], components: Component[]): Finding[] {
  if (adv.status !== "checked" && adv.status !== "stale") return [];
  const byPkg = new Map<string, Advisory[]>();
  for (const a of adv.items) byPkg.set(`${a.ecosystem}:${a.package}@${a.version}`, [...(byPkg.get(`${a.ecosystem}:${a.package}@${a.version}`) ?? []), a]);
  const out: Finding[] = [];
  for (const [key, list] of byPkg) {
    const worst = [...list].sort((a, b) => sevRank(a.severity) - sevRank(b.severity))[0]!;
    const c = components.find((x) => `${x.ecosystem}:${x.name}@${x.version}` === key);
    const severity: Severity = worst.severity === "unknown" ? "medium" : worst.severity;
    out.push(
      makeFinding("dependency/vulnerability", {
        id: `dependency:vuln:${key}`,
        severity,
        title: `${worst.package}@${worst.version}: ${list.length} known ${list.length === 1 ? "vulnerability" : "vulnerabilities"}`,
        message: `${list.map((a) => a.aliases.find((x) => x.startsWith("CVE-")) ?? a.id).slice(0, 4).join(", ")}${list.length > 4 ? ", …" : ""}. ${c ? (c.direct ? `Direct dependency${c.importers !== undefined ? `, imported by ${c.importers} source ${c.importers === 1 ? "file" : "files"}` : ""}.` : "Transitive dependency.") : ""}`,
        why: worst.summary || "A published advisory affects this version.",
        action: "Upgrade to a fixed version (see the advisory), or confirm the vulnerable code path is not used and record the decision.",
        confidence: adv.status === "stale" ? "inferred" : "verified",
        evidence: list.map((a) => ({ type: "dependency" as const, detail: `${a.id}${a.aliases.length ? ` (${a.aliases.slice(0, 2).join(", ")})` : ""} · ${a.severity}: ${a.summary.slice(0, 160)}` })),
        verification: ["Upgrade, then run `fehm health --advisories` again."],
      }),
    );
  }
  return out;
}
